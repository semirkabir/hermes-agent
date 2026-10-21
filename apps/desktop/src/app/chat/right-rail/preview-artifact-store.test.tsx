import type { GatewayEvent } from '@hermes/shared'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emitGatewayEvent } from '@/contrib/events'
import { $pendingArtifactComments } from '@/lib/artifact-comments'
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

function view(version: number, newest = version, html = `<h1>v${version}</h1>`, sourceExt = 'html', content = `<h1>v${version}</h1>`): StoreArtifactView {
  return {
    archived: false,
    content,
    created_at: 1,
    html,
    id: 'sif-review-abc123',
    kind: sourceExt === 'md' ? 'doc' : 'design',
    pinned: false,
    selected_version: version,
    session_id: 's1',
    size: 4,
    source_ext: sourceExt,
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

    await screen.findByText('<h1>v1</h1>')
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


const DOC = '# SIF Review\n\nHoldings rose 4% this quarter.\n\nQ3 outlook is cautious.'

function docView(): StoreArtifactView {
  return view(2, 2, '<h1>ignored</h1>', 'md', DOC)
}

/** Select `text` inside the rendered doc and release the mouse, like a user drag. */
async function highlight(text: string) {
  const layer = screen.getByTestId('artifact-comment-layer')
  // eslint-disable-next-line no-restricted-globals -- simulating a real text selection needs the live document
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const at = node.data.indexOf(text)

    if (at >= 0) {
      // eslint-disable-next-line no-restricted-globals -- simulating a real text selection needs the live document
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + text.length)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      fireEvent.mouseUp(node.parentElement!)
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
      })

      return
    }
  }

  throw new Error(`text not rendered: ${text}`)
}

describe('highlight to comment (docs render natively, like Redline)', () => {
  beforeEach(() => {
    pluginRest.mockReset()
    pluginRest.mockResolvedValue(docView())
    composer.requestComposerSubmit.mockClear().mockReturnValue(true)
    composer.requestComposerInsert.mockClear()
  })

  afterEach(() => {
    cleanup()
    window.getSelection()?.removeAllRanges()
    $pendingArtifactComments.set({})
    $storeArtifactVersion.set({})
    $storeArtifactRevision.set({})
  })

  it('renders a Markdown doc in the panel itself, not in a frame', async () => {
    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)

    await screen.findByText('Holdings rose 4% this quarter.')
    expect(screen.queryByTitle('SIF Review')).toBeNull()
    // eslint-disable-next-line no-restricted-globals -- simulating a real text selection needs the live document
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('pops a box over a highlight, queues several, and sends them all as one message', async () => {
    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    await screen.findByText('Holdings rose 4% this quarter.')

    await highlight('rose 4%')
    const box = await screen.findByTestId('artifact-comment-popup')
    expect(box.textContent).toContain('rose 4%')

    fireEvent.change(screen.getByPlaceholderText('Comment or ask for an edit…'), { target: { value: 'say why' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.queryByTestId('artifact-comment-popup')).toBeNull()

    await highlight('Q3 outlook')
    fireEvent.change(await screen.findByPlaceholderText('Comment or ask for an edit…'), { target: { value: 'cut this' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Comment or ask for an edit…'), { key: 'Enter' })

    const tray = screen.getByTestId('artifact-comment-tray')
    expect(tray.textContent).toContain('2 comments')
    expect(tray.textContent).toContain('say why')
    expect(tray.textContent).toContain('cut this')
    expect($pendingArtifactComments.get()['sif-review-abc123']!.map(c => c.block)).toEqual([1, 2])

    fireEvent.click(screen.getByRole('button', { name: 'Send all' }))

    expect(composer.requestComposerSubmit).toHaveBeenCalledTimes(1)
    const prompt = composer.requestComposerSubmit.mock.calls[0]![0]
    expect(prompt).toContain('id sif-review-abc123')
    expect(prompt).toContain('1. On "rose 4%"\n   say why')
    expect(prompt).toContain('2. On "Q3 outlook"\n   cut this')
    expect(screen.queryByTestId('artifact-comment-tray')).toBeNull()
  })

  it('removes a single queued comment and cancels a draft with Escape', async () => {
    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    await screen.findByText('Holdings rose 4% this quarter.')

    await highlight('Holdings')
    fireEvent.change(await screen.findByPlaceholderText('Comment or ask for an edit…'), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await highlight('cautious')
    fireEvent.change(await screen.findByPlaceholderText('Comment or ask for an edit…'), { target: { value: 'two' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove comment' })[0]!)
    expect(screen.getByTestId('artifact-comment-tray').textContent).toContain('1 comment')
    expect(screen.getByTestId('artifact-comment-tray').textContent).not.toContain('one')

    await highlight('quarter')
    fireEvent.keyDown(await screen.findByPlaceholderText('Comment or ask for an edit…'), { key: 'Escape' })
    expect(screen.queryByTestId('artifact-comment-popup')).toBeNull()
    expect($pendingArtifactComments.get()['sif-review-abc123']).toHaveLength(1)
  })

  it('does nothing for a click with no selection', async () => {
    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    const para = await screen.findByText('Holdings rose 4% this quarter.')

    window.getSelection()!.removeAllRanges()
    fireEvent.mouseUp(para)
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
    })

    expect(screen.queryByTestId('artifact-comment-popup')).toBeNull()
  })

  it('parks the batch in the message box when no composer can send it', async () => {
    composer.requestComposerSubmit.mockReturnValue(false)
    render(<ArtifactPreview target={storeArtifactTarget('sif-review-abc123', 'SIF Review')} />)
    await screen.findByText('Holdings rose 4% this quarter.')

    await highlight('Holdings')
    fireEvent.change(await screen.findByPlaceholderText('Comment or ask for an edit…'), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send all' }))

    expect(composer.requestComposerInsert).toHaveBeenCalledWith(expect.stringContaining('1. On "Holdings"'), { mode: 'block' })
  })
})
