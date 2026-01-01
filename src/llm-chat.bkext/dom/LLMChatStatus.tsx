import { DOMExtensionContext } from 'bike/dom'
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState } from 'react'

type StatusState =
  | { state: 'idle' }
  | {
      state: 'active'
      cacheReadTokens: number
      cacheWriteTokens: number
      ttlSeconds: number
      startedAt: number
    }

export async function activate(context: DOMExtensionContext) {
  const root = createRoot(context.element)
  root.render(<LLMChatStatus context={context} />)
}

type LLMChatStatusProps = {
  context: DOMExtensionContext
}

const LLMChatStatus: React.FC<LLMChatStatusProps> = ({ context }) => {
  const [status, setStatus] = useState<StatusState>({ state: 'idle' })
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)

  useEffect(() => {
    context.onmessage = (message: StatusState) => {
      setStatus(message ?? { state: 'idle' })
    }
  }, [context])

  useEffect(() => {
    const root = context.element
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.style.setProperty('--llm-cache-bg', 'rgb(30, 30, 30)')
        root.style.setProperty('--llm-cache-panel', 'rgb(46, 46, 46)')
        root.style.setProperty('--llm-cache-border', 'rgb(72, 72, 72)')
        root.style.setProperty('--llm-cache-text', 'rgb(235, 235, 235)')
        root.style.setProperty('--llm-cache-muted', 'rgb(165, 165, 165)')
        root.style.setProperty('--llm-cache-title', 'rgb(245, 245, 245)')
      } else {
        root.style.setProperty('--llm-cache-bg', 'rgb(255, 255, 255)')
        root.style.setProperty('--llm-cache-panel', 'rgb(248, 250, 252)')
        root.style.setProperty('--llm-cache-border', 'rgb(226, 232, 240)')
        root.style.setProperty('--llm-cache-text', 'rgb(31, 41, 55)')
        root.style.setProperty('--llm-cache-muted', 'rgb(100, 116, 139)')
        root.style.setProperty('--llm-cache-title', 'rgb(15, 23, 42)')
      }
      root.style.setProperty('color-scheme', isDark ? 'dark' : 'light')
    }

    applyTheme(media.matches)
    const listener = (event: MediaQueryListEvent) => applyTheme(event.matches)
    if (media.addEventListener) {
      media.addEventListener('change', listener)
    } else {
      media.addListener(listener)
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', listener)
      } else {
        media.removeListener(listener)
      }
    }
  }, [context.element])

  useEffect(() => {
    if (status.state !== 'active') {
      setRemainingSeconds(null)
      return
    }

    const updateRemaining = () => {
      const elapsed = (Date.now() - status.startedAt) / 1000
      const remaining = Math.max(status.ttlSeconds - elapsed, 0)
      setRemainingSeconds(remaining)
    }

    updateRemaining()
    const timer = setInterval(updateRemaining, 1000)
    return () => clearInterval(timer)
  }, [status])

  const formattedRemaining = useMemo(() => {
    if (remainingSeconds === null) return '--:--'
    const totalSeconds = Math.ceil(remainingSeconds)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }, [remainingSeconds])

  const cacheRead = status.state === 'active' ? status.cacheReadTokens : 0
  const cacheWrite = status.state === 'active' ? status.cacheWriteTokens : 0
  const hasCacheActivity = status.state === 'active' && (cacheRead > 0 || cacheWrite > 0)

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>LLM Cache</div>
      {!hasCacheActivity ? (
        <div style={mutedStyle}>No cache activity yet.</div>
      ) : (
        <div style={metricsStyle}>
          <div style={metricRowStyle}>
            <span style={labelStyle}>Cache read</span>
            <span style={valueStyle}>{formatNumber(cacheRead)}</span>
          </div>
          <div style={metricRowStyle}>
            <span style={labelStyle}>Cache write</span>
            <span style={valueStyle}>{formatNumber(cacheWrite)}</span>
          </div>
          <div style={metricRowStyle}>
            <span style={labelStyle}>Expires in</span>
            <span style={valueStyle}>{formattedRemaining}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Math.max(0, Math.round(value)).toLocaleString('en-US')
}

const containerStyle: React.CSSProperties = {
  fontFamily: '"Avenir Next", "Avenir", "Gill Sans", "Trebuchet MS", sans-serif',
  padding: '10px 12px',
  color: 'var(--llm-cache-text)',
  backgroundColor: 'var(--llm-cache-bg)'
}

const titleStyle: React.CSSProperties = {
  fontSize: '12px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontWeight: 700,
  color: 'var(--llm-cache-title)',
  marginBottom: '8px'
}

const mutedStyle: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--llm-cache-muted)'
}

const metricsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '12px'
}

const metricRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '6px 8px',
  borderRadius: '6px',
  backgroundColor: 'var(--llm-cache-panel)',
  border: '1px solid var(--llm-cache-border)'
}

const labelStyle: React.CSSProperties = {
  color: 'var(--llm-cache-muted)'
}

const valueStyle: React.CSSProperties = {
  fontWeight: 600,
  color: 'var(--llm-cache-title)'
}
