---
name: bike-extension-context
description: Route Bike extension development tasks to the correct local tutorial references for app context, DOM context, style context, and extension scaffolding. Use when implementing or modifying Bike extensions in this repository and deciding which context APIs or setup steps apply.
---

# Bike Extension Context

## Overview

Use this skill to select the right tutorial reference file for the current task and avoid loading unrelated docs.

## Select References

- For extension setup, manifest/config layout, and build/watch workflow, read `references/creating-extensions.md`.
- For `app` context tasks (`app/main.ts`, command handlers, row/text model operations), read `references/app-context-tutorial.md`.
- For `dom` context tasks (`dom/*.ts` or `dom/*.tsx`, dialogs, direct UI/DOM behavior), read `references/dom-context-tutorial.md`.
- For style/theme tasks (`style/main.ts`, CSS or presentation behavior), read `references/style-context-tutorial.md`.

## Workflow

1. Identify the target files and runtime context before editing.
2. Open only the matching reference file(s) from `references/`.
3. Apply repository constraints from `AGENTS.md` along with the selected reference.
4. If a change spans multiple contexts, load each relevant reference and keep context boundaries explicit.

## Notes

- Prefer minimal context loading; do not read all reference files by default.
- Resolve app-vs-dom uncertainty by checking the entry point and imported API namespaces first.
