import { atom } from 'nanostores'

import { persistBoolean, persistString, storedBoolean, storedString } from '@/lib/storage'

/**
 * How a run of tool calls is drawn in the transcript.
 *
 * `compact` (the default) is the single summary line with a ticker. `cards`
 * draws each run as one card: a live header, per-row status and the run's
 * pending approval inline.
 */
export type ToolCallStyle = 'cards' | 'compact'

export const TOOL_CALL_STYLE_STORAGE_KEY = 'chat.toolCallStyle'

export function parseToolCallStyle(value: unknown): ToolCallStyle {
  return value === 'cards' ? 'cards' : 'compact'
}

function loadToolCallStyle(): ToolCallStyle {
  if (typeof window === 'undefined') {
    return 'compact'
  }

  return parseToolCallStyle(storedString(TOOL_CALL_STYLE_STORAGE_KEY))
}

export const $toolCallStyle = atom<ToolCallStyle>(loadToolCallStyle())

$toolCallStyle.listen(style => persistString(TOOL_CALL_STYLE_STORAGE_KEY, style))

export function setToolCallStyle(style: ToolCallStyle) {
  $toolCallStyle.set(parseToolCallStyle(style))
}

/**
 * Cards style only: open each card while its run is live (the old behavior).
 * Off by default, so a card stays one bar whose header ticks through what is
 * running; the user opens it when they want the rows.
 */
export const TOOL_CARDS_EXPAND_LIVE_STORAGE_KEY = 'chat.toolCardsExpandLive'

export const $toolCardsExpandLive = atom<boolean>(
  typeof window === 'undefined' ? false : storedBoolean(TOOL_CARDS_EXPAND_LIVE_STORAGE_KEY, false)
)

$toolCardsExpandLive.listen(value => persistBoolean(TOOL_CARDS_EXPAND_LIVE_STORAGE_KEY, value))

export function setToolCardsExpandLive(value: boolean) {
  $toolCardsExpandLive.set(Boolean(value))
}
