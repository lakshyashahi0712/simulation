# SENTINEL LAN validation runbook

## Host setup

Use Node.js 22 or newer and one host for the built UI, API, and Socket.IO. Configure the root `.env` from `.env.example` as described in the [release runbook](release-runbook.md), keeping `HOST=0.0.0.0`. From the project directory:

```bash
npm ci
npm run start:release
```

Wait for the `SENTINEL ready` message. On the host, open `http://localhost:3001`. Other laptops use `http://<host-LAN-IP>:3001` for text and decision testing. The UI, `/api`, `/health`, and `/socket.io` share one origin; clients do not need to configure a separate backend address. Substitute your configured `PORT` if changed.

Allow the release port (3001 by default) through the host firewall on the local network. When running inside WSL, confirm that the Windows LAN address reaches the release server; mirrored networking or an appropriate port-forward may be required.

### Windows PowerShell quick start

Run PowerShell from the project folder. Keep this terminal open while the host is serving SENTINEL.

```powershell
cd "C:\Users\<user>\OneDrive\Desktop\simulation"
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
npm ci
npm run start:release
```

Find the host address in a second PowerShell window:

```powershell
ipconfig
```

Use the IPv4 address from the active Wi-Fi or Ethernet adapter, for example `192.168.1.25`. On each trainee laptop, open `http://192.168.1.25:3001`. If another laptop cannot connect, allow Node.js or TCP port 3001 through **Windows Defender Firewall → Allow an app through firewall** on the Private network. An administrator can add a scoped rule with:

```powershell
New-NetFirewallRule -DisplayName "SENTINEL 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private
```

This HTTP path is sufficient for text, decisions, and movement testing. Use the trusted HTTPS setup below before testing physical microphones.

## Trusted HTTPS for microphone access

Browsers allow microphone capture on localhost or a trusted HTTPS origin. Plain HTTP on a LAN IP does not provide microphone access.

1. Use a local development certificate tool such as `mkcert` to create a certificate containing the host LAN IP and `localhost`. For example, from a directory named `.certs`:

   ```bash
   mkcert -install
   mkcert -cert-file sentinel.pem -key-file sentinel-key.pem localhost 127.0.0.1 <host-LAN-IP>
   ```

2. Trust the issuing local CA on each trainee laptop. A certificate warning alone may still leave the origin unsuitable for microphone capture. Keep the CA private key on the host; only the public CA certificate needs to be installed on the other laptops.
3. Stop the HTTP release server, then set the certificate/key paths in root `.env` or the release terminal:

   Bash:

   ```bash
   SENTINEL_TLS_CERT="$PWD/.certs/sentinel.pem" SENTINEL_TLS_KEY="$PWD/.certs/sentinel-key.pem" npm run start:release
   ```

   PowerShell:

   ```powershell
   $env:SENTINEL_TLS_CERT = "$PWD/.certs/sentinel.pem"
   $env:SENTINEL_TLS_KEY = "$PWD/.certs/sentinel-key.pem"
   npm run start:release
   ```

4. Open `https://<host-LAN-IP>:3001` on all laptops (or your configured `PORT`). Built assets, API requests, and authenticated WebSockets all use this HTTPS origin. The release build selects same-origin API access automatically.

## Four-laptop acceptance pass

| Laptop | Role |
| --- | --- |
| 1 | Instructor |
| 2 | Commander |
| 3 | Operations |
| 4 | Communications/EW |

1. Instructor creates an Operation Signal Break room. Trainees join with its room code and distinct roles.
2. Instructor verifies all three trainees are linked, then starts the exercise.
3. Confirm synchronized simulation time and role-scoped reports.
4. Operations sends a message on Alpha Link. Confirm Commander receives it and Communications/EW does not receive Alpha Link content.
5. Instructor injects a 45-second Alpha Link delay. Send another message. It must be absent at the recipient until 45 simulation seconds pass.
6. Inject an outage. Send a message; inspect its drop in the instructor audit stream. Restore the channel and verify subsequent messages arrive.
7. Select Bravo Link in the text composer to exercise backup coordination.
8. Everyone explicitly joins Command Net voice, grants microphone permission, and holds **Hold to talk** while speaking. Check audio in both directions using headphones. Leave voice and confirm remote audio stops.
9. Disconnect a trainee network connection. Queue a text message, refresh the same tab, reconnect, and confirm it appears once. Instructor controls should not be queued while offline.
10. Advance to the decision gate. Commander submits rationale and confidence. Confirm one decision record with its perception snapshot.
11. Stop and restart the backend using the same data file. Participants should reconnect; the session must be paused. Resume from the instructor console. Rejoin voice explicitly.
12. End the exercise. Open TruthLens, change perception role, scrub the timeline, inspect decision provenance and scoring, export JSON, and use **Print / PDF**.
13. Restart the backend once more, refresh the instructor tab, and reopen AAR for the ended session. Its events and decisions must remain unchanged.

Per-tab session credentials restore existing participants. Opening a fresh tab without the credential creates a new join rather than recovering the old identity. A taken role is not released just because its laptop goes offline.

## Evidence to record

- Device/browser versions and the host URL.
- Room code and tested scenario version.
- Screenshots of linked participants and the decision snapshot.
- Successful text delay/drop/backup results.
- Audio direction checks, microphone permission results, and any echo.
- Pending-action count before/after reconnect and restart.
- Exported AAR JSON and printable report.
- Any failures with reproduction steps and console errors.

Use [the Phase B evidence sheet](phase-b-evidence.md) to record the result of each gate. Mark a gate **PASS**, **FAIL**, or **BLOCKED**; do not treat a one-machine synthetic client as physical-device evidence.

## Current verification boundary

Local automated tests exercise four independent Socket.IO clients, restarted server instances, private-channel text, duplicate retries, and voice signaling isolation. Browser verification uses two tabs and synthetic audio to exercise real WebRTC transport. Physical microphones, separate computers, Wi-Fi isolation/firewall behavior, and certificate trust still need this LAN pass.
