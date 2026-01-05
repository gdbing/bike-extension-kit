---
name: bike-evaluate-debug
description: Run Bike app-context AppleScript/JXA evaluate workflows to inspect outlines, selection state, row attributes, and text runs, plus make small debug edits without user involvement. Use when debugging Bike extensions or needing fast app-context introspection via `bike.evaluate`.
---

# Bike Evaluate Debug

## Overview

Use the scripts in `scripts/` to call `bike.evaluate` via JXA (`osascript`) in the app context. Each script prints JSON and is meant to be tweaked for one-off probes.

## Quick Start

- `osascript -l JavaScript scripts/outline-summary.js`
- `osascript -l JavaScript scripts/selection-dump.js`
- `osascript -l JavaScript scripts/marker-subtree-dump.js`
- `osascript -l JavaScript scripts/insert-debug-row.js` (writes a note row)
- `osascript -l JavaScript scripts/delete-debug-rows.js` (removes rows tagged by insert)

## Scripts

- `outline-summary.js` — counts rows by type, lists root markers, reports selection.
- `selection-dump.js` — detailed selection info plus text-attribute runs.
- `marker-subtree-dump.js` — dumps a marker subtree (edit `markerText` at top).
- `insert-debug-row.js` — inserts a note row after the selection (write example).
- `delete-debug-rows.js` — deletes rows tagged with `codex-debug=true`.

## Adaptation Tips

- Use `input` with JSON for parameters; `evaluate` input/output are strings only.
- Avoid `${...}` or backticks inside the inner `script` string.
- `row.text.attributeAt()` returns `undefined` when missing; treat as absent.
- Use `var` for values that must persist across evaluate calls.
- After using `insert-debug-row.js`, run `delete-debug-rows.js` to clean up tagged rows.
- Start new probes by copying an existing script and editing only the inner `script` body.
- Prefer `console.log(JSON.stringify(...))` for reliable output, then parse as needed.
- When expanding scope, iterate on a smaller row set first (e.g., `root.children` or `selection.rows`) before scanning `root.descendants`.
