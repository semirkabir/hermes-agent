import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface Hsv {
  h: number
  s: number
  v: number
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

const HEX_RE = /^#?([0-9a-f]{6})$/i
const HSL_RE = /^hsl\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*\)$/i

/** Parse "#rrggbb" or "hsl(h s% l%)" (the preset swatches) into HSV; else null. */
export function hexToHsv(input: null | string | undefined): Hsv | null {
  const hsl = input ? HSL_RE.exec(input.trim()) : null

  if (hsl) {
    const s = clamp01(Number(hsl[2]) / 100)
    const l = clamp01(Number(hsl[3]) / 100)
    const v = l + s * Math.min(l, 1 - l)

    return { h: Number(hsl[1]) % 360, s: v ? 2 * (1 - l / v) : 0, v }
  }

  const match = input ? HEX_RE.exec(input.trim()) : null

  if (!match) {
    return null
  }

  const n = parseInt(match[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0

  if (d) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  }

  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6

    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }

  return `#${[f(5), f(3), f(1)]
    .map(c =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

interface ColorWheelProps {
  value: null | string
  /** Fired while dragging too; callers that persist should debounce. */
  onChange: (hex: string) => void
  className?: string
  hueLabel: string
  brightnessLabel: string
  hexLabel: string
}

/**
 * HSV color wheel: angle = hue, distance from center = saturation, plus a
 * brightness slider and a hex field. Pure CSS gradients, no dependency.
 */
export function ColorWheel({ value, onChange, className, hueLabel, brightnessLabel, hexLabel }: ColorWheelProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 210, s: 0.7, v: 0.95 })
  const [hexDraft, setHexDraft] = useState(() => hsvToHex(hsv))
  const wheelRef = useRef<HTMLDivElement>(null)

  // Follow outside changes (a preset swatch click) without fighting a drag.
  useEffect(() => {
    const next = hexToHsv(value)

    if (next && hsvToHex(next) !== hsvToHex(hsv)) {
      setHsv(next)
      setHexDraft(hsvToHex(next))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only external value changes
  }, [value])

  const commit = (next: Hsv) => {
    setHsv(next)
    const hex = hsvToHex(next)
    setHexDraft(hex)
    onChange(hex)
  }

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = wheelRef.current?.getBoundingClientRect()

    if (!rect) {
      return
    }

    const radius = rect.width / 2
    const dx = event.clientX - rect.left - radius
    const dy = event.clientY - rect.top - radius
    // Clockwise from 12 o'clock, matching conic-gradient's default start.
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360

    commit({ ...hsv, h, s: clamp01(Math.hypot(dx, dy) / radius) })
  }

  const onWheelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 15 : 5

    const moves: Record<string, Partial<Hsv>> = {
      ArrowDown: { s: clamp01(hsv.s - step / 100) },
      ArrowLeft: { h: (hsv.h - step + 360) % 360 },
      ArrowRight: { h: (hsv.h + step) % 360 },
      ArrowUp: { s: clamp01(hsv.s + step / 100) }
    }

    const move = moves[event.key]

    if (move) {
      event.preventDefault()
      event.stopPropagation()
      commit({ ...hsv, ...move })
    }
  }

  const rad = (hsv.h * Math.PI) / 180
  const knobX = 50 + Math.sin(rad) * hsv.s * 50
  const knobY = 50 - Math.cos(rad) * hsv.s * 50
  const hex = hsvToHex(hsv)
  const fullBright = hsvToHex({ ...hsv, v: 1 })

  // Menus run typeahead/arrow navigation on keydown; keep keys in our fields.
  const keepKeys = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      event.stopPropagation()
    }
  }

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div
        aria-label={hueLabel}
        aria-valuemax={360}
        aria-valuemin={0}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={hex}
        className="relative aspect-square w-full max-w-32 cursor-crosshair touch-none rounded-full focus-visible:outline-2 focus-visible:outline-ring"
        data-testid="color-wheel"
        onKeyDown={onWheelKey}
        onPointerDown={event => {
          try {
            // Keep tracking when the drag leaves the wheel; unsupported for
            // some synthetic/pen pointers, where plain moves still work.
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // ignore
          }

          fromPointer(event)
        }}
        onPointerMove={event => {
          if (event.buttons & 1) {
            fromPointer(event)
          }
        }}
        ref={wheelRef}
        role="slider"
        style={{
          background:
            'radial-gradient(circle closest-side, #fff, transparent), conic-gradient(red, yellow, lime, cyan, blue, magenta, red)'
        }}
        tabIndex={0}
      >
        {/* Brightness dims the whole wheel, like a real HSV picker. */}
        <div className="pointer-events-none absolute inset-0 rounded-full bg-black" style={{ opacity: 1 - hsv.v }} />
        <span
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
          style={{ backgroundColor: hex, left: `${knobX}%`, top: `${knobY}%` }}
        />
      </div>
      <input
        aria-label={brightnessLabel}
        className="h-2 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow"
        max={100}
        min={0}
        onChange={event => commit({ ...hsv, v: Number(event.target.value) / 100 })}
        onKeyDown={keepKeys}
        style={{ background: `linear-gradient(to right, #000, ${fullBright})` }}
        type="range"
        value={Math.round(hsv.v * 100)}
      />
      <label className="flex h-6 w-full items-center gap-1.5 rounded-md bg-(--ui-control-hover-background) px-1.5">
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: hex }} />
        <input
          aria-label={hexLabel}
          className="min-w-0 flex-1 bg-transparent font-mono text-[0.6875rem] text-foreground focus:outline-none"
          maxLength={7}
          onBlur={() => setHexDraft(hex)}
          onChange={event => {
            const draft = event.target.value
            setHexDraft(draft)
            const next = hexToHsv(draft)

            if (next) {
              setHsv(next)
              onChange(hsvToHex(next))
            }
          }}
          onKeyDown={keepKeys}
          spellCheck={false}
          type="text"
          value={hexDraft}
        />
      </label>
    </div>
  )
}
