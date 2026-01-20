#!/usr/bin/env osascript -l JavaScript

const sampleText = 'normal italic normal';
const rangeStart = 7;
const rangeEnd = 13;
const input = JSON.stringify({
  text: sampleText,
  start: rangeStart,
  end: rangeEnd
});

const result = Application("Bike").evaluate({
  input: input,
  script: `
(input) => {
  var data = JSON.parse(input || '{}');
  var editor = bike.frontmostOutlineEditor;
  if (!editor || !editor.selection) {
    return JSON.stringify({ error: 'No selection' });
  }

  var outline = editor.outline;
  var anchor = editor.selection.row;
  var parent = anchor.parent || outline.root;
  var text = String(data.text || '');
  var start = Number(data.start || 0);
  var end = Number(data.end || 0);

  var inserted = [];
  outline.transaction({ animate: 'none' }, function() {
    inserted = outline.insertRows([{ text: text }], parent, anchor.nextSibling);
  });

  if (!inserted.length) {
    return JSON.stringify({ error: 'Insert failed' });
  }

  var row = inserted[0];
  if (typeof row.setAttribute === 'function') {
    row.setAttribute('codex-debug', 'true');
  }

  row.text.addAttribute('em', '', [start, end]);

  var flags = [];
  for (var i = 0; i < row.text.string.length; i += 1) {
    var value = row.text.attributeAt('em', i);
    flags.push(value !== null && value !== undefined);
  }

  var ranges = [];
  var inRange = false;
  var currentStart = 0;
  for (var j = 0; j < flags.length; j += 1) {
    if (flags[j] && !inRange) {
      inRange = true;
      currentStart = j;
    } else if (!flags[j] && inRange) {
      ranges.push([currentStart, j]);
      inRange = false;
    }
  }
  if (inRange) {
    ranges.push([currentStart, flags.length]);
  }

  function rangeAt(index, affinity) {
    var effective = [0, 0];
    var value = row.text.attributeAt('em', index, affinity, effective);
    return {
      index: index,
      affinity: affinity || 'default',
      value: value,
      effectiveRange: effective
    };
  }

  var effectiveSamples = [];
  for (var k = Math.max(0, start - 2); k <= Math.min(row.text.string.length - 1, end + 2); k += 1) {
    effectiveSamples.push(rangeAt(k, 'upstream'));
    effectiveSamples.push(rangeAt(k, 'downstream'));
  }

  var markdown = '';
  if (typeof row.text.toMarkdown === 'function') {
    markdown = row.text.toMarkdown();
  }

  return JSON.stringify({
    text: row.text.string,
    start: start,
    end: end,
    markdown: markdown,
    emRanges: ranges,
    effectiveSamples: effectiveSamples
  });
}
`
});

console.log(result);
