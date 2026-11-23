/**
 * Avatar motion selection: the roster mood plus the focused turn's activity
 * pick a state, tool names map to the motion for that kind of work, and a
 * finished turn plays its end beat instead of snapping back to idle.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return { atom, host: { state: {} }, useValue: vi.fn() }
})

const { avatarStateFor, settleAvatarState, toolAvatarState } = await import('./motion-state')

const busy = (phase: 'streaming' | 'thinking' | 'tool' | 'waiting', tool: null | string = null) => ({
  busy: true,
  failed: false,
  phase,
  tool
})

describe('toolAvatarState', () => {
  it.each([
    ['web_search', 'searching'],
    ['mcp__search__web_search', 'searching'],
    ['mnemosyne_recall', 'searching'],
    ['read_file', 'reading'],
    ['web_extract', 'reading'],
    ['terminal', 'running'],
    ['execute_code', 'running'],
    ['browser_exec', 'computing'],
    ['mcp__cua__computer_click', 'computing'],
    ['patch', 'coding'],
    ['write_file', 'coding'],
    ['delegate_task', 'spawning'],
    ['message_agent', 'sending'],
    ['image_generate', 'generating'],
    ['clarify', 'waiting'],
    ['todo_list', 'writing'],
    ['something_new', 'working'],
    [null, 'working']
  ])('%s -> %s', (tool, state) => {
    expect(toolAvatarState(tool)).toBe(state)
  })
})

describe('avatarStateFor', () => {
  it('idles a quiet bot and works a bot with a live background worker', () => {
    expect(avatarStateFor('idle', busy('tool', 'terminal'))).toBe('idle')
    expect(avatarStateFor('work', null)).toBe('working')
  })

  it('follows the focused turn for the bot that owns it', () => {
    expect(avatarStateFor('think', busy('thinking'))).toBe('thinking')
    expect(avatarStateFor('think', busy('streaming'))).toBe('streaming')
    expect(avatarStateFor('think', busy('tool', 'web_search'))).toBe('searching')
    expect(avatarStateFor('think', busy('waiting'))).toBe('waiting')
  })

  it('thinks when the owner is busy but no activity is known (group rooms, older hosts)', () => {
    expect(avatarStateFor('think', null)).toBe('thinking')
  })
})

describe('settleAvatarState', () => {
  it('plays finished after a turn and failed after an error', () => {
    expect(settleAvatarState('streaming', 'idle', false)).toBe('finished')
    expect(settleAvatarState('running', 'idle', true)).toBe('failed')
  })

  it('leaves idle-to-idle and busy-to-busy alone', () => {
    expect(settleAvatarState('idle', 'idle', true)).toBe('idle')
    expect(settleAvatarState('thinking', 'searching', false)).toBe('searching')
  })
})
