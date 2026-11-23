'use client'

import { useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createContext, type FC, useCallback, useContext, useMemo, useRef, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { SCAFFOLD_LABEL_CLASS, ScaffoldRow } from '@/components/chat/scaffold-row'
import { Button } from '@/components/ui/button'
import { CardStack, type CardStackAction } from '@/components/ui/card-stack'
import { Codicon } from '@/components/ui/codicon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { ChevronDown, Loader2, ShieldCheck } from '@/lib/icons'
import { releaseApprovalKey } from '@/lib/keybinds/approval-keys'
import { cn } from '@/lib/utils'
import { $approvalHostedInline } from '@/store/approval-host'
import { $gateway } from '@/store/gateway'
import { reconnectAction } from '@/store/gateway-reconnect'
import { notifyError } from '@/store/notifications'
import {
  answerApproval,
  type ApprovalRequest,
  clearApprovalRequest,
  replayPendingApproval,
  sessionApprovalRequests,
  sessionApprovalStackSize
} from '@/store/prompts'
import { $showToolActivity } from '@/store/tool-activity'
import { setToolDisclosureOpen } from '@/store/tool-view'

import { isApprovalActivity } from './approval-activity'
import { toolEntryDisclosureId } from './fallback-model/targets'
import { isToolCallPart, summarizeToolRun } from './run-summary'

type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'
export const ApprovalPlacementContext = createContext<'inline' | 'floating'>('inline')
const NO_REQUESTS: ApprovalRequest[] = []

// One transcript-owned host for the session. Execution rows never mount,
// register or re-home this queue, including the first delayed tool.start.
export const PendingApprovalStack: FC = () => {
  const { t } = useI18n()
  const placement = useContext(ApprovalPlacementContext)
  const sessionId = useStore(useSessionView().$runtimeId)
  const queued = useStore(useMemo(() => sessionApprovalRequests(sessionId), [sessionId]))
  const total = useStore(useMemo(() => sessionApprovalStackSize(sessionId), [sessionId]))
  // A live tool card is showing this decision inside its run; asking twice
  // would split one answer across two surfaces.
  const hostedInline = useStore(useMemo(() => $approvalHostedInline(sessionId), [sessionId]))
  const requests = hostedInline ? NO_REQUESTS : queued
  const reduced = useReducedMotion()

  return (
    <motion.section
      animate={{ paddingBlock: requests.length ? 8 : 0 }}
      aria-label={t.assistant.approval.jumpToApproval}
      className={cn(
        'min-w-0',
        placement === 'floating' ? 'sticky bottom-4 z-10 mt-auto w-full max-w-xl self-center' : 'w-full max-w-xl'
      )}
      data-approval-placement={placement}
      data-approval-stack=""
      data-session-id={sessionId ?? undefined}
      data-slot="tool-approval-stack"
      initial={false}
      transition={reduced || requests.length ? { duration: 0 } : { duration: 0.22, ease: 'easeInOut' }}
    >
      <ApprovalActivity floating={placement === 'floating'} visible={requests.length > 0} />
      <ApprovalQueue floating={placement === 'floating'} requests={requests} total={total} />
    </motion.section>
  )
}

function ApprovalActivity({ floating, visible }: { floating: boolean; visible: boolean }) {
  const { t } = useI18n()
  const reduced = useReducedMotion()
  const showToolActivity = useStore($showToolActivity)

  const summary = useAuiState(state => {
    if (!visible) {
      return ''
    }

    const start = state.thread.messages.findLastIndex(message => message.role === 'user')

    const tools = state.thread.messages
      .slice(start + 1)
      .filter(message => message.role === 'assistant')
      .flatMap(message => message.content.filter(isToolCallPart).filter(isApprovalActivity))

    return tools.length
      ? summarizeToolRun(
          tools,
          tools.some(tool => tool.result === undefined)
        )
      : ''
  })

  const disclosureIds = useAuiState(state => {
    if (!visible) {
      return ''
    }

    const start = state.thread.messages.findLastIndex(message => message.role === 'user')

    return state.thread.messages
      .slice(start + 1)
      .filter(message => message.role === 'assistant')
      .flatMap(message =>
        message.content
          .filter(isToolCallPart)
          .filter(isApprovalActivity)
          .map(tool => toolEntryDisclosureId(message.id, tool))
      )
      .join('\n')
  })

  // The pending approval stays. The run summary beside it is tool feed and
  // follows display.tool_progress alongside the other process rows.
  if (!showToolActivity) {
    return null
  }

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          animate={{ height: 'auto', opacity: 1 }}
          className="overflow-hidden"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          key="activity"
          transition={{ duration: reduced ? 0 : 0.22, ease: 'easeInOut' }}
        >
          <div
            className={cn('mb-1 min-w-0', floating && 'rounded bg-(--ui-chat-surface-background)')}
            data-approval-activity=""
            data-glass-opaque={floating ? '' : undefined}
            data-tool-summary=""
          >
            <ScaffoldRow
              onToggle={
                disclosureIds
                  ? () => {
                      for (const id of disclosureIds.split('\n')) {
                        setToolDisclosureOpen(id, true)
                      }
                    }
                  : undefined
              }
              open={false}
            >
              <span className={cn(SCAFFOLD_LABEL_CLASS, 'truncate')}>
                {summary || t.assistant.approval.jumpToApproval}
              </span>
            </ScaffoldRow>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

async function sendApproval(request: ApprovalRequest, choice: ApprovalChoice) {
  const gateway = $gateway.get()

  if (!gateway) {
    throw new Error('Gateway disconnected')
  }

  if (
    !sessionApprovalRequests(request.sessionId)
      .get()
      .some(item => item.requestId === request.requestId)
  ) {
    return
  }

  await answerApproval(gateway, request, choice)
  triggerHaptic(choice === 'deny' ? 'cancel' : 'submit')
  clearApprovalRequest(request.sessionId, request.requestId)
  void replayPendingApproval(gateway, request.sessionId).catch(() => undefined)
}

export function ApprovalQueue({
  requests,
  total,
  floating = false
}: {
  requests: ApprovalRequest[]
  total: number
  floating?: boolean
}) {
  const { t } = useI18n()

  return (
    <CardStack
      getKey={request => request.requestId ?? 'legacy'}
      items={requests}
      onSwipe={(request, _side, action) => {
        void action
          .depart(() => sendApproval(request, 'deny'))
          .catch(error => {
            releaseApprovalKey()
            notifyError(error, t.assistant.approval.sendFailed)
          })
      }}
      surfaceClassName={cn(
        'rounded-xl border bg-(--ui-chat-surface-background)',
        floating ? 'border-(--stroke-nous) shadow-nous' : 'border-(--ui-stroke-secondary)'
      )}
      swipeDirections={['left']}
    >
      {(request, action) => (
        <ApprovalCard
          position={total - requests.length + requests.indexOf(request) + 1}
          request={request}
          stack={action}
          total={total}
        />
      )}
    </CardStack>
  )
}

interface ApprovalCardProps {
  request: ApprovalRequest
  total: number
  position: number
  stack: CardStackAction
}

const SYNTHETIC_COMMAND_RE = /^<[^>]+> \(/

// What a request lets the user choose, and what it asks them to judge.
function approvalShape(request: ApprovalRequest) {
  // false when the backend won't honor a permanent allow → hide "Always allow".
  const allowPermanent = request.allowPermanent !== false
  const choices = request.choices ?? (request.smartDenied ? ['once', 'deny'] : undefined)
  const allowSession = choices ? choices.includes('session') : true
  const allowAlways = choices ? choices.includes('always') : allowPermanent
  const hasCommand = request.command.trim().length > 0
  // A plugin `approve` rule escalates through the same gate with a synthetic
  // display target (`<tool> (plugin approval rule)`) while the real command /
  // change lives in `description` — the user approves a label they cannot act
  // on otherwise. Show the description whenever the command is missing or one
  // of these synthetic labels; a real command keeps rendering as the command.
  const showsDescription = !hasCommand || SYNTHETIC_COMMAND_RE.test(request.command.trim())
  const details = showsDescription ? request.description.trim() : request.command.trim()

  return { allowAlways, allowSession, details, hasMoreOptions: allowSession || allowAlways, showsDescription }
}

/**
 * Answering a request: one reply in flight, focus handed back afterwards.
 * `depart` wraps the send (the stack animates its card out around it; the
 * inline row in a tool card just sends).
 */
function useApprovalResponder(
  request: ApprovalRequest,
  depart: (send: () => Promise<void>) => Promise<void>,
  hostRef: { current: HTMLElement | null }
) {
  const { t } = useI18n()
  const copy = t.assistant.approval
  const gateway = useStore($gateway)
  const [submitting, setSubmitting] = useState<ApprovalChoice | null>(null)
  const submittingRef = useRef(false)
  // Answering with the pointer moves focus onto the card, and the card then
  // unmounts, which parks focus on <body> — where type-to-focus routes the next
  // keystrokes into the chat composer. For a computer_use flow the agent may
  // have just aimed its input at another pane (terminal, preview), so the
  // approval hands focus back to whatever held it before the press (#113839).
  const focusOrigin = useRef<HTMLElement | null>(null)

  const rememberFocusOrigin = useCallback(() => {
    const active = document.activeElement

    if (active instanceof HTMLElement && active !== document.body && !hostRef.current?.contains(active)) {
      focusOrigin.current = active
    }
  }, [hostRef])

  const restoreFocusOrigin = useCallback(() => {
    const origin = focusOrigin.current
    const active = document.activeElement

    focusOrigin.current = null

    // Only when the answer itself is what stranded focus — never steal from a
    // surface the user moved to while the reply was in flight.
    if (origin?.isConnected && (!active || active === document.body || hostRef.current?.contains(active))) {
      origin.focus({ preventScroll: true })
    }
  }, [hostRef])

  const respond = useCallback(
    async (choice: ApprovalChoice) => {
      const pending = sessionApprovalRequests(request.sessionId).get()

      if (submittingRef.current || !pending.some(item => item.requestId === request.requestId)) {
        return
      }

      if (!gateway) {
        notifyError(new Error(copy.gatewayDisconnected), copy.sendFailed, { action: reconnectAction() })

        return
      }

      submittingRef.current = true
      setSubmitting(choice)

      try {
        await depart(() => sendApproval(request, choice))
        restoreFocusOrigin()
      } catch (error) {
        releaseApprovalKey()
        notifyError(error, copy.sendFailed)
        submittingRef.current = false
        setSubmitting(null)
      }
    },
    [copy.gatewayDisconnected, copy.sendFailed, depart, gateway, request, restoreFocusOrigin]
  )

  return { rememberFocusOrigin, respond, submitting }
}

// "Always allow" persists the pattern to ~/.hermes/config.yaml permanently, so
// it goes through a confirm step rather than firing straight from the menu.
function AlwaysAllowDialog({
  onConfirm,
  onOpenChange,
  open,
  request
}: {
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  request: ApprovalRequest
}) {
  const { t } = useI18n()
  const copy = t.assistant.approval

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.alwaysTitle}</DialogTitle>
          <DialogDescription>{copy.alwaysDescription(request.description)}</DialogDescription>
        </DialogHeader>

        {request.command.trim() && (
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-chat-surface-background) px-2.5 py-1.5 font-mono text-xs leading-snug text-foreground">
            {request.command.trim()}
          </pre>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} size="sm" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false)
              onConfirm()
            }}
            size="sm"
            variant="destructive"
          >
            {copy.alwaysAllow}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Defer one tick so the menu fully unmounts before the dialog mounts —
// otherwise Radix's focus-return races the dialog and dismisses it via
// onInteractOutside.
const openAfterMenu = (open: () => void) => setTimeout(open, 0)

const ApprovalCard: FC<ApprovalCardProps> = ({ request, total, position, stack }) => {
  const { t } = useI18n()
  const copy = t.assistant.approval
  const [confirmAlways, setConfirmAlways] = useState(false)
  const cardRef = useRef<HTMLElement | null>(null)
  const present = stack.active
  const { rememberFocusOrigin, respond, submitting } = useApprovalResponder(request, stack.depart, cardRef)
  const busy = submitting !== null || !present || stack.busy
  const { allowAlways, allowSession, details, hasMoreOptions, showsDescription } = approvalShape(request)

  return (
    <article
      aria-hidden={!present || undefined}
      className="min-w-0"
      data-request-id={request.requestId}
      data-slot="tool-approval-card"
      inert={!present}
      onPointerDownCapture={rememberFocusOrigin}
      ref={cardRef}
    >
      <div className="flex items-center gap-2 px-2.5 pt-2 text-xs text-(--ui-text-secondary)">
        <Codicon name="terminal" size="0.875rem" />
        <span>{showsDescription ? copy.commandDetails : copy.command}</span>
        {total > 1 && (
          <span className="ml-auto text-[0.6875rem] tabular-nums text-(--ui-text-tertiary)">
            {position} / {total}
          </span>
        )}
      </div>
      {details.length > 0 && (
        <pre className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-xs leading-relaxed text-(--ui-text-primary)">
          {details}
        </pre>
      )}
      <div className="flex items-center justify-end gap-1.5 px-2 pb-2 pt-1" data-slot="tool-approval-actions">
        <Button data-approval-deny="" disabled={busy} onClick={() => void respond('deny')} size="sm" variant="text">
          {submitting === 'deny' ? <Loader2 className="size-3 animate-spin" /> : copy.reject}
        </Button>
        {hasMoreOptions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={copy.moreOptions} disabled={busy} size="sm" variant="secondary">
                {copy.alwaysAllowMenu}
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {allowSession && (
                <DropdownMenuItem onSelect={() => void respond('session')}>{copy.allowSession}</DropdownMenuItem>
              )}
              {allowAlways && (
                <DropdownMenuItem onSelect={() => openAfterMenu(() => setConfirmAlways(true))}>
                  {copy.alwaysAllowMenu}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => void respond('deny')} variant="destructive">
                {copy.reject}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button data-approval-run="" disabled={busy} onClick={() => void respond('once')} size="sm">
          {submitting === 'once' ? <Loader2 className="size-3 animate-spin" /> : copy.run}
          <span className="opacity-60">↵</span>
        </Button>
      </div>

      <AlwaysAllowDialog
        onConfirm={() => void respond('always')}
        onOpenChange={setConfirmAlways}
        open={confirmAlways}
        request={request}
      />
    </article>
  )
}

const sendDirectly = (send: () => Promise<void>) => send()

/**
 * The pending approval as a row inside a live tool card.
 *
 * Same decision as the stack's card: Deny and Allow inline, and Allow for the
 * session / Always allow (with its confirm step) kept one click away in the
 * options menu, never removed. It carries the stack's data attributes, so the
 * approval keys (Enter runs, Escape denies) reach it exactly as they reach the
 * stack while the stack has stepped aside.
 */
export function InlineApprovalRow({
  position,
  request,
  total
}: {
  position: number
  request: ApprovalRequest
  total: number
}) {
  const { t } = useI18n()
  const copy = t.assistant.approval
  const cardCopy = t.assistant.tool.card
  const [confirmAlways, setConfirmAlways] = useState(false)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const { rememberFocusOrigin, respond, submitting } = useApprovalResponder(request, sendDirectly, rowRef)
  const busy = submitting !== null
  const { allowAlways, allowSession, details, hasMoreOptions, showsDescription } = approvalShape(request)
  const description = request.description.trim()

  const title = showsDescription
    ? request.command.trim() || copy.commandDetails
    : description
      ? description.charAt(0).toUpperCase() + description.slice(1)
      : copy.command

  return (
    <div
      className="min-w-0"
      data-approval-stack=""
      data-request-id={request.requestId}
      data-slot="tool-card-approval"
      onPointerDownCapture={rememberFocusOrigin}
      ref={rowRef}
    >
      <div className="flex min-w-0 items-start gap-2.5 px-3 py-2" data-stack-active="true">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center text-(--tool-card-warning)">
          <Codicon name="terminal" size="1rem" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-[13px] leading-5 text-(--ui-text-primary)">{title}</span>
            {total > 1 && (
              <span className="shrink-0 text-xs tabular-nums text-(--ui-text-tertiary)">
                {position} / {total}
              </span>
            )}
          </div>
          {details.length > 0 && details !== title && (
            <pre className="m-0 mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-snug text-(--ui-text-tertiary)">
              {details}
            </pre>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5" data-slot="tool-approval-actions">
          <Button
            className="h-7 rounded-lg px-2.5 text-xs"
            data-approval-deny=""
            disabled={busy}
            onClick={() => void respond('deny')}
            size="sm"
            variant="ghost"
          >
            {submitting === 'deny' ? <Loader2 className="size-3 animate-spin" /> : cardCopy.deny}
          </Button>
          {hasMoreOptions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={cardCopy.approvalOptions}
                  className="h-7 rounded-lg px-1.5"
                  disabled={busy}
                  size="sm"
                  variant="ghost"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                {allowSession && (
                  <DropdownMenuItem onSelect={() => void respond('session')}>{copy.allowSession}</DropdownMenuItem>
                )}
                {allowAlways && (
                  <DropdownMenuItem onSelect={() => openAfterMenu(() => setConfirmAlways(true))}>
                    {copy.alwaysAllowMenu}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => void respond('deny')} variant="destructive">
                  {copy.reject}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            className="h-7 gap-1 rounded-lg px-2.5 text-xs"
            data-approval-run=""
            disabled={busy}
            onClick={() => void respond('once')}
            size="sm"
          >
            {submitting === 'once' ? <Loader2 className="size-3 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            {cardCopy.allow}
          </Button>
        </div>
      </div>

      <AlwaysAllowDialog
        onConfirm={() => void respond('always')}
        onOpenChange={setConfirmAlways}
        open={confirmAlways}
        request={request}
      />
    </div>
  )
}
