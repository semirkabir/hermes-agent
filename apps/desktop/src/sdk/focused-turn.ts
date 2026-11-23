// `host.state` turn readouts for the FOCUSED chat: busy, awaiting the first
// payload, and what the turn is doing (phase + running tool).

import { computed, type ReadableAtom } from 'nanostores'

import { PRIMARY_SESSION_VIEW } from '@/app/chat/session-view'
import type { ClientSessionState } from '@/app/types'
import { $selectedStoredSessionId } from '@/store/session'
import { $focusedStoredSessionId } from '@/store/session-focus'
import { $focusedSessionState } from '@/store/session-states'

/**
 * Turn flag for the FOCUSED chat — same semantics as the statusbar's busy
 * pulse. While the focused surface is the primary workspace (or a draft with
 * no runtime slice yet) this reads the primary view, which itself falls back
 * to the global draft atoms. Once a session TILE holds focus, the tile's own
 * state slice is authoritative — a background session can never leak in.
 */
const focusedTurnFlag = (
  select: (state: ClientSessionState) => boolean,
  $primary: ReadableAtom<boolean>
): ReadableAtom<boolean> =>
  computed(
    [$focusedStoredSessionId, $selectedStoredSessionId, $focusedSessionState, $primary],
    (focused, selected, state, primary) =>
      !focused || focused === selected ? primary : Boolean(state && select(state))
  )

export const $focusedBusy = focusedTurnFlag(state => state.busy, PRIMARY_SESSION_VIEW.$busy)

export const $focusedAwaitingResponse = focusedTurnFlag(
  state => state.awaitingResponse,
  PRIMARY_SESSION_VIEW.$awaitingResponse
)

/** What the focused chat's turn is doing right now, for avatars and other
 *  ambient readouts. `tool` is the newest tool call still waiting on its
 *  result; `phase` is the coarse step (`thinking` before the first token or
 *  while reasoning, `streaming` while reply text arrives, `tool` while a call
 *  runs, `waiting` while a clarify prompt needs the user). `failed` is the
 *  last settled reply's error state, so a readout can mark how a turn ended. */
export interface PluginFocusedActivity {
  busy: boolean
  failed: boolean
  phase: 'idle' | 'streaming' | 'thinking' | 'tool' | 'waiting'
  tool: null | string
}

const IDLE_ACTIVITY: PluginFocusedActivity = { busy: false, failed: false, phase: 'idle', tool: null }

export const $focusedActivity = computed(
  [
    $focusedStoredSessionId,
    $selectedStoredSessionId,
    $focusedSessionState,
    PRIMARY_SESSION_VIEW.$messages,
    $focusedBusy,
    $focusedAwaitingResponse
  ],
  (focused, selected, state, primaryMessages, busy, awaiting): PluginFocusedActivity => {
    const messages = !focused || focused === selected ? primaryMessages : (state?.messages ?? [])
    const last = [...messages].reverse().find(message => message.role === 'assistant')
    const failed = Boolean(last?.error)

    if (state?.needsInput) {
      return { busy: true, failed: false, phase: 'waiting', tool: null }
    }

    if (!busy) {
      return failed ? { ...IDLE_ACTIVITY, failed } : IDLE_ACTIVITY
    }

    if (awaiting || !last) {
      return { busy, failed: false, phase: 'thinking', tool: null }
    }

    const tail = last.parts[last.parts.length - 1] as { result?: unknown; toolName?: string; type?: string } | undefined

    if (tail?.type === 'tool-call' && tail.result === undefined) {
      return { busy, failed: false, phase: 'tool', tool: String(tail.toolName || '') || null }
    }

    return { busy, failed: false, phase: tail?.type === 'text' ? 'streaming' : 'thinking', tool: null }
  }
)
