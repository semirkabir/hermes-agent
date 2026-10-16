import { afterEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'

import { VoiceLiveSession } from './voice-live'
import { resolveLiveTransport, VOICE_LIVE_ENGINES_AREA, type VoiceLiveTransport } from './voice-live-engines'

// A plugin engine is two halves sharing one name: the gateway half
// (`ctx.register_voice_live_engine`) and this renderer half. The composer only
// mounts a live engine when BOTH exist, so the renderer lookup must find the
// plugin's transport by the `voice.voice_chat_mode` value and report a miss as
// null (the composer then falls back to chained with a notice).

const handlers = { onClosed: () => undefined, onDelegation: () => undefined, onError: () => undefined }

const fakeTransport = (): VoiceLiveTransport => ({
  close: () => undefined,
  instruct: () => undefined,
  setMuted: () => undefined,
  speak: () => undefined,
  start: async () => undefined,
  think: () => undefined
})

const disposers: Array<() => void> = []

afterEach(() => disposers.splice(0).forEach(dispose => dispose()))

describe('resolveLiveTransport', () => {
  it('serves the built-in GPT-Live transport', () => {
    expect(resolveLiveTransport('GPT-Live')?.(handlers, null)).toBeInstanceOf(VoiceLiveSession)
  })

  it('finds a plugin transport by engine name, case-insensitively', () => {
    const transport = fakeTransport()
    disposers.push(
      registry.register({
        area: VOICE_LIVE_ENGINES_AREA,
        data: { create: () => transport, engine: 'Grok-Live' },
        id: 'grok'
      })
    )

    expect(resolveLiveTransport('grok-live')?.(handlers, null)).toBe(transport)
  })

  it('reports an engine with no renderer half as null', () => {
    disposers.push(registry.register({ area: VOICE_LIVE_ENGINES_AREA, data: { engine: 'broken-live' }, id: 'broken' }))

    expect(resolveLiveTransport('broken-live')).toBeNull()
    expect(resolveLiveTransport('gemini-live')).toBeNull()
  })

  it('stops serving a plugin transport once the plugin unloads', () => {
    const dispose = registry.register({
      area: VOICE_LIVE_ENGINES_AREA,
      data: { create: fakeTransport, engine: 'grok-live' },
      id: 'grok'
    })

    dispose()

    expect(resolveLiveTransport('grok-live')).toBeNull()
  })
})
