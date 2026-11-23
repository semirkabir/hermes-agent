import { afterEach, describe, expect, it } from 'vitest'

import { $awaitingResponse, $busy, $messages, $selectedStoredSessionId } from '@/store/session'

import { host } from './index'

const assistant = (parts: unknown[], error?: string) => ({ error, id: 'a1', parts, role: 'assistant' }) as never

describe('host.state.focusedActivity on the primary chat', () => {
  afterEach(() => {
    $busy.set(false)
    $awaitingResponse.set(false)
    $messages.set([])
    $selectedStoredSessionId.set(null)
  })

  it('walks thinking, tool, streaming and back to idle through one turn', () => {
    const activity = host.state.focusedActivity

    expect(activity.get()).toEqual({ busy: false, failed: false, phase: 'idle', tool: null })

    $busy.set(true)
    $awaitingResponse.set(true)
    expect(activity.get().phase).toBe('thinking')

    $awaitingResponse.set(false)
    $messages.set([assistant([{ toolName: 'terminal', type: 'tool-call' }])])
    expect(activity.get()).toEqual({ busy: true, failed: false, phase: 'tool', tool: 'terminal' })

    $messages.set([
      assistant([
        { result: 'ok', toolName: 'terminal', type: 'tool-call' },
        { text: 'done', type: 'text' }
      ])
    ])
    expect(activity.get()).toEqual({ busy: true, failed: false, phase: 'streaming', tool: null })

    $busy.set(false)
    expect(activity.get()).toEqual({ busy: false, failed: false, phase: 'idle', tool: null })
  })

  it('marks a turn that ended in an error as failed once it settles', () => {
    $messages.set([assistant([{ text: 'partial', type: 'text' }], 'boom')])

    expect(host.state.focusedActivity.get()).toEqual({ busy: false, failed: true, phase: 'idle', tool: null })
  })
})
