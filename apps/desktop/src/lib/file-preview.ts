import type { ReactNode } from 'react'

import type { PreviewTarget } from '@/store/preview'

/**
 * FILE PREVIEWERS — the preview rail as a contribution area (#67693).
 *
 * Core previews images, PDFs and text itself; everything else lands on the
 * "This looks like a binary file" notice. A plugin registers a previewer for
 * file extensions it can render (Word documents, spreadsheets, 3D models, …)
 * and the rail mounts it in place of that notice — the same seam the
 * transcript-directive area gives the chat, so no plugin ever has to reach
 * into the rail's markup to replace it.
 *
 * Core kinds are not claimable: a registration for `png` or `pdf` is ignored,
 * so a plugin can add formats but never hijack one core already renders.
 */

export const FILE_PREVIEW_AREA = 'preview.files'

/** Props handed to a file previewer's `render`. */
export interface FilePreviewProps {
  /** Absolute path of the file on the connected backend's filesystem. */
  path: string
  /** Display name (basename). */
  name: string
  /** Lowercased extension without the dot (`docx`). */
  extension: string
  byteSize?: number
  mimeType?: string
  /** Hand the file back to core's built-in handling (the binary notice and its
   *  "Preview anyway"), e.g. when the plugin finds the file is corrupt. */
  fallback: () => void
}

/** Payload of a `preview.files` contribution's `data`. */
export interface FilePreviewContribution {
  /** Extensions without the dot, case-insensitive (`['docx', 'dotx']`). */
  extensions: readonly string[]
  /** Higher wins when several plugins claim the same extension; ties go to the
   *  first registration. Defaults to 0. */
  priority?: number
  /** Renders the preview body. Mounted inside the contribution error boundary,
   *  so a throw degrades to an inline error, not a dead pane. */
  render: (props: FilePreviewProps) => ReactNode
}

/** Kinds core renders natively; previewers never replace these. */
const CORE_KINDS = new Set<PreviewTarget['previewKind']>(['directory', 'html', 'image', 'missing', 'pdf', 'text'])

export function fileExtension(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')

  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** Whether a preview target is eligible for a plugin previewer at all:
 *  a local file core would otherwise refuse or show as raw bytes. */
export function isPluginPreviewable(target: Pick<PreviewTarget, 'kind' | 'previewKind'>): boolean {
  return target.kind === 'file' && !CORE_KINDS.has(target.previewKind)
}

interface ClaimLike {
  data?: unknown
}

/** The contribution that renders `extension`, if any: highest priority, then
 *  first registered. Pure — the caller supplies the area's contributions. */
export function pickFilePreviewer<C extends ClaimLike>(contributions: readonly C[], extension: string): C | undefined {
  if (!extension) {
    return undefined
  }

  let best: C | undefined
  let bestPriority = -Infinity

  for (const contribution of contributions) {
    const data = contribution.data as FilePreviewContribution | undefined

    if (!data || typeof data.render !== 'function' || !Array.isArray(data.extensions)) {
      continue
    }

    if (!data.extensions.some(ext => String(ext).replace(/^\./, '').toLowerCase() === extension)) {
      continue
    }

    const priority = Number.isFinite(data.priority) ? Number(data.priority) : 0

    if (priority > bestPriority) {
      best = contribution
      bestPriority = priority
    }
  }

  return best
}
