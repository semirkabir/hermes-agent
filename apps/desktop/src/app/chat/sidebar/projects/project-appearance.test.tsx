import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hexToHsv, hsvToHex } from '@/components/ui/color-wheel'
import { isIconifyName, searchIconify } from '@/lib/iconify'

import { ProjectAppearancePicker } from './project-appearance'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        projects: {
          colorBrightness: 'Brightness',
          colorCustom: 'Custom color',
          colorHex: 'Hex color',
          colorHue: 'Hue and saturation',
          iconSearch: 'More icons',
          iconSearchEmpty: 'No icons found',
          iconSearchError: "Couldn't reach Iconify",
          iconSearchHint: 'Icons from Iconify',
          iconSearchPlaceholder: 'Search icons'
        }
      }
    }
  })
}))

// Shape of a real https://api.iconify.design/search response: a monochrome set
// (tabler) and a multicolor one (twemoji, palette: true) that must be dropped.
const SEARCH_RESPONSE = {
  icons: ['tabler:rocket', 'twemoji:rocket', 'mdi:rocket-outline'],
  collections: {
    mdi: { name: 'Material Design Icons', palette: false },
    tabler: { name: 'Tabler Icons', palette: false },
    twemoji: { name: 'Twitter Emoji', palette: true }
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  window.localStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/search?')
        ? new Response(JSON.stringify(SEARCH_RESPONSE), { status: 200 })
        : new Response('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"/></svg>', { status: 200 })
    )
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('iconify helpers', () => {
  it('tells Iconify names apart from codicons', () => {
    expect(isIconifyName('mdi:rocket')).toBe(true)
    expect(isIconifyName('material-symbols:rocket-outline-rounded')).toBe(true)
    expect(isIconifyName('rocket')).toBe(false)
    expect(isIconifyName('mdi:../../etc')).toBe(false)
    expect(isIconifyName(null)).toBe(false)
  })

  it('filters multicolor (palette) sets out of search results', async () => {
    const result = await searchIconify('rocket')

    expect(result.icons).toEqual(['tabler:rocket', 'mdi:rocket-outline'])
    expect(result.sets).toEqual({ mdi: 'Material Design Icons', tabler: 'Tabler Icons' })
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/api\.iconify\.design\/search\?query=rocket&/)
  })
})

describe('ProjectAppearancePicker iconify search', () => {
  const renderPicker = (icon: null | string = null) => {
    const onIcon = vi.fn()

    render(
      <ProjectAppearancePicker color="#3b82f6" icon={icon} noColorLabel="No color" onColor={vi.fn()} onIcon={onIcon} />
    )

    return onIcon
  }

  it('opens search from the + tile, debounces, and picks a monochrome result', async () => {
    vi.useFakeTimers()
    const onIcon = renderPicker()

    fireEvent.click(screen.getByRole('button', { name: 'More icons' }))
    const input = screen.getByRole('textbox', { name: 'Search icons' })

    fireEvent.change(input, { target: { value: 'roc' } })
    fireEvent.change(input, { target: { value: 'rocket' } })
    expect(fetchMock).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /twemoji|Twitter Emoji/ })).toBeNull()

    const tile = screen.getByRole('button', { name: 'rocket · Tabler Icons' })

    fireEvent.click(tile)
    expect(onIcon).toHaveBeenCalledWith('tabler:rocket')

    // Picking also caches the SVG locally so the sidebar renders offline.
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.iconify.design/tabler/rocket.svg')
    expect(window.localStorage.getItem('hermes.desktop.iconify.v1')).toContain('tabler:rocket')
  })

  it('keeps a picked Iconify icon visible and clears it on re-click', () => {
    const onIcon = renderPicker('mdi:rocket')
    const tile = screen.getByRole('button', { name: 'mdi:rocket' })

    expect(tile.getAttribute('aria-pressed')).toBe('true')
    expect(tile.querySelector('[data-iconify="mdi:rocket"]')).toBeTruthy()
    fireEvent.click(tile)
    expect(onIcon).toHaveBeenCalledWith(null)
  })

  it('shows an error line when Iconify is unreachable', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')))
    renderPicker()

    fireEvent.click(screen.getByRole('button', { name: 'More icons' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search icons' }), { target: { value: 'rocket' } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(screen.getByText("Couldn't reach Iconify")).toBeTruthy()
  })
})

describe('custom color wheel', () => {
  it('round-trips hex and parses the hsl() preset swatches', () => {
    for (const hex of ['#3b82f6', '#ff0000', '#000000', '#ffffff', '#12ab9c']) {
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex)
    }

    expect(hsvToHex(hexToHsv('hsl(0 100% 50%)')!)).toBe('#ff0000')
    expect(hexToHsv('nope')).toBeNull()
  })

  it('opens from the + swatch and persists a typed hex once, debounced', async () => {
    vi.useFakeTimers()
    const onColor = vi.fn()

    render(
      <ProjectAppearancePicker color={null} icon={null} noColorLabel="No color" onColor={onColor} onIcon={vi.fn()} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Custom color' }))
    expect(screen.getByTestId('color-wheel')).toBeTruthy()

    const hex = screen.getByRole('textbox', { name: 'Hex color' })

    fireEvent.change(hex, { target: { value: '#12ab9c' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Brightness' }), { target: { value: '50' } })
    expect(onColor).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })

    expect(onColor).toHaveBeenCalledTimes(1)
    expect(onColor.mock.calls[0][0]).toMatch(/^#[0-9a-f]{6}$/)
    expect(hexToHsv(onColor.mock.calls[0][0])!.v).toBeCloseTo(0.5, 1)
  })

  it('a preset swatch click persists immediately and cancels a pending drag', async () => {
    vi.useFakeTimers()
    const onColor = vi.fn()

    render(
      <ProjectAppearancePicker color={null} icon={null} noColorLabel="No color" onColor={onColor} onIcon={vi.fn()} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Custom color' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Hex color' }), { target: { value: '#12ab9c' } })
    fireEvent.click(screen.getByRole('button', { name: 'No color' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(onColor.mock.calls).toEqual([[null]])
  })
})
