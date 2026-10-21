import { atom } from 'nanostores'

import { pluginRest } from '@/api/plugins'
import { onGatewayEvent } from '@/contrib/events'
import type { PreviewTarget } from '@/store/preview'

/**
 * STORE-BACKED ARTIFACTS — typed, versioned artifacts the agent saved through
 * the `hermes-artifacts` gateway plugin (docs, slides, designs, dashboards,
 * html tools). Unlike the in-memory registry (`store/artifacts.ts`), the
 * backend owns the content, so a rail tab for one survives reloads and
 * re-reads the newest version whenever the agent saves another.
 *
 * Identity in the rail: an `artifact` preview target whose `url` is
 * `store:<id>`. The registry's own ids never carry that prefix, so one
 * `ArtifactPreview` entry point serves both and branches on it.
 */

export const ARTIFACTS_PLUGIN_ID = 'hermes-artifacts'
export const ARTIFACTS_CHANGED_EVENT = `plugin.${ARTIFACTS_PLUGIN_ID}.changed`
const STORE_PREFIX = 'store:'
const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/

export type StoreArtifactKind = 'dashboard' | 'design' | 'doc' | 'html' | 'slides'

export interface StoreArtifactVersionInfo {
  created_at: number
  note: string
  size: number
  version: number
}

/** `GET /item/<id>/view` — one round trip carries everything a tab shows. */
export interface StoreArtifactView {
  archived: boolean
  content: string
  created_at: number
  html: string
  id: string
  kind: StoreArtifactKind
  pinned: boolean
  selected_version: number
  session_id: null | string
  size: number
  source_ext: string
  summary: string
  title: string
  updated_at: number
  /** Newest version number. */
  version: number
  versions: StoreArtifactVersionInfo[]
}

export function isStoreArtifactId(id: string): boolean {
  return ID_RE.test(id)
}

/** The store id behind a rail target, or null when it is a registry artifact / not an artifact. */
export function storeArtifactIdOf(target: Pick<PreviewTarget, 'kind' | 'url'>): null | string {
  if (target.kind !== 'artifact' || !target.url.startsWith(STORE_PREFIX)) {
    return null
  }

  const id = target.url.slice(STORE_PREFIX.length)

  return isStoreArtifactId(id) ? id : null
}

export function storeArtifactTarget(id: string, label?: string): PreviewTarget {
  const url = `${STORE_PREFIX}${id}`

  return { kind: 'artifact', label: label?.trim() || id, source: url, url }
}

/** Per-artifact pinned version; absent = follow the newest. Memory-only on
 *  purpose: a reopened app should land on the current version. */
export const $storeArtifactVersion = atom<Record<string, number>>({})

export function selectStoreArtifactVersion(id: string, version: null | number) {
  const current = $storeArtifactVersion.get()

  if (version == null) {
    if (id in current) {
      const { [id]: _dropped, ...rest } = current
      $storeArtifactVersion.set(rest)
    }

    return
  }

  if (current[id] !== version) {
    $storeArtifactVersion.set({ ...current, [id]: version })
  }
}

/** Bumped per artifact whenever the backend broadcasts a change, so an open
 *  tab re-fetches without polling. */
export const $storeArtifactRevision = atom<Record<string, number>>({})

export function noteStoreArtifactChanged(id: string) {
  const current = $storeArtifactRevision.get()
  $storeArtifactRevision.set({ ...current, [id]: (current[id] ?? 0) + 1 })
}

let unsubscribeChanges: (() => void) | null = null

/** Start listening for `plugin.hermes-artifacts.changed` (idempotent). */
export function watchStoreArtifactChanges(): () => void {
  if (!unsubscribeChanges) {
    unsubscribeChanges = onGatewayEvent(ARTIFACTS_CHANGED_EVENT, event => {
      const payload = event.payload as null | Record<string, unknown> | undefined
      const id = typeof payload?.id === 'string' ? payload.id : ''

      if (id && isStoreArtifactId(id)) {
        noteStoreArtifactChanged(id)
      }
    })
  }

  return () => {
    unsubscribeChanges?.()
    unsubscribeChanges = null
  }
}

export function fetchStoreArtifactView(id: string, version?: null | number): Promise<StoreArtifactView> {
  if (!isStoreArtifactId(id)) {
    return Promise.reject(new Error(`invalid artifact id: ${id}`))
  }

  const query = version ? `?v=${encodeURIComponent(String(version))}` : ''

  return pluginRest<StoreArtifactView>(ARTIFACTS_PLUGIN_ID, `/item/${encodeURIComponent(id)}/view${query}`)
}

const MIME_BY_EXT: Record<string, string> = { html: 'text/html', md: 'text/markdown' }

export function storeArtifactDownload(view: Pick<StoreArtifactView, 'selected_version' | 'source_ext' | 'title'>) {
  const base =
    view.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'artifact'

  return {
    mimeType: MIME_BY_EXT[view.source_ext] ?? 'text/plain',
    name: `${base}-v${view.selected_version}.${view.source_ext || 'txt'}`
  }
}
