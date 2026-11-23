import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CACHE_KEY = 'hermes.desktop.iconify.v1'
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"/></svg>'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => Promise.resolve(new Response(SVG, { status: 200 })))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GlyphIcon', () => {
  it('renders a codicon for a plain name and never touches the network', async () => {
    const { GlyphIcon } = await import('./glyph-icon')
    const { container } = render(<GlyphIcon name="rocket" />)

    expect(container.querySelector('.codicon-rocket')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches an Iconify icon it has never seen so it keeps rendering offline', async () => {
    const { GlyphIcon } = await import('./glyph-icon')
    const { container } = render(<GlyphIcon name="mdi:rocket" />)

    const remote = (container.querySelector('[data-iconify]') as HTMLElement).style.maskImage

    expect(remote).toContain('https://api.iconify.design/mdi/rocket.svg')

    await waitFor(() => expect(window.localStorage.getItem(CACHE_KEY)).toContain('mdi:rocket'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves the cache alone for preview tiles', async () => {
    const { GlyphIcon } = await import('./glyph-icon')

    render(<GlyphIcon name="mdi:rocket" preview />)
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull()
  })
})

describe('iconify cache', () => {
  it('ignores malformed or oversized entries in localStorage', async () => {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        'mdi:good': SVG,
        'mdi:html': '<img src=x onerror=alert(1)>',
        'mdi:huge': `<svg>${'a'.repeat(20_000)}</svg>`,
        'mdi:number': 7,
        'not a name': SVG
      })
    )

    const { isIconifyCached } = await import('@/lib/iconify')

    expect(isIconifyCached('mdi:good')).toBe(true)
    expect(isIconifyCached('mdi:html')).toBe(false)
    expect(isIconifyCached('mdi:huge')).toBe(false)
    expect(isIconifyCached('mdi:number')).toBe(false)
  })

  it('refuses to cache a response that is not an SVG', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('<html></html>', { status: 200 })))
    const { cacheIconifyIcon, isIconifyCached } = await import('@/lib/iconify')

    await cacheIconifyIcon('mdi:rocket')

    expect(isIconifyCached('mdi:rocket')).toBe(false)
  })
})
