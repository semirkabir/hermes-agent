import { describe, expect, it } from 'vitest'

import { splitSpanItems, toolSpanAt } from './tool-span'

const tool = { type: 'tool-call' }
const thought = { type: 'reasoning', text: 'hmm' }
const blank = { type: 'text', text: '  ' }
const words = { type: 'text', text: 'Built. Installing it now.' }

describe('tool spans', () => {
  // The shape that drew "Used 1 tool / Used 4 tools / Used 1 tool / Used 1 tool":
  // thinking between steps split one stretch of work four ways.
  const parts = [thought, tool, thought, tool, tool, tool, tool, thought, tool, thought, tool, words, tool, blank]

  it('spans tools across thinking and blank text, and stops at visible text', () => {
    expect(toolSpanAt(parts, 4)).toEqual({ start: 0, end: 10, firstTool: 1 })
    expect(toolSpanAt(parts, 0)).toEqual({ start: 0, end: 10, firstTool: 1 })
    expect(toolSpanAt(parts, 11)).toBeNull()
    expect(toolSpanAt(parts, 12)).toEqual({ start: 12, end: 13, firstTool: 12 })
    expect(toolSpanAt([thought, words], 0)).toBeNull()
  })

  it('folds a whole span into one run with its thinking inside', () => {
    expect(splitSpanItems(['neutral', 'tool', 'neutral', 'tool', 'tool', 'neutral'])).toEqual([
      { kind: 'run', start: 0, end: 5 }
    ])
  })

  it('keeps cards in place and leaves thinking stranded between cards alone', () => {
    expect(splitSpanItems(['tool', 'neutral', 'card', 'neutral', 'card', 'neutral', 'tool'])).toEqual([
      { kind: 'run', start: 0, end: 1 },
      { kind: 'card', index: 2 },
      { kind: 'part', index: 3 },
      { kind: 'card', index: 4 },
      { kind: 'run', start: 5, end: 6 }
    ])
  })
})
