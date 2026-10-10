import type { Socket } from "socket.io-client";
import type { VoiceJoinResult, VoiceSignal } from "../../src/server/protocol.js";

interface PeerState {
  connection: RTCPeerConnection;
  candidates: RTCIceCandidateInit[];
  work: Promise<void>;
  audio: HTMLAudioElement | null;
}

// Best-effort free STUN improves peer discovery across ordinary home/NAT
// networks. Voice remains optional; networks requiring relay still need TURN.
const FREE_STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

export class VoiceClient {
  private stream: MediaStream | null = null;
  private readonly peers = new Map<string, PeerState>();
  private channelId = "";
  private generation = 0;
  private disposed = false;

  constructor(private readonly socket: Socket, private readonly report: (enabled: boolean, error?: string) => void) {
    socket.on("voice:peer-joined", this.onPeerJoined);
    socket.on("voice:peer-left", this.onPeerLeft);
    socket.on("voice:signal", this.onSignal);
    socket.on("disconnect", this.onDisconnect);
    socket.on("voice:closed", this.onClosed);
  }

  async join(channelId: string): Promise<void> {
    this.leave();
    const generation = this.generation;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture needs HTTPS or localhost. See the LAN runbook.");
      if (!this.socket.connected) throw new Error("Reconnect before joining voice.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation || this.disposed) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      this.talk(false);
      this.channelId = channelId;
      const result = await new Promise<VoiceJoinResult>((resolve, reject) => {
        this.socket.timeout(5000).emit("voice:join", { channelId }, (error: Error | null, data: VoiceJoinResult) => error ? reject(error) : resolve(data));
      });
      if (generation !== this.generation || this.disposed) return;
      if (result.error) throw new Error(result.error);
      this.report(true);
      // The newcomer offers. Existing opted-in peers only answer, avoiding glare.
      for (const participantId of result.peers) {
        const state = this.getPeer(participantId);
        this.enqueue(state, async () => {
          const offer = await state.connection.createOffer();
          await state.connection.setLocalDescription(offer);
          this.send(participantId, { description: { type: "offer", sdp: offer.sdp ?? "" } });
        });
      }
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.leave();
      this.report(false, error instanceof Error ? error.message : "Voice connection failed.");
    }
  }

  talk(enabled: boolean): void {
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = enabled && this.socket.connected; });
  }

  leave(): void {
    this.generation += 1;
    if (this.channelId && this.socket.connected) this.socket.emit("voice:leave");
    this.channelId = "";
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    if (!this.disposed) this.report(false);
  }

  dispose(): void {
    this.disposed = true;
    this.leave();
    this.socket.off("voice:peer-joined", this.onPeerJoined);
    this.socket.off("voice:peer-left", this.onPeerLeft);
    this.socket.off("voice:signal", this.onSignal);
    this.socket.off("disconnect", this.onDisconnect);
    this.socket.off("voice:closed", this.onClosed);
  }

  private onPeerJoined = ({ participantId, channelId }: { participantId: string; channelId: string }) => {
    if (this.stream && channelId === this.channelId) this.getPeer(participantId);
  };
  private onPeerLeft = ({ participantId, channelId }: { participantId: string; channelId: string }) => {
    if (channelId === this.channelId) this.closePeer(participantId);
  };
  private onDisconnect = () => { this.leave(); this.report(false, "Voice disconnected. Join again once linked."); };
  private onClosed = () => this.leave();
  private onSignal = ({ fromParticipantId, channelId, signal }: { fromParticipantId: string; channelId: string; signal: VoiceSignal }) => {
    if (!this.stream || channelId !== this.channelId) return;
    const state = this.getPeer(fromParticipantId);
    this.enqueue(state, async () => {
      const peer = state.connection;
      if (signal.description) {
        await peer.setRemoteDescription(signal.description);
        if (signal.description.type === "offer") {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          this.send(fromParticipantId, { description: { type: "answer", sdp: answer.sdp ?? "" } });
        }
        for (const candidate of state.candidates.splice(0)) await peer.addIceCandidate(candidate);
      }
      if (signal.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
        else state.candidates.push(signal.candidate);
      }
    });
  };

  private getPeer(id: string): PeerState {
    const existing = this.peers.get(id);
    if (existing) return existing;
    const connection = new RTCPeerConnection({ iceServers: FREE_STUN_SERVERS });
    const state: PeerState = { connection, candidates: [], work: Promise.resolve(), audio: null };
    this.peers.set(id, state);
    this.stream?.getTracks().forEach((track) => connection.addTrack(track, this.stream as MediaStream));
    connection.onicecandidate = (event) => {
      if (event.candidate) this.send(id, { candidate: event.candidate.toJSON() as NonNullable<VoiceSignal["candidate"]> });
    };
    connection.ontrack = (event) => {
      const audio = state.audio ?? document.createElement("audio");
      audio.autoplay = true;
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      audio.hidden = true;
      if (!audio.parentElement) document.body.appendChild(audio);
      state.audio = audio;
      void audio.play().catch(() => this.report(true, "Allow audio playback in the browser to hear peers."));
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed") { this.closePeer(id); this.report(true, "A voice peer failed to connect. Leave and rejoin voice."); }
    };
    return state;
  }

  private closePeer(id: string): void {
    const state = this.peers.get(id);
    if (!state) return;
    this.peers.delete(id);
    state.connection.onconnectionstatechange = null;
    state.connection.ontrack = null;
    state.connection.onicecandidate = null;
    state.connection.close();
    if (state.audio) { state.audio.pause(); state.audio.srcObject = null; state.audio.remove(); }
  }

  private enqueue(state: PeerState, work: () => Promise<void>): void {
    state.work = state.work.then(() => state.connection.signalingState === "closed" ? undefined : work()).catch((error: Error) => {
      if (!this.disposed && state.connection.signalingState !== "closed") this.report(true, error.message);
    });
  }

  private send(targetParticipantId: string, signal: VoiceSignal): void {
    if (this.socket.connected && this.channelId) this.socket.emit("voice:signal", { targetParticipantId, signal });
  }
}
