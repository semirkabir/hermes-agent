import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  $pendingArtifactComments,
  addPendingArtifactComment,
  ARTIFACT_BRIDGE_TAG,
  artifactBridgeScript,
  artifactCommentsPrompt,
  clearPendingArtifactComments,
  readArtifactBridgeMessage,
  removePendingArtifactComment,
  withArtifactBridge
} from './artifact-comments'

describe('readArtifactBridgeMessage', () => {
  it('accepts only messages carrying this render nonce', () => {
    const msg = { [ARTIFACT_BRIDGE_TAG]: 'n1', end: 9, rect: { bottom: 2, left: 1, right: 3, top: 0 }, start: 4, text: 'hello', type: 'selection' }

    expect(readArtifactBridgeMessage(msg, 'n1')).toMatchObject({ end: 9, start: 4, text: 'hello', type: 'selection' })
    expect(readArtifactBridgeMessage(msg, 'other')).toBeNull()
    expect(readArtifactBridgeMessage({ ...msg, type: 'navigate' }, 'n1')).toBeNull()
    expect(readArtifactBridgeMessage('nope', 'n1')).toBeNull()
    expect(readArtifactBridgeMessage({ [ARTIFACT_BRIDGE_TAG]: 'n1', type: 'ready' }, 'n1')).toEqual({ type: 'ready' })
  })
})

describe('withArtifactBridge', () => {
  it('injects the bridge before </body>, or appends it to a fragment', () => {
    expect(withArtifactBridge('<html><body><p>x</p></body></html>', 'n1')).toMatch(/<p>x<\/p><script>.*<\/script><\/body><\/html>$/s)
    expect(withArtifactBridge('<p>x</p>', 'n1')).toMatch(/^<p>x<\/p><script>/)
  })

  it('bakes in the nonce and no network or storage access', () => {
    const script = artifactBridgeScript('abc123')

    expect(script).toContain('"abc123"')
    expect(script).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|document\.cookie|parent\.document/)
  })
})

describe('bridge script in a real document', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('reports a text selection with its offsets back to the parent', async () => {
    // Fixed test fixture, not user content.
    document.body.innerHTML = '<h1>Title</h1><p>Holdings rose 4% this quarter.</p>'
    const posted: Record<string, unknown>[] = []
    vi.spyOn(window.parent, 'postMessage').mockImplementation(((message: Record<string, unknown>) => {
      posted.push(message)
    }) as typeof window.postMessage)

    // Runs the exact bridge source the app injects; the only interpolation is a fixed test nonce.
     
    new Function(artifactBridgeScript('nonce-1'))()
    expect(posted.at(-1)).toMatchObject({ [ARTIFACT_BRIDGE_TAG]: 'nonce-1', type: 'ready' })

    const text = document.querySelector('p')!.firstChild as Text
    const range = document.createRange()
    range.setStart(text, 9)
    range.setEnd(text, 16)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new MouseEvent('mouseup'))
    await new Promise(resolve => setTimeout(resolve, 0))

    const selection = posted.at(-1)!

    expect(selection).toMatchObject({ [ARTIFACT_BRIDGE_TAG]: 'nonce-1', text: 'rose 4%', type: 'selection' })
    // "Title" (5 chars) precedes the paragraph in the body's text.
    expect(selection.start).toBe(5 + 9)
    expect(selection.end).toBe(5 + 16)
  })
})

describe('pending comments', () => {
  afterEach(() => $pendingArtifactComments.set({}))

  it('queues, removes and clears per artifact, ignoring empty notes', () => {
    const a = addPendingArtifactComment('doc-aaaaaa', { end: 4, note: ' tighten ', quote: 'intro', start: 0, version: 2 })
    addPendingArtifactComment('doc-aaaaaa', { end: 9, note: 'cut', quote: 'risks', start: 5, version: 2 })
    addPendingArtifactComment('doc-bbbbbb', { end: 1, note: 'x', quote: 'y', start: 0, version: 1 })

    expect(addPendingArtifactComment('doc-aaaaaa', { end: 1, note: '   ', quote: 'q', start: 0, version: 2 })).toBeNull()
    expect(a?.note).toBe('tighten')
    expect($pendingArtifactComments.get()['doc-aaaaaa']).toHaveLength(2)

    removePendingArtifactComment('doc-aaaaaa', a!.id)
    expect($pendingArtifactComments.get()['doc-aaaaaa']!.map(c => c.note)).toEqual(['cut'])

    clearPendingArtifactComments('doc-aaaaaa')
    expect($pendingArtifactComments.get()).toEqual({ 'doc-bbbbbb': expect.any(Array) })
  })

  it('packs every comment into one message naming the artifact and version', () => {
    const prompt = artifactCommentsPrompt({ id: 'sif-review-abc123', title: 'SIF Review', version: 3 }, [
      { end: 1, id: '1', note: 'make this punchier', quote: 'Holdings   rose\n4%', start: 0, version: 3 },
      { end: 1, id: '2', note: 'add the date', quote: 'Q3', start: 0, version: 2 }
    ])

    expect(prompt).toContain('Apply these 2 comments to the artifact "SIF Review" (id sif-review-abc123).')
    expect(prompt).toContain('while viewing v2; the newest is v3')
    expect(prompt).toContain('artifact_get')
    expect(prompt).toContain('1. On "Holdings rose 4%"\n   make this punchier')
    expect(prompt).toContain('2. On "Q3"\n   add the date')
  })
})
