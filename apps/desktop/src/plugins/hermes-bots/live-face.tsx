/**
 * The animated bot face: the roster, the collapsed rail and a bot's empty chat
 * use it so an avatar moves with what its bot is doing.
 *
 * Shape faces (the math shapes and blobatar) are redrawn by the motion engine
 * with live eyes. Photos and sigils keep their picture and move as a whole,
 * with the same effects drawn around them. A static `BotFace` stays in
 * the DOM (hidden) so the roster's PNG backfill still finds `data-bot-face`.
 */

import { useEffect, useRef, useState } from 'react'

import { blobBodyColor, BotFace, isBlobShape, parseBlobShape } from './avatar'
import {
  type AvatarState,
  type AvatarSvg,
  buildAvatarSvg,
  createPlayer,
  paintFrame,
  type Player,
  poseTransform,
  type ShapeId,
  SHAPES
} from './motion-engine'
import type { FaceMood } from './types'

interface LiveBotFaceProps {
  color: string
  image?: null | string
  /** The roster's coarse mood, kept on the static face (`data-hb-mood`). */
  mood?: FaceMood
  name: string
  shape: string
  size: number
  state: AvatarState
}

const MATH_SHAPES: Record<string, ShapeId> = {
  circle: 'round',
  cloud: 'cloud',
  drop: 'drop',
  hexagon: 'hexagon',
  pill: 'capsule',
  squircle: 'squircle',
  triangle: 'triangle'
}

const BLOB_SHAPES: Record<string, ShapeId> = {
  boxy: 'squircle',
  capsule: 'capsule',
  cloud: 'cloud',
  droplet: 'drop',
  hexagon: 'hexagon',
  nub: 'pebble',
  organic: 'pebble',
  round: 'round',
  sun: 'sun',
  triangle: 'triangle'
}

/** FNV-1a: a name's stable seed (shape pick, motion shuffle). */
export function nameSeed(name: string): number {
  let h = 0x811c9dc5

  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }

  return h >>> 0
}

export type LiveFacePlan = { kind: 'drawn'; shape: ShapeId } | { kind: 'moved' }

/** Drawn by the engine, or a picture the engine only moves. */
export function liveFacePlan(shape: string, image: null | string | undefined, name: string): LiveFacePlan {
  if (image || shape.startsWith('sigil-')) {
    return { kind: 'moved' }
  }

  if (isBlobShape(shape)) {
    const { kind, seed } = parseBlobShape(shape, name)

    return { kind: 'drawn', shape: BLOB_SHAPES[kind] || SHAPES[nameSeed(seed) % SHAPES.length] }
  }

  return { kind: 'drawn', shape: MATH_SHAPES[shape] || 'round' }
}

// ── one clock for every live face ──────────────────────────────────────────

interface Entry {
  av: AvatarSvg
  mover: HTMLElement | null
  player: Player
  size: number
  visible: boolean
}

const entries = new Set<Entry>()
const entryOf = new WeakMap<Player, Entry>()
let rafId = 0
let last = 0

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function paint(entry: Entry, dt: number) {
  const frame = entry.player.step(dt)
  paintFrame(entry.av, frame)

  if (entry.mover) {
    entry.mover.style.transform = poseTransform(frame.pose, entry.size)
  }
}

function tick(now: number) {
  rafId = 0
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
  last = now

  // A hidden window keeps every face where it was (and costs nothing).
  if (document.visibilityState !== 'hidden') {
    for (const entry of entries) {
      if (entry.visible) {
        paint(entry, dt)
      }
    }
  }

  if (entries.size > 0) {
    rafId = window.requestAnimationFrame(tick)
  }
}

function startClock() {
  if (!rafId && typeof window !== 'undefined' && !reducedMotion()) {
    last = 0
    rafId = window.requestAnimationFrame(tick)
  }
}

let observer: IntersectionObserver | null = null
const byNode = new WeakMap<Element, Entry>()

function watch(node: Element, entry: Entry) {
  if (typeof IntersectionObserver === 'undefined') {
    return
  }

  observer ??= new IntersectionObserver(items => {
    for (const item of items) {
      const hit = byNode.get(item.target)

      if (hit) {
        hit.visible = item.isIntersecting
      }
    }
  })
  byNode.set(node, entry)
  observer.observe(node)
}

// The drawn body is 60% of the engine's viewBox; the static face's body is
// about 70% of its box. Oversizing the SVG keeps the body the same size and
// gives the effects room to draw around it.
const SVG_SCALE = 1.17

export function LiveBotFace({ shape, color, image, mood = 'idle', name, size, state }: LiveBotFaceProps) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const moverRef = useRef<HTMLSpanElement>(null)
  const plan = liveFacePlan(shape, image, name)
  const planKey = plan.kind === 'drawn' ? plan.shape : 'moved'
  const svgSize = Math.round(size * SVG_SCALE)
  const bodyColor = (plan.kind === 'drawn' && isBlobShape(shape) && blobBodyColor(shape, name)) || color

  // One player per mounted face; `state` changes steer it rather than
  // rebuilding it, so a new state blends in from the current pose.
  const [player] = useState(() => createPlayer(nameSeed(name) || 1, state))

  useEffect(() => {
    const host = hostRef.current

    if (!host) {
      return
    }

    const av = buildAvatarSvg(plan.kind === 'drawn' ? plan.shape : 'round', bodyColor, svgSize, plan.kind === 'moved')
    av.svg.setAttribute('aria-hidden', 'true')
    av.svg.setAttribute('data-hb-live', planKey)
    host.replaceChildren(av.svg)

    const entry: Entry = {
      av,
      mover: plan.kind === 'moved' ? moverRef.current : null,
      player,
      size,
      visible: true
    }

    entryOf.set(player, entry)
    entries.add(entry)
    watch(host, entry)
    paint(entry, 0)
    startClock()

    return () => {
      entries.delete(entry)
      entryOf.delete(player)
      observer?.unobserve(host)
    }
    // `plan` is derived from shape/image/name and summarised by planKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, bodyColor, player, size, svgSize])

  useEffect(() => {
    player.setState(state)
    const entry = entryOf.get(player)

    if (entry && reducedMotion()) {
      paint(entry, 0)
    }
  }, [player, state])

  const offset = (size - svgSize) / 2

  return (
    <span
      data-hb-live-face={name}
      data-hb-state={state}
      style={{ width: size, height: size, display: 'block', position: 'relative', lineHeight: 0 }}
    >
      {plan.kind === 'moved' ? (
        <span ref={moverRef} style={{ display: 'block', transformOrigin: '50% 60%', willChange: 'transform' }}>
          <BotFace color={color} image={image} mood={mood} name={name} shape={shape} size={size} />
        </span>
      ) : (
        // Hidden source for the roster's PNG backfill (`svg[data-bot-face]`).
        <span style={{ display: 'none' }}>
          <BotFace color={color} mood={mood} name={name} shape={shape} size={size} />
        </span>
      )}
      <span
        ref={hostRef}
        style={{
          position: 'absolute',
          left: offset,
          top: offset,
          width: svgSize,
          height: svgSize,
          pointerEvents: 'none'
        }}
      />
    </span>
  )
}
