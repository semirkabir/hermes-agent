import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { requestComposerFocus, requestComposerInsert, requestComposerSubmit } from '@/app/chat/composer/focus'
import { MessageTextContent } from '@/components/assistant-ui/markdown-text'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import {
  $pendingArtifactComments,
  addPendingArtifactComment,
  artifactCommentsPrompt,
  clearPendingArtifactComments,
  type PendingArtifactComment,
  removePendingArtifactComment,
  splitArtifactBlocks,
  tidyQuote
} from '@/lib/artifact-comments'
import { ArrowUp, MessageCircle, X } from '@/lib/icons'
import { notify } from '@/store/notifications'

/** Stable empty list, so effects keyed on the queue don't re-run every render. */
const NO_COMMENTS: readonly PendingArtifactComment[] = []
const HIGHLIGHT_NAME = 'hermes-artifact-pending'
const POPUP_WIDTH = 288
const POPUP_HEIGHT = 132
const GAP = 8

interface Draft {
  block: number
  quote: string
  x: number
  y: number
}

interface ArtifactCommentLayerProps {
  artifactId: string
  content: string
  kind: string
  newestVersion: number
  title: string
  version: number
}

/**
 * A Markdown artifact (doc or deck) rendered natively in the panel, with
 * Redline-style highlight-to-comment: select text, a small box pops up under
 * it, Add queues the comment and keeps the passage highlighted, and the tray
 * sends every queued comment to the agent as one message.
 */
export function ArtifactCommentLayer({ artifactId, content, kind, newestVersion, title, version }: ArtifactCommentLayerProps) {
  const { t } = useI18n()
  const copy = t.artifactPreview
  const mainRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pending = useStore($pendingArtifactComments)[artifactId] ?? NO_COMMENTS
  const blocks = useMemo(() => splitArtifactBlocks(kind, content), [content, kind])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    setDraft(null)
    setNote('')
  }, [content])

  useEffect(() => {
    if (draft) {
      textareaRef.current?.focus({ preventScroll: true })
    }
  }, [draft])

  // Paint queued quotes. Markdown renders after commit, so retry on the next frame too.
  useEffect(() => {
    const paint = () => paintPendingHighlights(docRef.current, pending)
    paint()
    const frame = requestAnimationFrame(paint)

    return () => {
      cancelAnimationFrame(frame)
      clearPendingHighlights()
    }
  }, [pending, blocks])

  const onMouseUp = useCallback(() => {
    // Let the browser settle the selection first (a click inside a selection collapses it late).
    window.setTimeout(() => {
      const selection = window.getSelection()
      const quote = selection?.toString() ?? ''
      const main = mainRef.current

      if (!selection || !quote.trim() || !main || !docRef.current?.contains(selection.anchorNode)) {
        if (!note.trim()) {
          setDraft(null)
        }

        return
      }

      const anchor =
        selection.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection.anchorNode

      const blockEl = anchor instanceof Element ? anchor.closest<HTMLElement>('[data-artifact-block]') : null

      if (!blockEl) {
        return
      }

      const range = selection.getRangeAt(0)
      // Fall back to the block's box where a Range has no geometry (jsdom).
      const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : blockEl.getBoundingClientRect()
      const box = main.getBoundingClientRect()
      const below = rect.bottom - box.top + main.scrollTop + GAP
      const above = rect.top - box.top + main.scrollTop - POPUP_HEIGHT - GAP
      const fitsBelow = rect.bottom - box.top + GAP + POPUP_HEIGHT <= main.clientHeight

      setDraft({
        block: Number(blockEl.dataset.artifactBlock),
        quote,
        x: Math.max(GAP, Math.min(rect.left - box.left, main.clientWidth - POPUP_WIDTH - GAP)),
        y: fitsBelow || above < main.scrollTop ? below : above
      })
    }, 0)
  }, [note])

  const dismiss = useCallback(() => {
    setDraft(null)
    setNote('')
    window.getSelection()?.removeAllRanges()
  }, [])

  const add = useCallback(() => {
    if (!draft || !note.trim()) {
      return
    }

    addPendingArtifactComment(artifactId, { block: draft.block, note, quote: draft.quote, version })
    dismiss()
  }, [artifactId, dismiss, draft, note, version])

  const sendAll = useCallback(() => {
    if (!pending.length) {
      return
    }

    const prompt = artifactCommentsPrompt({ id: artifactId, title, version: newestVersion }, pending)

    if (!requestComposerSubmit(prompt)) {
      // No chat composer on screen to send through: park the batch in the
      // message box instead of losing it.
      requestComposerInsert(prompt, { mode: 'block' })
      requestComposerFocus()
      notify({ kind: 'info', message: copy.commentsInComposer, title: copy.comments(pending.length) })
    }

    clearPendingArtifactComments(artifactId)
  }, [artifactId, copy, newestVersion, pending, title])

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="artifact-comment-layer">
      <div className="relative min-h-0 flex-1 overflow-y-auto" ref={mainRef}>
        <div className="mx-auto max-w-3xl px-6 py-5" onMouseUp={onMouseUp} ref={docRef}>
          {blocks.map((block, index) => (
            <div data-artifact-block={index} key={index}>
              {block.slideStart != null && (
                <div className="mt-6 mb-2 border-t border-border/50 pt-2 text-[0.625rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase first:mt-0 first:border-t-0 first:pt-0">
                  {copy.slideLabel(block.slideStart)}
                </div>
              )}
              <MessageTextContent media={false} text={block.text} />
              {pending.some(comment => comment.block === index) && (
                <div className="-mt-1 mb-1 flex gap-1">
                  {pending.map((comment, n) =>
                    comment.block === index ? (
                      <span
                        className="rounded bg-[color-mix(in_srgb,var(--ui-accent)_22%,transparent)] px-1 text-[0.5625rem] font-semibold tabular-nums"
                        key={comment.id}
                        title={comment.note}
                      >
                        {n + 1}
                      </span>
                    ) : null
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {draft && (
          <div
            className="absolute z-20 flex flex-col gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-md"
            data-testid="artifact-comment-popup"
            onMouseUp={event => event.stopPropagation()}
            style={{ left: draft.x, top: draft.y, width: POPUP_WIDTH }}
          >
            <div className="truncate text-[0.625rem] text-muted-foreground" title={draft.quote}>
              “{tidyQuote(draft.quote)}”
            </div>
            <textarea
              aria-label={copy.commentPlaceholder}
              className="min-h-14 w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs outline-none focus:border-(--ui-stroke-secondary)"
              onChange={event => setNote(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  dismiss()
                } else if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  add()
                }
              }}
              placeholder={copy.commentPlaceholder}
              ref={textareaRef}
              rows={2}
              value={note}
            />
            <div className="flex items-center justify-end gap-1.5">
              <Button onClick={dismiss} size="xs" type="button" variant="ghost">
                {t.common.cancel}
              </Button>
              <Button disabled={!note.trim()} onClick={add} size="xs" type="button" variant="default">
                {copy.addComment}
              </Button>
            </div>
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div className="shrink-0 border-t border-border/60 bg-background/95 px-2.5 py-2" data-testid="artifact-comment-tray">
          <div className="mb-1.5 flex items-center gap-2">
            <MessageCircle className="size-3 text-muted-foreground" />
            <span className="text-[0.6875rem] font-semibold">{copy.comments(pending.length)}</span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button onClick={() => clearPendingArtifactComments(artifactId)} size="xs" type="button" variant="ghost">
                {t.common.clear}
              </Button>
              <Button onClick={sendAll} size="xs" type="button" variant="default">
                <ArrowUp className="size-3" />
                {copy.sendAll}
              </Button>
            </div>
          </div>
          <ol className="max-h-36 space-y-1 overflow-y-auto">
            {pending.map((comment, index) => (
              <li
                className="group/comment flex items-start gap-2 rounded-md bg-(--ui-bg-quaternary) px-2 py-1.5 text-[0.6875rem]"
                key={comment.id}
              >
                <span className="mt-px font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-muted-foreground" title={comment.quote}>
                    “{tidyQuote(comment.quote)}”
                  </div>
                  <div className="whitespace-pre-wrap wrap-anywhere">{comment.note}</div>
                </div>
                <Tip label={copy.removeComment}>
                  <button
                    aria-label={copy.removeComment}
                    className="rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-foreground group-hover/comment:opacity-100"
                    onClick={() => removePendingArtifactComment(artifactId, comment.id)}
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                </Tip>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

// ── highlights (CSS Custom Highlight API, no DOM mutation) ───────────────────

interface HighlightRegistry {
  delete: (name: string) => void
  set: (name: string, value: unknown) => void
}

function highlightApi(): null | { create: (ranges: Range[]) => unknown; registry: HighlightRegistry } {
  const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights
  const Ctor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight

  return registry && Ctor ? { create: ranges => new Ctor(...ranges), registry } : null
}

function clearPendingHighlights() {
  highlightApi()?.registry.delete(HIGHLIGHT_NAME)
}

/** The range covering `quote` inside `root`'s text, matching across element boundaries. */
export function findQuoteRange(root: Element, quote: string): null | Range {
  const needle = quote.trim()

  if (!needle) {
    return null
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let text = ''

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text)
    text += (node as Text).data
  }

  const at = text.indexOf(needle)

  if (at < 0) {
    return null
  }

  const range = document.createRange()
  let offset = 0
  let started = false

  for (const node of nodes) {
    const end = offset + node.data.length

    if (!started && at < end) {
      range.setStart(node, at - offset)
      started = true
    }

    if (started && at + needle.length <= end) {
      range.setEnd(node, at + needle.length - offset)

      return range
    }

    offset = end
  }

  return null
}

function paintPendingHighlights(doc: HTMLElement | null, pending: readonly PendingArtifactComment[]) {
  const api = highlightApi()

  if (!api || !doc) {
    return
  }

  const ranges = pending.flatMap(comment => {
    const block = doc.querySelector(`[data-artifact-block="${comment.block}"]`)
    const range = block ? findQuoteRange(block, comment.quote) : null

    return range ? [range] : []
  })

  if (ranges.length) {
    api.registry.set(HIGHLIGHT_NAME, api.create(ranges))
  } else {
    api.registry.delete(HIGHLIGHT_NAME)
  }
}
