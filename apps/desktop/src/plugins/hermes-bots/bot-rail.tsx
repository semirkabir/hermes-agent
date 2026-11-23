import { cn, host, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { avatarColor, botAppearance } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { BotHoverCard, hoverState, useHover } from './bot-hover'
import { $botChatFocused, $focusedBotOwner, $selectedRosterKey, focusedRosterOwner } from './bot-state'
import { $botMeta, $lastRoster, botRosterKey, useRoster } from './data'
import { $groupChatWorkspace } from './group-chat'
import { $activeGroupMemberKeys } from './group-presence'
import { isBotHidden } from './hidden-bots'
import { displayName } from './labels'
import { LiveBotFace } from './live-face'
import { useAvatarState } from './motion-state'
import { openRosterBot } from './roster-actions'
import { sortRosterBots } from './roster-pane-derivation'
import { botRosterMeta } from './routing'
import { botRowOwnsWorkspace, botWorkingMood, useTurnBusy } from './row-helpers'
import type { RosterRow } from './types'

/** Rail width while the sidebar zone is collapsed: room for a 28px face plus
 *  its focus ring, instead of the 28px text-only strip. */
export const BOT_RAIL_WIDTH = '2.75rem'

/**
 * The Bots pane's collapsed form: one avatar per visible bot, newest activity
 * first — the roster without the text. Clicking a face opens that bot's chat
 * (⌘/⌃-click stacks it as a tab), the same exact-owner path as a roster row.
 * Rendered by the zone's collapsed rail in place of the vertical BOTS label.
 */
export function BotsRail() {
  const { data } = useRoster()
  const allMeta = useValue($botMeta)
  const live = Array.isArray(data?.profiles) ? (data.profiles as RosterRow[]) : null
  const rows = live ?? $lastRoster.get()
  const bots = sortRosterBots(rows, allMeta).roster.filter(bot => !isBotHidden(bot, allMeta))

  if (bots.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col items-center gap-1.5 py-2" data-bot-rail>
      {bots.map(bot => (
        <BotRailFace bot={bot} key={botRosterKey(bot)} />
      ))}
    </div>
  )
}

function BotRailFace({ bot }: { bot: RosterRow }) {
  const allMeta = useValue($botMeta)
  const meta = botRosterMeta(bot, allMeta)
  const focusedOwner = focusedRosterOwner(useValue($focusedBotOwner))
  const selectedRosterKey = useValue($selectedRosterKey)
  const botChatFocused = useValue($botChatFocused)
  const activeGroup = useValue($groupChatWorkspace)
  const groupKeys = useValue($activeGroupMemberKeys)
  const turnBusy = useTurnBusy()
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()

  const { shape, color, image } = botAppearance(bot.name, meta)
  const photo = Boolean(image && !isBackfilledFacePng(image))
  const mood = botWorkingMood(bot, focusedOwner, turnBusy, activeConnectionId, Date.now(), groupKeys)
  const motion = useAvatarState(mood)
  const isActive = botRowOwnsWorkspace(bot, activeGroup, botChatFocused, focusedOwner, selectedRosterKey)
  const label = displayName(bot, meta)
  const { hovered, onPointerEnter, onPointerLeave } = useHover()
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)

  return (
    <>
      <button
        aria-label={label}
        aria-pressed={isActive}
        className={cn(
          'relative grid size-9 place-items-center rounded-lg outline-none transition-colors',
          'hover:bg-(--ui-control-hover-background) focus-visible:ring-1 focus-visible:ring-(--ui-stroke-secondary)',
          isActive && 'bg-(--ui-control-hover-background)'
        )}
        data-bot-rail-face={bot.name}
        onBlur={onPointerLeave}
        onClick={event => {
          // The rail sits inside the collapsed zone, whose own click restores
          // the sidebar. Opening a bot must not also unfold it.
          event.stopPropagation()
          void openRosterBot(bot, { intent: event.metaKey || event.ctrlKey ? 'tab' : 'in-place' })
        }}
        onFocus={onPointerEnter}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        ref={setAnchor}
        type="button"
      >
        <LiveBotFace
          color={avatarColor(color, bot.name)}
          image={photo ? image : null}
          mood={mood}
          name={bot.name}
          shape={shape}
          size={28}
          state={hoverState(motion, hovered)}
        />
        {mood !== 'idle' && (
          <span
            aria-hidden
            className="absolute right-0.5 top-0.5 size-2 rounded-full bg-(--ui-accent) ring-2 ring-(--ui-sidebar-surface-background)"
          />
        )}
      </button>
      <BotHoverCard anchor={anchor} bot={bot} open={hovered} />
    </>
  )
}
