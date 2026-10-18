import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { ColorSwatches } from '@/components/ui/color-swatches'
import { ColorWheel } from '@/components/ui/color-wheel'
import { GlyphIcon } from '@/components/ui/glyph-icon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cacheIconifyIcon, isIconifyName, searchIconify } from '@/lib/iconify'
import { Loader2, Search } from '@/lib/icons'
import { PROFILE_SWATCHES } from '@/lib/profile-color'
import { cn } from '@/lib/utils'

// Curated codicons for a project glyph (tinted by the chosen color). Shared by
// the kebab's Appearance popover and the right-click menu's Appearance submenu
// so both offer the same picker. The trailing "+" opens an Iconify search for
// everything else.
export const PROJECT_ICONS = [
  'folder-library',
  'repo',
  'rocket',
  'beaker',
  'flame',
  'star-full',
  'heart',
  'zap',
  'target',
  'lightbulb',
  'tools',
  'device-desktop',
  'device-mobile',
  'terminal',
  'dashboard',
  'globe',
  'broadcast',
  'cloud',
  'database',
  'package',
  'book',
  'organization',
  'bug',
  'shield',
  'key',
  'gift',
  'telescope',
  'home'
]

const SEARCH_DEBOUNCE_MS = 250
// Dragging the wheel fires per pointer move; persist once it settles.
const COLOR_PERSIST_MS = 180

const TILE_CLASS =
  'grid aspect-square place-items-center rounded-md text-(--ui-text-tertiary) transition hover:bg-(--ui-control-hover-background)'

const TILE_ACTIVE_CLASS = 'bg-(--ui-control-active-background) text-foreground'

interface ProjectAppearancePickerProps {
  color: null | string
  icon: null | string
  noColorLabel: string
  onColor: (color: null | string) => void
  onIcon: (icon: null | string) => void
}

interface IconTileProps {
  color: null | string
  label: string
  name: string
  onPick: (name: null | string) => void
  selected: boolean
}

function IconTile({ color, label, name, onPick, selected }: IconTileProps) {
  return (
    <Tip label={label}>
      <button
        aria-label={label}
        aria-pressed={selected}
        className={cn(TILE_CLASS, selected && TILE_ACTIVE_CLASS)}
        onClick={() => onPick(selected ? null : name)}
        style={selected && color ? { color } : undefined}
        type="button"
      >
        <GlyphIcon name={name} size="0.8125rem" />
      </button>
    </Tip>
  )
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; icons: string[]; sets: Record<string, string> }

function useIconifySearch(query: string): SearchState {
  const [state, setState] = useState<SearchState>({ status: 'idle' })

  useEffect(() => {
    const q = query.trim()

    if (!q) {
      setState({ status: 'idle' })

      return
    }

    setState({ status: 'loading' })
    const controller = new AbortController()

    const timer = window.setTimeout(() => {
      searchIconify(q, controller.signal)
        .then(result => setState({ status: 'done', ...result }))
        .catch(() => {
          if (!controller.signal.aborted) {
            setState({ status: 'error' })
          }
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  return state
}

// Keep keys typed into the picker's fields away from the menu's typeahead and
// arrow navigation; Escape still bubbles so the menu can close.
const keepKeys = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key !== 'Escape') {
    event.stopPropagation()
  }
}

function useDebouncedColor(color: null | string, onColor: (color: null | string) => void) {
  // Live color while dragging, so the picker tints instantly while the write
  // to projects.db is debounced to one per settled drag.
  const [draft, setDraft] = useState<null | string>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const pick = (next: null | string) => {
    window.clearTimeout(timer.current)
    setDraft(null)
    onColor(next)
  }

  const drag = (hex: string) => {
    setDraft(hex)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setDraft(null)
      onColor(hex)
    }, COLOR_PERSIST_MS)
  }

  return { drag, draft, pick, shown: draft ?? color }
}

interface ProjectColorSectionProps {
  color: null | string
  draft: null | string
  noColorLabel: string
  onDrag: (hex: string) => void
  onPick: (color: null | string) => void
}

/** Preset swatches, "No color", and a "+" that opens the custom color wheel. */
function ProjectColorSection({ color, draft, noColorLabel, onDrag, onPick }: ProjectColorSectionProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const [wheelOpen, setWheelOpen] = useState(false)
  const shown = draft ?? color
  const isCustom = Boolean(shown && !PROFILE_SWATCHES.includes(shown))

  const ring = wheelOpen || isCustom ? (isCustom ? shown : 'var(--ui-text-tertiary)') : null

  return (
    <>
      <ColorSwatches
        clearIcon="circle-slash"
        clearLabel={noColorLabel}
        onChange={onPick}
        swatches={PROFILE_SWATCHES}
        trailing={
          <Tip label={p.colorCustom}>
            <button
              aria-expanded={wheelOpen}
              aria-label={p.colorCustom}
              className="grid size-5 shrink-0 place-items-center rounded-full transition-transform hover:scale-110"
              onClick={() => setWheelOpen(open => !open)}
              style={{
                // Rainbow until a custom color is set, then that color.
                background: isCustom
                  ? (shown ?? undefined)
                  : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
                boxShadow: ring ? `0 0 0 2px var(--ui-bg-elevated), 0 0 0 3.5px ${ring}` : undefined
              }}
              type="button"
            >
              <Codicon className="text-white mix-blend-difference" name="add" size="0.6875rem" />
            </button>
          </Tip>
        }
        value={shown ?? null}
      />
      {wheelOpen && (
        <ColorWheel
          brightnessLabel={p.colorBrightness}
          className="mt-2 w-0 min-w-full"
          hexLabel={p.colorHex}
          hueLabel={p.colorHue}
          onChange={onDrag}
          value={shown}
        />
      )}
    </>
  )
}

interface IconifySearchPanelProps {
  color: null | string
  icon: null | string
  onPick: (name: null | string) => void
}

/** Search field + monochrome Iconify results, opened by the icon grid's "+". */
function IconifySearchPanel({ color, icon, onPick }: IconifySearchPanelProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const search = useIconifySearch(query)
  const results = search.status === 'done' ? search.icons : []

  const message =
    search.status === 'error'
      ? p.iconSearchError
      : search.status === 'done' && !results.length
        ? p.iconSearchEmpty
        : null

  useEffect(() => inputRef.current?.focus(), [])

  const label = (name: string) => {
    const [prefix, glyph] = name.split(':')
    const set = search.status === 'done' ? search.sets[prefix] : undefined

    return set ? `${glyph} · ${set}` : glyph
  }

  return (
    // Width-capped so a long query or result set never widens the popover.
    <div className="mt-2 w-0 min-w-full border-t border-(--ui-stroke-tertiary) pt-2">
      <label className="flex h-7 items-center gap-1.5 rounded-md bg-(--ui-control-hover-background) px-2">
        <Search className="size-3.5 shrink-0 text-(--ui-text-tertiary)" />
        <input
          aria-label={p.iconSearchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-(--ui-text-tertiary) focus:outline-none"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={keepKeys}
          placeholder={p.iconSearchPlaceholder}
          ref={inputRef}
          spellCheck={false}
          type="text"
          value={query}
        />
        {search.status === 'loading' && (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-(--ui-text-tertiary)" />
        )}
      </label>
      {results.length > 0 && (
        <div className="mt-2 grid max-h-40 grid-cols-6 gap-1.5 overflow-y-auto" data-testid="iconify-results">
          {results.map(name => (
            <IconTile
              color={color}
              key={name}
              label={label(name)}
              name={name}
              onPick={onPick}
              selected={icon === name}
            />
          ))}
        </div>
      )}
      {message && <p className="mt-2 text-center text-[0.6875rem] text-(--ui-text-tertiary)">{message}</p>}
      <p className="mt-1.5 text-center text-[0.625rem] text-(--ui-text-tertiary) opacity-70">{p.iconSearchHint}</p>
    </div>
  )
}

/** Color swatches + icon grid for a project's appearance — one component so the
 *  kebab popover and the right-click submenu render an identical picker. */
export function ProjectAppearancePicker({ color, icon, noColorLabel, onColor, onIcon }: ProjectAppearancePickerProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const [searchOpen, setSearchOpen] = useState(false)
  const tint = useDebouncedColor(color, onColor)
  // A picked Iconify icon isn't in the curated grid — keep it visible (and
  // clearable in one click) as a tile ahead of the "+".
  const customIcon = isIconifyName(icon) ? icon : null

  const pick = (name: null | string) => {
    if (isIconifyName(name)) {
      void cacheIconifyIcon(name)
    }

    onIcon(name)
  }

  return (
    <>
      <ProjectColorSection
        color={color}
        draft={tint.draft}
        noColorLabel={noColorLabel}
        onDrag={tint.drag}
        onPick={tint.pick}
      />
      {/* Same 6 columns + gap as the swatch grid so the picker keeps the
          profile picker's width (icons flex to fill, not fixed-width). */}
      <div className="mt-2 grid grid-cols-6 gap-1.5">
        {PROJECT_ICONS.map(name => (
          <IconTile color={tint.shown} key={name} label={name} name={name} onPick={pick} selected={icon === name} />
        ))}
        {customIcon && <IconTile color={tint.shown} label={customIcon} name={customIcon} onPick={pick} selected />}
        <Tip label={p.iconSearch}>
          <button
            aria-expanded={searchOpen}
            aria-label={p.iconSearch}
            className={cn(TILE_CLASS, searchOpen && TILE_ACTIVE_CLASS)}
            onClick={() => setSearchOpen(open => !open)}
            type="button"
          >
            <Codicon name="add" size="0.8125rem" />
          </button>
        </Tip>
      </div>
      {searchOpen && <IconifySearchPanel color={tint.shown} icon={icon} onPick={pick} />}
    </>
  )
}
