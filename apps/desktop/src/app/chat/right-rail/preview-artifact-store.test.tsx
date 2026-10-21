import type { GatewayEvent } from '@hermes/shared'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emitGatewayEvent } from '@/contrib/events'
import {
  $storeArtifactRevision,
  $storeArtifactVersion,
  storeArtifactIdOf,
  storeArtifactTarget,
  type StoreArtifactView
} from '@/lib/artifact-store'

import { ArtifactPreview } from './preview-artifact'

const pluginRest = vi.hoisted(() => vi.fn())

vi.mock('@/api/plugins', () => ({ pluginRest }))

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
