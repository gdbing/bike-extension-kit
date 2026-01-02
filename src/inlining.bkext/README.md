# inlining

Prototype extension that inlines the contents of other open Bike documents
under explicit inline markers, with bidirectional sync.

## Usage

1. Open the document you want to inline and keep it open in Bike.
2. In the host document, add a row whose text is:
   ```
   <inline: Document Name>
   ```
   The document name must match the target document's display name.

The target document's entire outline becomes the children of that row. Edits
in either location propagate to the other (most-recent edit wins if both change).

## Behavior

- Explicit only: only rows with `<inline: ...>` are inlined.
- Targets must be open in Bike.
- If the target document is closed or renamed so it no longer matches, the
  inline children are cleared.
- If the inline marker is removed, the last inlined content remains as a
  snapshot.
- Top-level empty rows are not synced (Bike treats them inconsistently), but
  they are preserved locally so they don't get deleted during sync.

## Limitations

- Avoid inline cycles (A inlines B and B inlines A).
- Sync works by copying full content, not by patching specific row changes.
