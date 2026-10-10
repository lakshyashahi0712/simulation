# Release validation phase

## Implemented in this phase

- Restore ended sessions as authenticated, read-only sessions from their stored scenario and engine snapshots.
- Keep AAR, replay, and score comparisons available after restart.
- Persist text/decision action receipts and acknowledge retries without applying the action again.
- Store the browser outbox in per-session tab storage; remove entries only after an authoritative acceptance or rejection.
- Wait for restored server state before sending pending actions. Running sessions recover paused; pending actions wait for instructor resume.
- Apply communication delay to actual text-delivery time and preserve pending text across restart.
- Include delivered role-visible text in decision perception snapshots.
- Limit voice signaling to opted-in members of the same session and channel.
- Close voice peers and microphone tracks on leave, disconnect, unmount, or exercise completion.
- Buffer early ICE candidates and serialize SDP negotiation. Newcomers offer; existing members answer.
- Add channel selection and hold-to-talk controls.
- Proxy API/WebSocket traffic through Vite and support a configured HTTPS certificate/key for LAN microphones.
- Freeze exact delivered report content in the event log and reconstruct historical reports, text, and decision-gate lifecycle from deliveries up to the selected time.
- Expose instructor-only historical perception through `GET /api/sessions/:sessionId/perception?roleId=...&atSeconds=...`.
- Persist flat pre-decision checkpoints; isolate actual and alternate future replays from the original exercise.
- Replay subsequent recorded instructor controls, text, movement, interactions, and decisions, listing invalid inputs or inputs after branch termination as skipped.
- Include the selected decision and immediate rule effects in branch scores, with per-dimension evidence and downstream events, role perceptions, and object states.
- Stop rule actions and event processing when the exercise ends; synchronize rule-ended session status immediately.
- Add a repeatable synthetic four-client command with a credential-free JSON evidence artifact.
- Add a production one-origin stack, `.env.example`, healthcheck, JSON persistence backup command, built asset validation, and release runbook.
- Add separate browser smoke coverage for draft recovery, Forge validation/publication, trainee decisions, exercise start/end, and actual/alternate TruthLens evidence.

## Verification evidence

Latest software verification on **October 9, 2026** (HTTP/HTTPS deployment probes below retain their October 7 evidence):

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | **66 tests across 14 files passed** |
| Acceptance transport/outbox coverage | **6 tests passed within the full suite**; separately runnable as `npm run test:acceptance` |
| `npm run test:synthetic -- --output data/synthetic-acceptance.json` | All six checks passed; credential-free evidence saved |
| `npm run test:browser` | Two E2E tests passed; **33 checks and 15 screenshots** saved and inspected |
| Web build | Passed; 81 modules with a separately loaded graphics chunk |
| `npm run build:server` | Passed; standalone compiled server output |
| One-port HTTP release | Built UI/API/Socket.IO started on isolated port 3324; API, catalog, shell, and assets passed healthcheck |
| One-port HTTPS release | Started on isolated port 3325 with a temporary local certificate; API, shell/assets, authenticated WSS state, and start/end controls passed with certificate verification enabled |
| JSON backup/restore | Real active-session backup, paused recovery, credential preservation, and refusal to replace an existing backup passed |

The browser smoke is separate from `npm test` because it requires the external gstack browser executable. These checks use isolated sessions/persistence, not physical laptops or microphones.

### Automated acceptance

`npm run test:acceptance` covers:

- Instructor plus Commander, Operations, and Communications/EW clients on real HTTP/WebSocket transports.
- Synchronized simulation time and trainee ground-truth isolation.
- 45-second text delay, private-channel isolation, and delivery once after reconnect.
- Repeated text/decision action IDs and durable receipts across restart.
- Running-session recovery as paused; completed-session recovery and unchanged AAR data.
- Instructor-only AAR/counterfactual access and rejection of mutations on completed sessions.
- Opt-in voice discovery, same-channel/session signal relay, unauthorized join rejection, disconnect notification, and exercise-end cleanup.
- Browser outbox persistence after lost acknowledgements/refresh, duplicate-decision prevention, and definitive rejection handling.
- Instructor-only historical perception, invalid time rejection, and completed-session checkpoint/branch availability after restart.

`test/replay.test.ts` covers historical report revisions, future evidence exclusion, frozen content, legacy template fallback, gate submission/expiry, immediate score/state differences, later controls/text/movement/interactions, deterministic snapshot restoration, original-state immutability, early-ending branches, flat checkpoints, legacy score-only fallback, and immediate read-only transition for a rule-ended session.

### Single-machine synthetic acceptance

```bash
npm run test:synthetic
npm run test:synthetic -- --output data/demo-evidence.json
```

This command runs one instructor and three trainees against an isolated in-memory server using a free loopback port. Six logged checks validate HTTP/WebSocket joining, synchronized role-scoped state, a 45-second private text delay and reconnect/retry, decision-time evidence, historical perception and alternate future reports, and instructor authorization. The JSON contains the checks, AAR, and actual/alternate comparison, without participant credentials. It does not read or change `data/sentinel.json`.

The command uses the existing scoring rules: different future reports can have equal scores when no rule scores that difference. Branch score totals cover the selected decision onward, not the entire exercise.

### Live browser pass

An isolated backend on port 3012 and Vite proxy on port 5182 were used, with a temporary persistence file rather than the project's exercise data:

- Instructor and trainee consoles linked through the same-origin proxy.
- Two opted-in WebRTC peers reached `connected` state and created remote audio elements.
- The receiver reported inbound RTP packets and non-zero `totalAudioEnergy` from a synthetic oscillator source. This validates browser signaling/audio transport, not physical microphone quality.
- Backend shutdown closed peers and removed remote audio elements.
- A trainee queued text while disconnected; the queue survived a refresh.
- Backend restart restored the session paused, retaining the pending action. Instructor resume delivered it and cleared the acknowledged outbox.
- A second restart after completion restored the ended instructor console and reopened TruthLens.

An additional historical/branch UI pass used an isolated in-memory fixture on backend port 3013 and web port 5183:

- A report ID was delivered at 0s and again at 30s. Scrubbing to 5s showed the original timestamp and excluded the later delivery and text sent at 10s.
- The actual verification branch contained `late-verification-report`; the alternate North-route branch did not.
- Selecting the backup route and changing the rationale updated the comparison and scored evidence; both branches rendered side by side.
- At 375px width, the branch panels stacked and the page had no horizontal overflow. Desktop and mobile screenshots were inspected.
- JSON comparison export, decision-time provenance, and score-dimension evidence are exposed by the UI. Physical microphones/LAN devices were not used in this pass.

On this Windows/WSL-mounted workspace, the Vite process retained cached modules after file edits; restarting Vite was necessary to verify the latest source in the browser.

## Forge authoring continuation

Completed on October 5, 2026:

- Add no-code editors for reports, decision gates/options, all schema-supported rule triggers/conditions/actions, scheduled events, channel membership/backups, scoring dimensions, and objectives.
- Keep decision activation metadata and executable timeline events synchronized; switching to rule activation removes its old timed events.
- Keep report recipient visibility synchronized and allocate stable, collision-free entity/option IDs.
- Explain and block deletion of referenced reports, channels, options, rules, objectives, and scoring dimensions; keep published forms read-only.
- Validate option ownership, non-empty recipients/content, rule references/numbers/actions, decision activation, scoring weights, objective references, and timeline bounds with field-specific errors.
- Save current form edits before validation or publication, stop publication on a save failure, and show unsaved state. Editing clears stale validation results.
- Add playable Flood Response and Custom Blackout presets with distinct briefs, environments, communication faults, decision choices, and downstream rule effects. Existing saved scenarios take precedence when new presets are added.
- Honor a create-conflict rule's selected conflict report in runtime and historical perception. Prevent recursive re-entry into active rule chains while allowing repeatable rules on later triggers.
- Honor authored inactive channel status in channel health and report delivery; expose dropped/delayed report status to authored rule conditions without leaking dropped reports into trainee perception.
- Use the latest pre-decision checkpoint when a rule reactivates the same decision gate.

### Verification

`test/forge-authoring.test.ts` now contains 13 tests covering the three playable presets, an authored report/decision/rule chain saved and published through the API, timed-to-rule activation, disaster alternate-branch differences, invalid authoring data, runtime/historical conflict links, saved-installation preset merging, repeatable cyclic-rule handling, inactive channel delivery, dropped-status conditions, reactivated decision checkpoints, and world/access authoring. These are included in the final full-suite result above.

An isolated in-memory backend on port 3014 and Vite proxy on port 5184 were used for the browser pass:

- Create a disaster draft, edit its title/brief, add and schedule a report, retime its decision, add an option/condition, and change report/score actions.
- Simulate a failed draft save: Publish leaves the draft unpublished and keeps the unsaved changes visible.
- Remove all report recipients: Validate reports `reports[5].targetRoles` as the error. Restore the recipient and publish directly without a separate save.
- Inspect the saved published scenario: title, six reports, four options, matching 165-second activation/event, two conditions, a five-second report delay, and the edited score action are retained.
- Reload, reopen the read-only published scenario, and duplicate it. Required selector placeholders are disabled, and keyboard arrow navigation switches editor tabs.
- Launch the published scenario from the launcher, start it, and verify the instructor connection. No console errors appeared during the final exercise pass.
- Inspect desktop report-editor and 375px mobile rule-editor screenshots; the mobile page has no horizontal overflow.

The earlier browser passes used Windows `browse/dist/browse.exe`. After the requested gstack upgrade, this WSL setup also has a working native browser wrapper with its own Bun runtime and Chromium libraries. Browser smoke discovers the wrapper first; explicit `SENTINEL_BROWSER_BIN` overrides discovery.

## Browser, Forge, and packaging completion

Completed on October 7, 2026:

- Add role names/briefings, role-scoped object visibility, report recipients, movement ownership, body/collider/trigger controls, transforms, and scalar initial properties. Report access edits update executable recipients and visibility together.
- Reject nonfinite positions/rotation, nonpositive scales, unsupported body/collider types, and unknown movement owners before publication. Validation links open the affected editor.
- Defer validation-field focus until the selected graph node's inspector fields commit, so repeated validation links cannot leave focus on the node selector.
- Show each rule as a readable WHEN / IF / THEN chain. Published scenarios remain read-only.
- Back up unsaved drafts in browser local storage, offer explicit restore/discard after reload, clear acknowledged recovery on save/publication, and warn before leaving dirty drafts. Recovery does not silently overwrite a server draft.
- Load root `.env` configuration, declare Node.js 22+, build the standalone server, and serve the built UI/API/Socket.IO from one HTTP or optional HTTPS origin. The release build aligns its prototype admin token with the backend.
- Check built JS/CSS assets as well as API health, support strict no-overwrite backups, and document Windows/WSL setup and paused-session restore.

### Repeatable browser evidence

`test/browser-smoke.test.ts` starts an isolated in-memory server on a free port and uses asynchronous browser commands so the API event loop stays responsive. It owns and closes its instructor/trainee tabs and server. Separate Forge and Exercise/TruthLens E2E tests verify recovery after navigation and reload, visual rule authoring/connections/layout, linked node/field validation, publication/read-only inspection, persisted report/decision/rule/world/access edits, trainee visibility and acknowledged decision submission, live graph-authored effects, real TruthLens branch evidence, and responsive layouts without horizontal overflow.

Artifacts:

- `data/browser-smoke/checks.json` — passed status and 33 checks; completed `2026-10-09T14:16:22.093Z`.
- `data/browser-smoke/launcher-desktop.png` and `launcher-mobile.png`.
- `data/browser-smoke/instructor-desktop.png` and `instructor-mobile.png`.
- `data/browser-smoke/trainee-desktop.png` and `trainee-mobile.png`.
- `data/browser-smoke/rule-graph-desktop.png`.
- `data/browser-smoke/rule-graph-mobile.png`.
- `data/browser-smoke/forge-mobile.png`.
- `data/browser-smoke/truthlens-desktop.png`.
- `data/browser-smoke/truthlens-mobile.png`.
- `data/browser-smoke/forge-3d-desktop.png`.
- `data/browser-smoke/playground-overview.png`.
- `data/browser-smoke/playground-desktop.png`.
- `data/browser-smoke/playground-mobile.png`.

The desktop/mobile screenshots were inspected. `test/forge-recovery.test.ts` covers recovery semantics; `test/validation.test.ts` covers invalid world transforms/owners; `test/release-packaging.test.ts` verifies static/API/filesystem boundaries and a real running-session backup/restore, including byte equality and no-overwrite behavior.

## 3D playground continuation

Implemented on October 7, 2026:

- Render the authored world in Forge and instructor/trainee consoles using lazily loaded Three.js, primitive buildings/vehicles/nodes/areas, authored scale, and rotation in radians.
- Support orbit/pan/zoom, overhead/reset/focus, geometry/label/selector selection, and an interactive plan view.
- Display server-confirmed physics positions. Only a role's visible, owned, non-fixed collider-backed objects can move. Server-side checks enforce ownership, visibility, finite coordinates, world bounds, and running-session status.
- Offer directional buttons, focused-canvas keyboard controls, and Shift-click ground movement; editable Forge previews support ground placement.
- Map physical trigger contacts to role-specific zone-entry rules once per contact, allowing entry after exit. Record physics provenance so counterfactual replay does not apply a derived trigger as another human input.
- Provide instructor-wide channel health for communication-node fault colors, while retaining trainee channel/object filtering. Trainee object state labels identify initial briefing state rather than revealing live ground truth.
- Fall back after graphics-context loss without losing confirmed positions, release WebGL resources when leaving/switching views, and render only when state/camera changes with a 30 fps ceiling and capped pixel ratio.
- Keep overview labels readable by prioritizing selection and spacing projected labels to avoid overlap.

`test/playground.test.ts` adds five regressions covering cross-role pose synchronization, invisible bodies, movement permissions/bounds/session lifecycle, repeatable physical entry, replay without duplicate derived triggers, and instructor/trainee fault-health scope. The current browser flow additionally exercises real WebGL, ownership, start/end gating, keyboard and mobile movement, view switching, context-loss recovery, idle rendering, and published radians transforms.

## Visual rule graph continuation

Completed on October 7, 2026:

- Integrate connected WHEN / IF / THEN nodes into Forge's Rules tab, retaining the text overview and shared typed/reference controls.
- Add conditions/actions, change node types, remove supported nodes, and enforce one trigger and at least one action. All conditions remain required.
- Reconnect compatible ports to change executable sequence, or use Run after and Move earlier/later. Connections compile to the existing rule arrays.
- Arrange node headers with pointer gestures, arrow keys, or Canvas X/Y; provide pan, fit/focus, zoom, and automatic arrangement without another graphics dependency.
- Save optional versioned layout metadata with stable local IDs. Validate imported IDs, coordinates, slot references, and complete node coverage with structured `INVALID_RULE_GRAPH` errors.
- Select/focus the affected node and field from validation links. Published graphs disable authoring while leaving inspection and camera controls usable; mobile inspectors stack below the canvas.

`test/rule-graph.test.ts` contains six regressions: legacy projection/layout round-trip without execution changes; port reordering that changes actual object-state results while preserving identities/positions; all-required conditions and unsupported connection/minimum-node guards; typed edits/insertion/deletion/arrangement; malformed imported metadata with precise paths; and recovery/save/publication/JSON import/duplication/restart/execution with published immutability.

The browser authored a second time-window condition, changed a new action's type to an instructor alert, added/removed a temporary node, reconnected action ports, edited order and layout with native controls, and recovered the graph after navigation/reload. Save retained its coordinates. An invalid score reason linked directly to the selected inspector field. Publication retained the graph and enforced read-only editing with node selection available.

Commander then selected `verify-backup` at 30 seconds in the published exercise. Its graph emitted the authored alert and a raw score amount of `2`. TruthLens included the graph-authored evidence in the actual branch and excluded it from `continue-primary`. Both desktop and 375px mobile graph screenshots were inspected. The browser flow is split into two tests so each gate fits the existing five-minute per-test budget.

### Debug report: browser draft verification

- **Symptom:** the saved-graph assertion could not find the draft and attempted to read an undefined scenario ID.
- **Root cause:** the test queried `listScenarios()`, the published-only live catalog. A direct manager probe confirmed the draft was present in `listForgeScenarios()` and absent from the live catalog.
- **Fix:** `test/browser-smoke.test.ts` uses the Forge catalog and explicitly asserts the saved draft exists before checking its coordinates.
- **Evidence:** both browser gates and their 30 checks passed on October 7; typecheck, all 65 ordinary tests, server compilation, and all six synthetic checks passed.
- **Regression test:** the Forge browser gate recovers graph edits after reload, saves the draft, and checks stored node coordinates before publication.
- **Related:** the external browser CLI selects the empty-valued first-action option by visible label; the expanded workflow uses separate authoring and exercise gates to fit the existing per-test budget.
- **Status:** DONE.

## Signal Ledger UI redesign

Completed on October 9, 2026:

- Replace the neon command-center treatment with the Signal Ledger visual system: mineral work surface, ink rail, restrained field blue/rust/moss/ochre semantics, quiet borders, square-ish panels, and no decorative gradients or glow.
- Apply the system across the launcher, Forge, role consoles, 3D playground, rule graph, and TruthLens while preserving existing controls, dense scanning, keyboard access, and 375px responsive parity.
- Add `DESIGN.md` as the durable visual source of truth and keep the surface direction in `.opencode/surfaces/sentinel-workspace.md`.
- Record component samples and non-frontmatter tokens in `.impeccable/design.json`. A fresh read-only reviewer scored all six prior visual findings resolved; `.impeccable/review/verdict.md` preserves the scoped `disposition: ship` verdict.
- Capture and inspect desktop/mobile evidence for the launcher, instructor console, trainee console, Forge, 3D playground, rule graph, and TruthLens.
- Run the Impeccable detector on the changed UI. The remaining visual-pattern advisory is the mini-map grid. After adding `DESIGN.md`, token-coverage advisories also identify component tints, inherited sizes, and overridden legacy declarations not enumerated in its shared palette/type scale. These are not a clean-detector claim.

### Debug report: validation-field focus

- **Symptom:** clicking a validation link selected `action-3` but left keyboard focus on the inspector's node selector instead of its `reason` field.
- **Root cause:** a `requestAnimationFrame` scheduled beside `setSelectedId` could run before React committed the new inspector fields. The callback then used its fallback select; no later effect corrected the focus.
- **Fix:** `web/src/RuleGraphEditor.tsx` retains a pending focus request and resolves it in a separate effect after the requested node is rendered. The request is consumed once, so ordinary node navigation remains available.
- **Regression:** `test/browser-smoke.test.ts` exercises cross-tab validation focus and a repeated click of the same error link. Its timeout message now reports the selected node, active element, and rendered field names.
- **Evidence:** the original assertion failed with `selectedNode: action-3`, `activeTag: SELECT`, and `reason` present among inspector fields before the fix. The focused Forge test and two subsequent full browser runs passed after the fix. Latest gates took about 97 seconds and 96 seconds under the original 300-second limits.
- **Status:** DONE.

## Remaining release work

- Run the physical four-laptop/microphone procedure in [the LAN runbook](lan-validation.md).
- Voice audio is direct peer-to-peer LAN audio; simulated audio delay/dropout and cross-network TURN support are not implemented.
- Counterfactuals hold later recorded participant/instructor inputs constant; they do not predict how people would behave under a different choice. Sessions restored without decision checkpoints use the explicitly labeled score-only fallback.
- The 3D viewer and Forge placement are implemented; physics remains simplified collision bounds and movement rather than full rigid-body simulation.
- Historical reconstruction of old logs requires frozen report deliveries or the immutable report templates; exports predating both cannot supply missing historical content.
- Rehearse the implemented cached shell, scenario-library tags/archive/version history, authored timeline preview, and TruthLens information-flow graph alongside the broader preset/demo content. Current Forge/world authoring includes the visual rule graph, role visibility, report recipients, movement ownership, transforms, properties, physics bodies/colliders, and triggers.

The requested browser, Forge-polish, release-packaging, 3D, and visual-rule-graph software checks are complete and passing. Full product release acceptance remains open for the remaining product requirements and physical LAN checks above.
