/**
 * Dither avatars: `dither` / `dither:<seed>` shape strings, the markup they
 * render to, and the fallback look for a bot with nothing saved.
 *
 * The seed is the PROFILE NAME on purpose: the iPhone app has no copy of a
 * bot's saved look and draws the same avatar from the same name, so the two
 * clients agree without syncing anything. The golden below is the library's
 * own output for 'comms-triage'; if it ever changes, the phone port's golden
 * test (HermesTests/DitherAvatarTests.swift) must change with it.
 */

import { render } from '@testing-library/react'
import { generateColors } from 'dither-avatar'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return {
    atom,
    blobatarSvg: undefined,
    createBudgetedLoop: undefined,
    host: { state: { connectionId: { get: () => 'local' } } },
    profileColor: () => '#8b5cf6',
    PROFILE_SWATCHES: [],
    queryClient: undefined,
    useQuery: vi.fn(),
    useValue: vi.fn()
  }
})

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'hermes-bots' }))

describe('dither shape strings', () => {
  it('recognises the bare and seeded forms only', async () => {
    const { isDitherShape } = await import('./avatar')

    expect(isDitherShape('dither')).toBe(true)
    expect(isDitherShape('dither:abc')).toBe(true)
    expect(isDitherShape('ditherx')).toBe(false)
    expect(isDitherShape('blobatar')).toBe(false)
    expect(isDitherShape(null)).toBe(false)
  })

  it('is offered first in the shape picker', async () => {
    const { AVATAR_PICKER_SHAPES } = await import('./avatar')

    expect(AVATAR_PICKER_SHAPES[0]).toBe('dither')
  })
})

describe('rendering a dither face', () => {
  it('draws the library avatar for the profile name, sized and tagged for the PNG backfill', async () => {
    const { BotFace } = await import('./avatar')
    const { container } = render(<BotFace color="#38bdf8" name="comms-triage" shape="dither" size={40} />)
    const svg = container.querySelector('svg[data-bot-face="comms-triage"]')

    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('width')).toBe('40')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 200 200')
    // The library's hue pair for this name (also the phone's golden).
    expect(generateColors('comms-triage')).toEqual({ fill: '#0b748e', stroke: '#55d6f6' })
    expect(svg?.querySelector('rect')?.getAttribute('fill')).toBe('#0b748e')
    expect(svg?.querySelector('path')?.getAttribute('stroke')).toBe('#55d6f6')
  })

  it('uses a locked seed instead of the name', async () => {
    const { ditherMarkup } = await import('./avatar')

    expect(ditherMarkup('dither:other', 'comms-triage', 32)).toContain(`fill="${generateColors('other').fill}"`)
    expect(ditherMarkup('dither:', 'comms-triage', 32)).toContain(`fill="${generateColors('comms-triage').fill}"`)
  })

  it('is static: the math face clock never claims it', async () => {
    const { BotFace } = await import('./avatar')
    const { container } = render(<BotFace color="#38bdf8" name="agent" shape="dither" size={32} />)

    expect(container.querySelector('[data-hb-math]')).toBeNull()
  })
})

describe('the look of a bot with nothing saved', () => {
  it('is the dither avatar, while explicit picks and photos win', async () => {
    const { botAppearance } = await import('./avatar')

    expect(botAppearance('comms-triage', null).shape).toBe('dither')
    expect(botAppearance('comms-triage', {}).shape).toBe('dither')
    expect(botAppearance('sif-vp', { shape: 'squircle', custom: true }).shape).toBe('squircle')
    expect(botAppearance('sif-vp', { image: 'data:image/png;base64,AA', custom: true }).image).toBe(
      'data:image/png;base64,AA'
    )
  })

  it('leaves the primary profile on its fixed look', async () => {
    const { botAppearance } = await import('./avatar')

    expect(botAppearance('default', null).shape).toBe('squircle')
  })
})
