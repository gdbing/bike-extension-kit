# inlining

Prototype extension that inlines the contents of other open Bike documents
under explicit inline markers, with bidirectional sync running asynchronously
in the background.

## Usage

1. Open the document you want to inline and keep it open in Bike.
2. In the host document, add a row whose text is:
   ```
   <inline: Document Name>
   ```
   The document name must match the target document's display name
   (case-insensitive, leading/trailing whitespace ignored).

The target document's entire outline becomes the children of that row. Edits
in either location propagate to the other (most-recent edit wins if both change).

## Behavior

- Explicit only: only rows with `<inline: ...>` are inlined.
- Targets must be open in Bike.
- If multiple open documents share the same display name, the inline marker
  shows a warning row and no sync occurs.
- If the target document is closed or renamed so it no longer matches, the
  inline children are cleared.
- If the inline marker is removed, the last inlined content remains as a
  snapshot.
- Sync updates rows in place (row-by-row) and preserves the full subtree order.
- Inlined rows store a `data-inline-id` attribute that tracks the source row id.
- Empty rows are synced like any other row.
- Sync is debounced and time-sliced; large outlines update in batches rather
  than blocking text edits.
- If multiple inline copies change between syncs, the target document wins and
  inline edits are overwritten on the next sync.

## Limitations

- Avoid inline cycles (A inlines B and B inlines A).
- Clearing `data-inline-id` attributes in the inline copy will force remapping
  on the next sync.
- Sync is eventual: edits made while a sync is running will schedule another
  pass, so updates may appear slightly delayed.

## Testing

- Unit tests live in `tests/inlining`.
- Run `npm run test:inlining`.

## Manual Smoke Test (Bike Evaluate)

The script creates two temporary plaintext documents in `/tmp` and opens them
in Bike. It records their paths in `/tmp/bike-inlining-smoke-test/state.json`.

1. Setup:
   ```
   INLINE_MODE=setup osascript -l JavaScript skills/bike-evaluate-debug/scripts/inlining-smoke-test.js
   ```
2. Wait a moment for sync, then verify:
   ```
   INLINE_MODE=verify osascript -l JavaScript skills/bike-evaluate-debug/scripts/inlining-smoke-test.js
   ```
3. Verify inline-to-doc sync (edits inline copy, waits, then verifies target doc):
   ```
   INLINE_MODE=verify-inline-to-doc osascript -l JavaScript skills/bike-evaluate-debug/scripts/inlining-smoke-test.js
   ```
4. Cleanup (removes test rows, closes temp docs, deletes temp files/state):
   ```
   INLINE_MODE=cleanup osascript -l JavaScript skills/bike-evaluate-debug/scripts/inlining-smoke-test.js
   ```
