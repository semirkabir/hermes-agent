import type { Icon } from '@tabler/icons-react'
import type * as React from 'react'

import { iconifyMaskUrl, isIconifyName } from '@/lib/iconify'
import { cn } from '@/lib/utils'

import { Codicon } from './codicon'

interface GlyphIconProps extends React.HTMLAttributes<HTMLElement> {
  /** A codicon name ("rocket") or an Iconify name ("mdi:rocket"). */
  name: string
  size?: number | string
}

/**
 * Renders a user-chosen glyph: a codicon, or an Iconify icon drawn as a
 * currentColor mask so it inherits the same tint, size and hover color a
 * codicon would. Iconify markup never reaches the DOM (a mask reads alpha only).
 */
export function GlyphIcon({ className, name, size, style, ...props }: GlyphIconProps) {
  if (!isIconifyName(name)) {
    return <Codicon className={className} name={name} size={size} style={style} {...props} />
  }

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
