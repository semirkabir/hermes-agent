import { type ComponentProps, type ReactNode, useMemo, useState } from 'react'

import { useContributions } from '@/contrib'
import { ContribBoundary } from '@/contrib/react/boundary'
import {
  FILE_PREVIEW_AREA,
  fileExtension,
  type FilePreviewContribution,
  isPluginPreviewable,
  pickFilePreviewer
} from '@/lib/file-preview'
import type { PreviewTarget } from '@/store/preview'

import { LocalFilePreview } from './preview-file'

function targetPath(target: PreviewTarget) {
  if (target.path) {
    return target.path
  }

  try {
    const url = new URL(target.url)

    return url.protocol === 'file:' ? decodeURIComponent(url.pathname) : target.url
  } catch {
    return target.url
  }
}

/**
 * Mounts the plugin previewer claiming this file's extension, or `children`
 * (core's LocalFilePreview) when none does. A previewer that calls `fallback()`
 * hands this file back to core for the rest of the tab's life on this target.
 */
export function PluginFilePreview({ children, target }: { children: ReactNode; target: PreviewTarget }) {
  const contributions = useContributions(FILE_PREVIEW_AREA)
  const path = targetPath(target)
  const [fellBackFor, setFellBackFor] = useState<null | string>(null)

  const claim = useMemo(
    () => (isPluginPreviewable(target) ? pickFilePreviewer(contributions, fileExtension(path)) : undefined),
    [contributions, path, target]
  )

  if (!claim || fellBackFor === path) {
    return <>{children}</>
  }

  const { render } = claim.data as FilePreviewContribution
  const name = target.label || path.split(/[\\/]/).pop() || path

  return (
    <div className="absolute inset-0 overflow-hidden bg-background" data-file-previewer={claim.id}>
      <ContribBoundary id={claim.id}>
        <PreviewerHost
          byteSize={target.byteSize}
          extension={fileExtension(path)}
          fallback={() => setFellBackFor(path)}
          // Remount per file so a previewer never carries one file's state into another.
          key={path}
          mimeType={target.mimeType}
          name={name}
          path={path}
          render={render}
        />
      </ContribBoundary>
    </div>
  )
}

/** Core's local file preview, with plugin previewers in front of it. */
export function FilePreview(props: ComponentProps<typeof LocalFilePreview>) {
  return (
    <PluginFilePreview target={props.target}>
      <LocalFilePreview {...props} />
    </PluginFilePreview>
  )
}

function PreviewerHost({
  render,
  ...props
}: Parameters<FilePreviewContribution['render']>[0] & { render: FilePreviewContribution['render'] }) {
  return <>{render(props)}</>
}
