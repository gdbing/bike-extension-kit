#!/usr/bin/env osascript -l JavaScript

const result = Application("Bike").evaluate({
  script: `
(function() {
  var editor = bike.frontmostOutlineEditor;
  if (!editor || !editor.selection) {
    return JSON.stringify({ error: 'No selection' });
  }

  var selection = editor.selection;
  var names = ['strong', 'em', 'code', 's', 'a', 'mark'];

  function collectRuns(text) {
    if (!text || !text.string || typeof text.attributeAt !== 'function') {
      return [];
    }
    var result = [];
    for (var n = 0; n < names.length; n++) {
      var name = names[n];
      var start = null;
      var value = null;
      var length = text.string.length;
      for (var idx = 0; idx < length; idx++) {
        var val = text.attributeAt(name, idx);
        if (val == null && start === null) {
          continue;
        }
        if (val != null && start === null) {
          start = idx;
          value = val;
          continue;
        }
        if (start !== null && (val == null || val !== value)) {
          result.push({ name: name, start: start, end: idx, value: value });
          start = null;
          value = null;
          if (val != null) {
            start = idx;
            value = val;
          }
        }
      }
      if (start !== null) {
        result.push({ name: name, start: start, end: text.string.length, value: value });
      }
    }
    return result;
  }

  function rowInfo(row) {
    return {
      id: row.id,
      level: row.level,
      type: row.type,
      text: row.text ? row.text.string : '',
      attributes: row.attributes || {},
      runs: collectRuns(row.text)
    };
  }

  var rows = [];
  for (var r = 0; r < selection.rows.length; r++) {
    rows.push(rowInfo(selection.rows[r]));
  }

  return JSON.stringify({
    type: selection.type,
    word: selection.word,
    sentence: selection.sentence,
    headRow: rowInfo(selection.row),
    rows: rows
  });
})()
`
});

console.log(result);
