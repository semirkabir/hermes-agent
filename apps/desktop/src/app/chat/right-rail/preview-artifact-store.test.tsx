import type { GatewayEvent } from '@hermes/shared'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emitGatewayEvent } from '@/contrib/events'
import { $pendingArtifactComments, ARTIFACT_BRIDGE_TAG } from '@/lib/artifact-comments'
import {
  $storeArtifactRevision,
  $storeArtifactVersion,
  storeArtifactIdOf,
  storeArtifactTarget,
  type StoreArtifactView
} from '@/lib/artifact-store'

import { ArtifactPreview } from './preview-artifact'

const pluginRest = vi.hoisted(() => vi.fn())

const composer = vi.hoisted(() => ({
  requestComposerFocus: vi.fn(),
  requestComposerInsert: vi.fn(),
  requestComposerSubmit: vi.fn((_text: string) => true)
}))

vi.mock('@/api/plugins', () => ({ pluginRest }))
vi.mock('@/app/chat/composer/focus', () => composer)

function view(version: number, newest = version, html = `<h1>v${version}</h1>`): StoreArtifactView {
  return {
    archived: false,
    content: `# v${version}`,
    created_at: 1,
    html,
    id: 'sif-review-abc123',
    kind: 'doc',
    pinned: false,
    selected_version: version,
    session_id: 's1',
    size: 4,
    source_ext: 'md',
    summary: '',
    title: 'SIF Review',
    updated_at: 2,
    version: newest,
    versions: Array.from({ length: newest }, (_, index) => ({ created_at: index, note: '', size: 4, version: index + 1 }))
  }
}

describe('store artifact targets', () => {
  it('maps store ids and leaves registry artifacts alone', () => {
    expect(storeArtifactIdOf(storeArtifactTarget('sif-review-abc123'))).toBe('sif-review-abc123')
    expect(storeArtifactIdOf({ kind: 'artifact', url: 'session-1:html-dashboard' })).toBeNull()
    expect(storeArtifactIdOf({ kind: 'file', url: 'store:sif-review-abc123' })).toBeNull()
    expect(storeArtifactIdOf({ kind: 'artifact', url: 'store:../etc' })).toBeNull()
  })
})

describe('StoreArtifactPreview', () => {
  beforeEach(() => {
    pluginRest.mockReset()
  })

  afterEach(() => {
    cleanup()
    $storeArtifactVersion.set({})
    $storeArtifactRevision.set({})
  })

  it('fetches the view from the plugin and renders it in a scripts-only sandbox', async () => {
    pluginRest.mockResolvedValue(view(1))

    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)

    const frame = (await screen.findByTitle('SIF Review')) as HTMLIFrameElement

    expect(pluginRest).toHaveBeenCalledWith('hermes-artifacts', '/item/sif-review-abc123/view')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.srcdoc).toContain('<h1>v1</h1>')
    expect(frame.srcdoc).toContain('<script>')
  })

  it('re-fetches when the gateway broadcasts a change for this artifact', async () => {
    pluginRest.mockResolvedValueOnce(view(1)).mockResolvedValueOnce(view(2))

    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    await screen.findByTitle('SIF Review')

    act(() => {
      emitGatewayEvent({
        payload: { id: 'sif-review-abc123', version: 2 },
        type: 'plugin.hermes-artifacts.changed'
      } as unknown as GatewayEvent)
    })

    await waitFor(() => expect((screen.getByTitle('SIF Review') as HTMLIFrameElement).srcdoc).toContain('<h1>v2</h1>'))
    expect(pluginRest).toHaveBeenCalledTimes(2)
  })

  it('ignores change events for other artifacts', async () => {
    pluginRest.mockResolvedValue(view(1))

    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    await screen.findByTitle('SIF Review')

    act(() => {
      emitGatewayEvent({ payload: { id: 'other-000000' }, type: 'plugin.hermes-artifacts.changed' } as unknown as GatewayEvent)
    })

    expect(pluginRest).toHaveBeenCalledTimes(1)
  })

  it('steps back to an older version through the version arrows', async () => {
    pluginRest.mockImplementation((_plugin: string, path: string) =>
      Promise.resolve(path.endsWith('?v=1') ? view(1, 2) : view(2, 2))
    )

    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    await screen.findByText('v2 of 2')

    fireEvent.click(screen.getByRole('button', { name: 'Older version' }))

    await screen.findByText('v1 of 2')
    expect(pluginRest).toHaveBeenLastCalledWith('hermes-artifacts', '/item/sif-review-abc123/view?v=1')
    expect((screen.getByTitle('SIF Review') as HTMLIFrameElement).srcdoc).toContain('<h1>v1</h1>')
  })

  it('shows the source view on request', async () => {
    pluginRest.mockResolvedValue(view(1))

    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    await screen.findByTitle('SIF Review')

    fireEvent.click(screen.getByRole('button', { name: /source/i }))

    await screen.findByText('# v1')
    expect(screen.queryByTitle('SIF Review')).toBeNull()
  })

  it('reports a failed load with a retry instead of a blank pane', async () => {
    pluginRest.mockRejectedValueOnce(new Error('no artifact with id sif-review-abc123')).mockResolvedValueOnce(view(1))

    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)

    await screen.findByText('no artifact with id sif-review-abc123')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByTitle('SIF Review')
  })
})

/** Pretend the sandboxed frame's bridge posted `message` (same nonce it was built with). */
function fromFrame(frame: HTMLIFrameElement, message: Record<string, unknown>) {
  const nonce = /"([0-9a-f]{24})"/.exec(frame.srcdoc)![1]

  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { ...message, [ARTIFACT_BRIDGE_TAG]: nonce }, source: frame.contentWindow })
    )
  })
}

describe('highlight to comment', () => {
  beforeEach(() => {
    pluginRest.mockReset()
    pluginRest.mockResolvedValue(view(2))
    composer.requestComposerSubmit.mockClear().mockReturnValue(true)
    composer.requestComposerInsert.mockClear()
  })

  afterEach(() => {
    cleanup()
    $pendingArtifactComments.set({})
    $storeArtifactVersion.set({})
    $storeArtifactRevision.set({})
  })

  const select = (frame: HTMLIFrameElement, text: string, start = 0) =>
    fromFrame(frame, { end: start + text.length, rect: { bottom: 40, left: 20, right: 120, top: 24 }, start, text, type: 'selection' })

  it('pops a comment box over a highlight, queues several, and sends them all as one message', async () => {
    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    const frame = (await screen.findByTitle('SIF Review')) as HTMLIFrameElement

    select(frame, 'Holdings rose 4%')
    const box = await screen.findByTestId('artifact-comment-popup')
    expect(box.textContent).toContain('Holdings rose 4%')

    fireEvent.change(screen.getByPlaceholderText('Comment or ask for an edit…'), { target: { value: 'say why' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.queryByTestId('artifact-comment-popup')).toBeNull()

    select(frame, 'Q3 outlook', 40)
    fireEvent.change(await screen.findByPlaceholderText('Comment or ask for an edit…'), { target: { value: 'cut this' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Comment or ask for an edit…'), { key: 'Enter' })

    const tray = screen.getByTestId('artifact-comment-tray')
    expect(tray.textContent).toContain('2 comments')
    expect(tray.textContent).toContain('say why')
    expect(tray.textContent).toContain('cut this')

    fireEvent.click(screen.getByRole('button', { name: 'Send all' }))

    expect(composer.requestComposerSubmit).toHaveBeenCalledTimes(1)
    const prompt = composer.requestComposerSubmit.mock.calls[0]![0]
    expect(prompt).toContain('id sif-review-abc123')
    expect(prompt).toContain('1. On "Holdings rose 4%"\n   say why')
    expect(prompt).toContain('2. On "Q3 outlook"\n   cut this')
    expect(screen.queryByTestId('artifact-comment-tray')).toBeNull()
  })

  it('removes a single queued comment and cancels a draft with Escape', async () => {
    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    const frame = (await screen.findByTitle('SIF Review')) as HTMLIFrameElement

    select(frame, 'alpha')
    fireEvent.change(await screen.findByPlaceholderText('Comment or ask for an edit…'), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    select(frame, 'beta', 10)
    fireEvent.change(await screen.findByPlaceholderText('Comment or ask for an edit…'), { target: { value: 'two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove comment' })[0]!)
    expect(screen.getByTestId('artifact-comment-tray').textContent).toContain('1 comment')
    expect(screen.getByTestId('artifact-comment-tray').textContent).not.toContain('one')

    select(frame, 'gamma', 20)
    fireEvent.keyDown(await screen.findByPlaceholderText('Comment or ask for an edit…'), { key: 'Escape' })
    expect(screen.queryByTestId('artifact-comment-popup')).toBeNull()
    expect($pendingArtifactComments.get()['sif-review-abc123']).toHaveLength(1)
  })

  it('ignores messages from anything but this frame with this nonce', async () => {
    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    await screen.findByTitle('SIF Review')

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { [ARTIFACT_BRIDGE_TAG]: 'forged', rect: { bottom: 1, left: 1, right: 1, top: 1 }, text: 'x', type: 'selection' },
          source: window
        })
      )
    })

    expect(screen.queryByTestId('artifact-comment-popup')).toBeNull()
  })

  it('parks the batch in the message box when no composer can send it', async () => {
    composer.requestComposerSubmit.mockReturnValue(false)
    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    const frame = (await screen.findByTitle('SIF Review')) as HTMLIFrameElement

    select(frame, 'alpha')
    fireEvent.change(await screen.findByPlaceholderText('Comment or ask for an edit…'), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send all' }))

    expect(composer.requestComposerInsert).toHaveBeenCalledWith(expect.stringContaining('1. On "alpha"'), { mode: 'block' })
  })
})
