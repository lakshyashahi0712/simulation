# SENTINEL Phase B evidence sheet

Use this sheet during the physical four-device LAN pass described in [lan-validation.md](lan-validation.md). Record the actual date, device/browser versions, host address, scenario version, and any failure reproduction steps.

## Test identity

| Field | Result |
| --- | --- |
| Date/time |  |
| Host laptop/model |  |
| Host OS / Node version |  |
| Target hardware | Ryzen 3 3200U / integrated graphics / 12 GB RAM |
| Host LAN address and port |  |
| Browser versions |  |
| Scenario and version |  |
| Room code |  |

## Four-device gates

| Gate | Result | Evidence / notes |
| --- | --- | --- |
| Four devices join the same room |  |  |
| Instructor sees all three linked trainees |  |  |
| Simulation clocks remain synchronized |  |  |
| Commander cannot see Operations-only information |  |  |
| Operations can send a permitted report/message |  |  |
| Communications/EW sees channel health |  |  |
| Delayed message arrives after the configured delay |  |  |
| Dropped message is absent from the trainee and present in instructor audit |  |  |
| Backup channel carries the intended message |  |  |
| Voice works in both directions over trusted HTTPS |  |  |
| Voice leave stops remote audio |  |  |
| Offline queued action is applied once after reconnect |  |  |
| Paused session restores after backend restart |  |  |
| Completed session restores read-only with AAR |  |  |
| Decision includes rationale, confidence, and perception snapshot |  |  |
| TruthLens timeline, flow, scoring, export, and Print/PDF work |  |  |

## Performance notes

| Measure | Result |
| --- | --- |
| Number of simultaneous clients |  |
| Startup time |  |
| Typical simulation-control response |  |
| 3D playground responsiveness |  |
| Voice quality / echo |  |
| Reconnect time |  |
| CPU / memory observation |  |

## Release decision

- [ ] PASS — all required physical gates passed with evidence.
- [ ] FAIL — a required gate failed and needs a fix/retest.
- [ ] BLOCKED — physical device, certificate, network, or microphone access was unavailable.

### Failures and follow-up

| Failure | Reproduction steps | Owner / next action | Retest result |
| --- | --- | --- | --- |
|  |  |  |  |
