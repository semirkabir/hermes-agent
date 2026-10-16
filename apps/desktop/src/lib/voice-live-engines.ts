import { type OwnerScope, ownerScoped } from '@/api/client'
import { registry } from '@/contrib/registry'
import { hermesApi } from '@/hermes'

import { type LiveHistoryMessage, type VoiceLiveHandlers, VoiceLiveSession } from './voice-live'

/**
 * Live voice engines — the renderer half of `voice.voice_chat_mode`.
 *
 * Every live engine is one full-duplex voice model that owns the mic and the
 * speaker and DELEGATES real work to Hermes. The conversation hook
 * (`use-voice-live-conversation`) owns everything engine-neutral: turning a
 * delegation into a Hermes turn, streaming the reply back, stop words, mute,
 * barge-in. An engine supplies only the transport — how to reach its vendor
 * and map vendor events onto `VoiceLiveHandlers`.
 *
 * `gpt-live` is built in (`VoiceLiveSession`). A plugin adds another by
 * registering a `voice.liveEngines` data contribution whose `engine` matches
 * the name its gateway half registered (`ctx.register_voice_live_engine`):
 *
 *   ctx.register({ id: 'grok', area: VOICE_LIVE_ENGINES_AREA,
 *                  data: { engine: 'grok-live', create: (handlers, owner) => new GrokTransport(handlers, owner) } })
 */
export const VOICE_LIVE_ENGINES_AREA = 'voice.liveEngines'

export const GPT_LIVE_ENGINE = 'gpt-live'

/** What the conversation hook drives. `start` connects (mic + vendor session),
 *  seeded with prior text turns; `think` is quiet progress the voice may
 *  mention, `speak` a result it should say aloud (both keyed to the
 *  delegation they answer); `instruct` steers the persona session-wide;
 *  `close` ends gracefully and must eventually fire `handlers.onClosed`. */
export interface VoiceLiveTransport {
  start: (history: LiveHistoryMessage[]) => Promise<void>
  think: (delegationId: null | string, content: string) => void
  speak: (delegationId: null | string, content: string) => void
  instruct: (content: string) => void
  setMuted: (muted: boolean) => void
  close: () => void
}

/** `owner` is the chat's (connection, profile); dial the gateway with it
 *  (`requestLiveEngineSession`) so a Bot's chat uses the Bot's own engine
 *  settings. `null` = the active scope. */
export type VoiceLiveTransportFactory = (handlers: VoiceLiveHandlers, owner: null | OwnerScope) => VoiceLiveTransport

/** Payload of a `voice.liveEngines` data contribution. */
export interface VoiceLiveEngineContribution {
  /** The `voice.voice_chat_mode` value this transport serves. */
  engine: string
  create: VoiceLiveTransportFactory
}

const normalize = (name: string) => name.trim().toLowerCase()

/** The transport factory for `engine`: the built-in GPT-Live, else the newest
 *  plugin contribution serving that name. `null` when no desktop half is
 *  installed — the composer then falls back to chained with a notice. */
export function resolveLiveTransport(engine: string): null | VoiceLiveTransportFactory {
  const key = normalize(engine)

  if (key === GPT_LIVE_ENGINE) {
    return (handlers, owner) => new VoiceLiveSession(handlers, owner)
  }

  const match = registry
    .getArea(VOICE_LIVE_ENGINES_AREA)
    .map(c => c.data as Partial<VoiceLiveEngineContribution> | undefined)
    .findLast(d => typeof d?.create === 'function' && typeof d.engine === 'string' && normalize(d.engine) === key)

  return match?.create ?? null
}

/**
 * The selected engine's server-side session step on the owner's gateway
 * (`VoiceLiveEngine.create_session`): returns whatever that engine hands the
 * renderer — an SDP answer, an ephemeral client secret — never the API key.
 * Engines whose plugin backend owns the vendor socket don't need it.
 */
export async function requestLiveEngineSession<T extends object>(
  owner: null | OwnerScope,
  engineRequest: Record<string, unknown>,
  history: LiveHistoryMessage[] = []
): Promise<T> {
  const response = await hermesApi<{ ok: boolean } & T>({
    ...ownerScoped(owner ?? undefined),
    body: { engine_request: engineRequest, history },
    method: 'POST',
    path: '/api/audio/voice-live/session',
    timeoutMs: 45_000
  })

  if (!response?.ok) {
    throw new Error('Live voice session creation failed')
  }

  return response
}
