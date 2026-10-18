import { describe, expect, it } from 'vitest'

import { group } from '../model'
import { allFixedAbsorberIndex, subtreeGone } from './track-model'

describe('allFixedAbsorberIndex', () => {
  it('picks the last uncapped track', () => {
    // terminal (uncapped height) + logs (uncapped) → logs absorbs
    const growable = [0, 1]
    const max = (i: number) => (i === 0 ? '80vh' : undefined)

    expect(allFixedAbsorberIndex(growable, max)).toBe(1)
  })

  it('skips a capped last track and picks an earlier uncapped one', () => {
    // uncapped tool panel + capped files rail at the end of a column
    const growable = [0, 1]
    const max = (i: number) => (i === 1 ? '20rem' : undefined)

    expect(allFixedAbsorberIndex(growable, max)).toBe(0)
  })

  it('refuses to absorb when every fixed track is capped (review/files rail)', () => {
    // Default right rail: review | preview | files — all declare maxWidth.
    // Promoting any of them to grow-1 dropped the clamp and ballooned ⌘G/⌘J.
    const growable = [0, 1, 2]
    const max = () => '20rem'

    expect(allFixedAbsorberIndex(growable, max)).toBe(-1)
  })

  it('refuses a lone capped sidebar', () => {
    // ⌘G alone: only review is visible in the rail — must stay at 237px / max 20rem.
    expect(allFixedAbsorberIndex([0], () => '20rem')).toBe(-1)
  })
})

describe('subtreeGone main floor', () => {
  const main = { id: 'x', area: 'panes', data: { placement: 'main' } } as never
  const ctx = (gone: string[]) => ({ paneFor: () => main, paneGone: (id: string) => gone.includes(id), overrides: {} })

  it('keeps a zone whose hidden panes include the real main surface', () => {
    expect(subtreeGone(group(['session-tile:a']), ctx(['session-tile:a']))).toBe(false)
  })

  it('collapses a zone holding only hidden browser tiles (folded browser panel)', () => {
    const ids = ['preview-tile:url:browser-1', 'preview-tile:url:browser-2']

    expect(subtreeGone(group(ids), ctx(ids))).toBe(true)
  })

  it('keeps a browser zone while any tile in it is still shown', () => {
    const ids = ['preview-tile:url:browser-1', 'preview-tile:url:browser-2']

    expect(subtreeGone(group(ids), ctx([ids[0]]))).toBe(false)
  })
})
