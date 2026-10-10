# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Instructors author synthetic exercises, start and control live sessions, and review after-action evidence.
- Trainees in Commander, Operations, and Communications/EW roles make decisions with incomplete, delayed, or conflicting information.

## Product Purpose

SENTINEL is a multiplayer decision-training platform for degraded communication environments. It lets an instructor create and run fictional exercises, gives each trainee role-scoped information, and explains what each role knew when a decision was made.

Success means an instructor can prepare and run an exercise quickly, trainees can scan their role's situation and act without confusion, and the after-action review can show evidence rather than only a score.

## Positioning

SENTINEL's differentiator is decision-time evidence reconstruction: the system preserves each role's actual perception and compares the recorded decision with an alternate future without pretending to predict human behavior.

## Operating Context

- Forge is used during exercise preparation to author reports, decisions, communication faults, world objects, scoring, and trigger-condition-action rules.
- Exercise is used live by an instructor and distributed trainees on separate browser clients over a LAN-first or free public HTTPS web stack. The person who creates a room becomes its instructor; the deployed backend remains authoritative.
- TruthLens is used after an exercise to inspect timeline, role perception, provenance, score evidence, and alternate branches.
- The product is currently evaluated on a Windows/WSL development machine with a Ryzen 3 3200U, integrated graphics, and 12 GB RAM.

## Capabilities and Constraints

- Existing functionality, routes, controls, schema, persistence, multiplayer behavior, 3D playground, voice, validation, publication, recovery, and TruthLens evidence must remain working.
- The product uses React, TypeScript, Vite, Fastify, Socket.IO, and Three.js.
- The interface must retain operational information density and fast scanning while becoming easier to understand.
- Mobile parity matters at 375px as well as desktop use.
- Exercises are fictional and synthetic. The UI must not imply real operational integrations, classified information, real targeting, real radio frequencies, or real cyberattacks.
- VR is deferred. Physical four-laptop and microphone acceptance is tracked separately.
- The SIH judge demonstration must be publicly reachable without paid hosting, a paid domain, paid certificates, or required paid third-party services. The primary target is Render Free with a generated HTTPS URL; a Cloudflare Quick Tunnel from Windows is the fallback.
- Free-hosted sessions may cold-start and use ephemeral local JSON storage. Included fictional presets must work after a clean deployment, and the project owner must not need to be online for a judge to create a room.

## Brand Commitments

- SENTINEL is the product name and the voice should be direct, precise, calm, and human.
- The redesign must feel professional without becoming flashy, gamified, or a generic corporate admin panel.

## Evidence on Hand

- Product requirements and constraints: `docs/product-contract.md`.
- Scenario/schema contract: `docs/scenario-schema.md`.
- Acceptance procedure: `docs/acceptance-test.md`.
- Existing UI implementation: `web/src/`.
- Existing browser evidence: `data/browser-smoke/`.

## Product Principles

1. Show the evidence that changes a decision.
2. Keep role boundaries and simulation state legible.
3. Let instructors author and recover work without fear.
4. Make dense information scannable before making it decorative.
5. Keep the interface credible as a training instrument, not a game or a command-center costume.

## Accessibility & Inclusion

- Preserve keyboard access, visible focus, semantic controls, readable contrast, responsive reflow, and reduced-motion support.
- Do not rely on color alone for role, status, health, validation, or branch meaning.
