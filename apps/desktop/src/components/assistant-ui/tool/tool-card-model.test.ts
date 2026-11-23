import { describe, expect, it } from 'vitest'

import type { ToolPart } from './fallback-model'
import {
  cardRowStatus,
  diffCountLabel,
  failedRowSubtext,
  failedRowTitle,
  firstLine,
  formatCardDuration,
  joinMeta,
  rowCountLabel,
  rowDurationSeconds,
  runWallSeconds
} from './tool-card-model'

const part = (toolName: string, result?: unknown, extra: Partial<ToolPart> = {}): ToolPart => ({
  args: {},
  result,
  toolCallId: `${toolName}-1`,
  toolName,
  type: 'tool-call',
  ...extra
})

const NO_VIEW = { countLabel: undefined, searchHits: undefined, stdout: undefined, terminalExitCode: undefined }

describe('tool card durations', () => {
  it('formats per the desktop duration rules', () => {
    expect(formatCardDuration(0.42)).toBe('420ms')
    expect(formatCardDuration(1.2)).toBe('1.2s')
    expect(formatCardDuration(3)).toBe('3.0s')
    expect(formatCardDuration(72)).toBe('1m 12s')
    expect(formatCardDuration(undefined)).toBe('')
    expect(formatCardDuration(-1)).toBe('')
  })

  it('times a row from start to completion, else from the result', () => {
    expect(rowDurationSeconds({ completedAt: 101.25, timestamp: 100 })).toBeCloseTo(1.25)
    expect(rowDurationSeconds({ result: { duration_s: 0.61 } })).toBeCloseTo(0.61)
    expect(rowDurationSeconds({})).toBeUndefined()
  })

  it('times a run as wall time from first start to last completion', () => {
    expect(
      runWallSeconds([
        { completedAt: 101, timestamp: 100 },
        { completedAt: 103, timestamp: 100.5 }
      ])
    ).toBeCloseTo(3)
    expect(runWallSeconds([{ timestamp: 100 }])).toBeUndefined()
  })
})

describe('tool card copy', () => {
  it('turns the present-tense title into "Could not ..."', () => {
    expect(failedRowTitle('Reading config.yaml', 'read_file')).toBe('Could not read config.yaml')
    expect(failedRowTitle('Querying pending migrations', 'db_query')).toBe('Could not query pending migrations')
    expect(failedRowTitle('Running npm test', 'terminal')).toBe('Could not run npm test')
  })

  it('falls back to "<Tool> failed" when the title has no known verb', () => {
    expect(failedRowTitle('Frobnicate', 'frob_tool')).toBe('Frob tool failed')
  })

  it('keeps the first non-empty line of an error', () => {
    expect(firstLine('\n  Connection to app_production timed out after 5s\nTraceback...')).toBe(
      'Connection to app_production timed out after 5s'
    )
    expect(firstLine('x'.repeat(200)).length).toBe(160)
  })

  it('counts a diff as added and removed lines, dropping a zero side', () => {
    expect(diffCountLabel({ added: 12, removed: 3 })).toBe('+12 −3')
    expect(diffCountLabel({ added: 4, removed: 0 })).toBe('+4')
  })

  it('marks a row running, unavailable without a result, else by its view', () => {
    expect(cardRowStatus(true, undefined, 'success')).toBe('running')
    expect(cardRowStatus(false, undefined, 'success')).toBe('unavailable')
    expect(cardRowStatus(false, { ok: true }, 'error')).toBe('error')
  })

  it('says a failure once: the error line, unless the open detail leads with it', () => {
    const view = { detail: 'Permission denied\ntrace', subtitle: '' }

    expect(failedRowSubtext(true, false, view, 'Permission denied')).toBe('Permission denied')
    expect(failedRowSubtext(true, true, view, 'Permission denied')).toBeUndefined()
    expect(failedRowSubtext(false, false, view, 'Permission denied')).toBeUndefined()
  })

  it('joins count and duration with a middle dot, dropping blanks', () => {
    expect(joinMeta('4 results', '1.2s')).toBe('4 results · 1.2s')
    expect(joinMeta('', '420ms')).toBe('420ms')
  })
})

describe('row counts', () => {
  it('reports a non-zero terminal exit, else lines of output', () => {
    expect(rowCountLabel(part('terminal', { exit_code: 2, output: 'boom' }), NO_VIEW)).toBe('exit 2')
    expect(rowCountLabel(part('terminal', { exit_code: 0, output: 'a\nb\nc\n' }), NO_VIEW)).toBe('3 lines')
  })

  it('counts lines read, matches, results, sessions and items', () => {
    expect(rowCountLabel(part('read_file', { content: '1|a\n2|b' }), NO_VIEW)).toBe('2 lines')
    expect(rowCountLabel(part('search_files', { total_count: 1 }), NO_VIEW)).toBe('1 match')
    expect(
      rowCountLabel(part('web_search', {}), { ...NO_VIEW, searchHits: [{ snippet: '', title: 'a', url: '' }] })
    ).toBe('1 result')
    expect(rowCountLabel(part('session_search', { results: [{}, {}] }), NO_VIEW)).toBe('2 sessions')
    expect(rowCountLabel(part('list_files', { entries: [{}, {}, {}] }), NO_VIEW)).toBe('3 items')
  })

  it('keeps the compact row count for other tools, and nothing when there is none', () => {
    expect(rowCountLabel(part('custom_tool', {}), { ...NO_VIEW, countLabel: '5 rows' })).toBe('5 rows')
    expect(rowCountLabel(part('custom_tool', {}), NO_VIEW)).toBe('')
  })
})
