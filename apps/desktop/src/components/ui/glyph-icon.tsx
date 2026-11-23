import type { Icon } from '@tabler/icons-react'
import * as React from 'react'

import { cacheIconifyIcon, iconifyMaskUrl, isIconifyCached, isIconifyName } from '@/lib/iconify'
import { cn } from '@/lib/utils'

import { Codicon } from './codicon'

interface GlyphIconProps extends React.HTMLAttributes<HTMLElement> {
  /** A codicon name ("rocket") or an Iconify name ("mdi:rocket"). */
  name: string
  size?: number | string
  /** A throwaway preview (search results): draw from the network without filling the local cache. */
  preview?: boolean
}

/**
 * Renders a user-chosen glyph: a codicon, or an Iconify icon drawn as a
 * currentColor mask so it inherits the same tint, size and hover color a
 * codicon would. Iconify markup never reaches the DOM (a mask reads alpha only).
 */
export function GlyphIcon({ name, preview, ...props }: GlyphIconProps) {
  return isIconifyName(name) ? (
    <IconifyGlyph name={name} preview={preview} {...props} />
  ) : (
    <Codicon name={name} {...props} />
  )
}

function IconifyGlyph({ className, name, preview, size, style, ...props }: GlyphIconProps) {
  const [, setCached] = React.useState(false)

  // The icon name is shared through the project record, but the SVG cache is per
  // device: fill it on first sight so a project picked elsewhere also works offline.
  React.useEffect(() => {
    if (preview || isIconifyCached(name)) {
      return
    }

    let live = true

    void cacheIconifyIcon(name).then(() => live && setCached(true))

    return () => {
      live = false
    }
  }, [name, preview])

  const mask = iconifyMaskUrl(name)

  return (
    <i
      aria-hidden="true"
      className={cn('inline-block shrink-0 bg-current align-middle', className)}
      data-iconify={name}
      style={{
        ...(size != null && size !== '' ? { fontSize: size } : {}),
        height: '1em',
        width: '1em',
        maskImage: mask,
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
        maskSize: 'contain',
        WebkitMaskImage: mask,
        WebkitMaskPosition: 'center',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        ...style
      }}
      {...props}
    />
  )
}

/** Tabler-shaped wrapper for nav rows (command palette) that expect `IconComponent`. */
export function glyphIcon(name: string): Icon {
  function GlyphIconComponent({ className }: { className?: string }) {
    return <GlyphIcon className={cn('leading-none', className)} name={name} size="1em" />
  }

  GlyphIconComponent.displayName = `Glyph(${name})`

  return GlyphIconComponent as Icon
}
