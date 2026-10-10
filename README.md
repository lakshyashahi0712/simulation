# SENTINEL

**Train under uncertainty. Decide with incomplete information. Explain the decision afterward.**

SENTINEL is a browser-based, multiplayer decision-training platform. An instructor creates a fictional exercise, gives different participants different information, introduces communication problems, and reviews how the team responded.

Its central question is: **“What information did this person actually have when they made that decision?”**

This README is both a project progress report and a guide to running the application.

| Project snapshot | Status |
| --- | --- |
| Report updated | **9 October 2026** |
| Current application version | **0.1.0** |
| Stage | Working end-to-end web prototype with verified core workflows |
| Main modules | **Forge**: build exercises · **Exercise**: run them · **TruthLens**: explain outcomes |
| Latest software evidence | **66 automated tests**, **2 browser tests with 33 checks**, and **6 synthetic acceptance checks** |
| Next milestone | Rehearse the complete demo and validate it on four physical laptops |

## Contents

- [The problem we are solving](#the-problem-we-are-solving)
- [How SENTINEL works](#how-sentinel-works)
- [What we have built](#what-we-have-built)
- [What makes the project different](#what-makes-the-project-different)
- [Progress and verification](#progress-and-verification)
- [Future phases](#future-phases)
- [Current limitations](#current-limitations)
- [Technology and architecture](#technology-and-architecture)
- [Run the project](#run-the-project)
- [Try an end-to-end demonstration](#try-an-end-to-end-demonstration)
- [Controls and recovery](#controls-and-recovery)
- [Documentation](#documentation)

## The problem we are solving

Teams often need to act before they have a complete, shared picture. A field report may arrive late, an older observation may look current, two sources may disagree, or a communication channel may fail.

Looking only at the final outcome misses important questions:

- Did the participant receive the warning before making the decision?
- Did they recognise that a report was stale or contradictory?
- Did they verify uncertainty with another team member?
- Did they use an available backup communication channel?
- Was the problem in the decision, the information delivery, or the team's coordination?

SENTINEL makes these conditions part of a repeatable exercise and keeps the evidence needed to discuss them afterward.

### A simple example

In a fictional flood-response exercise, an earlier report says a shelter is accessible. A newer report says access is restricted, but that update reaches one role later than another. The coordinator must choose whether to act on the earlier report, verify through a backup channel, or use another shelter.

Afterward, the instructor can inspect when each report was generated and delivered, what the coordinator could see, and the submitted rationale and confidence. An alternate replay can show how a different choice changes the authored simulation.

**The intended value is a better-supported training discussion about decision-making under uncertainty.** We have implemented the supporting software; improved real-world training outcomes still need evaluation with users.

## How SENTINEL works

1. **Prepare in Forge.** Create or duplicate a scenario, configure the world, reports, decisions, channels, and rules, then validate and publish it.
2. **Create an exercise room.** The instructor selects a published scenario and shares the room code.
3. **Join with different roles.** Trainees receive only the objects, reports, and messages their roles are allowed to see.
4. **Run the exercise.** The server controls simulation time and state. Scheduled events and instructor actions introduce disruptions.
5. **Make and record decisions.** Participants submit an option, rationale, and confidence where required. The system captures their available information at that moment.
6. **Review in TruthLens.** Inspect the timeline, role-specific information, score explanations, and actual versus alternate replay branches.

### Who uses it?

| User | Main responsibility |
| --- | --- |
| Scenario author/admin | Build, validate, publish, duplicate, import, and export exercises in Forge |
| Instructor | Create rooms, assign roles, control the exercise, inject disruptions, and review results |
| Commander | Coordinate the response and submit primary decisions with rationale |
| Operations/Intelligence | Receive field information, communicate observations, and move permitted world objects |
| Communications/EW | Monitor available channels and coordinate communication through supported alternatives |

Role names and briefings are editable. Disaster/custom presets use names such as **Response Coordinator**, **Field Operations**, and **Communications Lead**.

## What we have built

### 1. Forge: no-code scenario authoring

Forge lets an author change exercise data through forms and a visual rule graph without editing application source code.

- **Scenario management:** create drafts, duplicate scenarios, import/export JSON, validate, and publish. Published scenarios are read-only and can be duplicated for further editing.
- **Reports:** configure source, channel, recipients, content, observation time, freshness, reliability, and conflict links; schedule delivery or send through rules.
- **Decisions:** configure prompts, roles, options, deadlines, rationale/confidence requirements, and timed or rule-based activation.
- **Channels and timeline:** configure participants, backup channels, latency, scheduled faults, recovery, state changes, and completion events.
- **World and access:** configure object placement, scale, rotation, properties, visibility, movement ownership, simplified physics, and trigger zones.
- **Scoring and objectives:** configure scoring weights and objectives, including explicit score events from authored rules.
- **Validation and recovery:** errors link to the affected editor/node/field; reference-aware deletion avoids broken scenarios; browser recovery protects unsaved drafts.

#### Visual rules that actually execute

Rules use **WHEN → IF → THEN**:

> **WHEN** a decision is submitted, **IF** the selected option uses the backup channel, **THEN** deliver a verification report, restore a channel, change an object state, and add a score event with a reason.

Each rule has one trigger, all its conditions must match, and its actions execute in order. Connecting compatible ports changes that executable order. Moving a node changes its saved visual layout. This is a structured rule editor, not an arbitrary branching program or a facility for executing custom JavaScript.

![Forge visual rule graph and node inspector](data/browser-smoke/rule-graph-desktop.png)

#### Optional Gemini-assisted drafts

Gemini can propose editable scenario data using a server-side API key. Its output is validated, and publication still goes through Forge. If the key or service is unavailable, the application returns a local draft based on an existing scenario with an explanatory notice.

The local fallback is a template-based draft, not an offline language model. Live exercises and their scoring do not require Gemini.

### 2. Exercise: multiplayer training

- Room-code joining and instructor role assignment.
- A shared simulation clock controlled by the authoritative server, meaning the server decides the accepted state for every client.
- Separate instructor ground truth and trainee role-scoped information.
- Start, pause, resume, advance time, and end controls.
- Application-level report/channel faults: delay, dropout, stale information, contradictory or partial reports, outages, and recovery.
- Role/channel-scoped text communication, including delayed delivery and supported queued actions after a disconnect.
- Opt-in, channel-based push-to-talk voice using WebRTC.
- Recorded decisions, rationale, confidence, and decision-time information snapshots.
- Durable action receipts so retrying an acknowledged text/decision action does not apply it twice.

Voice currently uses direct LAN audio. Simulated report/text degradation does not mean the voice audio itself is delayed or corrupted.

### 3. Interactive 3D playground

Forge and live consoles share a low-poly Three.js world with selectable objects, orbit/pan/zoom, overhead and focused views, and a 2D plan-view alternative.

Trainees can move eligible, visible objects assigned to their role. The server validates movement and confirms positions; entering an authored trigger zone can activate scenario rules. Published previews remain read-only.

The viewer loads on demand, limits rendering to a 30 fps ceiling, and sleeps when the scene and camera are unchanged. If WebGL2 is unavailable or its context is lost, the plan view preserves access to the confirmed world state. These are implemented performance measures, not a measured frame-rate guarantee for every device.

### 4. TruthLens: evidence-based after-action review

An **after-action review (AAR)** explains what happened during an exercise and supports the discussion of why.

TruthLens includes:

- A historical event timeline and role-specific perception at a selected time.
- An information-flow view that follows each report from generation through delay, delivery, or dropout and identifies the evidence available at decision checkpoints.
- Separate generated and delivered timestamps, including earlier revisions when a report is delivered more than once.
- Decision provenance: the exact available report/text evidence, selected option, rationale, and confidence associated with a decision.
- Score breakdowns and reasons, including effects of authored rules.
- An actual/alternate replay comparison with events, role reports/text, final object states, scores, and skipped inputs.
- JSON exports and a browser **Print / PDF** path.

**What an alternate replay means:** both branches start from the same saved pre-decision state. One uses the recorded choice; the other uses the selected alternative. Later recorded human inputs are held constant, and inputs invalid in a branch are listed as skipped. The comparison does not change the original exercise and does not predict how real people would react to different information.

![TruthLens actual and alternate decision comparison](data/browser-smoke/truthlens-desktop.png)

### 5. Reliability and interface work

- Local JSON persistence for drafts, published scenarios, and exercise snapshots.
- Cached production application shell for reconnect/offline startup, with live session authority remaining on the server.
- Scenario-library search, tag filtering, archive/restore, and immutable successor-version history.
- Read-only authored timeline preview before publication, including event timing and role-scoped report visibility.
- Running sessions restore paused after restart; completed sessions restore read-only with AAR access.
- Per-tab session recovery and a queued text/decision outbox.
- One-port built UI/API/Socket.IO serving, optional HTTPS, healthchecks, backup, and tested restore.
- The **Signal Ledger** redesign across launcher, Forge, live consoles, graph, playground, and TruthLens: pale mineral surfaces, dark ink structure, restrained semantic colors, and clearer evidence hierarchy.
- Desktop and 375px mobile browser checks, keyboard graph/movement controls, and regression coverage for validation-field focus.

The shared visual system is documented in [DESIGN.md](DESIGN.md).

### Included scenario presets

| Preset available now | Training situation |
| --- | --- |
| **Operation Signal Break** | Fictional military-style coordination with degraded communication and incomplete or conflicting reports |
| **Flood Response / Broken Links** | Shelter-support decisions involving delayed field reports, uncertain access, and backup verification |
| **Custom Blackout Protocol** | An editable service-recovery exercise involving a failed field link and a backup-channel decision |

All three use the same scenario schema and simulation engine. The early product contract calls the disaster concept “Operation Floodline”; **Flood Response / Broken Links** is the current implemented title. Existing saved scenarios take precedence over newly supplied preset data.

## What makes the project different

**Our main differentiator is the connected authoring, execution, and evidence-review workflow.** The 3D world and optional AI draft generator support that workflow; the decision-time evidence is its central idea.

| Training need | SENTINEL's approach | Why it matters |
| --- | --- | --- |
| Understand a decision in context | Preserve the participant's actual information at submission time | An instructor can discuss a choice using what was available then, rather than only hindsight |
| Practice an unequal information picture | Deliver different reports and objects to different roles | Participants must communicate and verify instead of sharing an all-seeing screen |
| Make communication failure part of the exercise | Author delays, outages, stale reports, conflicts, and recovery as executable events/rules | Disruptions are repeatable and their consequences can be traced |
| Explain more than a final score | Link decisions and score reasons with report/text evidence and timeline events | The review can examine the process behind the result |
| Explore “what if?” | Replay an alternate choice from the same pre-decision checkpoint | Compare downstream authored effects under explicit assumptions |
| Let instructors adapt the exercise | Publish typed visual rules and scenario data through Forge | New supported exercises do not require an application rewrite |
| Reuse the platform across domains | Use one engine for military-style, disaster-response, and service-recovery presets | Demonstrate that the project is a reusable training platform |
| Run locally with optional AI assistance | Host the live exercise on a LAN; use Gemini only for optional drafting | The core exercise can operate without an external AI service |

For a static presentation or quiz, the added value is live role-specific information and executable consequences. For a chat tool, it is scenario control and decision evidence. For a visualization-only prototype, it is the linked simulation and review process.

These comparisons explain the project's emphasis. They are not a claim that no other training simulator has similar features, or that SENTINEL has already outperformed commercial systems in a comparative study.

### A short explanation to share

> SENTINEL is a multiplayer training platform for decisions made with incomplete information. Instructors build scenarios in Forge, teams experience different reports and communication failures during Exercise, and TruthLens explains what each participant knew when they acted. Its distinguishing feature is connecting editable scenario rules, role-specific information, decision evidence, and alternate-outcome replay in one web application.

## Progress and verification

### Completed workstreams

| Workstream | Delivered so far |
| --- | --- |
| **Phase 0: foundation** | Product contract, schema, supported rule/object catalog, acceptance plan |
| **Phase 1: simulation engine** | Time, events, reports, faults, decisions, rules, explainable score events, snapshots, simplified physics |
| **Phase 2: multiplayer** | Rooms, roles, synchronized consoles, instructor controls, text, opt-in voice |
| **Forge authoring** | No-code editors, world/access controls, validation, publication, import/export, recovery, optional Gemini drafts |
| **TruthLens core** | Historical perception, decision provenance, isolated alternate branches, score evidence, exports |
| **Reliability and packaging** | Reconnect/outbox handling, restart recovery, built one-port stack, HTTPS support, healthcheck, backup/restore |
| **3D playground** | Shared Forge/live viewer, cameras, selection, owned-object movement, trigger contacts, keyboard/mobile controls, fallback |
| **Visual rule graph** | Executable connected nodes, ordering/layout, persistence, validation focus, read-only published inspection |
| **UI redesign and regression fixes** | Signal Ledger styling, comparison hierarchy, desktop/mobile evidence, corrected graph field-focus race |

“Delivered” here describes implemented and checked software. It does not mean every item in the original release contract or physical acceptance plan is complete.

### Latest verified results

The following results were recorded on **9 October 2026** during this update:

| Check | Result |
| --- | --- |
| TypeScript checks | Passed |
| Automated domain/server/reliability suite | **66 tests passed across 14 files** |
| Transport/outbox acceptance subset | **6 tests included in the 66-test suite** |
| Synthetic four-client exercise | **6 checks passed** using one instructor and three trainee clients |
| Production browser workflow | **2 tests passed with 33 checks** |
| Visual evidence | **15 captures** across desktop/mobile surfaces |
| Web and server builds | Passed |
| Scoped Impeccable finish review | Six prior visual findings scored resolved; scoped `ship` verdict |

The browser workflow covers Forge recovery, graph editing, validation and publication, read-only inspection, role visibility, movement, graphics fallback, decision submission, and real TruthLens branch evidence. Automated coverage also verifies scenario version/archive management. See the [browser check artifact](data/browser-smoke/checks.json), [synthetic report](data/synthetic-acceptance.json), [visual verdict](.impeccable/review/verdict.md), and [full validation report](docs/release-validation.md).

**What remains unverified:** the complete exercise on four separate laptops with real microphones, trusted certificates, and the target Wi-Fi/firewall configuration. Automated clients on one machine do not substitute for that test. Target-machine performance and training effectiveness also need direct measurement.

## Future phases

The next phases below group the outstanding work in the [implementation roadmap](docs/implementation-roadmap.md). They describe planned work and completion gates, not features already delivered.

### Next phase A: complete the demo and contract reconciliation

**Goal:** make the whole exercise easy to understand and repeat from preparation to review.

- Refine walkthroughs for all three presets: briefing, disruption, uncertainty, decision, and explanation.
- Reconcile the original acceptance checklist with the current implementation.
- Rehearse the completed cached shell, scenario-library tags/archive/version-history workflows, authored timeline preview, and TruthLens information-flow view as visible parts of the reviewer walkthrough.
- Rehearse Forge → publish → role joins → exercise → decision → TruthLens → export → restart/recovery.

**Completion gate:** a first-time reviewer can follow a complete demo and see exactly how a delayed report or different decision changes the recorded evidence.

### Next phase B: physical LAN acceptance and performance

**Goal:** verify the intended real-device setup.

- Run one instructor and three trainee laptops on the same local network.
- Verify trusted HTTPS, physical microphone capture, two-way audio, and channel membership.
- Exercise delays, dropped reports, backup communication, disconnect/reconnect, paused restore, and completed AAR recovery.
- Measure responsiveness with multiple clients on the target **Ryzen 3 3200U / integrated graphics / 12 GB RAM** host.
- Record actual results and resolve network, device, or performance issues uncovered by the run.

**Completion gate:** the [four-device LAN checklist](docs/lan-validation.md) passes with recorded evidence.

### Next phase C: feature freeze, regression, and handoff

The current recorded schedule is:

| Date | Planned milestone |
| --- | --- |
| **17 October 2026** | Feature freeze |
| **18–19 October 2026** | Regression testing, bug fixes, and demo rehearsal |
| **20 October 2026** | Project deadline/handoff |

Focus on repeatable startup, backed-up data, role isolation, publication validation, restart recovery, exports, and a clear demonstration script. Remaining limitations should accompany the handoff. These dates are targets from the roadmap, not proof that the remaining work is complete.

### After the initial handoff: candidate extensions

These are proposed directions to prioritise after user feedback, outside the committed initial web-release scope:

- **Evaluate training value:** run structured sessions with instructors/trainees and assess whether the evidence improves debriefs.
- **Improve scoring:** develop domain-specific rubrics and evaluate them against human instructor judgments.
- **Production administration:** replace the prototype shared admin token with proper accounts/access management and assess storage/deployment needs beyond a local demo.
- **Broader networking:** consider TURN-assisted voice for more difficult networks and separate simulated voice-degradation support.
- **Richer simulation:** consider more detailed physics, worlds, and scenario content where they improve the training task.
- **VR exploration:** reconsider only as a later project; it remains deferred from this release.

## Current limitations

| Area | Current boundary |
| --- | --- |
| Scoring | Transparent prototype rules and heuristics. Some measures use timing, rationale keywords/length, or option labels; they are not a validated assessment of real-world competence or an AI understanding of reasoning. |
| Alternate outcomes | Later recorded human actions are held constant. Older sessions without decision checkpoints use an explicitly labeled score-only fallback. Different reports do not automatically imply a different score. |
| Offline operation | The production shell and static assets are cached for startup/reconnect; API data and an authoritative exercise still require the server. A disconnected client does not run an independent authoritative exercise. |
| Scenario library | Search, tags, archive/restore, immutable successor versions, drafts, publication, duplication, and JSON exchange work; this remains a local prototype library rather than multi-user administration. |
| Voice | Direct LAN WebRTC, without TURN or simulated audio delay/corruption. Real-device microphone acceptance is pending. |
| Physics and visuals | Low-poly geometry and approximate movement/collision bounds, not a full rigid-body or photorealistic simulation. |
| Authentication | Prototype shared admin-token model; per-session participant access and role checks are separate from a production account system. |
| Performance | On-demand rendering and fallback are implemented; target-hardware measurements remain open. The graphics chunk still triggers Vite's 500 kB size advisory. |
| Visual documentation | The scoped finish review passed, but token-coverage and mini-map-grid detector advisories remain documented. |

All exercises are fictional and synthetic. The product has no real operational integrations, targeting, weapons, radio-frequency control, physical jamming, or cyberattack functionality.

## Technology and architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web UI | React 19, TypeScript, Vite 6 | Launcher, Forge, live consoles, and TruthLens |
| 3D viewer | Three.js | Lightweight world rendering and camera/object interaction |
| API | Node.js 22+, Fastify 5 | Scenario operations, sessions, review endpoints, and built UI serving |
| Real-time transport | Socket.IO 4 | Authoritative session updates and participant actions |
| Voice | Browser WebRTC | Opt-in peer-to-peer audio, with server-mediated signaling |
| Simulation | Shared TypeScript engine | Clock, event execution, rule evaluation, delivery, scoring, and replay |
| Persistence | Local JSON snapshots | Scenario/session storage and recovery |
| Optional draft assistance | Server-side Gemini integration | Proposed scenario data with validation and local fallback |
| Verification | Vitest, synthetic clients, external gstack browser | Domain, API, transport, recovery, and rendered UI checks |

**Data flow:** Forge writes validated scenario data. A live session takes an immutable snapshot of its published version. The server runs that snapshot and sends each participant only permitted state. Events, deliveries, and decision checkpoints supply TruthLens and alternate replay. Later scenario edits do not rewrite an existing exercise's history.

| Location | What it contains |
| --- | --- |
| `src/domain/` | Scenario types, validation, authoring helpers, and visual graph/executable-rule conversion |
| `src/engine/` | Simulation, time, physics, scoring, and replay behavior |
| `src/scenarios/` | Included scenario presets |
| `src/server/` | HTTP/Socket.IO server, session management, persistence, voice signaling, and Gemini integration |
| `web/src/` | React screens, graph editor, 3D viewer, and styles |
| `test/` | Automated tests and browser workflows |
| `scripts/` | Startup/build wrappers, synthetic acceptance, healthcheck, and backups |
| `docs/` | Product requirements, schema, roadmap, validation evidence, and runbooks |

## Run the project

### Requirements

- **Node.js 22 or newer** and npm.
- A current browser; WebGL2 enables 3D, with plan view available as a fallback.
- A shared LAN for separate-device use. Trusted HTTPS is required for microphone capture on other laptops.
- A Gemini key is optional and is not needed to run the included exercises.

### Built one-port application

From the project folder:

```bash
npm ci
```

If `.env` does not exist, copy `.env.example` to `.env` and set the local admin token and data path. On Linux/WSL use `cp .env.example .env`; on PowerShell use `Copy-Item .env.example .env`.

```bash
npm run start:release
```

Open **http://localhost:3001**. This command builds the UI and server, then serves the UI, API, and Socket.IO together. The release wrapper aligns the browser's prototype admin token with the backend token.

For other laptops, use `http://<host-LAN-address>:3001` with the host listening on the LAN. Configure trusted HTTPS for microphones as described in the [LAN runbook](docs/lan-validation.md). Installation/build needs the dependencies; the live local exercise does not require a cloud AI service.

### Development mode

After installing dependencies, run these in **separate terminals**:

```bash
# Terminal 1: API on port 3001
npm run server
```

```bash
# Terminal 2: web client on port 5173
npm run web
```

Open **http://localhost:5173**. Vite proxies HTTP and Socket.IO to the backend, so clients use the web URL only. Set `SENTINEL_ADMIN_TOKEN` and `VITE_ADMIN_TOKEN` to the same value for development. Override the proxy with `SENTINEL_API_PROXY`; `VITE_API_URL` supports a separately hosted API.

If a refresh shows older UI after edits on a Windows/WSL-mounted folder, restart `npm run web` to clear cached transforms.

### Verification and operations

```bash
npm run typecheck
npm test
npm run web:build
npm run build:server
npm run test:acceptance
npm run test:synthetic
npm run test:browser
```

- `test:acceptance` runs the transport/outbox subset of the ordinary suite.
- `test:synthetic` creates an isolated in-memory server and four clients, writes a credential-free report to `data/synthetic-acceptance.json`, and closes them. It does not load stored exercises. Choose another output with `npm run test:synthetic -- --output data/demo-evidence.json`.
- `test:browser` requires an external gstack browser executable, discovered locally or supplied through `SENTINEL_BROWSER_BIN`. It builds the UI, creates an isolated server, and saves checks/screenshots under `data/browser-smoke/`. It is separate from `npm test`.

With the application running, use `npm run healthcheck`. After persistence exists, use `npm run backup:data` or `npm run backup:data -- --output data/backups/pre-demo.json`; an existing backup destination will not be overwritten. See the [release runbook](docs/release-runbook.md) for configuration, asset healthchecks, TLS, and restore steps.

## Try an end-to-end demonstration

1. Open **SENTINEL Forge**, select **Custom / Blackout Protocol**, and create a **New draft**.
2. Change the brief or a report, inspect the **Rules** graph, and edit a supported action.
3. Select **Validate**, resolve any linked errors, and **Publish scenario**.
4. Return to the launcher, select the published scenario, and create an exercise room.
5. Join Commander, Operations, and Communications roles from separate browser tabs or laptops using the room code. Use tabs for a local preview; use physical devices for LAN acceptance.
6. Start the exercise and observe reports and channel changes. In the unmodified Blackout preset, the field-link outage begins at 60 simulation seconds and the decision gate activates at 120 seconds.
7. Submit a decision with rationale and confidence. Use **Verify through the backup channel before recovery** to see the authored verification report and recovery effects.
8. End the exercise, open AAR, inspect the timeline and role perception, then compare the recorded choice with an alternate option.
9. Export the AAR/comparison JSON or use **Print / PDF** for discussion.

**What to point out to a reviewer:** a rule created in Forge really executes, participants have different permitted information, the decision keeps its available evidence, and TruthLens explains the consequences without changing the original record.

## Controls and recovery

<details>
<summary><strong>Forge and graph editing</strong></summary>

Published scenarios are read-only; use **Duplicate selected** to edit a copy. IDs stay fixed when labels change. Delete controls explain references that must be resolved first, and decisions retain at least two options. **Validate** and **Publish scenario** save current edits before checking them; failed saves keep the scenario unpublished.

In **Rules**, select a node on the canvas or through **Selected graph node** and edit its inspector fields. Add supported condition/action nodes with the toolbar. Change action order through compatible ports, **Run after**, or **Move earlier/later**; **Escape** cancels a connection.

Drag node headers, use arrow keys on a focused header, or edit **Canvas X/Y** for visual placement. Drag the background to pan; use **Fit graph**, **Focus node**, zoom, and **Arrange nodes**. Layout survives recovery, save, publication, duplication, and JSON exchange. The collapsed **Rule overview** provides the same executable chain as text.

Unsaved edits are backed up in browser local storage. Reopen Forge after a reload to restore or discard recovered edits. Validation links select the affected node and focus its field.

</details>

<details>
<summary><strong>3D camera, placement, and movement</strong></summary>

Drag to orbit, right-drag/two fingers to pan, and scroll/pinch to zoom. Use **Overhead**, **Reset camera**, or **Focus selected**. Select through geometry, labels, or the object selector.

In editable Forge previews, select an object and Shift-click the ground to place it. Rotation Y is in radians. For trainee movement, give an object a non-fixed body and collider, assign a **Movement owner**, and include it in that role's visibility.

During a running exercise, move eligible objects with direction buttons, arrow keys/WASD while the canvas is focused, or Shift-click on the ground. Server-confirmed positions update all permitted clients. Movement is unavailable while disconnected, waiting, paused, or ended. Trainee state labels identify the initial briefing state rather than exposing instructor-only live ground truth.

</details>

<details>
<summary><strong>Session recovery and historical review</strong></summary>

Snapshots default to `data/sentinel.json`; override with `SENTINEL_DATA_FILE`. Running sessions restore paused after a restart for instructor resume. Completed sessions retain read-only AAR, historical perception, and available alternate-branch access.

Session credentials and the text/decision outbox use per-tab session storage. Refreshing that tab restores access. Supported actions stay queued until acknowledged, and server-side retry receipts prevent duplicate application. Instructor controls need a connection. Voice closes on disconnect and must be rejoined.

In TruthLens, scrub the timeline and select a role to reconstruct delivered information at that point. Choose a recorded decision and alternate option, optionally supply another rationale, then select **Compare branches**. Both branches run from the same checkpoint to the recorded horizon, stopping earlier if their rules end the exercise. Inspect downstream evidence and skipped inputs alongside scores.

</details>

## Documentation

| Document | Purpose |
| --- | --- |
| [Product context](PRODUCT.md) | Users, purpose, constraints, and accessibility commitments |
| [Product contract](docs/product-contract.md) | Original release goals and invariants; goals are not a completion checklist |
| [Scenario schema and Forge catalog](docs/scenario-schema.md) | Schema `1.0`, supported objects, events, conditions, and actions |
| [Acceptance test](docs/acceptance-test.md) | Definition of done and required demonstrations |
| [Implementation roadmap](docs/implementation-roadmap.md) | Completed workstreams and next-release priorities |
| [Release validation report](docs/release-validation.md) | Executed software checks, debug reports, and remaining acceptance work |
| [Release runbook](docs/release-runbook.md) | Startup, environment configuration, healthcheck, backup, and restore |
| [LAN validation runbook](docs/lan-validation.md) | Four-device testing, HTTPS, networking, and microphones |
| [Phase B evidence sheet](docs/phase-b-evidence.md) | Record four-device gates, performance observations, and release decision |
| [Public SIH demo deployment](docs/public-demo-deployment.md) | Render Docker deployment, public HTTPS, judge walkthrough, and deployment boundaries |
| [Free-hosting constraints](docs/free-hosting-constraints.md) | Standing zero-cost deployment rules for all future phases |
| [Design system](DESIGN.md) | Signal Ledger visual rules and shared design tokens |

**Bottom line:** SENTINEL connects scenario creation, cached LAN delivery, live multiplayer decisions, and evidence-based review in a working web prototype. The next step is to rehearse the complete demonstration, validate it reliably on the intended hardware, and evaluate its usefulness with real training participants.
