#!/usr/bin/env osascript -l JavaScript

ObjC.import('Foundation')
ObjC.import('stdlib')

const app = Application('Bike')
app.includeStandardAdditions = true

const env = (name) => {
  const processEnv = $.NSProcessInfo.processInfo.environment
  const value = processEnv.objectForKey(name)
  return value ? ObjC.unwrap(value) : null
}

const mode = env('INLINE_MODE') || 'verify' // setup | verify | cleanup
const baseDir = env('INLINE_TEMP_DIR') || '/tmp/bike-inlining-smoke-test'
const statePath = `${baseDir}/state.json`

const fileManager = $.NSFileManager.defaultManager

function ensureDir(path) {
  fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, undefined, undefined)
}

function fileExists(path) {
  return fileManager.fileExistsAtPath(path)
}

function writeText(path, text) {
  const content = $.NSString.stringWithString(text)
  content.writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, undefined)
}

function readText(path) {
  const content = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, undefined)
  return content ? ObjC.unwrap(content) : null
}

function removeFile(path) {
  if (!fileExists(path)) return false
  fileManager.removeItemAtPathError(path, undefined)
  return true
}

function createEmptyFile(path) {
  writeText(path, '')
}

function openFile(path) {
  try {
    app.open(Path(path))
    return true
  } catch (error) {
    return false
  }
}

function docName(doc) {
  try {
    return ObjC.unwrap(doc.name())
  } catch (error) {}
  try {
    return ObjC.unwrap(doc.name)
  } catch (error) {}
  return null
}

function closeDocument(doc) {
  const attempts = [
    () => doc.close({ saving: 'no' }),
    () => doc.close({ saving: app.saving.no }),
    () => doc.close({ saving: app.saveOptions.no }),
    () => doc.close()
  ]

  for (let i = 0; i < attempts.length; i += 1) {
    try {
      attempts[i]()
      return true
    } catch (error) {}
  }

  return false
}

function closeDocumentsByName(name) {
  if (!name) return 0
  let closed = 0
  const docsValue = typeof app.documents === 'function' ? app.documents() : app.documents
  let docs = []
  try {
    if (Array.isArray(docsValue)) {
      docs = docsValue
    } else if (docsValue && docsValue.isKindOfClass && docsValue.isKindOfClass($.NSArray)) {
      docs = docsValue
    }
  } catch (error) {
    docs = []
  }
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i]
    if (docName(doc) === name) {
      if (closeDocument(doc)) {
        closed += 1
      }
    }
  }
  return closed
}

function loadState() {
  if (!fileExists(statePath)) return null
  const text = readText(statePath)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (error) {
    return null
  }
}

function saveState(state) {
  ensureDir(baseDir)
  writeText(statePath, JSON.stringify(state))
}

function makeTempPaths() {
  const id = ObjC.unwrap($.NSUUID.UUID.UUIDString)
  return {
    hostPath: `${baseDir}/inline-host-${id}.txt`,
    targetPath: `${baseDir}/inline-target-${id}.txt`
  }
}

function runEvaluate(input) {
  return Application('Bike').evaluate({
    input: JSON.stringify(input),
    script: `
(input) => {
  var data = JSON.parse(input || '{}');
  var hostPath = String(data.hostPath || '');
  var targetPath = String(data.targetPath || '');
  var mode = String(data.mode || 'verify');

  if (!hostPath || !targetPath) {
    return JSON.stringify({ status: 'error', message: 'hostPath and targetPath are required' });
  }

  var debugAttr = 'codex-inlining-test';

  function toArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      if (value.isKindOfClass && value.isKindOfClass($.NSNull)) return [];
    } catch (error) {}
    try {
      if (typeof ObjC !== 'undefined' && ObjC.unwrap) {
        var unwrapped = ObjC.unwrap(value);
        if (Array.isArray(unwrapped)) return unwrapped;
      }
    } catch (error) {}
    try {
      if (typeof value.length === 'number') {
        var items = [];
        for (var i = 0; i < value.length; i++) {
          items.push(value[i]);
        }
        return items;
      }
    } catch (error) {}
    return [];
  }

  function normalizePath(path) {
    return String(path || '').replace(/\\\\+/g, '/');
  }

  function docPath(doc) {
    if (!doc.fileURL) return null;
    if (doc.fileURL.path) return normalizePath(doc.fileURL.path);
    if (doc.fileURL.absoluteString) return normalizePath(doc.fileURL.absoluteString.replace(/^file:\\/\\//, ''));
    return null;
  }

  function findDocByPath(path) {
    var wanted = normalizePath(path);
    var docs = toArray(bike.documents);
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      if (docPath(doc) === wanted) {
        return doc;
      }
    }
    return null;
  }

  function getOutline(doc) {
    var window = doc.frontmostWindow;
    var editor = window ? window.currentOutlineEditor : null;
    return editor ? editor.outline : null;
  }

  function collectRowsWithAttribute(outline, name, value) {
    var root = outline.root;
    var rows = toArray(root.descendants);
    var matches = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.attributes && row.attributes[name] === value) {
        matches.push(row);
      }
    }
    return matches;
  }

  function tagRows(rows, name, value) {
    var items = toArray(rows);
    for (var i = 0; i < items.length; i++) {
      var row = items[i];
      if (row && typeof row.setAttribute === 'function') {
        row.setAttribute(name, value);
      }
    }
  }

  function removeRows(outline, rows) {
    if (!rows || rows.length === 0) return 0;
    outline.transaction({ animate: 'none' }, function() {
      outline.removeRows(rows);
    });
    return rows.length;
  }

  function clearOutline(outline) {
    var rows = toArray(outline.root.children);
    if (!rows || rows.length === 0) return 0;
    outline.transaction({ animate: 'none' }, function() {
      outline.removeRows(rows);
    });
    return rows.length;
  }

  function findInlineMarker(outline, targetName) {
    var root = outline.root;
    var rows = toArray(root.descendants);
    var wanted = String(targetName || '').trim().toLowerCase();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var text = row.text && row.text.string ? row.text.string.trim() : '';
      var match = text.match(/^<inline:\\s*(.+?)\\s*>$/i);
      if (!match) continue;
      if (String(match[1]).trim().toLowerCase() === wanted) {
        return row;
      }
    }
    return null;
  }

  var hostDoc = findDocByPath(hostPath);
  var targetDoc = findDocByPath(targetPath);

  if (!hostDoc || !targetDoc) {
    return JSON.stringify({
      status: 'error',
      message: 'Host or target document not found',
      hostFound: Boolean(hostDoc),
      targetFound: Boolean(targetDoc)
    });
  }

  var hostOutline = getOutline(hostDoc);
  var targetOutline = getOutline(targetDoc);

  if (!hostOutline || !targetOutline) {
    return JSON.stringify({
      status: 'error',
      message: 'Missing outline editor for host or target'
    });
  }

  var hostName = String(hostDoc.displayName || '');
  var targetName = String(targetDoc.displayName || '');

  if (mode === 'cleanup') {
    var removedHost = removeRows(hostOutline, collectRowsWithAttribute(hostOutline, debugAttr, 'true'));
    var removedTarget = removeRows(targetOutline, collectRowsWithAttribute(targetOutline, debugAttr, 'true'));
    return JSON.stringify({
      status: 'ok',
      mode: mode,
      hostName: hostName,
      targetName: targetName,
      removedHost: removedHost,
      removedTarget: removedTarget
    });
  }

  if (mode === 'setup') {
    clearOutline(hostOutline);
    clearOutline(targetOutline);

    targetOutline.transaction({ animate: 'none' }, function() {
      var attrs = {};
      attrs[debugAttr] = 'true';
      var inserted = targetOutline.insertRows([
        { text: 'Inline test A', attributes: attrs },
        { text: 'Inline test B', attributes: attrs }
      ], targetOutline.root);
      tagRows(inserted, debugAttr, 'true');
    });

    hostOutline.transaction({ animate: 'none' }, function() {
      var attrs = {};
      attrs[debugAttr] = 'true';
      var inserted = hostOutline.insertRows([
        { text: '<inline: ' + targetName + '>', attributes: attrs }
      ], hostOutline.root);
      tagRows(inserted, debugAttr, 'true');
    });

    return JSON.stringify({
      status: 'ok',
      mode: mode,
      hostName: hostName,
      targetName: targetName,
      message: 'Setup complete. Wait for sync and run verify.'
    });
  }

  if (mode === 'inline-edit') {
    var marker = findInlineMarker(hostOutline, targetName);
    if (!marker) {
      return JSON.stringify({
        status: 'error',
        message: 'Inline marker not found in host document'
      });
    }

    var inlineRows = toArray(marker.children);
    var inlineContent = [];
    for (var i = 0; i < inlineRows.length; i++) {
      var row = inlineRows[i];
      if (row && row.attributes && row.attributes[debugAttr] === 'true') {
        inlineContent.push(row);
      }
    }
    if (inlineContent.length === 0) {
      return JSON.stringify({
        status: 'error',
        message: 'No inline test rows found; run setup first'
      });
    }

    hostOutline.transaction({ animate: 'none' }, function() {
      var first = inlineContent[0];
      if (first.text && typeof first.text.replace === 'function') {
        first.text.replace([0, first.text.string.length], 'Inline test A (edited)');
      }
      if (typeof first.setAttribute === 'function') {
        first.setAttribute(debugAttr, 'true');
      }
      var attrs = {};
      attrs[debugAttr] = 'true';
      var inserted = hostOutline.insertRows([{ text: 'Inline test C', attributes: attrs }], marker);
      tagRows(inserted, debugAttr, 'true');
    });

    return JSON.stringify({
      status: 'ok',
      mode: mode,
      hostName: hostName,
      targetName: targetName,
      message: 'Inline edit complete. Wait for sync and run verify.'
    });
  }

  var marker = findInlineMarker(hostOutline, targetName);
  if (!marker) {
    return JSON.stringify({
      status: 'error',
      message: 'Inline marker not found in host document'
    });
  }

  var targetRows = collectRowsWithAttribute(targetOutline, debugAttr, 'true');
  if (targetRows.length === 0) {
    return JSON.stringify({
      status: 'error',
      message: 'No test rows found in target; run setup first'
    });
  }

  var inlineRows = toArray(marker.children);
  var inlineContent = [];
  for (var i = 0; i < inlineRows.length; i++) {
    var row = inlineRows[i];
    if (row && row.attributes && row.attributes[debugAttr] === 'true') {
      inlineContent.push(row);
    }
  }
  inlineRows = inlineContent;
  var mismatches = [];

  if (inlineRows.length !== targetRows.length) {
    mismatches.push({
      kind: 'count',
      expected: targetRows.length,
      actual: inlineRows.length
    });
  }

  var compareCount = Math.min(inlineRows.length, targetRows.length);
  for (var i = 0; i < compareCount; i++) {
    var inlineRow = inlineRows[i];
    var targetRow = targetRows[i];

    if (inlineRow.text.string !== targetRow.text.string) {
      mismatches.push({
        kind: 'text',
        index: i,
        expected: targetRow.text.string,
        actual: inlineRow.text.string
      });
    }

    if (inlineRow.type !== targetRow.type) {
      mismatches.push({
        kind: 'type',
        index: i,
        expected: targetRow.type,
        actual: inlineRow.type
      });
    }

    var targetAttrs = targetRow.attributes || {};
    for (var key in targetAttrs) {
      if (!targetAttrs.hasOwnProperty(key)) continue;
      if (key === 'data-inline-id') continue;
      if (inlineRow.attributes[key] !== targetAttrs[key]) {
        mismatches.push({
          kind: 'attribute',
          index: i,
          key: key,
          expected: targetAttrs[key],
          actual: inlineRow.attributes[key]
        });
      }
    }
  }

  return JSON.stringify({
    status: mismatches.length === 0 ? 'ok' : 'fail',
    mode: mode,
    hostName: hostName,
    targetName: targetName,
    mismatches: mismatches
  });
}
`
  })
}

function openPaths(state) {
  const openedHost = openFile(state.hostPath)
  const openedTarget = openFile(state.targetPath)
  delay(0.2)
}

function parseEvaluate(result) {
  if (typeof result !== 'string') return { status: 'error', message: 'Unexpected evaluate response' }
  try {
    return JSON.parse(result)
  } catch (error) {
    return { status: 'error', message: result }
  }
}

function main() {
  if (mode === 'setup') {
    ensureDir(baseDir)
    const paths = makeTempPaths()
    createEmptyFile(paths.hostPath)
    createEmptyFile(paths.targetPath)
    openPaths(paths)
    const result = parseEvaluate(runEvaluate({ mode: mode, hostPath: paths.hostPath, targetPath: paths.targetPath }))
    const state = { hostPath: paths.hostPath, targetPath: paths.targetPath, hostName: result.hostName, targetName: result.targetName }
    saveState(state)
    console.log(JSON.stringify({ status: 'ok', mode: mode, state: state, result: result }))
    return
  }

  const state = loadState()
  if (!state || !state.hostPath || !state.targetPath) {
    console.log(JSON.stringify({ status: 'error', message: 'Missing state. Run with INLINE_MODE=setup first.' }))
    return
  }

  openPaths(state)
  if (mode === 'verify-inline-to-doc') {
    const edit = parseEvaluate(runEvaluate({ mode: 'inline-edit', hostPath: state.hostPath, targetPath: state.targetPath }))
    if (edit.status === 'error') {
      console.log(JSON.stringify({ status: 'error', mode: mode, state: state, result: edit }))
      return
    }
    delay(1)
    const verify = parseEvaluate(runEvaluate({ mode: 'verify', hostPath: state.hostPath, targetPath: state.targetPath }))
    console.log(JSON.stringify({ status: verify.status || 'ok', mode: mode, state: state, edit: edit, result: verify }))
    return
  }

  const result = parseEvaluate(runEvaluate({ mode: mode, hostPath: state.hostPath, targetPath: state.targetPath }))

  if (mode === 'cleanup') {
    const removedHost = removeFile(state.hostPath)
    const removedTarget = removeFile(state.targetPath)
    const closedHost = closeDocumentsByName(state.hostName)
    const closedTarget = closeDocumentsByName(state.targetName)
    removeFile(statePath)
    console.log(JSON.stringify({
      status: 'ok',
      mode: mode,
      result: result,
      removedHostFile: removedHost,
      removedTargetFile: removedTarget,
      closedHostDocs: closedHost,
      closedTargetDocs: closedTarget,
      removedStateFile: true
    }))
    return
  }

  console.log(JSON.stringify({ status: result.status || 'ok', mode: mode, state: state, result: result }))
}

main()
