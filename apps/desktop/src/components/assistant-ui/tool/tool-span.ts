/**
 * One line per stretch of tool work.
 *
 * assistant-ui groups only *adjacent* tool calls, so a model that thinks
 * between calls (reasoning parts, often hidden) got a separate "Used 1 tool"
 * line per step. A span is the maximal run of parts that are tool calls,
 * reasoning, or blank text, with at least one tool call in it. Visible text
 * still ends a span, so the order of what the user can read stays honest.
 *
 * The first ToolGroup inside a span owns it and renders every part in it; the
 * other ToolGroups and ReasoningGroups inside the span render nothing.
 */

interface PartLike {
  type?: string
  text?: unknown
}

/** Parts a span passes over without breaking: thinking and empty text. */
export function isSpanNeutralPart(part: PartLike | undefined): boolean {
  if (!part) {
    return false
  }

  if (part.type === 'reasoning') {
    return true
  }

  return part.type === 'text' && (typeof part.text !== 'string' || part.text.trim().length === 0)
}

function inSpan(part: PartLike | undefined): boolean {
  return part?.type === 'tool-call' || isSpanNeutralPart(part)
}

export interface ToolSpan {
  start: number
  end: number
  /** Index of the first tool call: the ToolGroup that starts here owns the span. */
  firstTool: number
}

/** The tool span containing `index`, or null when that part is in none. */
export function toolSpanAt(parts: readonly PartLike[], index: number): null | ToolSpan {
  if (!inSpan(parts[index])) {
    return null
  }

  let start = index

  while (start > 0 && inSpan(parts[start - 1])) {
    start -= 1
  }

  let end = index

  while (end < parts.length - 1 && inSpan(parts[end + 1])) {
    end += 1
  }

  for (let i = start; i <= end; i += 1) {
    if (parts[i]?.type === 'tool-call') {
      return { end, firstTool: i, start }
    }
  }

  return null
}

export type SpanPartKind = 'card' | 'neutral' | 'tool'

export type SpanItem =
  | { end: number; kind: 'run'; start: number }
  | { index: number; kind: 'card' }
  | { index: number; kind: 'part' }

/**
 * Split a span into cards (diffs, questions: they stay on screen) and runs of
 * activity. Thinking joins the run it sits in, leads, or trails; thinking
 * stranded between two cards stays as its own part. Indices are relative.
 */
export function splitSpanItems(kinds: readonly SpanPartKind[]): SpanItem[] {
  const items: SpanItem[] = []
  let run: null | Extract<SpanItem, { kind: 'run' }> = null
  let pending: null | number = null

  const flushPending = (until: number) => {
    if (pending === null) {
      return
    }

    for (let i = pending; i < until; i += 1) {
      items.push({ index: i, kind: 'part' })
    }

    pending = null
  }

  kinds.forEach((kind, index) => {
    if (kind === 'neutral') {
      if (run) {
        run.end = index
      } else if (pending === null) {
        pending = index
      }

      return
    }

    if (kind === 'card') {
      flushPending(index)
      run = null
      items.push({ index, kind: 'card' })

      return
    }

    if (run) {
      run.end = index
    } else {
      run = { end: index, kind: 'run', start: pending ?? index }
      pending = null
      items.push(run)
    }
  })

  flushPending(kinds.length)

  return items
}
