import type { Socket } from "socket.io";
import type { SessionManager } from "./session-manager.js";
import type { VoiceJoinResult, VoiceSignal } from "./protocol.js";

interface Member { socket: Socket; sessionId: string; participantId: string; channelId: string }

/** Membership and signaling only. Audio stays on the opted-in WebRTC peers. */
export class VoiceRooms {
  private readonly members = new Map<string, Member>();

  constructor(private readonly manager: SessionManager) {}

  attach(socket: Socket, sessionId: string, participantId: string): void {
    socket.on("voice:join", (payload: { channelId?: string }, ack?: (result: VoiceJoinResult) => void) => {
      try {
        if (typeof payload?.channelId !== "string") throw new Error("Choose a voice channel.");
        this.manager.assertVoiceChannel(sessionId, participantId, payload.channelId);
        this.leave(socket.id);
        const member: Member = { socket, sessionId, participantId, channelId: payload.channelId };
        const peers = this.peers(member);
        this.members.set(socket.id, member);
        peers.forEach((peer) => peer.socket.emit("voice:peer-joined", { participantId, channelId: member.channelId }));
        if (typeof ack === "function") ack({ channelId: member.channelId, peers: peers.map((peer) => peer.participantId) });
      } catch (error) {
        if (typeof ack === "function") ack({ channelId: payload?.channelId ?? "", peers: [], error: error instanceof Error ? error.message : "Voice unavailable." });
      }
    });
    socket.on("voice:leave", () => this.leave(socket.id));
    socket.on("voice:signal", (payload: { targetParticipantId?: string; signal?: unknown }) => {
      const sender = this.members.get(socket.id);
      if (!sender || !validSignal(payload?.signal)) return;
      const target = this.peers(sender).find((peer) => peer.participantId === payload.targetParticipantId);
      if (!target) return;
      try {
        this.manager.assertVoiceChannel(sessionId, participantId, sender.channelId);
        this.manager.assertVoiceChannel(target.sessionId, target.participantId, target.channelId);
        target.socket.emit("voice:signal", { fromParticipantId: participantId, channelId: sender.channelId, signal: payload.signal });
      } catch { this.leave(socket.id); }
    });
    socket.on("disconnect", () => this.leave(socket.id));
  }

  closeSession(sessionId: string): void {
    for (const member of [...this.members.values()]) {
      if (member.sessionId !== sessionId) continue;
      member.socket.emit("voice:closed", { reason: "Exercise completed." });
      this.leave(member.socket.id);
    }
  }

  reconcileSession(sessionId: string): void {
    for (const member of [...this.members.values()]) {
      if (member.sessionId !== sessionId) continue;
      try { this.manager.assertVoiceChannel(sessionId, member.participantId, member.channelId); }
      catch {
        member.socket.emit("voice:closed", { reason: "Voice membership is no longer available." });
        this.leave(member.socket.id);
      }
    }
  }

  private leave(socketId: string): void {
    const member = this.members.get(socketId);
    if (!member) return;
    this.members.delete(socketId);
    this.peers(member).forEach((peer) => peer.socket.emit("voice:peer-left", { participantId: member.participantId, channelId: member.channelId }));
  }

  private peers(member: Member): Member[] {
    return [...this.members.values()].filter((peer) => peer.socket.id !== member.socket.id && peer.sessionId === member.sessionId && peer.channelId === member.channelId);
  }
}

function validSignal(value: unknown): value is VoiceSignal {
  if (!value || typeof value !== "object") return false;
  const signal = value as VoiceSignal;
  if (signal.description) return ["offer", "answer"].includes(signal.description.type) && typeof signal.description.sdp === "string" && signal.description.sdp.length <= 65536;
  return Boolean(signal.candidate && typeof signal.candidate.candidate === "string" && signal.candidate.candidate.length <= 8192);
}
