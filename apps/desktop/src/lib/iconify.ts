// Iconify (https://iconify.design) bridge for project glyphs: search the public
// API, and render a picked icon as a currentColor CSS mask so it tints exactly
// like a codicon. Only the icon name ("prefix:name") is persisted on the
// project; the SVG is cached locally so the sidebar never waits on the network
// after the first fetch.

export const ICONIFY_API = 'https://api.iconify.design'

const CACHE_KEY = 'hermes.desktop.iconify.v1'
const CACHE_MAX = 200
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:[-_][a-z0-9]+)*$/

/** A picked Iconify icon is stored as "prefix:name"; codicons never contain ':'. */
export function isIconifyName(name: null | string | undefined): name is string {
  return Boolean(name && NAME_RE.test(name))
}

function splitName(name: string): [string, string] {
  const at = name.indexOf(':')

  return [name.slice(0, at), name.slice(at + 1)]
}

/** Remote SVG URL — the browser fetches + caches it; used until the local cache fills. */
export function iconifySvgUrl(name: string): string {
  const [prefix, icon] = splitName(name)

  return `${ICONIFY_API}/${encodeURIComponent(prefix)}/${encodeURIComponent(icon)}.svg`
}

type SvgCache = Record<string, string>

let memory: null | SvgCache = null

function readCache(): SvgCache {
  if (memory) {
    return memory
  }

  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    memory = parsed && typeof parsed === 'object' ? (parsed as SvgCache) : {}
  } catch {
    memory = {}
  }

  return memory
}

function writeCache(name: string, svg: string) {
  const cache = { ...readCache() }
  delete cache[name]
  cache[name] = svg
  const keys = Object.keys(cache)

  for (const stale of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) {
    delete cache[stale]
  }

  memory = cache

  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Quota or disabled storage: the in-memory copy still serves this session.
  }
}

/** CSS mask source for an icon: the cached SVG as a data URL, else the remote URL. */
export function iconifyMaskUrl(name: string): string {
  const svg = readCache()[name]

  return svg ? `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")` : `url("${iconifySvgUrl(name)}")`
}

export function isIconifyCached(name: string): boolean {
  return Boolean(readCache()[name])
}

const inflight = new Map<string, Promise<void>>()

/** Fetch an icon's SVG once and keep it locally (called when a project picks it). */
export function cacheIconifyIcon(name: string): Promise<void> {
  if (!isIconifyName(name) || isIconifyCached(name)) {
    return Promise.resolve()
  }

  const pending = inflight.get(name)

  if (pending) {
    return pending
  }

  const job = fetch(iconifySvgUrl(name))
    .then(res => (res.ok ? res.text() : Promise.reject(new Error(`iconify ${res.status}`))))
    .then(svg => {
      // A mask only reads alpha, so scripts/handlers in the markup can never run;
      // still, keep only something that is actually an <svg> document.
      if (/^\s*<svg[\s>]/i.test(svg)) {
        writeCache(name, svg)
      }
    })
    .catch(() => undefined)
    .finally(() => inflight.delete(name))

  inflight.set(name, job)

  return job
}

interface IconifySearchResponse {
  icons?: string[]
  collections?: Record<string, { palette?: boolean; name?: string }>
}

export interface IconifySearchResult {
  icons: string[]
  /** prefix → human set name, for tooltips. */
  sets: Record<string, string>
}

/**
 * Search every Iconify set, keeping only monochrome ones: multicolor sets
 * (emoji, logos, flags — `palette: true`) ignore the project's tint, so they
 * would break the "pick a color, the glyph follows" contract.
 */
export async function searchIconify(query: string, signal?: AbortSignal, limit = 48): Promise<IconifySearchResult> {
  const q = query.trim()

  if (!q) {
    return { icons: [], sets: {} }
  }

  // Over-fetch: palette sets are dropped client-side, the API has no filter.
  const url = `${ICONIFY_API}/search?query=${encodeURIComponent(q)}&limit=${Math.max(64, limit * 2)}`
  const res = await fetch(url, { signal })

  if (!res.ok) {
    throw new Error(`Iconify search failed (${res.status})`)
  }

  const data = (await res.json()) as IconifySearchResponse
  const collections = data.collections ?? {}
  const sets: Record<string, string> = {}

  const icons = (data.icons ?? [])
    .filter(name => {
      if (!isIconifyName(name)) {
        return false
      }

      const set = collections[splitName(name)[0]]

      return Boolean(set) && set?.palette !== true
    })
    .slice(0, limit)

  for (const name of icons) {
    const prefix = splitName(name)[0]
    sets[prefix] = collections[prefix]?.name ?? prefix
  }

  return { icons, sets }
}
