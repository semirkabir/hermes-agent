import { afterEach, describe, expect, it } from 'vitest'

import {
  $pendingArtifactComments,
  addPendingArtifactComment,
  artifactCommentsPrompt,
  clearPendingArtifactComments,
  removePendingArtifactComment,
  splitArtifactBlocks
} from './artifact-comments'

describe('splitArtifactBlocks', () => {
  it('splits a doc on blank lines and keeps fenced code whole', () => {
    const blocks = splitArtifactBlocks('doc', '# Title\n\nPara one\nstill one\n\n```py\na = 1\n\nb = 2\n```\n\n- x\n- y')

    expect(blocks.map(block => block.text)).toEqual(['# Title', 'Para one\nstill one', '```py\na = 1\n\nb = 2\n```', '- x\n- y'])
    expect(blocks.every(block => block.slideStart === undefined)).toBe(true)
  })

  it('numbers deck slides on --- and drops speaker notes', () => {
    const blocks = splitArtifactBlocks('slides', '# Deck\nsub\n---\n## Two\n- a\n<!-- notes: say it -->\n---\n## Three')

    expect(blocks.map(block => [block.slideStart, block.text])).toEqual([
      [1, '# Deck\nsub'],
      [2, '## Two\n- a'],
      [3, '## Three']
    ])
  })

  it('treats --- in a doc as a normal line', () => {
    expect(splitArtifactBlocks('doc', 'a\n---\nb')).toEqual([{ text: 'a\n---\nb' }])
  })
})

describe('pending comments', () => {
  afterEach(() => $pendingArtifactComments.set({}))

  it('queues, removes and clears per artifact, ignoring empty notes', () => {
    const a = addPendingArtifactComment('doc-aaaaaa', { block: 0, note: ' tighten ', quote: 'intro', version: 2 })
    addPendingArtifactComment('doc-aaaaaa', { block: 1, note: 'cut', quote: 'risks', version: 2 })
    addPendingArtifactComment('doc-bbbbbb', { block: 0, note: 'x', quote: 'y', version: 1 })

    expect(addPendingArtifactComment('doc-aaaaaa', { block: 0, note: '   ', quote: 'q', version: 2 })).toBeNull()
    expect(a?.note).toBe('tighten')
    expect($pendingArtifactComments.get()['doc-aaaaaa']).toHaveLength(2)

    removePendingArtifactComment('doc-aaaaaa', a!.id)
    expect($pendingArtifactComments.get()['doc-aaaaaa']!.map(c => c.note)).toEqual(['cut'])

    clearPendingArtifactComments('doc-aaaaaa')
    expect($pendingArtifactComments.get()).toEqual({ 'doc-bbbbbb': expect.any(Array) })
  })

  it('packs every comment into one message naming the artifact and version', () => {
    const prompt = artifactCommentsPrompt({ id: 'sif-review-abc123', title: 'SIF Review', version: 3 }, [
      { block: 0, id: '1', note: 'make this punchier', quote: 'Holdings   rose\n4%', version: 3 },
      { block: 2, id: '2', note: 'add the date', quote: 'Q3', version: 2 }
    ])

    expect(prompt).toContain('Apply these 2 comments to the artifact "SIF Review" (id sif-review-abc123).')
    expect(prompt).toContain('while viewing v2; the newest is v3')
    expect(prompt).toContain('artifact_get')
    expect(prompt).toContain('1. On "Holdings rose 4%"\n   make this punchier')
    expect(prompt).toContain('2. On "Q3"\n   add the date')
  })
})
