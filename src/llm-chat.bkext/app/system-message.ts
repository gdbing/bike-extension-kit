import type { Message } from './providers/types'

export function applyDefaultSystemMessage(
  messages: Message[],
  defaultSystemMessage?: string
): Message[] {
  if (!defaultSystemMessage || defaultSystemMessage.trim().length === 0) {
    return messages
  }

  const hasSystemMessage = messages.some(message => message.role === 'system')
  if (hasSystemMessage) return messages

  return [{ role: 'system', content: defaultSystemMessage }, ...messages]
}
