#!/usr/bin/env osascript -l JavaScript

const result = Application("Bike").evaluate({
  script: `
(function() {
  var editor = bike.frontmostOutlineEditor;
  if (!editor) {
    return 'No frontmost outline editor';
  }

  var outline = editor.outline;
  var root = outline.root;
  var rows = root.descendants || [];
  var toDelete = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row.attributes && row.attributes['codex-debug'] === 'true') {
      toDelete.push(row);
    }
  }

  if (toDelete.length === 0) {
    return 'No debug rows found';
  }

  outline.transaction({ animate: 'none' }, function() {
    outline.removeRows(toDelete);
  });

  return 'Removed ' + String(toDelete.length) + ' debug row(s)';
})()
`
});

console.log(result);
