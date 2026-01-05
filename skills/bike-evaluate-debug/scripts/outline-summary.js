#!/usr/bin/env osascript -l JavaScript

const result = Application("Bike").evaluate({
  script: `
(function() {
  var editor = bike.frontmostOutlineEditor;
  if (!editor) {
    return JSON.stringify({ error: 'No frontmost outline editor' });
  }

  var outline = editor.outline;
  var root = outline.root;
  var rows = root.descendants || [];
  var counts = {};

  for (var i = 0; i < rows.length; i++) {
    var type = rows[i].type || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
  }

  var markers = [];
  for (var j = 0; j < root.children.length; j++) {
    var text = root.children[j].text ? root.children[j].text.string : '';
    var trimmed = text.trim();
    if (/^<[^>]+>$/.test(trimmed)) {
      markers.push(trimmed);
    }
  }

  var selection = null;
  if (editor.selection) {
    selection = {
      type: editor.selection.type,
      rowId: editor.selection.row.id,
      rowText: editor.selection.row.text ? editor.selection.row.text.string : ''
    };
  }

  return JSON.stringify({
    totalRows: rows.length,
    countsByType: counts,
    markers: markers,
    selection: selection
  });
})()
`
});

console.log(result);
