import { Icon } from '@iconify/react'
import { useSettingsStore } from '../../store/useSettingsStore'

interface Props {
  onClose: () => void
}

export function SettingsPanel({ onClose }: Props) {
  const ui = useSettingsStore(s => s.ui)
  const setUi = useSettingsStore(s => s.setUi)
  const resetUi = useSettingsStore(s => s.resetUi)

  return (
    <div className="debug-overlay" role="dialog" aria-label="設定">
      <div className="debug-panel">
        <div className="debug-header">
          <h2 className="debug-title">設定</h2>
        </div>

        <div className="debug-section-label">記録ボタン (目玉)</div>
        <div className="debug-sliders">
          <SliderRow
            label="アイコンサイズ"
            value={ui.fabIconSize}
            min={28}
            max={64}
            step={1}
            unit="px"
            onChange={v => setUi({ fabIconSize: v })}
          />
          <SliderRow
            label="目の縦位置 (− 上 / + 下)"
            value={ui.eyeYOffset}
            min={-12}
            max={12}
            step={1}
            unit=""
            onChange={v => setUi({ eyeYOffset: v })}
          />
          <SliderRow
            label="白目サイズ倍率"
            value={ui.eyeSizeScale}
            min={0.6}
            max={1.6}
            step={0.05}
            unit="x"
            onChange={v => setUi({ eyeSizeScale: v })}
          />
          <SliderRow
            label="瞳サイズ倍率"
            value={ui.pupilSizeScale}
            min={0.6}
            max={1.6}
            step={0.05}
            unit="x"
            onChange={v => setUi({ pupilSizeScale: v })}
          />
        </div>

        <div className="debug-actions">
          <button className="btn-ghost" onClick={resetUi}>
            <Icon icon="lucide:rotate-ccw" />
            <span>UIをリセット</span>
          </button>
          <button className="btn-ghost" onClick={onClose}>
            <Icon icon="lucide:x" />
            <span>閉じる</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function SliderRow({
  label, value, min, max, step, unit, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  const decimals = step < 1 ? 2 : 0
  return (
    <div className="debug-slider-row">
      <div className="debug-slider-head">
        <span className="debug-slider-label">{label}</span>
        <span className="debug-slider-value">
          {value.toFixed(decimals)} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.currentTarget.value))}
      />
    </div>
  )
}
