import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { SessionView } from "../../src/server/protocol.js";
import { VoiceClient } from "./voice-client.js";

export function VoiceControls({ view, socket }: { view: SessionView; socket: Socket | null }) {
  const [enabled, setEnabled] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState(view.scenario.channels[0]?.id ?? "");
  const [talking, setTalking] = useState(false);
  const clientRef = useRef<VoiceClient | null>(null);
  const channels = view.scenario.channels.filter((channel) => channel.status === "active");

  useEffect(() => {
    if (!socket) return;
    const client = new VoiceClient(socket, (active, message) => {
      setEnabled(active);
      if (!active) setTalking(false);
      setError(message ?? null);
    });
    clientRef.current = client;
    const stopTalking = () => { client.talk(false); setTalking(false); };
    window.addEventListener("blur", stopTalking);
    document.addEventListener("visibilitychange", stopTalking);
    return () => {
      client.dispose();
      clientRef.current = null;
      window.removeEventListener("blur", stopTalking);
      document.removeEventListener("visibilitychange", stopTalking);
    };
  }, [socket]);

  useEffect(() => {
    if (view.session.status === "ended") clientRef.current?.leave();
    if (!channels.some((channel) => channel.id === channelId)) {
      clientRef.current?.leave();
      setChannelId(channels[0]?.id ?? "");
    }
  }, [view.session.status, view.scenario.channels, channelId]);

  async function join() {
    setJoining(true);
    await clientRef.current?.join(channelId);
    setJoining(false);
  }
  function talk(active: boolean) { clientRef.current?.talk(active); setTalking(active); }

  return <div className="voice-control">
    <select aria-label="Voice channel" value={channelId} disabled={enabled || joining} onChange={(event) => setChannelId(event.target.value)}>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select>
    <button className={`button ${enabled ? "button-warning" : "button-ghost"}`} disabled={joining || !socket?.connected || !channelId || view.session.status === "ended"} onClick={() => enabled ? clientRef.current?.leave() : void join()}>{joining ? "Joining voice…" : enabled ? "Leave voice" : "Join voice"}</button>
    {enabled && <button className={`button ${talking ? "button-primary" : "button-ghost"}`} aria-label="Push to talk" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); talk(true); }} onPointerUp={() => talk(false)} onPointerCancel={() => talk(false)} onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); talk(true); } }} onKeyUp={() => talk(false)} onBlur={() => talk(false)}>{talking ? "Transmitting" : "Hold to talk"}</button>}
    {error && <span className="voice-error" role="status">{error}</span>}
  </div>;
}
