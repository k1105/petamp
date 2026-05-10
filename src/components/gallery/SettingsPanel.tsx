import { useState } from 'react'
import { Icon } from '@iconify/react'
import { useSettingsStore } from '../../store/useSettingsStore'
import { resetAllCharacterMemory } from '../../character'

export function SettingsPanel() {
  const ui = useSettingsStore(s => s.ui)
  const setUi = useSettingsStore(s => s.setUi)
  const resetUi = useSettingsStore(s => s.resetUi)
  const radii = useSettingsStore(s => s.radii)
  const setRadii = useSettingsStore(s => s.setRadii)
  const resetRadii = useSettingsStore(s => s.resetRadii)
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  const onResetMemory = async () => {
    if (resetting) return
    const ok = window.confirm(
      'ペタンプの記憶をすべて消します。\n（過去の対話・要約・関係値・プロンプトログ）\n\nRunの記録は消えません。よろしいですか？',
    )
    if (!ok) return
    setResetting(true)
    try {
      await resetAllCharacterMemory()
      setResetDone(true)
      window.setTimeout(() => setResetDone(false), 2000)
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="settings-content">
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

      <div className="debug-section-label">マップ</div>
      <div className="debug-sliders">
        <SliderRow
          label="軌跡周辺の余白"
          value={ui.mapPaddingMeters}
          min={50}
          max={1000}
          step={10}
          unit="m"
          onChange={v => setUi({ mapPaddingMeters: v })}
        />
      </div>

      <div className="debug-section-label">軌跡サイズ</div>
      <div className="debug-sliders">
        <SliderRow
          label="閾値zoom (これ以上はm一定 / 未満は画面ピクセル一定)"
          value={radii.zoomThreshold}
          min={10}
          max={20}
          step={0.5}
          unit=""
          onChange={v => setRadii({ zoomThreshold: v })}
        />
        <SliderRow
          label="チューブ半径 (m@閾値zoom)"
          value={radii.tubeRadius}
          min={0.1}
          max={10}
          step={0.1}
          unit="m"
          onChange={v => setRadii({ tubeRadius: v })}
        />
        <SliderRow
          label="ドット半径 (m@閾値zoom)"
          value={radii.dotRadius}
          min={0.2}
          max={20}
          step={0.1}
          unit="m"
          onChange={v => setRadii({ dotRadius: v })}
        />
      </div>

      <div className="debug-actions">
        <button className="btn-ghost" onClick={resetRadii}>
          <Icon icon="lucide:rotate-ccw" />
          <span>軌跡サイズをリセット</span>
        </button>
        <button className="btn-ghost" onClick={resetUi}>
          <Icon icon="lucide:rotate-ccw" />
          <span>UIをリセット</span>
        </button>
      </div>

      <div className="debug-section-label">ペタンプ</div>
      <div className="debug-actions">
        <button
          className="btn-ghost"
          onClick={() => void onResetMemory()}
          disabled={resetting}
        >
          <Icon icon="lucide:trash-2" />
          <span>
            {resetting ? '消去中…' : resetDone ? '消去しました' : 'ペタンプの記憶をリセット'}
          </span>
        </button>
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
