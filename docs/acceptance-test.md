# SENTINEL Phase 0 Acceptance Test

This document is the definition of done for the first complete release. It is also the test plan that will be used from 18–19 October.

## A. Forge creation test

### Setup

- Start the SENTINEL application.
- Sign in as Admin.
- Open Forge.

### Steps

1. Create a scenario named `Operation Signal Break - Demo`.
2. Select the `military` category.
3. Add the Commander, Operations/Intelligence, and Communications/EW roles.
4. Add a low-poly 3D map.
5. Add two zones and three locations.
6. Add one team, one sensor, and one command post.
7. Add `Alpha Link` and `Bravo Link` communication channels.
8. Configure `Bravo Link` as the backup channel.
9. Add a field report targeted at the Commander.
10. Add an aerial report targeted at the Commander and Operations role.
11. Add a delay fault of 45 seconds to `Alpha Link`.
12. Add one dropout event.
13. Add two contradictory reports.
14. Add a decision gate with at least three options.
15. Require a rationale and confidence value.
16. Add one trigger-condition-action rule.
17. Configure at least three scoring dimensions.
18. Run scenario validation.
19. Fix any validation errors.
20. Preview the scenario.
21. Add a descriptive tag, filter the library by that tag, and inspect the authored timeline preview at the briefing, disruption, and decision times.
22. Publish version 1.
23. Create a successor version, confirm version 1 remains read-only, and archive/restore the selected library entry.

### Expected result

- The scenario is stored as a published version.
- All references resolve correctly.
- Validation reports no errors.
- The scenario can be selected for an exercise.
- The library can locate scenarios by tag, preserve version history, and hide or restore archived entries.
- The read-only preview exposes authored timing and role-scoped reports without creating a live session.

## B. Multiplayer exercise test

For public-demo transport/recovery coverage while four physical laptops are unavailable, open the deployed HTTPS URL and run the judge-created-room flow in multiple browsers. For single-machine coverage, run `npm run test:acceptance` and `npm run test:synthetic`. The latter writes `data/synthetic-acceptance.json` with AAR and alternate-branch evidence. These provide automated evidence for the supported slice; separate-device behavior, public-network fallback, and physical microphones remain part of full release acceptance.

### Setup

- Laptop 1: Instructor.
- Laptop 2: Commander.
- Laptop 3: Operations/Intelligence.
- Laptop 4: Communications/EW.
- All devices are connected to the same local network for the physical pass, or use the same deployed HTTPS URL for the public judge pass.

### Steps

1. Instructor creates a room.
2. Trainees join using the room code.
3. Instructor assigns all three roles.
4. Instructor starts the exercise.
5. Verify that all clients show the same simulation time.
6. Verify that the Commander cannot see Operations-only information.
7. Verify that Operations can submit a field report.
8. Verify that Communications/EW can see channel health.
9. Instructor injects a 45-second delay.
10. Instructor injects a dropped report.
11. Instructor injects a contradictory report.
12. Trainees send text messages.
13. Trainees use voice channels.
14. Communications/EW switches to the backup channel.
15. Commander submits a decision and rationale.
16. Disconnect one trainee laptop.
17. Continue the exercise.
18. Reconnect the trainee laptop.
19. Verify that missed events are reconciled.

For the public judge pass, repeat steps 1–6 from separate browser networks where available. The first request may wake a free service, and voice may be unavailable on networks that require a TURN relay; text, decisions, synchronization, and TruthLens are the required public path.

### Expected result

- The server remains authoritative.
- Each role receives only allowed information.
- Delay, dropout, and conflict behavior are visible to the instructor.
- The disconnected client does not invent missing information.
- Reconnection restores the correct session state.
- Every important event is logged.

## C. TruthLens AAR test

### Steps

1. Instructor ends the exercise.
2. Open the TruthLens report.
3. Scrub the ground-truth timeline.
4. Select the Commander perception view.
5. Select the Operations perception view.
6. Select the Communications/EW perception view.
7. Inspect the delayed report.
8. Inspect the dropped report.
9. Inspect the contradiction relationship.
10. Open the decision provenance view.
11. Verify the exact information available when the Commander decided.
12. Verify the rationale and confidence value.
13. Open the information-flow graph.
14. Open the score breakdown.
15. Open the counterfactual comparison.
16. Export JSON.
17. Export the printable/PDF report.
18. Deliver the same report ID a second time, then scrub to before its second delivery and verify the earlier content/timestamp remains visible.
19. Compare an alternate option that changes a downstream rule. Inspect both branches' reports, object states, score evidence, and skipped inputs.
20. Verify branch comparison does not change the recorded exercise or its AAR. Restart and repeat the comparison using the persisted checkpoint.

### Expected result

- Ground truth and perception are clearly separated.
- The AAR does not judge the participant using information they had not received.
- Delays use separate generated and delivered timestamps.
- Dropped reports remain in the instructor/AAR view.
- Scores identify the evidence that produced them.
- Exports contain the same exercise data shown in the interface.
- Timeline perception excludes reports/text not yet delivered; submitted or expired gates are no longer active.
- Both branches start with the same decision-time information, scenario version, and seed. Their later recorded inputs and early-end/skipping assumptions are visible.
- Branch scores include immediate rule consequences at the decision timestamp. A changed downstream report does not imply a score change unless scoring rules account for it.

## D. Custom Forge test

### Steps

1. Duplicate the military scenario.
2. Rename it `Custom Blackout Protocol`.
3. Change the channel delay from 45 seconds to 20 seconds.
4. Add a new decision gate.
5. Change the target role for one report.
6. Add a new trigger rule.
7. Validate the scenario.
8. Publish version 2.
9. Start an exercise from version 2.

### Expected result

- No source-code change is required.
- Version 1 remains unchanged.
- Version 2 uses the new configuration.
- The AAR identifies the exact scenario version used.

## E. Gemini draft test

### Steps

1. Open the AI scenario-generation panel.
2. Enter a prompt requesting three roles, two communication faults, and three decisions.
3. Generate a draft using Gemini.
4. Validate the returned structure.
5. Open the draft in Forge.
6. Edit at least one event and one scoring dimension.
7. Publish only after validation.
8. Disable the Gemini key or network temporarily.
9. Generate a scenario using the local fallback template.

### Expected result

- Gemini output becomes editable scenario data.
- Invalid output is rejected with useful validation messages.
- The API key is never exposed to the browser.
- Live exercise operation does not fail when Gemini is unavailable.

## F. Phase 1 implementation gate

Phase 0 passes when:

- The product contract is approved.
- The scenario schema is stable enough for TypeScript and validation implementation.
- The Forge object and rule catalog is fixed for the first release.
- The acceptance test is executable without adding new feature categories.
- The first scenario event list is defined.
- The project can move to simulation-engine implementation.

## G. Release blockers

Any of these blocks feature freeze:

- Trainees can see ground truth during an exercise.
- A decision cannot be tied to the participant's perception snapshot.
- Separate laptops cannot join the same room.
- The instructor cannot inject a communication degradation.
- A published scenario cannot be replayed.
- AAR output changes after the scenario is edited.
- The application fails when Gemini is unavailable.
- A scenario can publish with unresolved references.
- The server accepts unauthorized role actions.
