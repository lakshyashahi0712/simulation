# SENTINEL release runbook

This runbook covers the software-only release path. Physical LAN and microphone checks remain a separate acceptance step.

Use Node.js 22 or newer. Run `npm ci` in this folder to install the locked dependencies.

## Configure

```bash
cp .env.example .env
```

In Windows PowerShell, use `Copy-Item .env.example .env` instead.

Set `SENTINEL_ADMIN_TOKEN` and `SENTINEL_DATA_FILE`. `start:release`, `server`, healthcheck, and backup commands load the root `.env`, with shell variables taking precedence. The release build automatically matches `VITE_ADMIN_TOKEN` to the backend token. For separate development terminals (`npm run server` and `npm run web`), set both token variables to the same value.

## Start the release stack

```bash
npm run start:release
```

This builds the web UI to `dist/web`, compiles the server to `dist/server`, then serves the UI, API, and Socket.IO together at **`http://localhost:3001`** by default. Change `PORT` to use another port. There is one long-running server process; Ctrl+C saves persistence and stops it.

For a LAN host, keep `HOST=0.0.0.0` and open `http://<host-LAN-address>:<PORT>` on each client. Use trusted HTTPS by setting both `SENTINEL_TLS_CERT` and `SENTINEL_TLS_KEY` when microphones are required. `SENTINEL_WEB_PORT` and `SENTINEL_API_PROXY` apply to the development Vite server only.

## Check the stack

```bash
npm run healthcheck
SENTINEL_WEB_URL=http://127.0.0.1:3001 npm run healthcheck
```

The check requires a running API and at least one published scenario. Set `SENTINEL_WEB_URL` to also fetch the built shell and all referenced JS/CSS assets. In PowerShell, set `$env:SENTINEL_WEB_URL = 'http://localhost:3001'` before `npm run healthcheck`. For HTTPS, use the certificate's hostname in `SENTINEL_API_URL` / `SENTINEL_WEB_URL` and trust its issuer (for Node, `NODE_EXTRA_CA_CERTS` can point to the issuer certificate).

## Back up exercises

```bash
npm run backup:data
npm run backup:data -- --output data/backups/pre-demo.json
```

Backups copy the configured JSON persistence file, including published scenarios, drafts, event history, decision checkpoints, and hashed credentials. The default output is `data/backups/<name>-<timestamp>.json`. Explicit destinations must be new files; existing backups are never replaced. A persistence file is created after the first draft/session save or clean shutdown.

### Restore

1. Stop the server with Ctrl+C.
2. Preserve the current file by running `npm run backup:data`.
3. Copy the chosen backup to the path configured by `SENTINEL_DATA_FILE`:

   ```bash
   cp data/backups/pre-demo.json data/sentinel.json
   ```

   PowerShell: `Copy-Item data/backups/pre-demo.json data/sentinel.json`.

4. Run `npm run start:release` and `npm run healthcheck`.
5. Running sessions restore paused; instructors resume them. Completed sessions remain read-only.

## Verify before handoff

```bash
npm run typecheck
npm test
npm run test:acceptance
npm run test:synthetic
npm run test:browser
npm run web:build
npm run build:server
```

`test:browser` builds the UI and starts an isolated in-memory server on a free port. It uses an external gstack browser executable configured with `SENTINEL_BROWSER_BIN` or discovered in the user's `.gstack/bin` / skills folders. This WSL setup has a native wrapper that supplies its Bun runtime and rootless Chromium libraries; Windows `browse.exe` remains a discovery fallback. It creates and closes its own browser tabs and server. Results and desktop/mobile screenshots are written to `data/browser-smoke/`.

The flow covers draft creation, unsaved-edit recovery after reload, world/access edits, reports/decisions/rules, linked validation errors, publication, real WebGL rendering, role-filtered objects, owned-object movement, keyboard/mobile controls, plan/context-loss fallback, acknowledged decisions, AAR/counterfactual UI, and mobile overflow checks. It does not require microphones or additional laptops.
