/**
 * Hermes avatar motion: a living bot face driven by agent state.
 *
 * Each state picks a pool of keyframed body clips, an optional face override
 * and an optional effect drawn around the body; eyes blink and morph on their
 * own. Clips, states, eyes, overlays and the pseudo-3D projection all live
 * in this file.
 *
 * Pure module: `createPlayer` advances time and returns a `Frame`; `paintFrame`
 * writes that frame into an <svg> built by `buildAvatarSvg`. No React here —
 * `live-face.tsx` mounts it and `motion-state.ts` picks the state.
 */

// ── math ────────────────────────────────────────────────────────────────────

export type Vec2 = [number, number]
type Bezier = [number, number, number, number]

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const rad = (d: number) => (d * Math.PI) / 180

/** cubic-bezier(x1,y1,x2,y2) easing, solved for x by Newton + bisection. */
function bezier([x1, y1, x2, y2]: Bezier, x: number): number {
  if (x <= 0) {
    return 0
  }

  if (x >= 1) {
    return 1
  }

  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3
  let lo = 0
  let hi = 1
  let t = x

  for (let i = 0; i < 18; i++) {
    const v = bx(t)

    if (Math.abs(v - x) < 1e-4) {
      break
    }

    if (v < x) {
      lo = t
    } else {
      hi = t
    }

    t = (lo + hi) / 2
  }

  return by(t)
}

const EASE: Record<string, Bezier> = {
  inOut: [0.45, 0, 0.55, 1],
  out: [0.2, 0.8, 0.3, 1],
  in: [0.5, 0, 0.8, 0.4],
  back: [0.3, 1.45, 0.5, 1],
  snap: [0.6, 0, 0.2, 1.2],
  soft: [0.35, 0.1, 0.25, 1]
}

// ── body shapes (polar outlines, unit radius) ───────────────────────────────

export type ShapeId =
  | 'round'
  | 'squircle'
  | 'pebble'
  | 'capsule'
  | 'hexagon'
  | 'triangle'
  | 'cloud'
  | 'drop'
  | 'flower'
  | 'sun'
  | 'star'
  | 'clover'

export const SHAPES: ShapeId[] = [
  'round',
  'squircle',
  'pebble',
  'capsule',
  'hexagon',
  'triangle',
  'cloud',
  'drop',
  'flower',
  'sun',
  'star',
  'clover'
]

/** Rounded regular polygon radius at angle a (n sides, corner softness s). */
function polyR(a: number, n: number, s: number) {
  const seg = (Math.PI * 2) / n
  const local = ((((a + Math.PI / 2) % seg) + seg) % seg) - seg / 2
  const flat = Math.cos(Math.PI / n) / Math.cos(local)

  return lerp(flat, 1, s) * 0.98
}

function superR(a: number, n: number, ax = 1, ay = 1) {
  const c = Math.abs(Math.cos(a)) / ax
  const s = Math.abs(Math.sin(a)) / ay

  return (c ** n + s ** n) ** (-1 / n)
}

/** Ray from the origin at angle a: farthest exit through a union of circles. */
function circlesR(a: number, circles: [number, number, number][]) {
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  let best = 0

  for (const [cx, cy, r] of circles) {
    const b = dx * cx + dy * cy
    const disc = b * b - (cx * cx + cy * cy - r * r)

    if (disc >= 0) {
      best = Math.max(best, b + Math.sqrt(disc))
    }
  }

  return best
}

const CLOUD: [number, number, number][] = [
  [-0.5, -0.12, 0.46],
  [-0.18, 0.28, 0.5],
  [0.32, 0.22, 0.52],
  [0.58, -0.14, 0.42],
  [0.02, -0.26, 0.5]
]

/** Radius of each shape's outline at angle a (0 = right, counter-clockwise, y up). */
const POLAR: Record<ShapeId, (a: number) => number> = {
  round: () => 1,
  squircle: a => superR(a, 4.2) * 0.9,
  pebble: a => superR(a, 2.4, 1.08, 0.9) * (1 + 0.04 * Math.sin(a * 2 + 0.6)),
  capsule: a => superR(a, 3.2, 1.12, 0.74),
  hexagon: a => polyR(a + Math.PI / 6, 6, 0.28),
  triangle: a => polyR(a + Math.PI / 3, 3, 0.3) * 1.08,
  cloud: a => circlesR(a, CLOUD),
  drop: a => {
    const up = Math.max(0, Math.sin(a))

    return 0.92 + 0.22 * up ** 6 - 0.06 * up
  },
  flower: a => 0.86 + 0.14 * Math.abs(Math.cos(2.5 * (a - Math.PI / 2))) ** 0.7,
  sun: a => 0.9 + 0.08 * Math.max(0, Math.cos(10 * a)) ** 3,
  star: a => 0.78 + 0.22 * Math.max(0, Math.cos(2 * (a - Math.PI / 2) * 2.5)) ** 1.6 * 1.0,
  clover: a => 0.78 + 0.22 * Math.abs(Math.cos(2 * a)) ** 0.5
}

/** Sample a shape outline into `steps` points on a unit-ish ring. */
export function shapeRing(shape: ShapeId, steps = 96): Vec2[] {
  const f = POLAR[shape] ?? POLAR.round
  const pts: Vec2[] = []

  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const r = f(a)
    pts.push([Math.cos(a) * r, Math.sin(a) * r])
  }

  return pts
}

// ── pose + projection ──────────────────────────────────────────────────────

export interface Pose {
  /** pitch (nod), yaw (turn), roll (tilt), degrees */
  rx: number
  ry: number
  rz: number
  /** hop / drop in body units (+ is up) */
  y: number
  /** squash: >1 wide-and-short, <1 tall-and-thin */
  squash: number
  /** uniform breathing scale */
  scale: number
}

export const REST: Pose = { rx: 0, ry: 0, rz: 0, y: 0, squash: 1, scale: 1 }

/** How deep the body is relative to its width. A puffy body never turns into
 *  a sliver on a full spin, which is what keeps a 2D outline reading as 3D. */
const DEPTH = 0.82

function projectRing(ring: Vec2[], p: Pose): Vec2[] {
  const cy = Math.cos(rad(p.ry))
  const sy = Math.sin(rad(p.ry))
  const cx = Math.cos(rad(p.rx))
  const sx = Math.sin(rad(p.rx))
  const wx = Math.sqrt(cy * cy + DEPTH * DEPTH * sy * sy)
  const wy = Math.sqrt(cx * cx + DEPTH * DEPTH * sx * sx)
  const rz = rad(p.rz)
  const cz = Math.cos(rz)
  const sz = Math.sin(rz)
  const sqx = p.squash
  const sqy = 1 / p.squash

  return ring.map(([x, y]) => {
    const X = x * wx * sqx * p.scale
    const Y = y * wy * sqy * p.scale

    return [X * cz - Y * sz, X * sz + Y * cz + p.y]
  })
}

/** Where a point on the body's front surface lands, plus whether it faces us. */
function projectSurface(x: number, y: number, p: Pose): { pt: Vec2; facing: number } {
  // front surface of an ellipsoid-ish body: z from the depth ratio
  const z = DEPTH * Math.sqrt(Math.max(0, 1 - Math.min(1, x * x + y * y)))
  const a = rad(p.ry)
  const b = rad(p.rx)
  // yaw around y, then pitch around x
  let X = x * Math.cos(a) + z * Math.sin(a)
  let Z = -x * Math.sin(a) + z * Math.cos(a)
  let Y = y * Math.cos(b) - Z * Math.sin(b)
  Z = y * Math.sin(b) + Z * Math.cos(b)
  X *= p.squash * p.scale
  Y *= (1 / p.squash) * p.scale
  const rz = rad(p.rz)
  const out: Vec2 = [X * Math.cos(rz) - Y * Math.sin(rz), X * Math.sin(rz) + Y * Math.cos(rz) + p.y]

  return { pt: out, facing: Z }
}

// ── eyes ───────────────────────────────────────────────────────────────────

export type Expression =
  'neutral' | 'happy' | 'surprised' | 'sleepy' | 'squint' | 'calm' | 'sad' | 'inspect' | 'confused'

/** One eye: a capsule (w x h, tilt) or an arc (curve > 0 smile-up "^", < 0 "u"). */
interface EyeShape {
  w: number
  h: number
  tilt: number
  dy: number
  arc: number
}

const CAP = (w: number, h: number, tilt = 0, dy = 0): EyeShape => ({ w, h, tilt, dy, arc: 0 })
const ARC = (w: number, arc: number, dy = 0, tilt = 0): EyeShape => ({ w, h: 0.05, tilt, dy, arc })

/** [left, right] eye shapes in body units (eye spacing is fixed). */
const EXPRESSIONS: Record<Expression, [EyeShape, EyeShape]> = {
  neutral: [CAP(0.17, 0.4), CAP(0.17, 0.4)],
  happy: [ARC(0.3, 0.13, 0.03), ARC(0.3, 0.13, 0.03)],
  surprised: [CAP(0.25, 0.48), CAP(0.25, 0.48)],
  sleepy: [ARC(0.3, -0.04, -0.05), ARC(0.3, -0.04, -0.05)],
  squint: [CAP(0.22, 0.12, 8), CAP(0.22, 0.12, -8)],
  calm: [ARC(0.27, -0.1, -0.02), ARC(0.27, -0.1, -0.02)],
  sad: [CAP(0.17, 0.32, -16, -0.05), CAP(0.17, 0.32, 16, -0.05)],
  inspect: [CAP(0.22, 0.44), CAP(0.13, 0.24, 0, 0.03)],
  confused: [CAP(0.17, 0.36, 12), ARC(0.27, 0.08, 0.04, -10)]
}

const EYE_X = 0.25
const EYE_Y = 0.1

function mixEye(a: EyeShape, b: EyeShape, t: number): EyeShape {
  return {
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
    tilt: lerp(a.tilt, b.tilt, t),
    dy: lerp(a.dy, b.dy, t),
    arc: lerp(a.arc, b.arc, t)
  }
}

// ── clips (our own keyframes) ──────────────────────────────────────────────

type TrackKey = 'rx' | 'ry' | 'rz' | 'y' | 'squash' | 'scale'
interface Key {
  t: number
  v: number
  e?: keyof typeof EASE
}
interface Clip {
  dur: number
  tracks: Partial<Record<TrackKey, Key[]>>
  /** expression changes at times */
  faces?: { t: number; face: Expression }[]
  /** blink times */
  blinks?: number[]
}

const k = (t: number, v: number, e: keyof typeof EASE = 'inOut'): Key => ({ t, v, e })

export const CLIPS: Record<string, Clip> = {
  // idle family
  sway: {
    dur: 4.2,
    tracks: {
      ry: [k(0, 0), k(1.1, 7), k(2.6, -6), k(4.2, 0)],
      rz: [k(0, 0), k(1.4, -2.5), k(3, 2), k(4.2, 0)],
      scale: [k(0, 1), k(2.1, 1.025), k(4.2, 1)]
    },
    blinks: [1.5, 3.5]
  },
  glance: {
    dur: 5.8,
    tracks: {
      ry: [k(0, 0), k(0.7, 28, 'out'), k(2.4, 28), k(3.1, -18, 'inOut'), k(4.6, -18), k(5.8, 0)],
      rx: [k(0, 0), k(0.7, -6), k(3.1, 4), k(5.8, 0)],
      rz: [k(0, 0), k(0.7, 6), k(3.1, -5), k(5.8, 0)]
    },
    blinks: [0.75, 3.15]
  },
  pirouette: {
    dur: 5.6,
    tracks: {
      ry: [k(0, 0), k(0.6, -24, 'inOut'), k(2.4, 360, 'soft'), k(5.6, 360)],
      rx: [k(0, 0), k(1.4, -12), k(2.6, 0), k(5.6, 0)],
      y: [k(0, 0), k(1.2, 0.06, 'out'), k(2.4, 0, 'in'), k(5.6, 0)]
    },
    blinks: [3.4]
  },
  // working family
  flip: {
    dur: 6.5,
    tracks: {
      rx: [k(0, 0), k(1.2, 14, 'inOut'), k(2.6, -360, 'snap'), k(6.5, -360)],
      y: [k(0, 0), k(1.6, 0.12, 'out'), k(2.6, 0, 'in'), k(6.5, 0)],
      squash: [k(0, 1), k(1.1, 1.12), k(1.5, 0.9), k(2.7, 1.1, 'out'), k(3.1, 1)]
    },
    faces: [
      { t: 1.4, face: 'surprised' },
      { t: 3.4, face: 'neutral' }
    ],
    blinks: [5]
  },
  spin: {
    dur: 4.6,
    tracks: {
      ry: [k(0, 0), k(0.5, 26, 'out'), k(2, -360, 'snap'), k(4.6, -360)],
      squash: [k(0, 1), k(0.6, 1.1), k(1.4, 0.92), k(2.2, 1.06, 'back'), k(2.7, 1)]
    },
    faces: [
      { t: 0.3, face: 'inspect' },
      { t: 2.4, face: 'neutral' }
    ]
  },
  rock: {
    dur: 4.8,
    tracks: {
      rz: [k(0, 0), k(0.8, 26), k(1.8, -28), k(2.8, 22), k(3.8, -14), k(4.8, 0)],
      rx: [k(0, 0), k(2.4, 10), k(4.8, 0)]
    },
    faces: [
      { t: 0, face: 'surprised' },
      { t: 4.2, face: 'neutral' }
    ]
  },
  ponder: {
    dur: 5,
    tracks: {
      ry: [k(0, 0), k(1.2, -20), k(2.6, 18), k(3.8, -8), k(5, 0)],
      rx: [k(0, 0), k(1.6, -12), k(3.4, 8), k(5, 0)]
    },
    faces: [
      { t: 0.4, face: 'calm' },
      { t: 4.4, face: 'neutral' }
    ]
  },
  scan: {
    dur: 4,
    tracks: {
      ry: [k(0, 0), k(0.5, -30, 'out'), k(1.4, -30), k(2, 30, 'inOut'), k(3, 30), k(4, 0)],
      rx: [k(0, -6), k(4, -6)]
    },
    faces: [
      { t: 0.4, face: 'surprised' },
      { t: 3.6, face: 'neutral' }
    ],
    blinks: [1.8]
  },
  tumble: {
    dur: 5,
    tracks: {
      rx: [k(0, 0), k(1, 10), k(2.1, 360, 'snap'), k(5, 360)],
      rz: [k(0, 0), k(1.6, -10), k(2.6, 6), k(3.4, 0)]
    },
    blinks: [1.05, 3.6]
  },
  // replying
  nod: {
    dur: 2.5,
    tracks: {
      rx: [k(0, 0), k(0.35, 12), k(0.8, -6), k(1.3, 10), k(1.8, -4), k(2.5, 0)],
      ry: [k(0, -8), k(1.25, 10), k(2.5, -8)]
    },
    blinks: [2]
  },
  chatter: {
    dur: 2.4,
    tracks: {
      ry: [k(0, 0), k(0.6, 16), k(1.4, -14), k(2.4, 0)],
      rz: [k(0, 0), k(0.8, -8), k(1.6, 8), k(2.4, 0)],
      squash: [k(0, 1), k(0.3, 1.05), k(0.6, 1), k(1.2, 1.05), k(1.5, 1)]
    },
    faces: [
      { t: 0.6, face: 'surprised' },
      { t: 1.6, face: 'neutral' }
    ]
  },
  // outcomes
  hop: {
    dur: 2.3,
    tracks: {
      squash: [k(0, 1), k(0.3, 1.2, 'out'), k(0.5, 0.82), k(0.95, 0.88), k(1.15, 1.18, 'out'), k(1.5, 0.96), k(1.8, 1)],
      y: [k(0, 0), k(0.45, 0, 'in'), k(0.75, 0.22, 'out'), k(1.1, 0, 'in'), k(2.3, 0)],
      rz: [k(0, 0), k(0.7, -8), k(1.2, 6), k(2.3, 0)]
    },
    faces: [{ t: 0.15, face: 'happy' }]
  },
  bounce: {
    dur: 1.2,
    tracks: { squash: [k(0, 1), k(0.25, 1.22, 'out'), k(0.5, 0.86), k(0.8, 1.06), k(1.2, 1)] },
    faces: [{ t: 0, face: 'happy' }]
  },
  wiggle: {
    dur: 2,
    tracks: {
      rz: [k(0, 0), k(0.3, 14), k(0.6, -14), k(0.9, 10), k(1.2, -6), k(2, 0)],
      rx: [k(0, 0), k(1, -16), k(2, 0)]
    },
    faces: [
      { t: 0.1, face: 'happy' },
      { t: 1.7, face: 'neutral' }
    ]
  },
  shake: {
    dur: 2.1,
    tracks: {
      ry: [k(0, 0), k(0.25, 22), k(0.5, -18), k(0.75, 14), k(1, -8), k(1.4, 0)],
      rz: [k(0, 0), k(0.8, 8), k(2.1, 0)],
      scale: [k(0, 1), k(0.6, 0.94), k(2.1, 1)]
    },
    faces: [
      { t: 0.05, face: 'confused' },
      { t: 1.8, face: 'neutral' }
    ]
  },
  droop: {
    dur: 2.8,
    tracks: { rx: [k(0, 0), k(0.9, 22, 'soft'), k(2.8, 22)], y: [k(0, 0), k(0.9, -0.05), k(2.8, -0.05)] },
    faces: [{ t: 0.2, face: 'sad' }]
  },
  doze: {
    dur: 1.6,
    tracks: { rx: [k(0, 20), k(0.8, 26), k(1.6, 20)], ry: [k(0, -10), k(0.8, 8), k(1.6, -10)] },
    faces: [{ t: 0, face: 'sleepy' }]
  },
  celebrate: {
    dur: 5.4,
    tracks: {
      ry: [k(0, 0), k(0.5, -30, 'out'), k(2.6, 720, 'soft'), k(5.4, 720)],
      y: [k(0, 0), k(0.8, 0.14, 'out'), k(1.8, 0.02), k(2.4, 0.1, 'out'), k(3, 0, 'in'), k(5.4, 0)],
      squash: [k(2.9, 1), k(3.1, 1.2), k(3.4, 0.92), k(3.8, 1)]
    },
    faces: [{ t: 0, face: 'happy' }]
  },
  turntable: { dur: 10, tracks: { ry: [k(0, 0, 'inOut'), k(10, 360, 'inOut')], rx: [k(0, -6), k(10, -6)] } },
  approve: {
    dur: 3.4,
    tracks: { rx: [k(0, 0), k(0.4, 18), k(0.9, -4), k(1.4, 16), k(2, 0)], rz: [k(0, 8), k(2, 14), k(3.4, 8)] },
    blinks: [2.6]
  }
}

// ── states ─────────────────────────────────────────────────────────────────

export type Effect = 'dots' | 'radar' | 'orbit' | 'progress' | 'pencil' | 'send' | 'halo' | 'spawn'

export type AvatarState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'streaming'
  | 'searching'
  | 'reading'
  | 'working'
  | 'coding'
  | 'running'
  | 'computing'
  | 'waiting'
  | 'writing'
  | 'sending'
  | 'spawning'
  | 'generating'
  | 'blocked'
  | 'finished'
  | 'failed'
  | 'sleeping'
  | 'waking'
  | 'celebrate'
  | 'approving'
  | 'happy'
  | 'curious'
  | 'confused'
  | 'sad'
  | 'drowsy'
  | 'surprised'
  | 'turntable'

interface StateDef {
  clips: string[]
  face?: Expression
  effect?: Effect
  /** state to fall into after `hold` seconds (or after one clip when hold is absent) */
  then?: AvatarState
  hold?: number
}

const WORK = ['flip', 'spin', 'rock', 'ponder', 'scan', 'tumble']
const IDLE = ['sway', 'sway', 'glance', 'sway', 'pirouette']

export const STATES: Record<AvatarState, StateDef> = {
  idle: { clips: IDLE },
  listening: { clips: ['ponder'], face: 'calm' },
  thinking: { clips: ['sway'], effect: 'dots' },
  streaming: { clips: ['nod', 'chatter', 'nod'] },
  searching: { clips: ['sway'], effect: 'radar' },
  reading: { clips: WORK },
  working: { clips: WORK },
  coding: { clips: WORK },
  running: { clips: WORK },
  computing: { clips: WORK },
  waiting: { clips: ['sway'], effect: 'orbit' },
  writing: { clips: ['sway'], effect: 'pencil' },
  sending: { clips: ['sway'], effect: 'send' },
  spawning: { clips: ['sway'], effect: 'spawn' },
  generating: { clips: ['sway'], effect: 'progress' },
  blocked: { clips: ['shake'], then: 'drowsy', hold: 120 },
  finished: { clips: ['bounce', 'hop'], face: 'happy', then: 'idle' },
  failed: { clips: ['droop'], then: 'idle' },
  sleeping: { clips: ['doze'], face: 'sleepy', effect: 'halo' },
  waking: { clips: ['sway'], face: 'surprised', then: 'idle', hold: 1.6 },
  celebrate: { clips: ['celebrate'], face: 'happy' },
  approving: { clips: ['approve'], then: 'idle' },
  happy: { clips: ['hop'] },
  curious: { clips: ['spin'], face: 'inspect' },
  confused: { clips: ['shake'] },
  sad: { clips: ['droop'] },
  drowsy: { clips: ['doze'] },
  surprised: { clips: ['sway'], face: 'surprised' },
  turntable: { clips: ['turntable'] }
}

export const STATE_NAMES = Object.keys(STATES) as AvatarState[]

// ── player ─────────────────────────────────────────────────────────────────

export interface Frame {
  pose: Pose
  eyes: [EyeShape, EyeShape]
  /** 0 open … 1 shut */
  lid: number
  effect: Effect | null
  /** 0..1 fade of the effect (cross-fades on state change) */
  effectAmount: number
  /** seconds since the current state began */
  stateTime: number
}

function sampleTrack(keys: Key[] | undefined, t: number, fallback: number): number {
  if (!keys || keys.length === 0) {
    return fallback
  }

  if (t <= keys[0].t) {
    return keys[0].v
  }

  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]

    if (t <= b.t) {
      const a = keys[i - 1]
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t)

      return lerp(a.v, b.v, bezier(EASE[b.e ?? 'inOut'], u))
    }
  }

  return keys[keys.length - 1].v
}

function clipPose(clip: Clip, t: number): Pose {
  const tr = clip.tracks
  // full turns are authored as 360 multiples so the clip ends where it began
  const wrap = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180

  return {
    rx: wrap(sampleTrack(tr.rx, t, 0)),
    ry: wrap(sampleTrack(tr.ry, t, 0)),
    rz: sampleTrack(tr.rz, t, 0),
    y: sampleTrack(tr.y, t, 0),
    squash: sampleTrack(tr.squash, t, 1),
    scale: sampleTrack(tr.scale, t, 1)
  }
}

function clipFace(clip: Clip, t: number, base: Expression): Expression {
  let face = base

  for (const f of clip.faces ?? []) {
    if (t >= f.t) {
      face = f.face
    }
  }

  return face
}

const BLINK = 0.16
const MIX = 0.45 // seconds to blend between clips / poses
const FACE_MIX = 0.22

function blinkAt(times: number[] | undefined, t: number): number {
  let lid = 0

  for (const b of times ?? []) {
    const u = (t - b) / BLINK

    if (u >= 0 && u <= 1) {
      lid = Math.max(lid, Math.sin(u * Math.PI))
    }
  }

  return lid
}

function mixPose(a: Pose, b: Pose, t: number): Pose {
  const angle = (x: number, y: number) => x + (((((y - x + 180) % 360) + 360) % 360) - 180) * t

  return {
    rx: angle(a.rx, b.rx),
    ry: angle(a.ry, b.ry),
    rz: lerp(a.rz, b.rz, t),
    y: lerp(a.y, b.y, t),
    squash: lerp(a.squash, b.squash, t),
    scale: lerp(a.scale, b.scale, t)
  }
}

export interface Player {
  setState(state: AvatarState): void
  readonly state: AvatarState
  step(dt: number): Frame
}

/** A seeded, deterministic player: same seed + same calls = same motion. */
export function createPlayer(seed = 1, initial: AvatarState = 'idle'): Player {
  let rng = seed >>> 0 || 1

  const rand = () => {
    rng ^= rng << 13
    rng ^= rng >>> 17
    rng ^= rng << 5

    return ((rng >>> 0) % 100000) / 100000
  }

  let state: AvatarState = initial
  let stateTime = 0
  let queue: string[] = []
  let clipName = ''
  let clipTime = 0
  let fromPose: Pose = REST
  let blendT = 1
  let face: Expression = 'neutral'
  let fromFace: Expression = 'neutral'
  let faceT = 1
  let effect: Effect | null = null
  let prevEffect: Effect | null = null
  let effectT = 1
  let lastPose: Pose = REST
  let ambientBlink = 2 + rand() * 3

  const nextClip = () => {
    const def = STATES[state]

    if (queue.length === 0) {
      queue = [...def.clips]

      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))

        ;[queue[i], queue[j]] = [queue[j], queue[i]]
      }

      if (queue.length > 1 && queue[0] === clipName) {
        queue.push(queue.shift() as string)
      }
    }

    fromPose = lastPose
    blendT = 0
    clipName = queue.shift() as string
    clipTime = 0
  }

  const enter = (s: AvatarState) => {
    prevEffect = effect
    state = s
    stateTime = 0
    queue = []
    effect = STATES[s].effect ?? null
    effectT = prevEffect === effect ? 1 : 0
    nextClip()
  }

  enter(initial)

  return {
    get state() {
      return state
    },
    setState(s) {
      if (s !== state) {
        enter(s)
      }
    },
    step(dt) {
      stateTime += dt
      clipTime += dt
      blendT = Math.min(1, blendT + dt / MIX)
      faceT = Math.min(1, faceT + dt / FACE_MIX)
      effectT = Math.min(1, effectT + dt / 0.35)

      const def = STATES[state]
      let clip = CLIPS[clipName]

      if (clipTime >= clip.dur) {
        if (def.then && def.hold === undefined) {
          enter(def.then)
        } else {
          nextClip()
        }

        clip = CLIPS[clipName]
      }

      if (def.then && def.hold !== undefined && stateTime >= def.hold) {
        enter(def.then)
        clip = CLIPS[clipName]
      }

      const target = clipPose(clip, clipTime)
      const pose = blendT < 1 ? mixPose(fromPose, target, bezier(EASE.inOut, blendT)) : target
      lastPose = pose

      const wanted = clipFace(clip, clipTime, STATES[state].face ?? 'neutral')
      // a state's face override wins over a clip's neutral beats
      const nextFace = STATES[state].face && wanted === 'neutral' ? (STATES[state].face as Expression) : wanted

      if (nextFace !== face) {
        fromFace = face
        face = nextFace
        faceT = 0
      }

      let lid = blinkAt(clip.blinks, clipTime)
      // ambient blinks for faces with open capsule eyes
      ambientBlink -= dt

      if (ambientBlink <= 0) {
        ambientBlink = 2.5 + rand() * 4
      }

      if (ambientBlink < BLINK) {
        lid = Math.max(lid, Math.sin((1 - ambientBlink / BLINK) * Math.PI))
      }

      // switching between capsule and arc eyes goes through a quick close
      const a = EXPRESSIONS[fromFace]
      const b = EXPRESSIONS[face]
      const kindFlip = (a[0].arc === 0) !== (b[0].arc === 0)
      let eyes: [EyeShape, EyeShape]

      if (kindFlip) {
        const half = faceT < 0.5
        eyes = half ? a : b
        lid = Math.max(lid, Math.sin(faceT * Math.PI))
      } else {
        const u = bezier(EASE.out, faceT)
        eyes = [mixEye(a[0], b[0], u), mixEye(a[1], b[1], u)]
      }

      return { pose, eyes, lid, ...effectMix(effectT, prevEffect, effect), stateTime }
    }
  }
}

/** The effect on screen while the previous one fades out and the next fades in. */
function effectMix(
  t: number,
  prev: Effect | null,
  next: Effect | null
): { effect: Effect | null; effectAmount: number } {
  if (t < 1 && prev) {
    return { effect: prev, effectAmount: prev === next ? t : 1 - t }
  }

  return { effect: next, effectAmount: next ? t : 0 }
}

// ── SVG painting ───────────────────────────────────────────────────────────

const NS = 'http://www.w3.org/2000/svg'
/** Body radius in viewBox units (viewBox 0 0 100 100, body centred). */
const R = 30
const CX = 50
const CY = 52

const toView = ([x, y]: Vec2): Vec2 => [CX + x * R, CY - y * R]

function ringPath(pts: Vec2[]): string {
  // Catmull-Rom through the projected ring -> smooth closed cubic path
  const v = pts.map(toView)
  const n = v.length
  let d = `M${v[0][0].toFixed(2)} ${v[0][1].toFixed(2)}`

  for (let i = 0; i < n; i++) {
    const p0 = v[(i - 1 + n) % n]
    const p1 = v[i]
    const p2 = v[(i + 1) % n]
    const p3 = v[(i + 2) % n]
    const c1: Vec2 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: Vec2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
  }

  return `${d}Z`
}

export interface AvatarSvg {
  svg: SVGSVGElement
  ring: Vec2[]
  body: SVGPathElement
  eyes: [SVGPathElement, SVGPathElement]
  fx: SVGGElement
  clip: SVGPathElement
  color: string
  bodyless: boolean
  ink: string
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(NS, tag)

  for (const [key, val] of Object.entries(attrs)) {
    node.setAttribute(key, String(val))
  }

  return node
}

function isDark(hex: string) {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255

  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110
}

let clipSerial = 0

/** `bodyless` draws only the effects layer: the caller moves its own face
 *  (a photo, a sigil) with `poseTransform` and lays this on top. */
export function buildAvatarSvg(shape: ShapeId, color: string, size = 96, bodyless = false): AvatarSvg {
  const svg = el('svg', { viewBox: '0 0 100 100', width: size, height: size }) as SVGSVGElement
  svg.style.overflow = 'visible'
  const ink = isDark(color) ? 'rgba(240,232,214,0.95)' : 'rgba(18,16,24,0.88)'
  const fx = el('g', { 'data-fx': 1 })
  const body = el('path', { fill: color })
  const eyeL = el('path', { fill: ink, stroke: ink, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  const eyeR = el('path', { fill: ink, stroke: ink, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  // eyes are clipped to the body so a turned face never pokes past the edge
  const clipId = `hb-motion-clip-${++clipSerial}`
  const defs = el('defs')
  const clipEl = el('clipPath', { id: clipId })
  const clip = el('path')
  clipEl.append(clip)
  defs.append(clipEl)
  const eyeGroup = el('g', { 'clip-path': `url(#${clipId})` })
  eyeGroup.append(eyeL, eyeR)
  svg.append(defs, fx, body, eyeGroup)

  if (bodyless) {
    body.setAttribute('display', 'none')
    eyeGroup.setAttribute('display', 'none')
  }

  return { svg, ring: shapeRing(shape), body, eyes: [eyeL, eyeR], fx, clip, color, ink, bodyless }
}

function eyePath(e: EyeShape, centre: Vec2, lid: number, facing: number, p: Pose): { d: string; stroke: number } {
  const [cx, cy] = toView(centre)
  const squash = Math.max(0.35, facing) // eyes foreshorten as the face turns away
  const tilt = rad(e.tilt + p.rz)

  const rot = (x: number, y: number): string => {
    const X = x * Math.cos(tilt) - y * Math.sin(tilt)
    const Y = x * Math.sin(tilt) + y * Math.cos(tilt)

    return `${(cx + X).toFixed(2)} ${(cy + Y).toFixed(2)}`
  }

  const w = e.w * R * squash * 0.5

  if (e.arc !== 0) {
    // stroked arc: "^" (arc > 0, happy) or "u" (arc < 0, calm/sleepy)
    const h = -e.arc * R * (1 - lid * 0.6)

    return { d: `M${rot(-w, 0)}Q${rot(0, h * 2)} ${rot(w, 0)}`, stroke: R * 0.1 }
  }

  const h = Math.max(0.35, e.h * R * 0.5 * (1 - lid))
  const r = Math.min(w, h)

  // rounded capsule
  return {
    d:
      `M${rot(-w + r, -h)}L${rot(w - r, -h)}A${r} ${r} 0 0 1 ${rot(w, -h + r)}` +
      `L${rot(w, h - r)}A${r} ${r} 0 0 1 ${rot(w - r, h)}L${rot(-w + r, h)}` +
      `A${r} ${r} 0 0 1 ${rot(-w, h - r)}L${rot(-w, -h + r)}A${r} ${r} 0 0 1 ${rot(-w + r, -h)}Z`,
    stroke: 0
  }
}

/** Effect geometry around the body. Everything is drawn in the body colour. */
function paintEffect(av: AvatarSvg, f: Frame) {
  const g = av.fx

  while (g.firstChild) {
    g.removeChild(g.firstChild)
  }

  if (!f.effect || f.effectAmount <= 0.01) {
    return
  }

  const a = f.effectAmount
  const t = f.stateTime
  const c = av.color

  const dot = (x: number, y: number, r: number, o: number) =>
    g.append(
      el('circle', {
        cx: x.toFixed(2),
        cy: y.toFixed(2),
        r: Math.max(0.2, r).toFixed(2),
        fill: c,
        opacity: clamp(o).toFixed(3)
      })
    )

  const ring = (r: number, w: number, o: number, dash?: string) =>
    g.append(
      el('circle', {
        cx: CX,
        cy: CY,
        r: r.toFixed(2),
        fill: 'none',
        stroke: c,
        'stroke-width': w.toFixed(2),
        opacity: clamp(o).toFixed(3),
        ...(dash ? { 'stroke-dasharray': dash, 'stroke-linecap': 'round' } : {})
      })
    )

  switch (f.effect) {
    case 'dots': {
      // three thought dots climbing up and to the right, each popping in turn
      for (let i = 0; i < 3; i++) {
        const ph = (t * 1.4 - i * 0.22) % 1.6
        const pop = ph < 0 ? 0 : Math.sin(clamp(ph / 0.5) * Math.PI * 0.5)
        const lift = Math.sin(t * 2.2 + i) * 1.2
        dot(CX + R * 0.95 + i * 7, CY - R * 0.95 - i * 6 + lift, (2.4 + i * 0.9) * pop * a, a * (0.5 + 0.5 * pop))
      }

      break
    }

    case 'radar': {
      for (let i = 0; i < 3; i++) {
        const u = (t / 1.4 + i / 3) % 1
        ring(R * (1.08 + u * 0.9), 2.2 * (1 - u * 0.6), a * (1 - u) * 0.8)
      }

      break
    }

    case 'orbit': {
      for (let i = 0; i < 5; i++) {
        const ang = t * 1.8 + (i * Math.PI * 2) / 5
        const front = Math.cos(ang)
        const r = R * 1.45
        dot(
          CX + r * Math.sin(ang),
          CY + r * 0.38 * Math.cos(ang) + 4,
          (2 + 1.2 * clamp(front)) * a,
          a * (0.35 + 0.65 * clamp((front + 0.4) / 1.4))
        )
      }

      break
    }

    case 'progress': {
      const r = R * 1.32
      const frac = (t % 3.2) / 3
      ring(r, 2.6, a * 0.16)
      const circ = 2 * Math.PI * r

      const arc = el('circle', {
        cx: CX,
        cy: CY,
        r: r.toFixed(2),
        fill: 'none',
        stroke: c,
        'stroke-width': 2.6,
        'stroke-linecap': 'round',
        'stroke-dasharray': `${(circ * clamp(frac)).toFixed(2)} ${circ.toFixed(2)}`,
        transform: `rotate(-90 ${CX} ${CY})`,
        opacity: a.toFixed(3)
      })

      g.append(arc)

      break
    }

    case 'pencil': {
      const x = CX + R * 1.15 + Math.sin(t * 9) * 2.5
      const y = CY + R * 0.55 + Math.sin(t * 4.5) * 1.5

      const p = el('g', {
        transform: `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(-40 + Math.sin(t * 9) * 8).toFixed(1)})`,
        opacity: a.toFixed(3)
      })

      p.append(el('rect', { x: -2, y: -14, width: 4, height: 11, rx: 1, fill: c }))
      p.append(el('path', { d: 'M-2 -3 L2 -3 L0 2 Z', fill: c }))
      g.append(p)
      // the line it leaves
      const len = ((t * 0.8) % 1) * 14
      g.append(
        el('path', {
          d: `M${(x - 16).toFixed(2)} ${(y + 4).toFixed(2)} h${len.toFixed(2)}`,
          stroke: c,
          'stroke-width': 1.6,
          'stroke-linecap': 'round',
          opacity: (a * 0.6).toFixed(3)
        })
      )

      break
    }

    case 'send': {
      const u = (t / 1.3) % 1
      const e = u * u * (0.4 + 0.6 * u)
      const d = R * 1.9 * e
      dot(CX + R * 0.8 + d * 0.74, CY - R * 0.8 - d * 0.62, 3.4 * (1 - e * 0.55) * a, a * (1 - e * e))
      const u2 = clamp(u - 0.1)
      const e2 = u2 * u2
      dot(CX + R * 0.8 + R * 1.9 * e2 * 0.74, CY - R * 0.8 - R * 1.9 * e2 * 0.62, 1.8 * a, a * 0.35 * (1 - e2))

      break
    }

    case 'spawn': {
      for (let i = 0; i < 5; i++) {
        const u = (((t / 1.6 - i * 0.12) % 1) + 1) % 1
        const ease = 1 - (1 - u) ** 3
        const ang = i * 2.4 + u * 2
        const dist = R * 2.2 * (1 - ease)
        dot(
          CX + dist * Math.cos(ang),
          CY + dist * Math.sin(ang) * 0.8,
          3 * (0.5 + 0.5 * ease) * a,
          a * clamp(u * 5) * (1 - ease * 0.3)
        )
      }

      break
    }

    case 'halo': {
      const s = 0.5 + 0.5 * Math.sin(t * 1.6)
      ring(R * 1.15 + 3 * s, 3.2, a * (0.08 + 0.14 * s))

      // a small z-z-z
      const z = el('text', {
        x: CX + R * 0.9,
        y: CY - R * 0.95 - 4 * s,
        'font-size': 9,
        'font-weight': 700,
        fill: c,
        opacity: (a * (0.4 + 0.5 * s)).toFixed(3)
      })

      z.textContent = 'z'
      g.append(z)

      break
    }
  }
}

/** CSS transform that moves a flat face (photo, sigil) through a pose: the
 *  same foreshortening the drawn body gets, minus eyes that ride the surface. */
export function poseTransform(p: Pose, size: number): string {
  const wx = Math.sqrt(Math.cos(rad(p.ry)) ** 2 + DEPTH * DEPTH * Math.sin(rad(p.ry)) ** 2)
  const wy = Math.sqrt(Math.cos(rad(p.rx)) ** 2 + DEPTH * DEPTH * Math.sin(rad(p.rx)) ** 2)
  const sx = wx * p.squash * p.scale
  const sy = (wy / p.squash) * p.scale
  const lift = -p.y * size * 0.5

  return `translateY(${lift.toFixed(2)}px) rotate(${p.rz.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`
}

export function paintFrame(av: AvatarSvg, f: Frame) {
  if (av.bodyless) {
    paintEffect(av, f)

    return
  }

  const p = f.pose
  const outline = ringPath(projectRing(av.ring, p))
  av.body.setAttribute('d', outline)
  av.clip.setAttribute('d', outline)

  for (let side = 0; side < 2; side++) {
    const sx = side === 0 ? -EYE_X : EYE_X
    const e = f.eyes[side]
    const { pt, facing } = projectSurface(sx, EYE_Y + e.dy, p)
    const node = av.eyes[side]

    if (facing < 0.15) {
      node.setAttribute('d', '')

      continue
    }

    const { d, stroke } = eyePath(e, pt, f.lid, facing, p)
    node.setAttribute('d', d)
    node.setAttribute('fill', stroke ? 'none' : av.ink)
    node.setAttribute('stroke-width', String(stroke))
    node.setAttribute('opacity', clamp((facing - 0.15) / 0.25).toFixed(3))
  }

  paintEffect(av, f)
}
