#!/usr/bin/env osascript -l JavaScript

const textToInsert = 'Debug note row';
const input = JSON.stringify({ text: textToInsert });

const result = Application("Bike").evaluate({
  input: input,
  script: `
(input) => {
  var data = JSON.parse(input || '{}');
  var editor = bike.frontmostOutlineEditor;
  if (!editor || !editor.selection) {
    return 'No selection';
  }

  var row = editor.selection.row;
  var outline = editor.outline;
  var parent = row.parent || outline.root;
  var text = String(data.text || 'Debug note row');

  outline.transaction({ animate: 'none' }, function() {
    var inserted = outline.insertRows([{ text: text, type: 'note' }], parent, row.nextSibling);
    if (inserted.length > 0 && typeof inserted[0].setAttribute === 'function') {
      inserted[0].setAttribute('codex-debug', 'true');
    }
  });

  return 'Inserted debug row';
}
`
});

console.log(result);
