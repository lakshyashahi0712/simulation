# SENTINEL implementation roadmap

This roadmap tracks the original product contract, completed work, and the next product phase. The authoritative requirements are [product-contract.md](product-contract.md) and [acceptance-test.md](acceptance-test.md); executed checks are recorded in [release-validation.md](release-validation.md).

## Product and constraints

- Forge creates and validates synthetic exercises without source changes.
- Exercise runs an instructor and Commander, Operations/Intelligence, and Communications/EW roles against an authoritative server.
- TruthLens assesses decisions using the information actually available at decision time and explains alternate simulations.
- Military, disaster, and custom presets share one schema/engine. Gemini drafts are optional and always validated.
- Web-based, LAN-first or free-public HTTPS, lightweight enough for the Ryzen 3 3200U / integrated GPU / 12 GB host. VR is deferred.
- All data and interactions remain fictional/synthetic.
- Feature freeze: **17 October**. Testing/fixes: **18–19 October**. Deadline: **20 October**.

## Completed workstreams

| Workstream | Delivered |
| --- | --- |
| Phase 0: foundation | Product contract, scenario schema, supported object/rule catalog, acceptance procedure |
| Phase 1: simulation | Clock, event log, role-scoped reports/faults, decisions, rules, explainable scoring, simplified physics, snapshots |
| Phase 2: multiplayer | Rooms, role assignment, synchronized consoles, instructor controls, text, reconnect/outbox behavior, and opt-in push-to-talk voice |
| Reliability | Durable action receipts/outbox, reconnect, paused running-session recovery, read-only ended-session recovery |
| Forge core | Reports, gates/options, rules, timeline, channels, scoring/objectives, world/access controls, validation links, publication, browser draft recovery, optional Gemini drafts, authored timeline preview, and scenario-library search/tags/archive/version history |
| TruthLens core | Historical deliveries/perception, decision provenance, report lifecycle information-flow view, isolated actual/alternate future replay, scoring evidence, export/print |
| Release hardening | Automated browser/synthetic/transport checks, one-port built release, cached static shell, environment loading, optional HTTPS, healthchecks, no-overwrite backups and tested restore |
| 3D playground core | Shared Forge/live Three.js viewer, primitive object models, cameras/selection, authoritative owned-object movement, physical trigger entry, mobile controls, plan/context-loss fallback, resource cleanup |
| Visual rule graph | Connected typed trigger/condition/action nodes, compatible port ordering, drag/keyboard layout, inspector/reference validation, persistent layouts, read-only publication, live execution and TruthLens evidence |
| Signal Ledger UI and documentation | Product-wide visual redesign, responsive desktop/mobile evidence, design-system documentation, scoped finish review, and validation-link focus regression fix |

## Phase 1 free-hosting review

Phase 1 was reviewed against the standing [free-hosting constraints](free-hosting-constraints.md) after the SIH online-demo requirement was added.

| Gate | Status | Evidence or boundary |
| --- | --- | --- |
| Authoritative simulation runs inside the deployed Node process | **PASS** | The server owns the clock, event log, reports, decisions, rules, scoring, and snapshots. |
| Public platform port and host are configurable | **PASS** | `PORT` and `HOST` are read from the environment; `render.yaml` uses `HOST=0.0.0.0`. |
| UI, API, and Socket.IO share one public origin | **PASS** | The release build uses `window.location.origin`; Render terminates HTTPS and proxies the service. |
| A judge can become instructor without the project owner | **PASS** | Any visitor can create a room; the room creator receives the instructor participant token. |
| Included presets work without cloud data or Gemini | **PASS** | Presets are compiled into the server and Gemini has a local fallback. |
| Free-service restart/cold-start behavior is understood | **PASS WITH LIMITATION** | The service may wake slowly; ephemeral `/tmp` persistence can lose drafts and sessions after restart. |
| Public voice works on every network | **OPEN / OPTIONAL** | Direct WebRTC is supported, but reliable cross-network voice may require TURN; voice is not a judging gate. |
| Clean public container deployment | **OPEN ACCEPTANCE GATE** | Must be verified from the GitHub → Render Free deployment before the public judge link is announced. |

### Phase 1 public acceptance gate

Phase 1 is online-demo ready when a clean free deployment passes `/health`, lists the three included published presets, lets a new visitor create a room, connects at least two browser clients over Socket.IO, advances a preset, records a decision, and opens the AAR without the project owner being present.

## Phase 2 free-hosting review

Phase 2 was reviewed for the public SIH judge path. The deployed service remains the multiplayer authority, while the visitor who creates a room becomes that room's instructor.

| Gate | Status | Evidence or boundary |
| --- | --- | --- |
| Judge-created room and instructor authority | **PASS** | `POST /api/sessions` creates a room for the visitor; instructor-only controls are checked by participant token and server role. |
| Public Socket.IO transport | **PASS** | The browser prefers WebSocket and falls back to polling for restrictive networks; both use the deployed same-origin HTTPS endpoint. |
| Four-client synchronization and role isolation | **PASS** | Automated acceptance covers four clients, synchronized time, trainee ground-truth exclusion, private channels, and server-authoritative actions. |
| Reconnect and queued text/decision actions | **PASS** | Per-tab credentials, action receipts, outbox retry, and state reconciliation are covered by the acceptance suite. |
| Free public voice baseline | **BEST EFFORT** | Free public STUN servers are used for peer discovery; TURN relay is not required for the judging flow and remains unavailable on the zero-cost baseline. |
| Free-service restart behavior | **PASS WITH LIMITATION** | Reconnect works while the service remains alive; a free-service restart may pause/lose ephemeral sessions depending on deployment storage. |

### Phase 2 public acceptance gate

Phase 2 is online-demo ready when a judge can open the public URL, create a room without the project owner, join multiple browser clients over HTTPS, run text/decision synchronization, reconnect a client, and retain role isolation. Voice is demonstrated only when the network permits direct WebRTC; it is not a release blocker for the free deployment.

## Visual rule graph: completed

Completed on **October 7, 2026**:

1. Show one trigger, each all-required condition, and ordered actions as connected nodes.
2. Add/remove/change/reorder supported nodes using typed fields, compatible ports, and inspector controls; arrange layouts with drag, keyboard, fit/focus, and pan/zoom.
3. Retain reference selectors and publication validation, including node/field focus from validation links.
4. Store executable arrays and optional versioned layout metadata in schema `1.0`; retain them through draft recovery, save, publication, duplication, and JSON import/export.
5. Publish a browser-authored graph, execute its alert and score action in a live exercise, and verify its effects in the actual TruthLens branch and exclusion from the alternate choice.

**Completion gate passed:** six graph regressions plus two browser E2E tests, with 30 checks and nine inspected screenshots. The full software suite contains 66 passing tests across 14 files. See [release-validation.md](release-validation.md) for evidence.

## Latest verification and presentation pass

Completed on **October 9, 2026**:

- Reworked the launcher, Forge, instructor console, trainee console, 3D playground, visual rule graph, and TruthLens around the Signal Ledger design system.
- Added desktop and 375px mobile evidence for the main product surfaces.
- Fixed a React commit-timing race where a validation link could select the right graph node but leave focus on the inspector selector instead of the invalid field.
- Verified the current build with 66 automated tests, two browser E2E tests with 33 checks, six synthetic four-client checks, typecheck, web build, and server build.

The browser workflow is software-only. Four physical laptops, microphones, trusted HTTPS, target-network behavior, and target-host performance remain part of physical acceptance.

## Next: demo and contract reconciliation

- Refine the three preset walkthroughs: briefing, disruption, uncertainty, decision, and an understandable AAR/alternate comparison.
- Rehearse the now-implemented cached shell, scenario-library tags/archive/version history, authored timeline preview, and information-flow graph as visible parts of the demo.
- Run Forge → publication → role joins → exercise → decision → TruthLens → export → restart/recovery.
- Check performance on the target host using real exercise interactions, including multiple browser clients.
- Freeze features by 17 October and use 18–19 October for regression, fixes, and rehearsal.

## Physical acceptance

When laptops/microphones are available, run [lan-validation.md](lan-validation.md): four separate devices, trusted HTTPS, two-way audio, text delay/drop/backup, reconnect, paused restore, and completed AAR recovery.

Automated single-machine evidence does not complete physical acceptance. Voice is currently direct WebRTC; physics uses approximate bounds rather than full rigid-body simulation. Later human inputs in counterfactuals are held constant.
