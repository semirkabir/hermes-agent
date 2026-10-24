/**
 * DitherField / DitherLoading outside a real GPU.
 *
 * jsdom has no WebGL2, which is the same situation as a crashed GPU process:
 * the field must fall back to the CSS `.dither` checker (never an empty box),
 * and the loading state must still say what is loading to screen readers.
 * The WebGL path itself is checked by rendering it in a real browser.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DitherField, DitherLoading, prefersReducedMotion } from './dither-field'

describe('DitherField without WebGL', () => {
  it('falls back to the CSS checker at a visible tint', () => {
    const { container } = render(<DitherField frontAlpha={0.2} />)
    const field = container.querySelector('[data-dither-field]') as HTMLElement

    expect(field.getAttribute('data-dither-field')).toBe('css')
    expect(field.classList.contains('dither')).toBe(true)
    expect(Number(field.style.opacity)).toBeCloseTo(0.2)
    expect(field.getAttribute('aria-hidden')).toBe('true')
  })

  it('never fades the fallback to nothing', () => {
    const { container } = render(<DitherField frontAlpha={0} />)
    const field = container.querySelector('[data-dither-field]') as HTMLElement

    expect(Number(field.style.opacity)).toBeGreaterThan(0)
  })
})

describe('DitherLoading', () => {
  it('is a polite status with the label and the detail', () => {
    render(<DitherLoading detail="Q3 deck" label="Loading" />)

    const status = screen.getByRole('status')

    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toContain('Loading')
    expect(status.textContent).toContain('Q3 deck')
  })
})

describe('prefersReducedMotion', () => {
  it('reads the media query and tolerates environments without matchMedia', () => {
    expect(typeof prefersReducedMotion()).toBe('boolean')
  })
})
