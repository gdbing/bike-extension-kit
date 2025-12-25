import { defineEditorStyle, Color } from 'bike/style'

let style = defineEditorStyle('code-background', 'Code Background')

// Include all layers from the default 'bike' style
style.layer('base', (row, run, caret, viewport, include) => {
  include('bike', 'base')
})

style.layer('row-formatting', (row, run, caret, viewport, include) => {
  include('bike', 'row-formatting')

  // Add background decoration to codeblock rows
  row('.codeblock', (context, row) => {
    row.text.decoration('codeblock-background', (background, layout) => {
      background.anchor.x = 0
      background.anchor.y = 0
      background.x = layout.leading
      background.y = layout.top
      background.width = layout.width
      background.height = layout.height
      background.color = Color.systemGray().withAlpha(0.2)
      background.zPosition = -1
      background.corners.radius = 3
      background.mergable = true
    })
  })
})

style.layer('run-formatting', (row, run, caret, viewport, include) => {
  include('bike', 'run-formatting')

  // Add code background decoration after the default monospace styling
  run('.@code', (context, text) => {
    text.decoration('code-background', (background, layout) => {
      background.anchor.x = 0
      background.anchor.y = 0
      background.x = layout.leading
      background.y = layout.top
      background.width = layout.width
      background.height = layout.height
      background.color = Color.systemGray().withAlpha(0.2)
      background.zPosition = -1
      background.corners.radius = 3
      background.mergable = true
    })
  })
})

style.layer('controls', (row, run, caret, viewport, include) => {
  include('bike', 'controls')
})

style.layer('selection', (row, run, caret, viewport, include) => {
  include('bike', 'selection')
})

style.layer('highlights', (row, run, caret, viewport, include) => {
  include('bike', 'highlights')
})

style.layer('outline-focus', (row, run, caret, viewport, include) => {
  include('bike', 'outline-focus')
})

style.layer('drag-and-drop', (row, run, caret, viewport, include) => {
  include('bike', 'drag-and-drop')
})

style.layer('text-focus', (row, run, caret, viewport, include) => {
  include('bike', 'text-focus')
})

style.layer('filter-match', (row, run, caret, viewport, include) => {
  include('bike', 'filter-match')
})
