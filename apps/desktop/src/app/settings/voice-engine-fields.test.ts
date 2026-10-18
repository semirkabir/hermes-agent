import { describe, expect, it } from 'vitest'

import { configSubpageForField } from './config-subpages'
import { sectionFieldEntries, voiceFieldVisible } from './helpers'

// Live voice engines describe their own settings in the backend schema (`engine` set).
// Settings → Voice must list them under Conversation and show only the selected engine's.

const schema = {
  'voice.voice_chat_mode': { options: ['chained', 'gpt-live', 'grok-live'], type: 'select' as const },
  'voice.gpt_live.voice': { engine: 'gpt-live', options: ['marin'], type: 'select' as const },
  'voice.grok_live.voice': { engine: 'grok-live', options: ['ara', 'eve'], type: 'select' as const }
}

describe('live voice engine settings', () => {
  it('lists plugin engine fields in the Voice section', () => {
    const keys = (sectionFieldEntries(schema, {}).get('voice') ?? []).map(([key]) => key)

    expect(keys).toContain('voice.grok_live.voice')
  })

  it("shows only the selected engine's fields", () => {
    const config = { voice: { voice_chat_mode: 'grok-live' } }

    expect(voiceFieldVisible('voice.grok_live.voice', config, schema['voice.grok_live.voice'])).toBe(true)
    expect(voiceFieldVisible('voice.gpt_live.voice', config, schema['voice.gpt_live.voice'])).toBe(false)
    expect(voiceFieldVisible('voice.voice_chat_mode', config, schema['voice.voice_chat_mode'])).toBe(true)
  })

  it('routes every engine field to the Conversation page', () => {
    expect(configSubpageForField('voice', 'voice.grok_live.voice')).toBe('conversation')
    expect(configSubpageForField('voice', 'voice.gemini_live.model')).toBe('conversation')
    expect(configSubpageForField('voice', 'voice.gpt_live.instructions')).toBe('conversation')
  })
})
