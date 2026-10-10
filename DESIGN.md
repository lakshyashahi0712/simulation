---
name: SENTINEL Signal Ledger
description: A calm evidence workspace for synthetic decision-training exercises.
colors:
  mineral-bg: "#e9efed"
  surface: "#f8faf8"
  surface-muted: "#eef3f1"
  ink: "#172936"
  ink-soft: "#304552"
  line: "#c9d5d2"
  line-strong: "#aabbb7"
  field-blue: "#21647b"
  primary-button: "#1e5d73"
  action-rust: "#9d543f"
  uncertainty-ochre: "#9a6a29"
  verified-moss: "#3b705d"
  danger-red: "#a44743"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(42px, 6vw, 76px)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.065em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.3
  mono:
    fontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  none: "0"
  compact: "2px"
  control: "4px"
  panel: "3px"
spacing:
  control: "10px 11px"
  panel: "17px 18px"
components:
  button-primary:
    backgroundColor: "{colors.primary-button}"
    textColor: "#f7fbf9"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.action-rust}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "38px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "17px 18px"
---

# Design System: SENTINEL Signal Ledger

## Overview

**Creative North Star: “Signal Ledger”**

SENTINEL is a professional training workspace for incomplete information. The interface uses a pale mineral work surface and a deep ink rail so the user's attention stays on state, evidence, and the next action. It should feel like a well-made operations workbook, not a neon control panel, tactical game, or generic corporate dashboard.

The product stays dense and practical. Structure comes from aligned panels, quiet borders, compact evidence rows, and clear state strips. Color is semantic: field blue navigates, rust marks intervention, moss confirms verified state, and ochre marks uncertainty.

**Key Characteristics:**

- Pale mineral ground with dark ink structure.
- Square, quiet panels with borders instead of ornamental depth.
- System sans for operating text; monospace only for IDs, timestamps, coordinates, and simulation values.
- The 3D playground is the one dark visual field and remains an authored simulation surface.
- Mobile reflows preserve the same reading order and controls.

Implementation source: `web/src/redesign.css` supplies the active visual tokens after the legacy layout styles. This document records the shared system, not every component-specific tint or inherited size. The Impeccable detector also reads overridden legacy declarations, so its design-system advisories require checking the computed style before changing a live surface.

## Colors

The palette is cool, restrained, and semantic. Saturated accents are reserved for actions, state, and evidence.

### Primary

- **Field Blue** (`#21647b`): primary actions, navigation emphasis, links, graph edges, and verified interactive focus.
- **Action Rust** (`#9d543f`): secondary actions and intervention controls.

### Secondary

- **Verified Moss** (`#3b705d`): healthy/confirmed state and successful validation.
- **Uncertainty Ochre** (`#9a6a29`): warnings, delayed information, and uncertain state.
- **Danger Red** (`#a44743`): invalid authoring and destructive controls.

### Neutral

- **Mineral Ground** (`#e9efed`): page field.
- **Surface** (`#f8faf8`): panels, cards, and form surfaces.
- **Muted Surface** (`#eef3f1`): selected controls and secondary work areas.
- **Ink** (`#172936`): headings, body text, and the top rail.
- **Ink Soft** (`#304552`): supporting text.
- **Line** (`#c9d5d2`) and **Line Strong** (`#aabbb7`): structure and input boundaries.

### Named Rules

**The Evidence Before Ornament Rule.** Use color and hierarchy to explain what changes a decision. Do not add decorative glow, gradients, or visual noise to make a screen feel more technical.

## Typography

**Display Font:** system sans stack, with platform-native fallbacks.

**Body Font:** system sans stack, with platform-native fallbacks.

**Label/Mono Font:** `SFMono-Regular`, `Consolas`, or `Liberation Mono` for measurements and metadata.

The pairing is workmanlike and quiet. Display scale comes from weight, size, and tight tracking rather than a decorative typeface. Monospace is data syntax, never a costume for ordinary prose.

### Hierarchy

- **Display** (700, `clamp(42px, 6vw, 76px)`, 0.98): launcher purpose statement.
- **Headline** (700, 25–40px): workspace title and major task framing.
- **Title** (700, 15–24px): panel and card titles.
- **Body** (400, 12–17px, 1.5): instructions, descriptions, and evidence content.
- **Label** (650, 11px, 1.3): controls and compact field labels.
- **Mono metadata** (400, 9–10px): state, time, IDs, graph lanes, and coordinates.

## Layout

Wide workspaces use a disciplined 12-column grid with a maximum width around 1480px and 32px outer padding. The first viewport gives the current task one dominant region, a supporting evidence region, and a visible state strip.

The launcher leads with a concise purpose statement and two differentiated start paths. Forge keeps scenario brief, world preview, object inspection, and authoring in one ordered workspace. Live consoles put current state and decisions before secondary history. TruthLens presents actual and alternate branches side by side on wide screens and stacks them on narrow screens.

At 375px, multi-column work areas become one column, controls wrap, graph inspectors stack below the canvas, and no horizontal scrolling is allowed. Preserve the desktop reading order rather than hiding core controls.

## Elevation & Depth

The system is flat by default. Tonal surfaces and quiet 1px borders establish hierarchy. Shadows are ambient and sparse, used only for the main launcher/workspace lift. The 3D playground creates depth through its dark stage, grid plane, object geometry, and labels rather than CSS effects.

### Named Rules

**The Flat-By-Default Rule.** Panels should read as a single work surface. A border or tonal shift is preferred to a floating card stack.

## Shapes

Controls use a 4px radius. Panels use a 3px radius. Graph nodes and evidence rows use square-ish corners. Avoid thick side stripes on rounded cards; semantic accents belong on top rails, labels, text, or state controls.

## Components

### Buttons

- **Shape:** compact 38px controls with a 4px radius.
- **Primary:** field blue with light text for the main action.
- **Secondary:** action rust for alternate or intervention actions.
- **Ghost:** transparent with a strong line; hover adds a pale mineral tint.
- **Focus:** a visible 3px field/rust outline with a 2px offset.

### Cards / Containers

- **Shape:** flat surface, quiet border, minimal radius.
- **Header:** title first, supporting metadata second; do not add decorative eyebrow labels above every heading.
- **Density:** compact rows and form groups, with generous separation between distinct work areas.

### Evidence and State

- Use field blue for links and graph structure; the primary button uses its darker `primary-button` tone.
- Use moss, ochre, and red with text/status labels so color is never the only meaning.
- Keep timestamps, IDs, coordinates, and simulation values monospace.

### 3D Playground

- Use the dark teal stage as a deliberate contrast field.
- Keep object labels readable and outlined.
- Use brighter mint, rust, ochre, and blue object materials against the dark stage.
- Retain plan view and keyboard/touch controls as equivalent accessible paths.

## Do's and Don'ts

### Do

- Put current state and the next decision where the eye lands first.
- Keep authoring errors linked to the exact field and graph node.
- Preserve dense evidence rows when they help scanning.
- Test every major surface at desktop and 375px widths.
- Keep the interface credible as a synthetic training instrument.

### Don't

- Do not use glow, gradients, glass, or neon as default decoration.
- Do not turn every section into a same-size card or nest cards without a task reason.
- Do not use monospace for ordinary body copy.
- Do not hide core authoring, live exercise, or TruthLens controls on mobile.
- Do not imply real-world operational integrations or classified data.
