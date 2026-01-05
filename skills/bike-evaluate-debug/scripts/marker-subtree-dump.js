#!/usr/bin/env osascript -l JavaScript

const markerText = '<user>';
const input = JSON.stringify({ markerText });

const result = Application("Bike").evaluate({
  input: input,
  script: `
(input) => {
  var data = JSON.parse(input || '{}');
  var target = String(data.markerText || '').trim().toLowerCase();
  var editor = bike.frontmostOutlineEditor;
  if (!editor) {
    return JSON.stringify({ error: 'No frontmost outline editor' });
  }

  var root = editor.outline.root;
  var marker = null;
  for (var i = 0; i < root.children.length; i++) {
    var text = root.children[i].text ? root.children[i].text.string : '';
    if (text.trim().toLowerCase() === target) {
      marker = root.children[i];
      break;
    }
  }

  if (!marker) {
    return JSON.stringify({ error: 'Marker not found', marker: data.markerText });
  }

  var rows = [marker].concat(marker.descendants || []);
  var payload = rows.map(function(row) {
    return {
      id: row.id,
      level: row.level,
      type: row.type,
      text: row.text ? row.text.string : '',
      attributes: row.attributes || {}
    };
  });

  return JSON.stringify({ marker: data.markerText, rows: payload });
}
`
});

console.log(result);
