import { DOMScriptHandle, Window } from 'bike/app'

type CacheStatusMessage =
  | { state: 'idle' }
  | {
      state: 'active'
      cacheReadTokens: number
      cacheWriteTokens: number
      ttlSeconds: number
      startedAt: number
    }

const STATUS_ITEM_ID = 'llm-chat:status'
const STATUS_SCRIPT = 'LLMChatStatus.js'
const handles = new Map<Window, DOMScriptHandle>()

export async function registerStatusInspector(window: Window): Promise<void> {
  const handle = await window.inspector.addItem({
    id: STATUS_ITEM_ID,
    script: STATUS_SCRIPT
  })
  handles.set(window, handle)
}

function getHandle(window?: Window): DOMScriptHandle | undefined {
  if (!window) return undefined
  return handles.get(window)
}

export function resetStatus(window?: Window): void {
  const handle = getHandle(window)
  handle?.postMessage({ state: 'idle' } satisfies CacheStatusMessage)
}

export function updateCacheStatus(
  window: Window | undefined,
  data: Omit<CacheStatusMessage, 'state'>
): void {
  const handle = getHandle(window)
  if (!handle) return
  handle.postMessage({ state: 'active', ...data } satisfies CacheStatusMessage)
}
