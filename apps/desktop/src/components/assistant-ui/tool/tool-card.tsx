'use client'

import { useStore } from '@nanostores/react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import {
  createContext,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { FileTypeIcon } from '@/components/ui/file-type-icon'
import { ToolIcon } from '@/components/ui/tool-icon'
import { useI18n } from '@/i18n'
import { AlertCircle, Check, ChevronDown, Clock } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { claimInlineApproval } from '@/store/approval-host'
import { sessionApprovalRequests, sessionApprovalStackSize } from '@/store/prompts'
import { $toolCardsExpandLive } from '@/store/tool-call-style'
import { setToolDisclosureOpen } from '@/store/tool-view'

import { InlineApprovalRow } from './approval'
import { isApprovalActivity } from './approval-activity'
import { buildToolView, isFileEditTool, toolIconName, type ToolPart, toolPreviewOutcome } from './fallback-model'
import { cardRowsOpen, formatCardDuration, pickTickerLead, runWallSeconds, tickerWait } from './tool-card-model'

/**
 * The tool card: one header line over a run of tool calls. The rows inside it
 * are the same `ToolEntry` rows the compact style draws, told by this context
 * to wear the card's row chrome. Their titles, details and expanded bodies are
 * the existing machinery.
 */
export interface ToolCardRowScope {
  /** The pending call the inline approval row stands in for; that row steps aside until answered. */
  approvalCallId?: string
}

export const ToolCardRowContext = createContext<null | ToolCardRowScope>(null)

const MAX_STACK_ICONS = 5

/** 12px ring spinner, 1.5px stroke, 0.8s linear; still under reduced motion. */
export function CardSpinner({ label }: { label?: string }) {
  return (
    <svg
      aria-label={label}
      className="size-3 shrink-0 animate-spin text-(--ui-text-tertiary) [animation-duration:0.8s] motion-reduce:animate-none"
      data-slot="tool-card-spinner"
      fill="none"
      role={label ? 'img' : undefined}
      viewBox="0 0 12 12"
    >
      <circle cx="6" cy="6" opacity="0.25" r="5.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 0.75a5.25 5.25 0 0 1 5.25 5.25" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

/** The leading glyph of a row and of the header stack: file type for a path, else the tool's own icon. */
export function CardToolGlyph({ filePath, icon, size = '1rem' }: { filePath?: string; icon?: string; size?: string }) {
  if (filePath) {
    return <FileTypeIcon className="text-(--ui-text-secondary)" path={filePath} size={size} />
  }

  return <ToolIcon className="text-(--ui-text-secondary)" name={icon || 'tools'} size={size} />
}

// The live ticker's roll: out the top, in from below, together.
const TICKER_EASE = [0.2, 0.8, 0.2, 1] as const

function tickerMotion(reduced: boolean | null) {
  return reduced
    ? {
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        initial: { opacity: 0 },
        transition: { duration: 0.15, ease: 'easeInOut' as const }
      }
    : {
        animate: { filter: 'blur(0px)', opacity: 1, y: '0%' },
        exit: { filter: 'blur(2px)', opacity: 0, y: '-100%' },
        initial: { filter: 'blur(2px)', opacity: 0, y: '100%' },
        transition: { duration: 0.22, ease: TICKER_EASE }
      }
}

/**
 * 16px icons in 20px circles ringed in the card fill, overlapped by 6px, max 5 then "+N".
 * `lead` is the running call's icon while the ticker runs: it takes the front badge and rolls in
 * with the label.
 */
export function IconStack({ icons, lead }: { icons: readonly string[]; lead?: string }) {
  const reduced = useReducedMotion()
  const ordered = lead ? [lead, ...icons.filter(icon => icon !== lead)] : icons
  const shown = ordered.slice(0, MAX_STACK_ICONS)
  const extra = ordered.length - shown.length

  return (
    <span aria-hidden className="flex shrink-0 items-center" data-slot="tool-card-icons">
      {shown.map((icon, index) => (
        <span
          className={cn(
            'relative flex size-3.5 items-center justify-center overflow-hidden rounded-full bg-(--tool-card-icon-fill) shadow-[0_0_0_1.5px_var(--tool-card-ring)]',
            index > 0 && '-ml-1'
          )}
          data-tool-card-lead={lead && index === 0 ? icon : undefined}
          key={lead && index === 0 ? 'lead' : icon}
          style={{ zIndex: MAX_STACK_ICONS - index } as CSSProperties}
        >
          {lead && index === 0 ? (
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span className="flex items-center justify-center" key={icon} {...tickerMotion(reduced)}>
                <ToolIcon className="text-(--ui-text-secondary)" name={icon} size="0.5625rem" />
              </motion.span>
            </AnimatePresence>
          ) : (
            <ToolIcon className="text-(--ui-text-secondary)" name={icon} size="0.5625rem" />
          )}
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-(--tool-card-icon-fill) px-1 text-[0.5rem] font-medium tabular-nums text-(--ui-text-secondary) shadow-[0_0_0_1.5px_var(--tool-card-ring)]">
          +{extra}
        </span>
      )}
    </span>
  )
}

/** Title tense change: a 150ms cross-fade, skipped on first paint and under reduced motion. */
function CrossFadeText({ className, text }: { className?: string; text: string }) {
  const reduced = useReducedMotion()
  const first = useRef(text)
  const animate = !reduced && text !== first.current

  return (
    <motion.span
      animate={{ opacity: 1 }}
      className={className}
      initial={animate ? { opacity: 0 } : false}
      key={text}
      transition={{ duration: 0.15, ease: 'easeInOut' }}
    >
      {text}
    </motion.span>
  )
}

export interface ToolCardRowHeaderProps {
  done: boolean
  expandable: boolean
  failed: boolean
  filePath?: string
  icon?: string
  meta: string
  onToggle: () => void
  open: boolean
  pending: boolean
  /** A running row's live meta (MCP progress, timer), from the compact row's own renderer. */
  runningMeta?: ReactNode
  status: 'error' | 'notice' | 'running' | 'success' | 'unavailable' | 'warning'
  subtext?: string
  title: string
}

/** One row's line inside the card: glyph, present/past title, metadata, status mark. */
export function ToolCardRowHeader({
  done,
  expandable,
  failed,
  filePath,
  icon,
  meta,
  onToggle,
  open,
  pending,
  runningMeta,
  status,
  subtext,
  title
}: ToolCardRowHeaderProps) {
  const { t } = useI18n()

  const mark = pending ? (
    <CardSpinner label={t.assistant.tool.statusRunning} />
  ) : failed ? (
    <AlertCircle aria-label={t.assistant.tool.statusError} className="size-3.5 shrink-0 text-destructive" />
  ) : status === 'warning' ? (
    <AlertCircle
      aria-label={t.assistant.tool.statusRecovered}
      className="size-3.5 shrink-0 text-(--tool-card-warning)"
    />
  ) : status === 'unavailable' ? null : (
    <Check
      aria-label={t.assistant.tool.statusDone}
      className={cn(
        'size-3 shrink-0',
        status === 'notice' ? 'text-(--ui-text-tertiary)' : 'text-(--tool-card-success)'
      )}
      data-slot="tool-card-check"
      strokeWidth={2.5}
    />
  )

  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-md py-1.5 transition-colors',
        failed && 'bg-(--tool-card-failed-tint)'
      )}
      data-slot="tool-card-row"
      data-tool-card-row-state={pending ? 'running' : failed ? 'failed' : 'done'}
    >
      <button
        aria-expanded={expandable ? open : undefined}
        className={cn(
          'group/card-row flex min-w-0 flex-1 items-start gap-2.5 text-left',
          expandable ? 'cursor-pointer' : 'cursor-default'
        )}
        disabled={!expandable}
        onClick={onToggle}
        type="button"
      >
        <span className="flex h-[18px] w-4 shrink-0 items-center justify-center">
          <CardToolGlyph filePath={filePath} icon={icon} size="0.75rem" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <CrossFadeText
            className="block min-w-0 truncate text-[length:var(--tool-card-text)] leading-[18px] text-(--ui-text-secondary) group-hover/card-row:text-(--ui-text-primary)"
            text={title}
          />
          {subtext && (
            <span
              className="block min-w-0 truncate text-xs leading-4 text-(--tool-card-error-text)"
              data-slot="tool-card-row-error"
              title={subtext}
            >
              {subtext}
            </span>
          )}
        </span>
      </button>
      <span className="flex h-[18px] shrink-0 items-center gap-2">
        {pending && runningMeta}
        {done && meta && (
          <span
            className="text-[length:var(--tool-card-meta)] tabular-nums text-(--ui-text-tertiary)"
            data-slot="tool-card-row-meta"
          >
            {meta}
          </span>
        )}
        {mark}
        {expandable && (
          <ChevronDown
            aria-hidden
            className={cn('size-3 shrink-0 text-(--ui-text-tertiary) transition-transform', open && 'rotate-180')}
          />
        )}
      </span>
    </div>
  )
}

/**
 * A row's outer box inside the card. A row that arrives while the turn streams
 * slides in (height 0 -> auto, opacity 0 -> 1, 220ms); history paints still.
 */
export function ToolCardRowFrame({
  animateIn,
  children,
  ...data
}: {
  animateIn: boolean
  children: ReactNode
  'data-file-edit'?: string
  'data-tool-open'?: string
}) {
  const reduced = useReducedMotion()
  const [enter] = useState(() => animateIn && !reduced)

  return (
    <motion.div
      animate={{ height: 'auto', opacity: 1 }}
      className="min-w-0 max-w-full overflow-hidden"
      data-slot="tool-block"
      data-tool-row=""
      initial={enter ? { height: 0, opacity: 0 } : false}
      transition={{ duration: 0.22, ease: 'easeInOut' }}
      {...data}
    >
      {children}
    </motion.div>
  )
}

/** One label the header can show. Same key = same line (text may update in place, no roll). */
interface TickerLabel {
  icon?: string
  key: string
  text: string
  /** Shows at once instead of waiting out the current label's dwell (an approval). */
  urgent?: boolean
}

/**
 * The header's dwell rule: a label stays up at least TICKER_DWELL_MS;
 * a newer one waits, and when the wait ends only the LATEST wanted label shows,
 * so a burst of fast calls never replays as a backlog. `want` null is a gap
 * between two calls: a call's label stays up, anything else gives way to
 * `fallback`. Each change re-arms the timer with the newest label, which is
 * what makes it "latest wins" without a ref.
 */
function useTickerDwell(wanted: null | TickerLabel, fallback: TickerLabel): TickerLabel {
  // The label on screen and when it went up, swapped together.
  const [current, setCurrent] = useState(() => ({
    at: typeof performance === 'undefined' ? 0 : performance.now(),
    label: wanted ?? fallback
  }))

  const shown = current.label
  const want = wanted ?? (shown.key.startsWith('call:') ? null : fallback)

  useEffect(() => {
    if (!want) {
      return
    }

    if (want.key === shown.key) {
      if (want.text !== shown.text || want.icon !== shown.icon) {
        setCurrent(previous => ({ ...previous, label: want }))
      }

      return
    }

    const swap = () => setCurrent({ at: performance.now(), label: want })
    const wait = want.urgent ? 0 : tickerWait(current.at, performance.now())

    if (wait <= 0) {
      swap()

      return
    }

    const timer = window.setTimeout(swap, wait)

    return () => window.clearTimeout(timer)
  }, [current.at, shown, want])

  return shown
}

/** One header line; while it rolls out it stops answering to the label slot. */
function TickerLine({
  approval,
  label,
  reduced,
  shimmer,
  total
}: {
  approval: boolean
  label: string
  reduced: boolean | null
  shimmer: boolean
  total?: string
}) {
  const present = useIsPresent()

  return (
    <motion.span
      className={cn('flex min-w-0 items-center gap-1.5', !present && 'pointer-events-none')}
      data-slot={present ? 'tool-card-line' : 'tool-card-line-exit'}
      {...tickerMotion(reduced)}
    >
      {approval && <Clock aria-hidden className="size-3 shrink-0 text-(--tool-card-warning)" />}
      <span
        className={cn(
          'min-w-0 truncate',
          approval
            ? 'text-(--tool-card-warning)'
            : 'text-(--ui-text-secondary) group-hover/card-head:text-(--ui-text-primary)',
          shimmer && 'shimmer'
        )}
        data-slot={present ? 'tool-card-label' : 'tool-card-label-exit'}
      >
        {label}
      </span>
      {total && (
        <span
          className="shrink-0 text-[length:var(--tool-card-meta)] font-normal tabular-nums text-(--ui-text-tertiary)"
          data-slot={present ? 'tool-card-total' : 'tool-card-total-exit'}
        >
          · {total}
        </span>
      )}
    </motion.span>
  )
}

type CardState = 'approval' | 'live' | 'settled'

/**
 * The live ticker: the newest running call's own present-tense title, held for
 * the dwell; the approval and settled copy otherwise.
 */
function useCardTicker(run: ToolCardRun, state: CardState) {
  const { t } = useI18n()
  const copy = t.assistant.tool.card
  const { extra: runningExtra, lead } = useMemo(() => pickTickerLead(run.tools, run.live), [run.tools, run.live])

  const leadTitle = useMemo(
    () => (lead ? buildToolView({ ...lead, completedAt: undefined, result: undefined }, '').title : ''),
    [lead]
  )

  const want = useMemo<null | TickerLabel>(() => {
    if (state === 'approval') {
      return { key: 'approval', text: copy.waitingApproval, urgent: true }
    }

    if (state === 'settled') {
      return { key: 'settled', text: copy.used(run.count) }
    }

    if (lead) {
      return {
        icon: toolIconName(lead.toolName) || 'tools',
        key: `call:${lead.toolCallId ?? lead.toolName}:${lead.timestamp ?? ''}`,
        text: leadTitle
      }
    }

    // A gap between two calls keeps the last one up instead of flashing a count.
    return null
  }, [copy, lead, leadTitle, run.count, state])

  const usingLabel = useMemo<TickerLabel>(() => ({ key: 'using', text: copy.using(run.count) }), [copy, run.count])
  const shown = useTickerDwell(want, usingLabel)

  return { runningExtra, shown, shownLive: shown.key !== 'approval' && shown.key !== 'settled' }
}

interface ToolCardHeaderProps {
  expanded: boolean
  failedCount: number
  icons: readonly string[]
  onToggle: () => void
  runningExtra: number
  shown: TickerLabel
  shownLive: boolean
  state: CardState
  wall: string
}

/** The card's one line: icon stack, ticker, "+N" running beside it, the failed pill, the chevron. */
function ToolCardHeader({
  expanded,
  failedCount,
  icons,
  onToggle,
  runningExtra,
  shown,
  shownLive,
  state,
  wall
}: ToolCardHeaderProps) {
  const { t } = useI18n()
  const copy = t.assistant.tool.card
  const reduced = useReducedMotion()

  return (
    <button
      aria-expanded={expanded}
      className="group/card-head flex w-fit min-w-0 max-w-full items-center gap-2 py-1 text-left"
      data-slot="tool-card-header"
      onClick={onToggle}
      type="button"
    >
      <IconStack icons={icons} lead={shownLive ? shown.icon : undefined} />
      <span
        aria-live="polite"
        className="relative flex h-[18px] min-w-0 shrink items-center overflow-hidden text-[length:var(--tool-card-text)] font-normal leading-[18px]"
        data-slot="tool-card-ticker"
      >
        <AnimatePresence initial={false} mode="popLayout">
          <TickerLine
            approval={shown.key === 'approval'}
            key={shown.key}
            label={shown.text}
            reduced={reduced}
            shimmer={shownLive && state === 'live'}
            total={shown.key === 'settled' && wall ? wall : undefined}
          />
        </AnimatePresence>
      </span>
      {state === 'live' && shownLive && runningExtra > 0 && (
        <span
          className="shrink-0 rounded-full bg-(--tool-card-icon-fill) px-1.5 py-px text-[10px] font-semibold leading-[14px] tabular-nums text-(--ui-text-tertiary)"
          data-slot="tool-card-running-extra"
        >
          +{runningExtra}
        </span>
      )}
      {failedCount > 0 && (
        <span
          className="shrink-0 rounded-full bg-(--tool-card-failed-pill) px-1.5 py-px text-[10px] font-semibold leading-[14px] text-destructive"
          data-slot="tool-card-failed"
        >
          {copy.failedCount(failedCount)}
        </span>
      )}
      <ChevronDown
        aria-hidden
        className={cn(
          'size-3 shrink-0 text-(--ui-text-tertiary) transition-transform duration-200',
          expanded && 'rotate-180'
        )}
      />
    </button>
  )
}

export interface ToolCardRun {
  count: number
  entryIds: readonly string[]
  key: string
  live: boolean
  tools: readonly ToolPart[]
}

/**
 * The card frame around one run. Header: icon stack, live/settled copy, the
 * failed pill, the amber approval state. Body: the run's rows, the inline
 * approval when the pending decision belongs to this live run.
 */
export function ToolCard({
  children,
  currentTurn,
  disclosureId,
  enterRef,
  persistedOpen,
  rowOpen,
  run
}: {
  children: ReactNode
  currentTurn: boolean
  disclosureId: string
  enterRef?: (el: HTMLElement | null) => void
  persistedOpen: boolean | undefined
  rowOpen: boolean
  run: ToolCardRun
}) {
  const reduced = useReducedMotion()
  const sessionView = useSessionView()
  const runtimeId = useStore(sessionView.$runtimeId)
  const expandLive = useStore($toolCardsExpandLive)
  const approvals = useStore(useMemo(() => sessionApprovalRequests(runtimeId), [runtimeId]))
  const approvalTotal = useStore(useMemo(() => sessionApprovalStackSize(runtimeId), [runtimeId]))

  const icons = useMemo(() => {
    const seen: string[] = []

    for (const tool of run.tools) {
      const icon = toolIconName(tool.toolName) || 'tools'

      if (!seen.includes(icon)) {
        seen.push(icon)
      }
    }

    return seen
  }, [run.tools])

  const failedCount = useMemo(
    () => run.tools.filter(tool => toolPreviewOutcome(tool).status === 'error').length,
    [run.tools]
  )

  const live = run.live
  const request = approvals[0]
  // The pending decision belongs to the run the agent is in: this card, live, in the current turn.
  const hostsApproval = Boolean(request && runtimeId && currentTurn && run.live)

  useLayoutEffect(() => {
    if (!hostsApproval || !runtimeId) {
      return
    }

    return claimInlineApproval(runtimeId, disclosureId)
  }, [disclosureId, hostsApproval, runtimeId])

  // A lone edit's diff is the deliverable, so it stays on screen as it does in the compact style.
  const loneEdit = run.count === 1 && isFileEditTool(run.tools[0]?.toolName ?? '')

  // Closed by default, live or not: the header's ticker says what is running.
  const expanded = cardRowsOpen({ expandLive, live, loneEdit, persistedOpen, rowOpen })
  const wall = useMemo(() => formatCardDuration(runWallSeconds(run.tools)), [run.tools])

  const state: CardState = hostsApproval ? 'approval' : live ? 'live' : 'settled'

  const { runningExtra, shown, shownLive } = useCardTicker(run, state)

  // The decision is about the run's newest unresolved command; the approval row takes its place.
  const approvalCallId = hostsApproval
    ? run.tools.findLast(tool => tool.result === undefined && isApprovalActivity(tool))?.toolCallId
    : undefined

  const scope = useMemo<ToolCardRowScope>(() => ({ approvalCallId }), [approvalCallId])

  return (
    <div className="min-w-0 max-w-full" data-slot="tool-block" data-tool-card="" data-tool-group="" ref={enterRef}>
      <div className="tool-card min-w-0 max-w-full" data-tool-card-state={state}>
        <ToolCardHeader
          expanded={expanded}
          failedCount={failedCount}
          icons={icons}
          onToggle={() => setToolDisclosureOpen(disclosureId, !expanded)}
          runningExtra={runningExtra}
          shown={shown}
          shownLive={shownLive}
          state={state}
          wall={wall}
        />
        <AnimatePresence initial={false}>
          {(expanded || hostsApproval) && (
            <motion.div
              animate={{ height: 'auto', opacity: 1 }}
              className="overflow-hidden"
              data-slot="tool-card-body"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              key="rows"
              transition={{ duration: reduced ? 0 : 0.26, ease: 'easeInOut' }}
            >
              <div className="pt-0.5">
                {expanded && <ToolCardRowContext.Provider value={scope}>{children}</ToolCardRowContext.Provider>}
                {hostsApproval && request && (
                  <motion.div
                    animate={{ height: 'auto', opacity: 1 }}
                    className="overflow-hidden"
                    initial={reduced ? false : { height: 0, opacity: 0 }}
                    transition={{ duration: reduced ? 0 : 0.22, ease: 'easeInOut' }}
                  >
                    <InlineApprovalRow
                      position={approvalTotal - approvals.length + 1}
                      request={request}
                      total={approvalTotal}
                    />
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {!expanded && live && (
          // Closed while live: the rows stay mounted out of sight so their side effects (a previewable
          // artifact surfacing in the composer) still run, exactly as when the card was open.
          <div aria-hidden className="hidden" data-slot="tool-card-offstage" inert>
            <ToolCardRowContext.Provider value={scope}>{children}</ToolCardRowContext.Provider>
          </div>
        )}
      </div>
    </div>
  )
}
