import { useStore } from '@nanostores/react'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { $modeShadowed } from '@/store/interface-mode'
import { $toolCallStyle, $toolCardsExpandLive, setToolCallStyle, setToolCardsExpandLive } from '@/store/tool-call-style'
import { $toolViewMode, setToolViewMode } from '@/store/tool-view'

import { ListRow, ToggleRow } from './primitives'
import { SETTING_IDS, settingElementId } from './settings-manifest'

const ids = SETTING_IDS.appearance

/** Chat display rows for how tool calls read: the tool view, the run style, and (cards only) expand while running. */
export function ToolCallSettings() {
  const { t } = useI18n()
  const a = t.settings.appearance
  const toolViewMode = useStore($toolViewMode)
  const toolViewShadowed = useStore($modeShadowed('toolViewMode'))
  const toolCallStyle = useStore($toolCallStyle)
  const toolCardsExpandLive = useStore($toolCardsExpandLive)

  const toolOptions = [
    { id: 'product', label: a.product },
    { id: 'technical', label: a.technical }
  ] as const

  const toolCallStyleOptions = [
    { id: 'compact', label: a.toolCallStyleCompact },
    { id: 'cards', label: a.toolCallStyleCards }
  ] as const

  return (
    <>
      <ListRow
        action={
          <SegmentedControl
            onChange={id => {
              triggerHaptic('selection')
              setToolViewMode(id)
            }}
            options={toolOptions}
            value={toolViewMode}
          />
        }
        // Simple mode decides this value for now; say so instead of promising it persists.
        description={toolViewShadowed ? `${a.toolViewDesc} ${t.interfaceMode.sessionNote}` : a.toolViewDesc}
        id={settingElementId(ids.toolView)}
        title={a.toolViewTitle}
      />

      <ListRow
        action={
          <SegmentedControl
            onChange={id => {
              triggerHaptic('selection')
              setToolCallStyle(id)
            }}
            options={toolCallStyleOptions}
            value={toolCallStyle}
          />
        }
        description={a.toolCallStyleDesc}
        id={settingElementId(ids.toolCallStyle)}
        title={a.toolCallStyleTitle}
      />

      {toolCallStyle === 'cards' && (
        <ToggleRow
          checked={toolCardsExpandLive}
          description={a.toolCardsExpandLiveDesc}
          id={settingElementId(ids.toolCardsExpandLive)}
          label={a.toolCardsExpandLiveTitle}
          onChange={setToolCardsExpandLive}
        />
      )}
    </>
  )
}
