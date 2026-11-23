import { type ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesGateway } from '@/hermes'
import { releaseApprovalKey } from '@/lib/keybinds/approval-keys'
import { onPersistenceEvent, persistString } from '@/lib/storage'
import { $gateway } from '@/store/gateway'
import { clearAllPrompts, setApprovalRequest } from '@/store/prompts'
import { resetServerRequestsForTests } from '@/store/server-requests'
import { $activeSessionId } from '@/store/session'
import {
  $toolCardsExpandLive,
  parseToolCallStyle,
  setToolCallStyle,
  setToolCardsExpandLive,
  TOOL_CALL_STYLE_STORAGE_KEY,
  TOOL_CARDS_EXPAND_LIVE_STORAGE_KEY
} from '@/store/tool-call-style'
import { clearDismissedToolRows } from '@/store/tool-dismiss'
import { clearSessionToolProgress, setToolProgress } from '@/store/tool-progress'
import { $toolDisclosureStates } from '@/store/tool-view'
import { stubMenuDomApis } from '@/test/jsdom'

import { stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '../test-utils'
import { Thread } from '../thread'

import { cardRowsOpen, pickTickerLead, TICKER_DWELL_MS, tickerWait } from './tool-card-model'

stubThreadEnvironment()
stubThreadViewportSize()

const createdAt = new Date('2026-06-03T00:00:00.000Z')
const t0 = createdAt.getTime() / 1000

const METADATA = { custom: {}, steps: [], unstable_annotations: [], unstable_data: [], unstable_state: null }

function assistant(id: string, content: unknown[], running: boolean): ThreadMessage {
  return {
    content,
    createdAt,
    id,
    metadata: METADATA,
    role: 'assistant',
    status: running ? { type: 'running' } : { reason: 'stop', type: 'complete' }
  } as unknown as ThreadMessage
}

const readDone = {
  args: { path: '/repo/src/wiring.tsx' },
  argsText: '{}',
  completedAt: t0 + 21,
  result: { content: 'export const Wiring = () => null' },
  timestamp: t0 + 20,
  toolCallId: 'read-1',
  toolName: 'read_file',
  type: 'tool-call'
}

const termDone = {
  args: { command: 'ls -la' },
  argsText: '{}',
  completedAt: t0 + 23.5,
  result: { exit_code: 0, output: 'wiring.tsx' },
  timestamp: t0 + 22,
  toolCallId: 'term-1',
  toolName: 'terminal',
  type: 'tool-call'
}

const termPending = {
  args: { command: 'rm -rf /tmp/x' },
  argsText: '{}',
  timestamp: t0 + 24,
  toolCallId: 'term-2',
  toolName: 'terminal',
  type: 'tool-call'
}

const readFailed = {
  args: { path: '/etc/shadow' },
  argsText: '{}',
  completedAt: t0 + 31,
  isError: true,
  result: { error: 'Permission denied: /etc/shadow', success: false },
  timestamp: t0 + 30,
  toolCallId: 'read-bad',
  toolName: 'read_file',
  type: 'tool-call'
}

const Harness = ({ message }: { message: ThreadMessage }) => (
  <ThreadRuntime messages={[message]}>
    <Thread />
  </ThreadRuntime>
)

const card = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-tool-card]')
const label = (container: HTMLElement) => container.querySelector('[data-slot="tool-card-label"]')?.textContent

// Visible rows only: a closed live card keeps its rows mounted off stage.
const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-slot="tool-card-row"]')).filter(
    row => !row.closest('[data-slot="tool-card-offstage"]')
  )

beforeAll(() => {
  stubMenuDomApis()
})

beforeEach(() => {
  clearAllPrompts()
  resetServerRequestsForTests()
  $activeSessionId.set('sess-1')
  $toolDisclosureStates.set({})
  clearDismissedToolRows()
  setToolCallStyle('cards')
  setToolCardsExpandLive(false)
})

afterEach(() => {
  cleanup()
  releaseApprovalKey()
  clearAllPrompts()
  $activeSessionId.set(null)
  $gateway.set(null)
  setToolCallStyle('compact')
  setToolCardsExpandLive(false)
})

describe('tool call style setting', () => {
  it('defaults to compact and persists under chat.toolCallStyle', () => {
    const writes: (null | string)[] = []

    const stop = onPersistenceEvent(event => {
      if (event.key === TOOL_CALL_STYLE_STORAGE_KEY && event.op === 'write') {
        writes.push(event.value)
      }
    })

    expect(parseToolCallStyle(null)).toBe('compact')
    expect(parseToolCallStyle('bogus')).toBe('compact')
    expect(parseToolCallStyle('cards')).toBe('cards')
    setToolCallStyle('compact')
    stop()
    expect(writes).toEqual(['compact'])
  })

  it('loads as compact when nothing is stored', async () => {
    persistString(TOOL_CALL_STYLE_STORAGE_KEY, null)
    vi.resetModules()
    const fresh = await import('@/store/tool-call-style')

    expect(fresh.$toolCallStyle.get()).toBe('compact')
  })

  it('falls back to the compact summary line when set to compact', async () => {
    setToolCallStyle('compact')
    const { container } = render(<Harness message={assistant('a-compact', [readDone, termDone], false)} />)

    expect(await screen.findByText('Explored wiring.tsx, ran 1 command')).toBeTruthy()
    expect(card(container)).toBeNull()
  })
})

describe('expand tool calls while running setting', () => {
  it('defaults off and persists under chat.toolCardsExpandLive', () => {
    const writes: (null | string)[] = []

    const stop = onPersistenceEvent(event => {
      if (event.key === TOOL_CARDS_EXPAND_LIVE_STORAGE_KEY && event.op === 'write') {
        writes.push(event.value)
      }
    })

    expect($toolCardsExpandLive.get()).toBe(false)
    setToolCardsExpandLive(true)
    stop()
    expect(writes).toEqual(['true'])
  })

  it('decides when the rows show', () => {
    const base = { expandLive: false, live: true, loneEdit: false, persistedOpen: undefined, rowOpen: false }

    expect(cardRowsOpen(base)).toBe(false)
    expect(cardRowsOpen({ ...base, expandLive: true })).toBe(true)
    expect(cardRowsOpen({ ...base, expandLive: true, live: false })).toBe(false)
    expect(cardRowsOpen({ ...base, rowOpen: true })).toBe(true)
    expect(cardRowsOpen({ ...base, loneEdit: true })).toBe(true)
    expect(cardRowsOpen({ ...base, expandLive: true, persistedOpen: false })).toBe(false)
    expect(cardRowsOpen({ ...base, persistedOpen: true })).toBe(true)
  })
})

describe('live ticker', () => {
  it('leads with the newest running call and counts the rest', () => {
    type Part = { completedAt?: number; result?: unknown; timestamp?: number }
    const a: Part = { completedAt: undefined, result: undefined, timestamp: 10 }
    const b: Part = { completedAt: undefined, result: undefined, timestamp: 12 }
    const done: Part = { completedAt: 13, result: 'ok', timestamp: 11 }

    expect(pickTickerLead([a, done, b], true)).toEqual({ extra: 1, lead: b })
    // Not live: nothing is running.
    expect(pickTickerLead([a], false)).toEqual({ extra: 0, lead: undefined })
  })

  it('holds a label for the dwell before the next one rolls in', () => {
    expect(TICKER_DWELL_MS).toBe(700)
    expect(tickerWait(1000, 1000)).toBe(700)
    expect(tickerWait(1000, 1500)).toBe(200)
    expect(tickerWait(1000, 1800)).toBe(0)
  })

  it('stays closed while live and shows what is running in the header', async () => {
    const { container } = render(<Harness message={assistant('a-tick', [readDone, termPending], true)} />)

    await waitFor(() => expect(label(container)).toMatch(/^Running/))
    expect(card(container)?.querySelector('[data-tool-card-state="live"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="tool-card-header"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(rows(container)).toHaveLength(0)
    // The rows stay mounted off stage so their side effects still run.
    expect(container.querySelector('[data-slot="tool-card-offstage"] [data-slot="tool-card-row"]')).not.toBeNull()
    expect(container.querySelector('[data-tool-card-lead]')?.getAttribute('data-tool-card-lead')).toBe('terminal')
    expect(container.querySelector('[data-slot="tool-card-running-extra"]')).toBeNull()
  })

  it('shows "+N" for the other calls running beside the lead', async () => {
    const readPending = {
      ...readDone,
      completedAt: undefined,
      result: undefined,
      timestamp: t0 + 25,
      toolCallId: 'read-2'
    }

    const { container } = render(<Harness message={assistant('a-two', [termPending, readPending], true)} />)

    await waitFor(() => expect(label(container)).toMatch(/^Reading/))
    expect(container.querySelector('[data-slot="tool-card-running-extra"]')?.textContent).toBe('+1')
  })

  it('rolls to the next call only after the dwell, then settles', async () => {
    const termRunning = { ...termDone, completedAt: undefined, result: undefined }

    const readNext = {
      ...readDone,
      completedAt: undefined,
      result: undefined,
      timestamp: t0 + 24,
      toolCallId: 'read-3'
    }

    const view = render(<Harness message={assistant('a-roll', [termRunning], true)} />)
    const { container } = view

    await waitFor(() => expect(label(container)).toMatch(/^Running/))
    const first = label(container)

    view.rerender(<Harness message={assistant('a-roll', [termDone, readNext], true)} />)
    // Inside the dwell the first label is still up.
    expect(label(container)).toBe(first)
    await waitFor(() => expect(label(container)).toMatch(/^Reading/), { timeout: 2000 })

    view.rerender(<Harness message={assistant('a-roll', [termDone, { ...readDone, toolCallId: 'read-3' }], false)} />)
    await waitFor(() => expect(label(container)).toBe('Used 2 tools'), { timeout: 2000 })
    expect(container.querySelector('[data-tool-card-lead]')).toBeNull()
  })
})

describe('tool card copy', () => {
  it('reads live while the run is the tail of a streaming turn', async () => {
    setToolCardsExpandLive(true)
    const { container } = render(<Harness message={assistant('a-live', [readDone, termPending], true)} />)

    await waitFor(() => expect(label(container)).toMatch(/^Running/))
    expect(card(container)?.querySelector('[data-tool-card-state="live"]')).not.toBeNull()

    const [read, term] = rows(container)

    expect(read.textContent).toContain('Read wiring.tsx')
    expect(read.querySelector('[data-slot="tool-card-check"]')).not.toBeNull()
    expect(read.querySelector('[data-slot="tool-card-row-meta"]')?.textContent).toBe('1 line · 1.0s')
    expect(term.textContent).toMatch(/^Running/)
    // The header ticker is the running row's own title.
    expect(term.textContent).toContain(label(container) as string)
    expect(term.querySelector('[data-slot="tool-card-spinner"]')).not.toBeNull()
  })

  it('settles to "Used N tools · total" and collapses to the bar', async () => {
    const { container } = render(<Harness message={assistant('a-settled', [readDone, termDone], false)} />)

    await waitFor(() => expect(label(container)).toBe('Used 2 tools'))
    expect(container.querySelector('[data-slot="tool-card-total"]')?.textContent).toBe('· 3.5s')
    expect(rows(container)).toHaveLength(0)

    fireEvent.click(container.querySelector('[data-slot="tool-card-header"]') as HTMLElement)

    await waitFor(() => expect(rows(container)).toHaveLength(2))
    expect(rows(container)[1].querySelector('[data-slot="tool-card-row-meta"]')?.textContent).toBe('1 line · 1.5s')
  })

  it('renders a run of one tool as a card too', async () => {
    const { container } = render(<Harness message={assistant('a-one', [readDone], false)} />)

    await waitFor(() => expect(label(container)).toBe('Used 1 tool'))
    expect(container.querySelector('[data-tool-summary]')).toBeNull()
  })

  it('shows live MCP progress on a running row', async () => {
    setToolCardsExpandLive(true)
    setToolProgress('sess-1', 'term-2', { message: 'refining mesh', percent: 42 })
    const { container } = render(<Harness message={assistant('a-progress', [readDone, termPending], true)} />)

    await waitFor(() => expect(rows(container)).toHaveLength(2))
    expect(rows(container)[1].querySelector('[data-slot="tool-progress"]')?.textContent).toBe('42% · refining mesh')
    expect(rows(container)[0].querySelector('[data-slot="tool-progress"]')).toBeNull()
    clearSessionToolProgress('sess-1')
  })

  it('opens the existing detail view when a row is clicked', async () => {
    setToolCardsExpandLive(true)
    const { container } = render(<Harness message={assistant('a-detail', [readDone, termPending], true)} />)

    await waitFor(() => expect(rows(container)).toHaveLength(2))
    fireEvent.click(rows(container)[0].querySelector('button[aria-expanded]') as HTMLElement)

    await waitFor(() => expect(container.querySelector('[data-tool-row][data-tool-open]')).not.toBeNull())
    expect(container.querySelector('[data-tool-row][data-tool-open]')?.textContent).toContain('export const Wiring')
  })
})

describe('failed row', () => {
  it('only counts the failure in the header when the expand setting is off', async () => {
    const { container } = render(<Harness message={assistant('a-fail-closed', [readDone, readFailed], false)} />)

    await waitFor(() => expect(container.querySelector('[data-slot="tool-card-failed"]')?.textContent).toBe('1 failed'))
    expect(rows(container)).toHaveLength(0)

    fireEvent.click(container.querySelector('[data-slot="tool-card-header"]') as HTMLElement)
    await waitFor(() => expect(container.querySelector('[data-tool-card-row-state="failed"]')).not.toBeNull())
  })

  it('tints the row, names the failure, and counts it in the header', async () => {
    const { container } = render(<Harness message={assistant('a-fail', [readDone, readFailed], false)} />)

    await waitFor(() => expect(container.querySelector('[data-slot="tool-card-failed"]')?.textContent).toBe('1 failed'))
    fireEvent.click(container.querySelector('[data-slot="tool-card-header"]') as HTMLElement)

    const failed = await waitFor(() => {
      const row = container.querySelector<HTMLElement>('[data-tool-card-row-state="failed"]')
      expect(row).not.toBeNull()

      return row as HTMLElement
    })

    expect(failed.textContent).toContain('Could not read shadow')
    expect(failed.querySelector('[data-slot="tool-card-row-error"]')?.textContent).toBe(
      'Permission denied: /etc/shadow'
    )
  })
})

describe('approval inside the card', () => {
  it('turns the header amber and answers from the inline row', async () => {
    const request = vi.fn().mockResolvedValue({ resolved: true })
    $gateway.set({ request } as unknown as HermesGateway)
    setApprovalRequest({
      command: 'rm -rf /tmp/x',
      description: 'recursive delete',
      requestId: 'apr-1',
      sessionId: 'sess-1'
    })

    const { container } = render(<Harness message={assistant('a-approval', [readDone, termPending], true)} />)

    await waitFor(() => expect(label(container)).toBe('Waiting for approval'))
    expect(container.querySelector('[data-tool-card-state="approval"]')).not.toBeNull()

    const inline = card(container)?.querySelector('[data-slot="tool-card-approval"]')

    expect(inline?.textContent).toContain('Recursive delete')
    // The rows stay closed: the approval row sits right under the header on its own.
    expect(rows(container)).toHaveLength(0)
    expect(inline?.textContent).toContain('rm -rf /tmp/x')
    expect(screen.getByRole('button', { name: /Deny/ })).toBeTruthy()
    // "Allow for the session" and "Always allow" stay one click away.
    expect(screen.getByRole('button', { name: 'More approval options' })).toBeTruthy()

    // The transcript stack steps aside instead of asking twice.
    const stacks = Array.from(container.querySelectorAll('[data-approval-stack]'))
    const active = stacks.filter(stack => stack.querySelector('[data-stack-active="true"]'))

    expect(active).toHaveLength(1)
    expect(active[0].closest('[data-tool-card]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Allow/ }))

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        'approval.respond',
        expect.objectContaining({ choice: 'once', request_id: 'apr-1', session_id: 'sess-1' }),
        expect.anything(),
        undefined
      )
    )
  })

  it('opens the rows above the approval row, which stands in for its pending command', async () => {
    setApprovalRequest({
      command: 'rm -rf /tmp/x',
      description: 'recursive delete',
      requestId: 'apr-3',
      sessionId: 'sess-1'
    })
    const { container } = render(<Harness message={assistant('a-approval-open', [readDone, termPending], true)} />)

    await waitFor(() => expect(label(container)).toBe('Waiting for approval'))
    fireEvent.click(container.querySelector('[data-slot="tool-card-header"]') as HTMLElement)

    await waitFor(() => expect(rows(container)).toHaveLength(1))
    expect(rows(container)[0].textContent).toContain('Read wiring.tsx')
    expect(card(container)?.querySelector('[data-slot="tool-card-approval"]')).not.toBeNull()
  })

  it('leaves the approval in the transcript stack when no card run is live', async () => {
    setApprovalRequest({
      command: 'rm -rf /tmp/x',
      description: 'recursive delete',
      requestId: 'apr-2',
      sessionId: 'sess-1'
    })
    const { container } = render(<Harness message={assistant('a-text', [{ text: 'Waiting.', type: 'text' }], true)} />)

    const run = await screen.findByRole('button', { name: /Run/ })

    expect(run.closest('[data-tool-card]')).toBeNull()
    expect(container.querySelector('[data-slot="tool-card-approval"]')).toBeNull()
  })
})
