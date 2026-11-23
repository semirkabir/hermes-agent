import { describe, expect, it } from 'vitest'

import { splitRunItems, technicalTrace } from './fallback'

describe('splitRunItems', () => {
  it('collapses a stretch of activity into one run', () => {
    expect(splitRunItems(['read_file', 'search_files', 'terminal'])).toEqual([{ end: 2, kind: 'run', start: 0 }])
  })

  it('folds file edits into the run instead of splitting it', () => {
    // Read, edit, run reads as ONE summary line.
    expect(splitRunItems(['read_file', 'patch', 'read_file', 'terminal'])).toEqual([{ end: 3, kind: 'run', start: 0 }])
    expect(splitRunItems(['patch', 'write_file', 'edit_file'])).toEqual([{ end: 2, kind: 'run', start: 0 }])
  })

  it('keeps a card at the point in the turn where it happened', () => {
    // A card (a question, an image, a fan-out) still splits the run around it.
    expect(splitRunItems(['read_file', 'clarify', 'read_file', 'terminal'])).toEqual([
      { end: 0, kind: 'run', start: 0 },
      { index: 1, kind: 'card' },
      { end: 3, kind: 'run', start: 2 }
    ])
  })

  it('does not let adjacent cards merge into a run', () => {
    expect(splitRunItems(['clarify', 'image_generate'])).toEqual([
      { index: 0, kind: 'card' },
      { index: 1, kind: 'card' }
    ])
  })

  it('passes a part that is not a tool call through as its own card', () => {
    expect(splitRunItems(['read_file', '', 'read_file'])).toEqual([
      { end: 0, kind: 'run', start: 0 },
      { index: 1, kind: 'card' },
      { end: 2, kind: 'run', start: 2 }
    ])
  })

  it('has nothing to split when the range is empty', () => {
    expect(splitRunItems([])).toEqual([])
  })
})

describe('technicalTrace', () => {
  it('indents object payloads and persisted JSON strings', () => {
    expect(technicalTrace({ offset: 2, path: '/tmp/demo.txt' }, '{"success":true,"lines":["a","b"]}')).toBe(
      'Arguments:\n{\n  "offset": 2,\n  "path": "/tmp/demo.txt"\n}\n\nResult:\n{\n  "success": true,\n  "lines": [\n    "a",\n    "b"\n  ]\n}'
    )
  })

  it('leaves scalar strings untouched', () => {
    expect(technicalTrace(undefined, 'plain text')).toBe('Result:\nplain text')
    expect(technicalTrace(undefined, '"already quoted"')).toBe('Result:\n"already quoted"')
  })
})
