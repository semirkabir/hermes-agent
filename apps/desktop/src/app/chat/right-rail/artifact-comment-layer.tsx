import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { requestComposerFocus, requestComposerInsert, requestComposerSubmit } from '@/app/chat/composer/focus'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import {
  $pendingArtifactComments,
  addPendingArtifactComment,
  ARTIFACT_BRIDGE_TAG,
  artifactCommentsPrompt,
  type ArtifactSelection,
  clearPendingArtifactComments,
  newArtifactBridgeNonce,
  type PendingArtifactComment,
  readArtifactBridgeMessage,
  removePendingArtifactComment,
  tidyQuote,
  withArtifactBridge
} from '@/lib/artifact-comments'
import { ArrowUp, MessageCircle, X } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { notify } from '@/store/notifications'

/** Stable empty list, so effects keyed on the queue don't re-run every render. */
const NO_COMMENTS: readonly PendingArtifactComment[] = []
const POPUP_WIDTH = 288
const POPUP_HEIGHT = 132
const GAP = 8

interface ArtifactCommentLayerProps {
  artifactId: string
  html: string
  newestVersion: number
  title: string
  version: number
}

/**
 * The rendered artifact plus highlight-to-comment: select text in the frame,
 * a small box pops up beside it, "Add" queues the comment (the passage stays
 * highlighted), and the tray at the bottom sends every queued comment to the
 * agent as one message.
 */
export function ArtifactCommentLayer({ artifactId, html, newestVersion, title, version }: ArtifactCommentLayerProps) {
  const { t } = useI18n()
  const copy = t.artifactPreview
  const frameRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pending = useStore($pendingArtifactComments)[artifactId] ?? NO_COMMENTS
  const [selection, setSelection] = useState<ArtifactSelection | null>(null)
  const [note, setNote] = useState('')
  const [frameReady, setFrameReady] = useState(false)

  // One nonce per rendered document: the frame only reports, and only obeys,
  // messages carrying it. Same html → same srcDoc → the frame doesn't reload.
  const { nonce, srcDoc } = useMemo(() => {
    const fresh = newArtifactBridgeNonce()

    return { nonce: fresh, srcDoc: withArtifactBridge(html, fresh) }
  }, [html])

  const postToFrame = useCallback(
    (message: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage({ ...message, [ARTIFACT_BRIDGE_TAG]: nonce }, '*')
    },
    [nonce]
  )

  useEffect(() => {
    setFrameReady(false)
    setSelection(null)
    setNote('')
  }, [srcDoc])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) {
        return
      }

      const message = readArtifactBridgeMessage(event.data, nonce)

      if (!message) {
        return
      }

      if (message.type === 'ready') {
        setFrameReady(true)

        return
      }

      const quote = message.text

      if (!quote.trim() || !message.rect) {
        // A click elsewhere in the artifact clears the selection; keep a
        // half-written note's box open only while there is text to anchor it.
        setSelection(current => (current && note.trim() ? current : null))

        return
      }

      setSelection({ end: message.end, quote, rect: message.rect, start: message.start })
    }

    window.addEventListener('message', onMessage)

    return () => window.removeEventListener('message', onMessage)
  }, [nonce, note])

  // Paint queued comments as highlights whenever they change or the frame (re)loads.
  useEffect(() => {
    if (frameReady) {
      postToFrame({
        items: pending.map(comment => ({ end: comment.end, start: comment.start, text: comment.quote })),
        type: 'highlights'
      })
    }
  }, [frameReady, pending, postToFrame])

  useEffect(() => {
    if (selection) {
      textareaRef.current?.focus({ preventScroll: true })
    }
  }, [selection])

  const dismiss = useCallback(() => {
    setSelection(null)
    setNote('')
    postToFrame({ type: 'clear-selection' })
  }, [postToFrame])

  const add = useCallback(() => {
    if (!selection || !note.trim()) {
      return
    }

    addPendingArtifactComment(artifactId, {
      end: selection.end,
      note,
      quote: selection.quote,
      start: selection.start,
      version
    })
    dismiss()
  }, [artifactId, dismiss, note, selection, version])

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

  const popup = selection ? popupPosition(selection, containerRef.current) : null

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1" ref={containerRef}>
        <iframe
          className="block size-full border-0"
          ref={frameRef}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          title={title}
        />

        {selection && popup && (
          <div
            className="absolute z-20 flex flex-col gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-md"
            data-testid="artifact-comment-popup"
            style={{ left: popup.left, top: popup.top, width: POPUP_WIDTH }}
          >
            <div className="truncate text-[0.625rem] text-muted-foreground" title={selection.quote}>
              “{tidyQuote(selection.quote)}”
            </div>
            <textarea
              aria-label={copy.commentPlaceholder}
              className="min-h-14 w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs outline-none focus:border-(--ui-stroke-secondary)"
              onChange={event => setNote(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  dismiss()
                } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !event.shiftKey)) {
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
                  <div className={cn('whitespace-pre-wrap wrap-anywhere')}>{comment.note}</div>
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

/** Below the selection when it fits, above it otherwise; clamped inside the pane. */
function popupPosition(selection: ArtifactSelection, container: HTMLElement | null) {
  const width = container?.clientWidth || 640
  const height = container?.clientHeight || 480
  const left = Math.max(GAP, Math.min(selection.rect.left, width - POPUP_WIDTH - GAP))
  const below = selection.rect.bottom + GAP
  const top = below + POPUP_HEIGHT <= height ? below : Math.max(GAP, selection.rect.top - POPUP_HEIGHT - GAP)

  return { left, top }
}
