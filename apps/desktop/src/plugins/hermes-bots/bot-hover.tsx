/**
 * Hovering a bot: its face reacts (a happy hop and wiggle while it is idle) and,
 * on the collapsed rail, a preview card opens beside it: a small face, the bot's
 * name and its last message, two lines at most.
 *
 * The card is portalled to <body> and placed from the trigger's rect, so the
 * narrow rail never squeezes it (the old tooltip wrapped one letter per line).
 */

import { useValue } from '@hermes/plugin-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { avatarColor, botAppearance } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { $botMeta, $lastRoster } from './data'
import { displayName, stripPreviewMarkdown } from './labels'
import { LiveBotFace } from './live-face'
import type { AvatarState } from './motion-engine'
import { botRosterMeta } from './routing'
import { A2A_PREFIX_RE, previewKind } from './row-helpers'
import type { RosterRow } from './types'

/** What the face plays while hovered: a greeting when idle, its work otherwise. */
export function hoverState(base: AvatarState, hovered: boolean): AvatarState {
  return hovered && base === 'idle' ? 'greet' : base
}

/** Hover flag with a short grace on leave so a pass across the row does not flicker. */
export function useHover(delayOutMs = 120) {
  const [hovered, setHovered] = useState(false)
  const timer = useRef<number | null>(null)

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  useEffect(() => clear, [])

  const onPointerEnter = useCallback(() => {
    clear()
    setHovered(true)
  }, [])

  const onPointerLeave = useCallback(() => {
    clear()
    timer.current = window.setTimeout(() => setHovered(false), delayOutMs)
  }, [delayOutMs])

  return { hovered, onPointerEnter, onPointerLeave }
}

/** The line a hover card shows: the last message of the chat a click opens. */
export function botPreviewText(bot: RosterRow): string {
  const session = bot.canonical_session || bot.last_session
  const raw = session?.preview || ''
  const { fromBot } = previewKind(raw, $lastRoster.get(), bot.connectionId)
  const text = fromBot ? raw.replace(A2A_PREFIX_RE, '').trim() : raw

  return stripPreviewMarkdown(text).trim()
}

export function BotHoverCard({ bot, anchor, open }: { bot: RosterRow; anchor: HTMLElement | null; open: boolean }) {
  const meta = botRosterMeta(bot, useValue($botMeta))
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    setRect(open && anchor ? anchor.getBoundingClientRect() : null)
  }, [anchor, open])

  if (!open || !rect || typeof document === 'undefined') {
    return null
  }

  const { shape, color, image } = botAppearance(bot.name, meta)
  const photo = Boolean(image && !isBackfilledFacePng(image))
  const preview = botPreviewText(bot)
  const top = Math.max(8, Math.min(rect.top - 4, window.innerHeight - 96))

  return createPortal(
    <div
      className="pointer-events-none fixed z-[60] w-[19rem] rounded-2xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary,#1f1f22) px-3.5 py-2.5 shadow-xl"
      data-bot-hover-card={bot.name}
      role="tooltip"
      style={{ left: rect.right + 10, top }}
    >
      <div className="flex items-center gap-2">
        <LiveBotFace
          color={avatarColor(color, bot.name)}
          image={photo ? image : null}
          name={bot.name}
          shape={shape}
          size={18}
          state="idle"
        />
        <span className="truncate text-[15px] font-medium">{displayName(bot, meta)}</span>
      </div>
      {preview ? (
        <p className="mt-1 line-clamp-2 text-[14px] leading-5 text-(--ui-text-tertiary)">{preview}</p>
      ) : (
        <p className="mt-1 text-[13px] text-(--ui-text-quaternary)">No messages yet</p>
      )}
    </div>,
    document.body
  )
}
