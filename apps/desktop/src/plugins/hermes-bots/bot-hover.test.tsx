/**
 * Hover on a bot: the face greets while idle (keeps its work motion while
 * busy), and the rail's preview card shows the name and last message beside
 * the face instead of the old letter-per-line tooltip.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, host: { ...sdk.host, state: { ...sdk.host.state } } }
})

vi.mock('./live-face', () => ({ LiveBotFace: ({ state }: { state: string }) => <i data-face-state={state} /> }))

const { BotHoverCard, botPreviewText, hoverState } = await import('./bot-hover')
const { CLIPS, STATES } = await import('./motion-engine')

const bot = {
  name: 'mewtoo',
  connectionId: 'local',
  canonical_session: {
    id: 's',
    preview: 'Hey Semir, **going well**! The Hyperliquid backtest is the last thing I worked on.'
  }
} as never

afterEach(() => cleanup())

describe('hover', () => {
  it('greets when idle and leaves busy motion alone', () => {
    expect(hoverState('idle', true)).toBe('greet')
    expect(hoverState('idle', false)).toBe('idle')
    expect(hoverState('running', true)).toBe('running')
    expect(STATES.greet.clips.every(c => CLIPS[c])).toBe(true)
  })

  it('previews the last message without markdown', () => {
    expect(botPreviewText(bot)).toBe('Hey Semir, going well! The Hyperliquid backtest is the last thing I worked on.')
  })

  it('opens a card beside the anchor with the name and preview', () => {
    const anchor = window.document.createElement('button')
    anchor.getBoundingClientRect = () =>
      ({ top: 100, right: 44, left: 8, bottom: 136, width: 36, height: 36 }) as DOMRect
    render(<BotHoverCard anchor={anchor} bot={bot} open />)

    const card = screen.getByRole('tooltip')
    expect(card.textContent).toContain('Mewtoo')
    expect(card.textContent).toContain('Hyperliquid backtest')
    expect(card.getAttribute('style')).toContain('left: 54px')
  })
})
