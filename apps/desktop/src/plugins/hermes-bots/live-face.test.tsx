/**
 * The animated face: shape faces are redrawn by the motion engine (with live
 * eyes), pictures are moved whole, and a static face stays in the DOM so the
 * roster's PNG backfill (`svg[data-bot-face]`) keeps working.
 */

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return {
    atom,
    blobatarSvg: () =>
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="#ffc0aa"><path d="M0 0Z"/></g><g fill="#170c09"><path d="M0 0Z"/></g></svg>',
    createBudgetedLoop: undefined,
    host: { state: { connectionId: { get: () => 'local' } } },
    profileColor: () => '#8b5cf6',
    PROFILE_SWATCHES: ['#8b5cf6'],
    queryClient: undefined,
    useQuery: vi.fn(),
    useValue: vi.fn()
  }
})

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'hermes-bots' }))

const { liveFacePlan, LiveBotFace, nameSeed } = await import('./live-face')
const { createPlayer, STATE_NAMES } = await import('./motion-engine')

describe('liveFacePlan', () => {
  it('draws math shapes and blobatars, moves photos and sigils', () => {
    expect(liveFacePlan('squircle', null, 'a')).toEqual({ kind: 'drawn', shape: 'squircle' })
    expect(liveFacePlan('pill', null, 'a')).toEqual({ kind: 'drawn', shape: 'capsule' })
    expect(liveFacePlan('blobatar::droplet', null, 'a')).toEqual({ kind: 'drawn', shape: 'drop' })
    expect(liveFacePlan('squircle', 'data:image/png;base64,x', 'a')).toEqual({ kind: 'moved' })
    expect(liveFacePlan('sigil-3', null, 'a')).toEqual({ kind: 'moved' })
  })

  it('gives an unpinned blobatar the same silhouette for the same name', () => {
    expect(liveFacePlan('blobatar', null, 'joab')).toEqual(liveFacePlan('blobatar', null, 'joab'))
    expect(nameSeed('joab')).toBe(nameSeed('joab'))
  })
})

describe('LiveBotFace', () => {
  it('draws the engine face and keeps a hidden static face for the backfill', () => {
    const { container } = render(<LiveBotFace color="#9159FE" name="aris" shape="hexagon" size={34} state="thinking" />)

    const live = container.querySelector('svg[data-hb-live="hexagon"]')
    expect(live).not.toBeNull()
    expect(live?.querySelector('path')?.getAttribute('d')).toMatch(/^M/)
    expect(container.querySelector('svg[data-bot-face="aris"]')).not.toBeNull()
    expect(container.querySelector('[data-hb-state="thinking"]')).not.toBeNull()
  })

  it('draws a blobatar in the library palette', () => {
    const { container } = render(<LiveBotFace color="#000000" name="joab" shape="blobatar" size={34} state="idle" />)

    expect(container.querySelector('svg[data-hb-live] > path')?.getAttribute('fill')).toBe('#ffc0aa')
  })

  it('moves a photo whole instead of redrawing it', () => {
    const { container } = render(
      <LiveBotFace
        color="#9159FE"
        image="data:image/png;base64,x"
        name="joab"
        shape="squircle"
        size={34}
        state="working"
      />
    )

    expect(container.querySelector('img')).not.toBeNull()
    expect(container.querySelector('svg[data-hb-live="moved"]')).not.toBeNull()
  })
})

describe('motion engine', () => {
  it('stays finite for every state and settles end beats back to idle', () => {
    for (const state of STATE_NAMES) {
      const player = createPlayer(7, state)

      for (let i = 0; i < 30 * 20; i++) {
        const frame = player.step(1 / 30)
        const values = [...Object.values(frame.pose), frame.lid, frame.effectAmount]
        expect(values.every(Number.isFinite)).toBe(true)
      }
    }

    const done = createPlayer(1, 'finished')

    for (let i = 0; i < 30 * 6; i++) {
      done.step(1 / 30)
    }

    expect(done.state).toBe('idle')
  })
})
