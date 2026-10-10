# Public SIH judge demo deployment

This project can be deployed at zero cost for an SIH demonstration. The recommended path is a Render Free Docker web service, which supplies a public HTTPS URL and supports WebSocket upgrades for Socket.IO. It uses a generated `onrender.com` address, so a paid domain is not required.

## Before deploying

- Keep all exercise data fictional and synthetic.
- Push the project to a private or public GitHub repository.
- Use the included presets for the first judge demo; they do not require a persisted scenario file.
- The current prototype uses a shared admin token in the browser for Forge. This is acceptable only for a controlled synthetic demonstration, not for sensitive or production data.

## Render Free quick path

1. Push the project to GitHub, including `Dockerfile`, `.dockerignore`, and `render.yaml`.
2. Create or sign in to a Render account at <https://render.com>.
3. Select **New → Blueprint**.
4. Choose the repository containing SENTINEL.
5. Confirm the service name `sentinel-sih-demo` and deploy.
6. Wait for the `/health` check to become healthy.
7. Open the generated URL, such as `https://sentinel-sih-demo.onrender.com`.

The Docker image builds the web assets and server once during deployment, then starts the compiled one-port server. This avoids rebuilding on every free-plan wake-up. Render supplies the public TLS certificate. Do not use `mkcert` for the public URL.

The free plan may sleep after inactivity, so open the URL a few minutes before the judging session and allow up to a minute for the first request. No paid plan is required for a short demonstration.

## Judge demo flow

The public Render service is the authoritative backend, but it does not permanently own a training room. The person who clicks **Create exercise room** becomes the instructor for that room. You do not need to be online, and you do not need to create a room before judges arrive.

1. A judge opens the public URL.
2. The judge selects a published included preset from the launcher and clicks **Create exercise room**. That browser becomes the instructor console.
3. The judge shares the room code with the other judges or opens additional tabs/devices.
4. Participants join as Commander, Operations / Intelligence, and Communications / EW.
5. The instructor starts the exercise, advances the clock, submits the Commander decision, ends the exercise, and opens TruthLens.
6. The judges can show the report lifecycle, decision-time evidence, and alternate replay.

If a judge wants to demonstrate authoring, they can instead open Forge, create/publish a draft, return to the launcher, and create a room from that published version. The room uses the published scenario snapshot created at that time.

## Durable storage

The blueprint uses `/tmp/sentinel.json` so the free demo can start without storage setup. A service restart or redeploy can erase drafts and completed sessions on the free plan. Use the included published presets for the judge flow and do not depend on a draft surviving a restart. You can keep local backups at no cost. Persistent cloud storage is optional, not required for the demo.

If you later choose a paid persistent disk, mount it at `/var/lib/sentinel` and set:

```text
SENTINEL_DATA_FILE=/var/lib/sentinel/sentinel.json
```

Keep a backup of the final demo data outside the service.

## Free Windows fallback: Cloudflare Quick Tunnel

If Render is unavailable, keep SENTINEL running on your Windows laptop and expose it temporarily with a free Cloudflare Quick Tunnel.

1. Install `cloudflared` from <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>.
2. Start SENTINEL locally:

   ```powershell
   npm run start:release
   ```

3. In a second PowerShell window, run:

   ```powershell
   cloudflared tunnel --url http://localhost:3001
   ```

4. Give judges the generated `https://*.trycloudflare.com` URL.

This option has no hosting bill and provides HTTPS, but the URL is temporary, the Windows laptop must remain awake and connected, and the tunnel can stop. Render Free is better for a stable SIH link.

## Public deployment hardening still required

- Replace the shared prototype admin token with real authentication before broad public use.
- Add rate limiting and production access controls.
- Use persistent storage and scheduled backups.
- Add a TURN service if voice must work across restrictive networks.
- Monitor service logs and rehearse a restart before the judging session.

## Zero-cost recommendation

Use GitHub Free, Render Free, the generated Render HTTPS URL, and the three included published presets. Warm the service before the judges arrive, keep a local copy of the project and evidence, and demonstrate text, decisions, TruthLens, and alternate replay without making voice a required judging step.
