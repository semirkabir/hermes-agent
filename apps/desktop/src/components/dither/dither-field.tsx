/**
 * Dithered surfaces for loading states and backgrounds.
 *
 * `DitherField` paints Paper Shaders' ordered-dither shader (Apache-2.0,
 * https://github.com/paper-design/shaders) into whatever box it is given.
 * Colors are CSS colors, theme tokens included (`currentColor`, `var(--x)`,
 * oklch, color-mix): they are rasterized through a 1x1 canvas so the shader
 * gets plain RGBA, and re-resolved on every theme repaint.
 *
 * Cost rules, so a plugin can drop it in without thinking about them:
 * - `prefers-reduced-motion` renders one still frame (speed 0).
 * - The mount pauses itself while offscreen or in a hidden tab.
 * - Pixel ratio 1: dither cells are chunky on purpose, so rendering at 2x
 *   only quadruples the fill cost.
 * - No WebGL (tests, a broken GPU process) falls back to the app's CSS
 *   `.dither` checker at the same tint, never an empty box.
 */

import {
  ditheringFragmentShader,
  DitheringShapes,
  DitheringTypes,
  ShaderFitOptions,
  ShaderMount
} from '@paper-design/shaders'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { onThemeRepaint } from '@/hooks/use-theme-epoch'
import { cn } from '@/lib/utils'

export type DitherShape = keyof typeof DitheringShapes
export type DitherType = keyof typeof DitheringTypes
export type Rgba = [number, number, number, number]

export interface DitherFieldProps {
  /** Ground color. Any CSS color. Default: transparent, so the box behind shows. */
  back?: string
  className?: string
  /** Ink color. Any CSS color. Default: the element's own text color. */
  front?: string
  /** Multiplies the ink's alpha; keep it low for backgrounds (0.1 to 0.3). */
  frontAlpha?: number
  /** Dither cell size in CSS pixels. */
  pixelSize?: number
  scale?: number
  shape?: DitherShape
  /** Animation speed; 0 draws one still frame. Reduced motion forces 0. */
  speed?: number
  style?: CSSProperties
  type?: DitherType
}

let probeCanvas: HTMLCanvasElement | null = null

/** Any CSS color, resolved against `el`, as 0..1 RGBA. Transparent when it can't be read. */
export function resolveCssColor(el: HTMLElement, value: string): Rgba {
  if (typeof document === 'undefined') {
    return [0, 0, 0, 0]
  }

  const probe = document.createElement('span')
  probe.style.display = 'none'
  probe.style.color = value
  el.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()

  probeCanvas ??= document.createElement('canvas')
  probeCanvas.width = 1
  probeCanvas.height = 1
  const ctx = probeCanvas.getContext('2d', { willReadFrequently: true })

  if (!ctx || !computed) {
    return [0, 0, 0, 0]
  }

  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = 'rgba(0, 0, 0, 0)'
  ctx.fillStyle = computed
  ctx.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data

  return [r / 255, g / 255, b / 255, a / 255]
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function DitherField({
  back = 'transparent',
  className,
  front = 'currentColor',
  frontAlpha = 1,
  pixelSize = 3,
  scale = 1,
  shape = 'warp',
  speed = 0.5,
  style,
  type = '4x4'
}: DitherFieldProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const el = ref.current

    if (!el) {
      return
    }

    const colors = () => {
      const ink = resolveCssColor(el, front)

      return {
        u_colorBack: resolveCssColor(el, back),
        u_colorFront: [ink[0], ink[1], ink[2], ink[3] * Math.max(0, Math.min(1, frontAlpha))] as Rgba
      }
    }

    let mount: null | ShaderMount = null

    try {
      mount = new ShaderMount(
        el,
        ditheringFragmentShader,
        {
          ...colors(),
          u_shape: DitheringShapes[shape],
          u_type: DitheringTypes[type],
          u_pxSize: pixelSize,
          u_fit: ShaderFitOptions.none,
          u_scale: scale,
          u_rotation: 0,
          u_offsetX: 0,
          u_offsetY: 0,
          u_originX: 0.5,
          u_originY: 0.5,
          u_worldWidth: 0,
          u_worldHeight: 0
        },
        // The shader writes premultiplied color; the context default composites it once.
        undefined,
        prefersReducedMotion() ? 0 : speed,
        0,
        1
      )
      setFallback(false)
    } catch {
      setFallback(true)

      return
    }

    const stopTheme = onThemeRepaint(() => mount?.setUniforms(colors()))

    return () => {
      stopTheme()
      mount?.dispose()
    }
  }, [back, front, frontAlpha, pixelSize, scale, shape, speed, type])

  return (
    <div
      aria-hidden
      className={cn('pointer-events-none overflow-hidden', fallback && 'dither', className)}
      data-dither-field={fallback ? 'css' : 'webgl'}
      ref={ref}
      style={fallback ? { opacity: Math.max(0.08, Math.min(1, frontAlpha)), ...style } : style}
    />
  )
}

export interface DitherLoadingProps {
  className?: string
  /** Secondary line under the label, e.g. the thing being loaded. */
  detail?: string
  /** What is loading, read out to screen readers too. */
  label: string
}

/**
 * A loading state that fills its box with a slow dithered drift behind a
 * plain label. Use it where a panel would otherwise show a spinner or a blank.
 */
export function DitherLoading({ className, detail, label }: DitherLoadingProps) {
  return (
    <div
      aria-live="polite"
      className={cn('relative grid size-full min-h-24 place-items-center overflow-hidden text-muted-foreground', className)}
      data-dither-loading
      role="status"
    >
      <DitherField className="absolute inset-0" frontAlpha={0.38} pixelSize={3} shape="warp" speed={0.45} type="4x4" />
      <div className="relative grid max-w-sm justify-items-center gap-1 rounded-md bg-background px-3 py-2 text-center">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {detail && <span className="text-xs leading-relaxed text-muted-foreground">{detail}</span>}
      </div>
    </div>
  )
}
