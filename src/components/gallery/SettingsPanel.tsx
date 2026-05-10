import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { useSettingsStore } from '../../store/useSettingsStore'
import {
  resetAllCharacterMemory,
  resetOnboarding,
  resetPromptLog,
} from '../../character'

type AsyncActionKey = 'onboarding' | 'log' | 'all'

export function SettingsPanel() {
  const navigate = useNavigate()
  const ui = useSettingsStore(s => s.ui)
  const setUi = useSettingsStore(s => s.setUi)
  const resetUi = useSettingsStore(s => s.resetUi)
  const radii = useSettingsStore(s => s.radii)
  const setRadii = useSettingsStore(s => s.setRadii)
  const resetRadii = useSettingsStore(s => s.resetRadii)

  const [busy, setBusy] = useState<AsyncActionKey | null>(null)
  const [done, setDone] = useState<AsyncActionKey | null>(null)

  const runAction = async (key: AsyncActionKey, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(key)
    try {
      await fn()
      setDone(key)
      window.setTimeout(() => setDone(d => (d === key ? null : d)), 1800)
    } finally {
      setBusy(null)
    }
  }

  const onResetOnboarding = () => {
    if (!window.confirm('オンボーディング画面が次のホームアクセスで再表示されます。\n登録済みの名前を消します。よろしいですか？')) return
    void runAction('onboarding', async () => {
      await resetOnboarding()
      navigate('/', { replace: true })
    })
  }

  const onResetLog = () => {
    if (!window.confirm('プロンプトログをすべて削除します。\nペタンプの記憶は残ります。よろしいですか？')) return
    void runAction('log', resetPromptLog)
  }

  const onResetAll = () => {
    if (!window.confirm('ペタンプに関するすべてのデータを消します。\n（過去の対話・要約・関係値・名前・プロンプトログ）\n\nRunの記録は消えません。よろしいですか？')) return
    void runAction('all', async () => {
      await resetAllCharacterMemory()
      navigate('/', { replace: true })
    })
  }

  return (
    <div className="settings-content">
      <Section title="記録ボタン (目玉)">
        <SliderRow
          label="アイコンサイズ"
          value={ui.fabIconSize}
          min={28} max={64} step={1} unit="px"
          onChange={v => setUi({ fabIconSize: v })}
        />
        <SliderRow
          label="目の縦位置"
          hint="− 上 / + 下"
          value={ui.eyeYOffset}
          min={-12} max={12} step={1} unit=""
          onChange={v => setUi({ eyeYOffset: v })}
        />
        <SliderRow
          label="白目サイズ倍率"
          value={ui.eyeSizeScale}
          min={0.6} max={1.6} step={0.05} unit="x"
          onChange={v => setUi({ eyeSizeScale: v })}
        />
        <SliderRow
          label="瞳サイズ倍率"
          value={ui.pupilSizeScale}
          min={0.6} max={1.6} step={0.05} unit="x"
          onChange={v => setUi({ pupilSizeScale: v })}
        />
      </Section>

      <Section title="マップ">
        <SliderRow
          label="軌跡周辺の余白"
          value={ui.mapPaddingMeters}
          min={50} max={1000} step={10} unit="m"
          onChange={v => setUi({ mapPaddingMeters: v })}
        />
      </Section>

      <Section title="軌跡サイズ">
        <SliderRow
          label="閾値zoom"
          hint="以上はm一定 / 未満は画面ピクセル一定"
          value={radii.zoomThreshold}
          min={10} max={20} step={0.5} unit=""
          onChange={v => setRadii({ zoomThreshold: v })}
        />
        <SliderRow
          label="チューブ半径 (m@閾値zoom)"
          value={radii.tubeRadius}
          min={0.1} max={10} step={0.1} unit="m"
          onChange={v => setRadii({ tubeRadius: v })}
        />
        <SliderRow
          label="ドット半径 (m@閾値zoom)"
          value={radii.dotRadius}
          min={0.2} max={20} step={0.1} unit="m"
          onChange={v => setRadii({ dotRadius: v })}
        />
        <div className="settings-row-actions">
          <button className="settings-btn-secondary" onClick={resetRadii}>
            <Icon icon="lucide:rotate-ccw" />
            <span>軌跡サイズをリセット</span>
          </button>
          <button className="settings-btn-secondary" onClick={resetUi}>
            <Icon icon="lucide:rotate-ccw" />
            <span>UIをリセット</span>
          </button>
        </div>
      </Section>

      <Section title="ペタンプ">
        <button className="settings-btn-secondary" onClick={() => navigate('/prompt-logs')}>
          <Icon icon="lucide:scroll-text" />
          <span>プロンプトログを見る</span>
        </button>
        <button
          className="settings-btn-secondary"
          onClick={onResetLog}
          disabled={busy !== null}
        >
          <Icon icon="lucide:eraser" />
          <span>{labelFor('log', busy, done, 'プロンプトログを削除')}</span>
        </button>
        <button
          className="settings-btn-secondary"
          onClick={onResetOnboarding}
          disabled={busy !== null}
        >
          <Icon icon="lucide:user-round-x" />
          <span>{labelFor('onboarding', busy, done, 'オンボーディングをやり直す')}</span>
        </button>
        <button
          className="settings-btn-danger"
          onClick={onResetAll}
          disabled={busy !== null}
        >
          <Icon icon="lucide:trash-2" />
          <span>{labelFor('all', busy, done, 'ペタンプをまっさらに戻す')}</span>
        </button>
      </Section>
    </div>
  )
}

function labelFor(
  key: AsyncActionKey,
  busy: AsyncActionKey | null,
  done: AsyncActionKey | null,
  base: string,
): string {
  if (busy === key) return '実行中…'
  if (done === key) return '完了しました'
  return base
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      <div className="settings-section-body">{children}</div>
    </section>
  )
}

interface SliderRowProps {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}

function SliderRow({ label, hint, value, min, max, step, unit, onChange }: SliderRowProps) {
  const decimals = step < 1 ? 2 : 0
  return (
    <div className="settings-slider-row">
      <div className="settings-slider-head">
        <span className="settings-slider-label">{label}</span>
        <span className="settings-slider-value">
          {value.toFixed(decimals)}{unit}
        </span>
      </div>
      {hint && <div className="settings-slider-hint">{hint}</div>}
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
