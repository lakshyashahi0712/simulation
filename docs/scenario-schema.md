# SENTINEL Scenario Schema and Forge Catalog

**Schema version:** `1.0`

The scenario definition is the contract between Forge, the simulation engine, multiplayer sessions, and TruthLens. Forge edits this structure; the runtime engine executes it.

## 1. Canonical scenario shape

```json
{
  "schemaVersion": "1.0",
  "id": "operation-signal-break",
  "version": 1,
  "status": "published",
  "metadata": {
    "title": "Operation Signal Break",
    "category": "military",
    "description": "Synthetic multi-domain exercise under degraded communications.",
    "durationSeconds": 600,
    "seed": 42001,
    "tags": ["land", "air", "cyber", "ew", "command-and-control"]
  },
  "roles": [],
  "environment": {
    "world": { "type": "low-poly-grid", "width": 120, "depth": 120 },
    "objects": []
  },
  "channels": [],
  "reports": [],
  "events": [],
  "rules": [],
  "decisions": [],
  "objectives": [],
  "scoring": [],
  "aar": {
    "metrics": [],
    "sections": ["summary", "timeline", "perception", "decisions", "communication"]
  }
}
```

## 2. Metadata

| Field | Type | Required | Description |
|---|---|---:|---|
| `schemaVersion` | string | yes | Schema version used to validate the document. |
| `id` | string | yes | Stable identifier. |
| `version` | integer | yes | Published version number. |
| `status` | enum | yes | `draft`, `validated`, `published`, or `archived`. |
| `metadata.title` | string | yes | Display name. |
| `metadata.category` | enum | yes | `military`, `disaster`, or `synthetic`. |
| `metadata.description` | string | yes | Instructor-facing explanation. |
| `metadata.durationSeconds` | integer | yes | Exercise duration. |
| `metadata.seed` | integer | yes | Seed for repeatable behavior. |
| `metadata.tags` | string[] | no | Search and filtering tags. |

## 3. Roles

```json
{
  "id": "commander",
  "name": "Commander",
  "kind": "commander",
  "briefing": "You coordinate the exercise and submit primary decisions.",
  "permissions": ["receive_reports", "send_messages", "submit_decisions"],
  "visibility": {
    "objectIds": ["command-post", "north-zone"],
    "reportIds": ["air-report-01", "field-report-01"]
  }
}
```

Supported role kinds:

- `commander`
- `operations`
- `communications-ew`
- `custom`

An administrator may create custom roles, but every custom role must have an ID, name, briefing, permissions, and an information-visibility configuration.

## 4. Environment objects

Every object has a stable ID, a type, a transform, and optional physics properties.

```json
{
  "id": "north-checkpoint",
  "type": "location",
  "name": "North Checkpoint",
  "transform": {
    "position": { "x": 18, "y": 0, "z": -12 },
    "rotationY": 0,
    "scale": { "x": 1, "y": 1, "z": 1 }
  },
  "properties": {
    "status": "open",
    "visibleToRoles": ["commander", "operations"]
  },
  "physics": {
    "body": "fixed",
    "collider": "box",
    "trigger": false
  }
}
```

### Supported object types

#### Environment

- `zone`
- `location`
- `route`
- `checkpoint`
- `hazard`
- `objective-area`
- `spawn-point`

#### Operational

- `team`
- `unit`
- `sensor`
- `observation-point`
- `resource`
- `command-post`

#### Communication

- `channel-node`
- `report-source`
- `relay-node`

### Supported physics values

| Field | Values |
|---|---|
| `body` | `fixed`, `kinematic`, `dynamic` |
| `collider` | `box`, `sphere`, `capsule`, `none` |
| `trigger` | boolean |
| `mass` | positive number for dynamic bodies |
| `restitution` | number from `0` to `1` |

Physics is used for low-poly trigger and interaction behavior. It is not intended to model a full combat game world.

## 5. Communication channels

```json
{
  "id": "alpha-link",
  "name": "Alpha Link",
  "kind": "team",
  "participants": ["commander", "operations"],
  "baseLatencyMs": 300,
  "reliability": 1,
  "backupChannelId": "bravo-link",
  "status": "active"
}
```

Supported channel kinds:

- `team`
- `broadcast`
- `private`
- `voice`

Runtime faults can override channel behavior without modifying the published scenario.

## 6. Reports

```json
{
  "id": "field-report-01",
  "sourceRole": "operations",
  "channelId": "alpha-link",
  "targetRoles": ["commander"],
  "domain": "land",
  "priority": "critical",
  "generatedAtSeconds": 90,
  "content": "North route status requires verification.",
  "freshnessSeconds": 60,
  "reliability": 0.7
}
```

The engine records runtime fields separately:

- `generatedAt`
- `deliveredAt`
- `deliveryStatus`
- `delayMs`
- `droppedReason`
- `contradictsReportId`
- `receivedBy`

Supported delivery statuses:

- `delivered`
- `delayed`
- `dropped`
- `conflicting`
- `stale`
- `partial`

## 7. Events

Timed events have an `atSeconds` value. Triggered events are created by rules.

```json
{
  "id": "disable-alpha-link",
  "type": "channel-fault",
  "atSeconds": 150,
  "payload": {
    "channelId": "alpha-link",
    "fault": "delay",
    "delayMs": 45000,
    "durationSeconds": 90
  }
}
```

Supported event types:

- `message`
- `channel-fault`
- `channel-restore`
- `state-change`
- `decision-gate`
- `instructor-alert`
- `objective-update`
- `scenario-end`

Supported communication faults:

- `delay`
- `dropout`
- `conflict`
- `stale`
- `partial`
- `outage`

## 8. Trigger-condition-action rules

Runtime rules use a serializable structure.

```json
{
  "id": "verify-north-route",
  "trigger": {
    "type": "decision-submitted",
    "decisionId": "route-decision"
  },
  "conditions": [
    {
      "type": "selected-option",
      "decisionId": "route-decision",
      "optionId": "north-route"
    }
  ],
  "actions": [
    {
      "type": "send-report",
      "reportId": "late-verification-report",
      "delayMs": 30000
    }
  ],
  "once": true
}
```

### Triggers

- `time-reached`
- `zone-entered`
- `message-received`
- `message-ignored`
- `decision-submitted`
- `channel-disabled`
- `channel-restored`
- `object-collision`
- `instructor-injection`

### Conditions

- `role-is`
- `object-state`
- `channel-state`
- `report-age`
- `report-status`
- `selected-option`
- `decision-count`
- `objective-state`
- `time-window`

### Actions

- `send-report`
- `delay-report`
- `drop-report`
- `create-conflict`
- `disable-channel`
- `restore-channel`
- `activate-decision`
- `change-object-state`
- `send-instructor-alert`
- `add-score-event`
- `end-exercise`

Forge edits these as connected WHEN / IF / THEN nodes with a typed inspector, reference selectors, multiple conditions, ordered actions, and run-once controls. A rule has one trigger, all conditions are required, and actions execute in array order. Compatible port connections and the ordering controls update these executable arrays. The engine executes the validated runtime representation and prevents recursive re-entry into an active rule.

### Optional visual layout

Rules may include `editor.graph` metadata. Existing schema `1.0` scenarios without it remain valid and receive a default canvas arrangement when opened. The engine executes `trigger`, `conditions`, and `actions`; connections are derived from their order.

For the example above, the optional metadata is:

```json
{
  "editor": {
    "graph": {
      "version": 1,
      "nodes": [
        { "id": "trigger-0", "kind": "trigger", "index": 0, "position": { "x": 32, "y": 48 } },
        { "id": "condition-0", "kind": "condition", "index": 0, "position": { "x": 320, "y": 48 } },
        { "id": "action-0", "kind": "action", "index": 0, "position": { "x": 608, "y": 48 } }
      ]
    }
  }
}
```

The layout version is independent of the scenario schema/version. Local node IDs are 1–80 letters, digits, underscores, or hyphens and unique within a rule. `kind` is `trigger`, `condition`, or `action`; `index` identifies the corresponding executable array slot, with trigger index `0`. Every executable node must have exactly one layout entry. Canvas coordinates are finite numbers from `0` through `4096`.

Node identities and positions survive typed edits and reordering; slot indices update to reflect execution order. Moving or arranging nodes changes visual placement. Layouts persist through draft save/recovery, publication, duplication, and JSON import/export. Malformed layout metadata produces field-specific `INVALID_RULE_GRAPH` validation errors.

## 9. Decision gates

```json
{
  "id": "route-decision",
  "title": "Select a verified support route",
  "targetRoles": ["commander"],
  "activation": {
    "type": "time",
    "atSeconds": 240
  },
  "options": [
    {
      "id": "north-route",
      "label": "Continue on North Route"
    },
    {
      "id": "verification",
      "label": "Request verification before movement"
    },
    {
      "id": "backup-route",
      "label": "Use Backup Route"
    }
  ],
  "requireRationale": true,
  "requireConfidence": true,
  "timeLimitSeconds": 60
}
```

## 10. Scoring dimensions

Scoring is transparent and configurable.

Initial dimensions:

- `decision-timeliness`
- `uncertainty-recognition`
- `conflict-resolution`
- `information-verification`
- `communication-clarity`
- `backup-channel-use`
- `team-coordination`
- `adaptability`
- `rationale-quality`

Scores must be explainable in the AAR. Every score event should reference the exercise event that caused it.

## 11. AAR configuration

The AAR must be able to display:

- Ground-truth timeline
- Per-role perception timeline
- Generated versus delivered timestamps
- Delayed and dropped reports
- Contradiction links
- Decisions and rationales
- Active faults at decision time
- Communication graph
- Score breakdown
- Counterfactual branch metadata

## 12. Validation invariants

A scenario is publishable only when:

1. `schemaVersion` is supported.
2. All IDs are unique.
3. Every referenced role, object, channel, report, decision, and rule exists.
4. Every decision has at least two options.
5. Every rule has a valid trigger and action.
6. Every exercise has at least one start event and one completion condition.
7. Every published scenario has scoring dimensions.
8. Every message has a source and target.
9. Every configured duration and delay is non-negative.
10. A frozen published version cannot be mutated by a live exercise.

The authoring editor keeps timed decision activation synchronized with its `decision-gate` event. Trigger-activated decisions require a rule containing an `activate-decision` action. Option references must belong to the selected decision; scoring actions must reference a configured dimension and include a reason. Reports and decisions require recipients, event times must fit the scenario duration, and rule delays/durations and scoring weights must be finite and non-negative. Deletion controls show dependencies so authors can update references before removing an entity.
