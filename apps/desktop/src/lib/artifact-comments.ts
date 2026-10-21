import { atom } from 'nanostores'

/**
 * HIGHLIGHT-TO-COMMENT for store-backed artifacts in the right panel, the
 * Redline way: Markdown artifacts (docs, decks) render natively in the panel
 * as blocks, the selection is read from the app's own DOM, and queued
 * comments are painted with the CSS Custom Highlight API. Nothing runs inside
 * a sandboxed frame (the app's CSP blocks inline scripts there).
 *
 * Queued comments live in memory per artifact until the user sends them all
 * as ONE message, so the agent applies them in a single pass and saves one
 * new version.
 */

export interface PendingArtifactComment {
  /** Index of the rendered block the quote sits in. */
  block: number
  id: string
  note: string
  quote: string
  /** Version the user was looking at when they wrote it. */
  version: number
}

export interface ArtifactBlock {
  /** 1-based slide number for decks, on the slide's first block. */
  slideStart?: number
  text: string
}

/** Collapse whitespace so a quote reads as one line in the tray and the prompt. */
export function tidyQuote(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Split Markdown into commentable blocks: paragraphs, headings, lists and
 * tables split on blank lines; fenced code stays whole. Decks also split on a
 * `---` line (a new slide) and drop `<!-- notes: ... -->`.
 */
export function splitArtifactBlocks(kind: string, content: string): ArtifactBlock[] {
  const deck = kind === 'slides'
  const source = deck ? content.replace(/<!--[\s\S]*?-->/g, '') : content
  const blocks: ArtifactBlock[] = []
  let lines: string[] = []
  let fence = false
  let slide = 1
  let slidePending = deck

  const flush = () => {
    const text = lines.join('\n').trim()

    if (text) {
      blocks.push(slidePending ? { slideStart: slide, text } : { text })
      slidePending = false
    }

    lines = []
  }

  for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      lines.push(line)

      continue
    }

    if (!fence && deck && /^\s*---\s*$/.test(line)) {
      flush()

      if (blocks.length) {
        slide += 1
        slidePending = true
      }

      continue
    }

    if (!fence && !line.trim()) {
      flush()

      continue
    }

    lines.push(line)
  }

  flush()

  return blocks
}

// ── queued comments ─────────────────────────────────────────────────────────

export const $pendingArtifactComments = atom<Record<string, PendingArtifactComment[]>>({})

let commentSeq = 0

export function addPendingArtifactComment(
  artifactId: string,
  draft: Omit<PendingArtifactComment, 'id'>
): PendingArtifactComment | null {
  const note = draft.note.trim()
  const quote = draft.quote.trim()

  if (!note || !quote) {
    return null
  }

  commentSeq += 1
  const comment = { ...draft, id: `c${Date.now().toString(36)}${commentSeq}`, note, quote }
  const current = $pendingArtifactComments.get()

  $pendingArtifactComments.set({ ...current, [artifactId]: [...(current[artifactId] ?? []), comment] })

  return comment
}

export function removePendingArtifactComment(artifactId: string, commentId: string) {
  const current = $pendingArtifactComments.get()
  const next = (current[artifactId] ?? []).filter(comment => comment.id !== commentId)

  if (next.length) {
    $pendingArtifactComments.set({ ...current, [artifactId]: next })
  } else {
    clearPendingArtifactComments(artifactId)
  }
}

export function clearPendingArtifactComments(artifactId: string) {
  const current = $pendingArtifactComments.get()

  if (artifactId in current) {
    const { [artifactId]: _dropped, ...rest } = current
    $pendingArtifactComments.set(rest)
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The one message "Send all" submits: which artifact, which version, every quote and note. */
export function artifactCommentsPrompt(
  artifact: { id: string; title: string; version: number },
  comments: readonly PendingArtifactComment[]
): string {
  const viewed = [...new Set(comments.map(comment => comment.version))]
  const older = viewed.filter(version => version !== artifact.version)
  const count = comments.length === 1 ? 'this comment' : `these ${comments.length} comments`

  const header = [
    `Apply ${count} to the artifact "${artifact.title}" (id ${artifact.id}).`,
    older.length
      ? `I wrote them while viewing v${older.join(', v')}; the newest is v${artifact.version}, so check the quotes against it.`
      : `They are on v${artifact.version}, the newest version.`,
    'Read it with artifact_get, make every change in one pass, and save it as one new version with artifact_save.'
  ].join(' ')

  const body = comments.map((comment, index) => {
    const note = comment.note.replace(/\n+/g, '\n   ')

    return `${index + 1}. On "${clip(tidyQuote(comment.quote), 400)}"\n   ${note}`
  })

  return [header, '', ...body].join('\n')
}
