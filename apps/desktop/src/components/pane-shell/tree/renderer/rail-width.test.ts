import { describe, expect, it } from 'vitest'

import type { Contribution } from '@/contrib/types'

import type { GroupNode } from '../model'

import { fixedTrackSize, MINIMIZED_TRACK, minimizedTrackFor, type TrackContext } from './track-model'

const pane = (id: string, data: Record<string, unknown> = {}) =>
  ({ area: 'panes', data, id }) as unknown as Contribution

const group = (panes: string[], minimized = true) =>
  ({ active: panes[0], id: 'g', minimized, panes, type: 'group' }) as unknown as GroupNode

const ctxFor = (contribs: Contribution[]): TrackContext => ({
  overrides: {},
  paneFor: (id: string) => contribs.find(c => c.id === id),
  paneGone: () => false
})

describe('collapsed rail width', () => {
  it('keeps the 28px strip when no pane renders rail content', () => {
    const ctx = ctxFor([pane('sessions', { railIcon: 'list-unordered' })])

    expect(minimizedTrackFor(group(['sessions']), ctx.paneFor)).toBe(MINIMIZED_TRACK)
    expect(fixedTrackSize(group(['sessions']), 'row', ctx)).toBe(MINIMIZED_TRACK)
  })

  it('widens to the rail width a pane with rail content declares', () => {
    const ctx = ctxFor([pane('sessions'), pane('bots', { railContent: () => null, railWidth: '2.75rem' })])

    expect(minimizedTrackFor(group(['sessions', 'bots']), ctx.paneFor)).toBe('2.75rem')
    expect(fixedTrackSize(group(['sessions', 'bots']), 'row', ctx)).toBe('2.75rem')
  })

  it('ignores a rail width without rail content', () => {
    const ctx = ctxFor([pane('bots', { railWidth: '2.75rem' })])

    expect(minimizedTrackFor(group(['bots']), ctx.paneFor)).toBe(MINIMIZED_TRACK)
  })
})
