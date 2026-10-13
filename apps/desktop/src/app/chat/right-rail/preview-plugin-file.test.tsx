// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'
import { FILE_PREVIEW_AREA, type FilePreviewContribution, pickFilePreviewer } from '@/lib/file-preview'
import type { PreviewTarget } from '@/store/preview'

import { PluginFilePreview } from './preview-plugin-file'

const docx: PreviewTarget = {
  binary: true,
  kind: 'file',
  label: 'paper.docx',
  path: '/home/u/paper.docx',
  previewKind: 'binary',
  source: 'test',
  url: 'file:///home/u/paper.docx'
}

const core = <div data-testid="core-preview">core</div>

function claim(id: string, data: Partial<FilePreviewContribution>) {
  return registry.register({
    id,
    area: FILE_PREVIEW_AREA,
    source: `plugin:${id}`,
    data: {
      extensions: ['docx'],
      render: ({ name }) => <div data-testid={id}>{name}</div>,
      ...data
    } satisfies FilePreviewContribution
  })
}

describe('PluginFilePreview', () => {
  const disposers: (() => void)[] = []

  afterEach(() => {
    cleanup()
    disposers.splice(0).forEach(dispose => dispose())
  })

  it('renders core preview when no plugin claims the extension', () => {
    render(<PluginFilePreview target={docx}>{core}</PluginFilePreview>)
    expect(screen.getByTestId('core-preview')).toBeTruthy()
  })

  it('replaces the binary notice with the claiming previewer', () => {
    disposers.push(claim('word', {}))
    render(<PluginFilePreview target={docx}>{core}</PluginFilePreview>)
    expect(screen.getByTestId('word').textContent).toBe('paper.docx')
    expect(screen.queryByTestId('core-preview')).toBeNull()
  })

  it('upgrades an already-open preview when a plugin hot-loads', () => {
    render(<PluginFilePreview target={docx}>{core}</PluginFilePreview>)
    expect(screen.getByTestId('core-preview')).toBeTruthy()
    act(() => {
      disposers.push(claim('word', {}))
    })
    expect(screen.getByTestId('word')).toBeTruthy()
  })

  it('never lets a plugin replace a kind core renders natively', () => {
    disposers.push(claim('pdf-hijack', { extensions: ['pdf'] }))
    const pdf: PreviewTarget = { ...docx, label: 'a.pdf', path: '/a.pdf', previewKind: 'pdf', url: 'file:///a.pdf' }

    render(<PluginFilePreview target={pdf}>{core}</PluginFilePreview>)
    expect(screen.getByTestId('core-preview')).toBeTruthy()
  })

  it('hands the file back to core when the previewer falls back', () => {
    disposers.push(
      claim('word', {
        render: ({ fallback }) => (
          <button data-testid="word" onClick={fallback} type="button">
            give up
          </button>
        )
      })
    )
    render(<PluginFilePreview target={docx}>{core}</PluginFilePreview>)
    act(() => screen.getByTestId('word').click())
    expect(screen.getByTestId('core-preview')).toBeTruthy()
  })

  it('contains a throwing previewer inside its own boundary', () => {
    disposers.push(
      claim('boom', {
        render: () => {
          throw new Error('kaboom')
        }
      })
    )
    const quiet = console.error

    console.error = () => {}

    let container: HTMLElement

    try {
      ;({ container } = render(<PluginFilePreview target={docx}>{core}</PluginFilePreview>))
    } finally {
      console.error = quiet
    }

    expect(container.querySelector('[data-file-previewer="boom"]')).toBeTruthy()
    expect(screen.queryByTestId('core-preview')).toBeNull()
  })
})

describe('pickFilePreviewer', () => {
  const entry = (id: string, data: unknown) => ({ id, data })
  const render = () => null

  it('prefers higher priority, then first registration', () => {
    const list = [
      entry('a', { extensions: ['docx'], render }),
      entry('b', { extensions: ['docx'], priority: 5, render }),
      entry('c', { extensions: ['docx'], priority: 5, render })
    ]

    expect(pickFilePreviewer(list, 'docx')?.id).toBe('b')
  })

  it('matches extensions case-insensitively and with a leading dot', () => {
    expect(pickFilePreviewer([entry('a', { extensions: ['.DOCX'], render })], 'docx')?.id).toBe('a')
  })

  it('ignores malformed registrations', () => {
    expect(
      pickFilePreviewer([entry('a', { extensions: 'docx', render }), entry('b', { extensions: ['docx'] })], 'docx')
    ).toBeUndefined()
  })
})
