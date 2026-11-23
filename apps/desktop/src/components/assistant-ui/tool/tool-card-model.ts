import { translateNow } from '@/i18n'
import { capitalize } from '@/lib/text'
import { toolResultRecord } from '@/lib/tool-result-metadata'

import { formatDurationSeconds, numberValue, type ToolPart, type ToolView } from './fallback-model'

/**
 * Pure copy and state rules for the tool card. The card reuses each row's
 * existing present/past title machinery; what lives here is only what the card
 * adds: header copy, per-row metadata and the failed title.
 */

const validSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** "420ms" under a second, "1.2s" under a minute, "1m 12s" after: the desktop's one duration format. */
export function formatCardDuration(seconds: number | undefined): string {
  return seconds === undefined || !Number.isFinite(seconds) || seconds < 0 ? '' : formatDurationSeconds(seconds)
}

/** Per-row duration: completedAt - timestamp, else the result's own `duration_s`. */
export function rowDurationSeconds(part: Pick<ToolPart, 'completedAt' | 'result' | 'timestamp'>): number | undefined {
  if (validSeconds(part.timestamp) && validSeconds(part.completedAt) && part.completedAt >= part.timestamp) {
    return part.completedAt - part.timestamp
  }

  const reported = numberValue(toolResultRecord(part).duration_s)

  return reported !== null && reported >= 0 ? reported : undefined
}

/** A label stays up at least this long before the live ticker rolls to the next one. */
export const TICKER_DWELL_MS = 700

/** How long a wanted label still waits for the one on screen to finish its dwell. */
export function tickerWait(lastSwapAt: number, now: number, dwellMs = TICKER_DWELL_MS): number {
  return Math.max(0, lastSwapAt + dwellMs - now)
}

/** A row is running while the run streams and it has no result yet. */
export function isRunningPart(part: Pick<ToolPart, 'completedAt' | 'result'>, live: boolean) {
  return live && part.result === undefined && part.completedAt === undefined
}

/**
 * What the live ticker leads with: the newest-started running call, and how
 * many other calls are running beside it (the "+N" pill). Ties on start time
 * go to the later call in the run.
 */
export function pickTickerLead<T extends Pick<ToolPart, 'completedAt' | 'result' | 'timestamp'>>(
  parts: readonly T[],
  live: boolean
): { extra: number; lead: T | undefined } {
  let lead: T | undefined
  let count = 0

  for (const part of parts) {
    if (!isRunningPart(part, live)) {
      continue
    }

    count += 1

    if (!lead || (part.timestamp ?? 0) >= (lead.timestamp ?? 0)) {
      lead = part
    }
  }

  return { extra: Math.max(0, count - 1), lead }
}

/**
 * Whether a card shows its rows. Closed by default, live or not: the header's
 * ticker carries the run. A choice the user made sticks; an opened row or a
 * lone edit's diff opens it; the "expand while running" setting opens it while
 * the run is live. An approval never opens the rows: its row renders under the
 * header on its own.
 */
export function cardRowsOpen({
  expandLive,
  live,
  loneEdit,
  persistedOpen,
  rowOpen
}: {
  expandLive: boolean
  live: boolean
  loneEdit: boolean
  persistedOpen: boolean | undefined
  rowOpen: boolean
}): boolean {
  if (persistedOpen !== undefined) {
    return persistedOpen
  }

  return rowOpen || loneEdit || (expandLive && live)
}

/** Wall time of a run: first start to last completion. */
export function runWallSeconds(tools: readonly Pick<ToolPart, 'completedAt' | 'timestamp'>[]): number | undefined {
  let start: number | undefined
  let end: number | undefined

  for (const tool of tools) {
    if (validSeconds(tool.timestamp)) {
      start = start === undefined ? tool.timestamp : Math.min(start, tool.timestamp)
    }

    if (validSeconds(tool.completedAt)) {
      end = end === undefined ? tool.completedAt : Math.max(end, tool.completedAt)
    }
  }

  return start !== undefined && end !== undefined && end >= start ? end - start : undefined
}

/** First non-empty line of an error, kept to one line. */
export function firstLine(text: string | null | undefined, max = 160): string {
  const line =
    String(text ?? '')
      .split('\n')
      .map(entry => entry.trim())
      .find(Boolean) ?? ''

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// The present participles the title machinery leads with, and the bare verb a
// failure reads with ("Reading config.yaml" -> "Could not read config.yaml").
// English only: another locale's participle is not in here, so it falls back to
// "<Tool> failed" rather than guessing at grammar.
const BASE_VERBS: Record<string, string> = {
  analyzing: 'analyze',
  browsing: 'browse',
  calling: 'call',
  checking: 'check',
  clicking: 'click',
  creating: 'create',
  delegating: 'delegate',
  deleting: 'delete',
  editing: 'edit',
  executing: 'execute',
  exploring: 'explore',
  extracting: 'extract',
  fetching: 'fetch',
  finding: 'find',
  generating: 'generate',
  listing: 'list',
  loading: 'load',
  navigating: 'navigate',
  opening: 'open',
  patching: 'patch',
  posting: 'post',
  querying: 'query',
  reading: 'read',
  recalling: 'recall',
  running: 'run',
  saving: 'save',
  scrolling: 'scroll',
  searching: 'search',
  sending: 'send',
  taking: 'take',
  typing: 'type',
  updating: 'update',
  using: 'use',
  viewing: 'view',
  writing: 'write'
}

export function humanToolName(toolName: string): string {
  return capitalize(toolName.replace(/[_-]+/g, ' ').trim()) || toolName
}

/** "Could not <verb> <target>", from the row's own present-tense title; else "<Tool> failed". */
export function failedRowTitle(presentTitle: string, toolName: string): string {
  const match = /^(\S+)(.*)$/s.exec(presentTitle.trim())
  const base = match ? BASE_VERBS[match[1].toLowerCase()] : undefined

  if (match && base) {
    return translateNow('assistant.tool.card.couldNot', `${base}${match[2].replace(/\s+/g, ' ')}`)
  }

  return translateNow('assistant.tool.card.toolFailed', humanToolName(toolName))
}

function arrayLength(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]

    if (Array.isArray(value)) {
      return value.length
    }
  }

  return undefined
}

function countNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = numberValue(record[key])

    if (value !== null && value >= 0 && Number.isInteger(value)) {
      return value
    }
  }

  return undefined
}

function lineCount(text: unknown): number | undefined {
  if (typeof text !== 'string' || !text.trim()) {
    return undefined
  }

  return text.replace(/\n+$/, '').split('\n').length
}

const LIST_TOOLS = new Set(['list_dir', 'list_directory', 'list_files', 'ls'])

/**
 * The count half of a done row's "<count> · <duration>", only where the result
 * reliably carries it. Everything else keeps the count the row
 * already showed in the compact style, or none.
 */
export function rowCountLabel(
  part: ToolPart,
  view: Pick<ToolView, 'countLabel' | 'searchHits' | 'stdout' | 'terminalExitCode'>
): string {
  const record = toolResultRecord(part)

  const count = (key: 'countItems' | 'countLines' | 'countMatches' | 'countResults' | 'countSessions', n?: number) =>
    n === undefined ? '' : translateNow(`assistant.tool.card.${key}`, n)

  switch (part.toolName) {
    case 'terminal': {
      const exit = view.terminalExitCode ?? numberValue(record.exit_code) ?? undefined

      if (exit !== undefined && exit !== 0) {
        return translateNow('assistant.tool.card.exitCode', exit)
      }

      return count('countLines', lineCount(view.stdout ?? record.output ?? record.stdout))
    }

    case 'read_file':
      return count('countLines', lineCount(record.content))

    case 'search_files':
      return count(
        'countMatches',
        countNumber(record, ['total_count', 'match_count']) ?? arrayLength(record, ['matches', 'files'])
      )

    case 'web_search':
      return count('countResults', view.searchHits?.length || arrayLength(record, ['results']))

    case 'session_search':

    case 'session_search_recall':
      return count('countSessions', arrayLength(record, ['results', 'sessions']))
  }

  if (LIST_TOOLS.has(part.toolName)) {
    return count('countItems', arrayLength(record, ['entries', 'items', 'files']))
  }

  return view.countLabel ?? ''
}

export function joinMeta(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' · ')
}

/** "+12 −3", the line counts of a file edit's diff. */
export function diffCountLabel({ added, removed }: { added: number; removed: number }): string {
  return [added > 0 && `+${added}`, removed > 0 && `−${removed}`].filter(Boolean).join(' ')
}

/** A row's status mark: running while pending, unavailable when it settled with no result, else the view's own. */
export function cardRowStatus(
  pending: boolean,
  result: unknown,
  status: ToolView['status']
): 'unavailable' | ToolView['status'] {
  if (pending) {
    return 'running'
  }

  return result === undefined ? 'unavailable' : status
}

/** A failed row's second line: the first line of its error, unless the open detail below already leads with it. */
export function failedRowSubtext(
  failed: boolean,
  open: boolean,
  view: Pick<ToolView, 'detail' | 'subtitle'>,
  detailSummary: string
): string | undefined {
  const line = failed ? firstLine(view.subtitle || detailSummary || view.detail) : ''

  return line && !(open && line === firstLine(detailSummary)) ? line : undefined
}
