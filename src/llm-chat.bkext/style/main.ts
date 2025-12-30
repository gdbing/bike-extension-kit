import { defineEditorStyle, Color } from 'bike/style'
import configJson from '../config.json'

const MARKER_ATTRIBUTE = 'llm-marker'

type MarkerColors = {
  user?: string
  system?: string
  assistant?: string
  error?: string
  default?: string
}

const DEFAULT_COLORS: Required<MarkerColors> = {
  user: '#2F6FDB',
  system: '#B25E00',
  assistant: '#18794E',
  error: '#C41C1C',
  default: '#6B7280'
}

const markerColors: MarkerColors =
  (configJson as { ui?: { markerColors?: MarkerColors } }).ui?.markerColors ?? {}

function colorFromHex(value?: string): Color | null {
  if (!value) return null
  const hex = value.trim().replace(/^#/, '')
  if (!(hex.length === 6 || hex.length === 8)) return null

  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  const alpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255

  if ([red, green, blue, alpha].some(Number.isNaN)) return null
  return new Color(red / 255, green / 255, blue / 255, alpha / 255)
}

function resolveColor(name: keyof MarkerColors): Color | null {
  return (
    colorFromHex(markerColors[name]) ??
    colorFromHex(DEFAULT_COLORS[name])
  )
}

const style = defineEditorStyle('llm-chat', 'LLM Chat')

style.layer('base', (row, run, caret, viewport, include) => {
  include('bike', 'base')
})

style.layer('row-formatting', (row, run, caret, viewport, include) => {
  include('bike', 'row-formatting')

  row('.codeblock', (context, rowStyle) => {
    rowStyle.text.decoration('codeblock-background', (background, layout) => {
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

  row('.note', (context, rowStyle) => {
    rowStyle.text.color = rowStyle.text.color.withAlpha(0.5)
  })

  const defaultColor = resolveColor('default')
  if (defaultColor) {
    row(`.@${MARKER_ATTRIBUTE}`, (context, rowStyle) => {
      rowStyle.text.color = defaultColor
    })
  }

  const userColor = resolveColor('user')
  if (userColor) {
    row(`.@${MARKER_ATTRIBUTE} = user`, (context, rowStyle) => {
      rowStyle.text.color = userColor
    })
  }

  const systemColor = resolveColor('system')
  if (systemColor) {
    row(`.@${MARKER_ATTRIBUTE} = system`, (context, rowStyle) => {
      rowStyle.text.color = systemColor
    })
  }

  const assistantColor = resolveColor('assistant')
  if (assistantColor) {
    row(`.@${MARKER_ATTRIBUTE} = assistant`, (context, rowStyle) => {
      rowStyle.text.color = assistantColor
    })
  }

  const errorColor = resolveColor('error')
  if (errorColor) {
    row(`.@${MARKER_ATTRIBUTE} = error`, (context, rowStyle) => {
      rowStyle.text.color = errorColor
    })
  }
})

style.layer('run-formatting', (row, run, caret, viewport, include) => {
  include('bike', 'run-formatting')

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
