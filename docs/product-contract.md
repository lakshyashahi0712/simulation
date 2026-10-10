# SENTINEL Product Contract

**Status:** Phase 0 approved draft
**Release target:** Feature-complete by 17 October; testing and bug fixes on 18–19 October
**Platform:** Web application; VR headset support is not part of this release

## 1. Product promise

SENTINEL allows an instructor to create and run synthetic command-and-control exercises where participants receive different, delayed, incomplete, or contradictory information. It records the information available to each participant at decision time and produces an explainable after-action review.

The product measures the decision process under uncertainty. It does not grade a participant only by hindsight against the hidden ground truth.

## 2. User roles

### Admin

- Create and edit scenario drafts.
- Add playground objects, communication channels, events, decisions, rules, and scoring criteria.
- Validate, publish, duplicate, import, export, and archive scenarios.
- Review all exercise reports.

### Instructor

- Select a published scenario.
- Create an exercise room and assign roles.
- Start, pause, resume, speed up, and end an exercise.
- Observe ground truth and participant awareness.
- Inject supported disruptions and reports during an exercise.
- Generate and export the AAR.

### Commander

- Receive command-level information.
- Communicate with the other roles.
- Submit primary decisions and rationale.

### Operations/Intelligence Officer

- Receive operations and intelligence reports.
- Submit observations and verification requests.
- Identify and communicate conflicting or stale information.

### Communications/EW Officer

- Monitor channel health.
- Report communication faults.
- Switch to supported backup channels.
- Submit communication-related observations and decisions.

## 3. Primary scenarios

All scenarios use the same engine and schema. They differ through data, roles, event definitions, and scoring rules.

### Operation Signal Break

The flagship military training scenario. It uses a fictional environment and synthetic land, air, cyber, electronic-warfare, and command-and-control events.

Required exercise beats:

1. A normal initial briefing.
2. A field report delayed for the commander.
3. A stale aerial observation.
4. An incomplete cyber warning.
5. A communication-channel outage or degradation.
6. Two contradictory reports.
7. A backup-channel decision.
8. At least one commander decision gate requiring rationale.
9. A final AAR showing ground truth versus role-specific perception.

### Operation Floodline

A disaster-response preset using weather, infrastructure, relief logistics, medical support, and emergency communication events. It proves that SENTINEL is reusable outside one domain.

### Blackout Protocol

A blank/custom preset that an administrator can modify in Forge. It is used to demonstrate that the engine is data-driven and does not require code changes for every new exercise.

## 4. Product boundaries

### Included in this release

- Low-poly 3D web playground.
- Supported object placement, properties, basic collisions, and trigger zones.
- Visual trigger-condition-action rules.
- Scenario versioning and validation.
- Real multiplayer over a host machine and local network.
- Text communication and push-to-talk voice channels.
- Application-layer communication degradation. The system does not alter physical network interfaces.
- Gemini-generated scenario drafts with validation and manual editing.
- LAN-first operation, cached production shell, reconnect, and queued supported actions.
- TruthLens replay, scoring, counterfactual comparison, and export.
- Local scenario library with import/export, duplication, tags, and version history.

### Excluded from this release

- VR headset interaction.
- Real operational systems or sensitive data.
- Real radio frequencies, physical jamming, or cyberattack functionality.
- Arbitrary JavaScript or code execution from a scenario.
- Photorealistic terrain or a large-scale military game world.

The Forge contract is intentionally broad through supported objects and rule blocks. It does not execute arbitrary administrator code.

## 5. Product invariants

These rules must remain true throughout implementation:

1. The server is authoritative for exercise time, ground truth, message delivery, and decisions.
2. Trainees never receive ground-truth state during a live exercise.
3. Each exercise uses an immutable snapshot of the published scenario version.
4. Generated time and delivered time are stored separately for every report.
5. Dropped reports remain visible to the instructor and AAR, but not to the target trainee.
6. Every decision stores the participant's perceived-information snapshot.
7. Admin edits affect future exercises and never rewrite completed AAR data.
8. Live exercise operation does not depend on Gemini availability.
9. All scenario rules are validated before publication.
10. Every instructor injection is recorded as an exercise event.

## 6. Main demonstration

The judging demonstration should follow this sequence:

1. Admin opens Forge and creates or duplicates a scenario.
2. Admin adds a communication channel, a delayed report, a contradiction, and a decision gate.
3. Admin validates and publishes the scenario.
4. Instructor creates an exercise room.
5. Commander, Operations/Intelligence, and Communications/EW roles join from separate laptops.
6. Instructor starts the exercise.
7. Each role receives a different information stream.
8. Instructor injects a channel degradation.
9. Trainees exchange text and voice messages.
10. Trainees submit decisions and rationale.
11. One client reconnects after a temporary disconnection.
12. Instructor opens TruthLens and compares ground truth with each role's perception.
13. Instructor opens the counterfactual view and compares an alternate decision.
14. Instructor exports the AAR.

## 7. Completion standard

Phase 0 is complete when the schema, Forge catalog, and acceptance test are approved. Phase 1 begins by implementing the scenario engine against this contract.
