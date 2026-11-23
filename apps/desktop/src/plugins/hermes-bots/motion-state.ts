/**
 * Which motion a bot's avatar plays: the roster's coarse mood (idle / think /
 * work) refined by what the focused chat's turn is doing right now (thinking,
 * streaming, which tool is running, waiting on the user), plus the beat when a
 * turn ends (a happy hop on success, a droop on failure).
 */

import { atom, host, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import type { AvatarState } from './motion-engine'
import type { FaceMood } from './types'

export interface FocusedActivity {
  busy: boolean
  failed: boolean
  phase: 'idle' | 'streaming' | 'thinking' | 'tool' | 'waiting'
  tool: null | string
}

const IDLE_ACTIVITY: FocusedActivity = { busy: false, failed: false, phase: 'idle', tool: null }
const $noActivity = atom<FocusedActivity>(IDLE_ACTIVITY)

/** Tool name → motion, first match wins. MCP tools keep their server prefix
 *  (`mcp__cua__computer_click`), so patterns match anywhere in the name. */
const TOOL_STATES: [RegExp, AvatarState][] = [
  [/clarify|approval/, 'waiting'],
  [/delegate|spawn|create_agent|kanban_create/, 'spawning'],
  [/message_agent|send|reply|post|publish|draft_card/, 'sending'],
  [/image_generate|video_generate|xai_video|generate/, 'generating'],
  [/browser|computer|cua__|drive_preview|desktop_preview/, 'computing'],
  [/terminal|execute_code|process_manage|shell/, 'running'],
  [/patch|write_file|skill_manage|edit/, 'coding'],
  [/search|recall|query|x_search|session_search/, 'searching'],
  [/read_file|skill_view|extract|fetch|scrape|transcript|attachment|get_/, 'reading'],
  [/todo|memory|remember|journal|note|plan/, 'writing']
]

export function toolAvatarState(tool: null | string | undefined): AvatarState {
  const name = (tool || '').toLowerCase()

  for (const [re, state] of TOOL_STATES) {
    if (re.test(name)) {
      return state
    }
  }

  return 'working'
}

/** Steady-state motion for one bot, ignoring end-of-turn beats. */
export function avatarStateFor(mood: FaceMood, activity: FocusedActivity | null): AvatarState {
  if (mood === 'work') {
    return 'working'
  }

  if (mood !== 'think') {
    return 'idle'
  }

  // `think` = this bot owns the focused busy turn (or is in a live group room).
  switch (activity?.busy ? activity.phase : 'thinking') {
    case 'streaming':
      return 'streaming'

    case 'tool':
      return toolAvatarState(activity?.tool)

    case 'waiting':
      return 'waiting'

    default:
      return 'thinking'
  }
}

const BUSY: ReadonlySet<AvatarState> = new Set<AvatarState>([
  'thinking',
  'streaming',
  'searching',
  'reading',
  'working',
  'coding',
  'running',
  'computing',
  'waiting',
  'writing',
  'sending',
  'spawning',
  'generating'
])

/** The end-of-turn beat: busy → idle plays `finished` (or `failed`); the
 *  engine then settles back to idle on its own. */
export function settleAvatarState(prev: AvatarState, next: AvatarState, failed: boolean): AvatarState {
  if (next === 'idle' && BUSY.has(prev)) {
    return failed ? 'failed' : 'finished'
  }

  return next
}

/** The focused turn's activity, or a quiet stand-in on hosts that predate it. */
export function useFocusedActivity(): FocusedActivity {
  return useValue(host.state.focusedActivity ?? $noActivity)
}

/** Avatar state for one roster bot, with the end-of-turn beat folded in.
 *  Derived during render (React's "previous value in state" pattern) so the
 *  beat lands on the same frame the turn ends. */
export function useAvatarState(mood: FaceMood): AvatarState {
  const activity = useFocusedActivity()
  const steady = avatarStateFor(mood, mood === 'think' ? activity : null)
  const [prev, setPrev] = useState<AvatarState>(steady)
  const [shown, setShown] = useState<AvatarState>(steady)

  if (prev !== steady) {
    setPrev(steady)
    setShown(settleAvatarState(prev, steady, activity.failed))
  }

  return shown
}
