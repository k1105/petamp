import { Icon } from '@iconify/react'
import type { TrackPoint } from '../../types'
import type { Radii, FilterSettings } from '../../store/useSettingsStore'

interface Props {
  trackPoints: TrackPoint[]
  consecutiveRejections: number
  lastMahalanobis2: number | null
  radii: Radii
  onChangeRadii: (partial: Partial<Radii>) => void
  onResetRadii: () => void
  filterSettings: FilterSettings
  onChangeFilterSettings: (partial: Partial<FilterSettings>) => void
  onResetFilterSettings: () => void
  showRawTube: boolean
  onToggleRawTube: (v: boolean) => void
  onClose: () => void
}

export function RecordingDebugPanel({
  trackPoints,
  consecutiveRejections,
  lastMahalanobis2,
  radii,
  onChangeRadii,
  onResetRadii,
  filterSettings,
  onChangeFilterSettings,
  onResetFilterSettings,
  showRawTube,
  onToggleRawTube,
  onClose,
}: Props) {
  const accepted = trackPoints.filter(p => !p.rejected).length
  const rejected = trackPoints.length - accepted
  const latest = trackPoints.at(-1)

  const setRadius = (key: keyof Radii, value: number) => {
    onChangeRadii({ [key]: value })
  }

  const setFilter = (key: keyof FilterSettings, value: number) => {
    onChangeFilterSettings({ [key]: value })
  }

  return (
    <div className="debug-overlay" role="dialog" aria-label="記録デバッグ">
      <div className="debug-panel">
        <div className="debug-header">
          <h2 className="debug-title">記録デバッグ</h2>
          <span className="debug-badge">{trackPoints.length} points</span>
        </div>

        <dl className="debug-summary">
          <div><dt>採用</dt><dd>{accepted}</dd></div>
          <div><dt>不採用</dt><dd>{rejected}</dd></div>
          <div>
            <dt>最新 accuracy</dt>
            <dd>{latest?.accuracy != null ? `${latest.accuracy.toFixed(1)} m` : '—'}</dd>
          </div>
          <div>
            <dt>最新 rejected</dt>
            <dd>{latest ? (latest.rejected ? 'yes' : 'no') : '—'}</dd>
          </div>
          <div>
            <dt>連続棄却</dt>
            <dd>{consecutiveRejections}</dd>
          </div>
          <div>
            <dt>直近 Kalman d²</dt>
            <dd>{lastMahalanobis2 != null ? lastMahalanobis2.toFixed(2) : '—'}</dd>
          </div>
        </dl>

        <div className="debug-section-label">フィルタ閾値</div>
        <div className="debug-sliders">
          <SliderRow
            label="最大速度 (hard ceiling)"
            value={filterSettings.maxSpeed}
            min={3}
            max={100}
            step={1}
            unit="m/s"
            secondary={`≈ ${(filterSettings.maxSpeed * 3.6).toFixed(0)} km/h`}
            onChange={v => setFilter('maxSpeed', v)}
          />
          <SliderRow
            label="Kalman σa (プロセスノイズ)"
            value={filterSettings.kalmanSigmaA}
            min={0.1}
            max={10}
            step={0.1}
            unit="m/s²"
            secondary="低=モデル信用 / 高=観測追従"
            onChange={v => setFilter('kalmanSigmaA', v)}
          />
          <SliderRow
            label="Kalman ゲート χ²"
            value={filterSettings.kalmanGateChi2}
            min={2}
            max={20}
            step={0.5}
            unit=""
            secondary="5.99=95% 9.21=99% 11.83=99.7%"
            onChange={v => setFilter('kalmanGateChi2', v)}
          />
        </div>

        <div className="debug-section-label">表示</div>
        <label className="debug-toggle-row">
          <input
            type="checkbox"
            checked={showRawTube}
            onChange={e => onToggleRawTube(e.currentTarget.checked)}
          />
          <span>赤チューブ (生 GPS) を表示</span>
        </label>

        <div className="debug-section-label">表示半径 (m@閾値zoom)</div>
        <div className="debug-sliders">
          <SliderRow
            label="閾値zoom (≧=m一定 / <=画面ピクセル一定)"
            value={radii.zoomThreshold}
            min={10}
            max={20}
            step={0.5}
            unit=""
            onChange={v => setRadius('zoomThreshold', v)}
          />
          <SliderRow
            label="チューブ半径"
            value={radii.tubeRadius}
            min={0.1}
            max={10}
            step={0.1}
            unit="m"
            onChange={v => setRadius('tubeRadius', v)}
          />
          <SliderRow
            label="赤チューブ半径"
            value={radii.rawTubeRadius}
            min={0.1}
            max={10}
            step={0.1}
            unit="m"
            onChange={v => setRadius('rawTubeRadius', v)}
          />
          <SliderRow
            label="自己位置ドット半径"
            value={radii.dotRadius}
            min={0.2}
            max={20}
            step={0.1}
            unit="m"
            onChange={v => setRadius('dotRadius', v)}
          />
        </div>

        <div className="debug-actions">
          <button className="btn-ghost" onClick={onResetFilterSettings}>
            <Icon icon="lucide:rotate-ccw" />
            <span>フィルタをリセット</span>
          </button>
          <button className="btn-ghost" onClick={onResetRadii}>
            <Icon icon="lucide:rotate-ccw" />
            <span>半径をリセット</span>
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
  label, value, min, max, step, unit, secondary, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  secondary?: string
  onChange: (v: number) => void
}) {
  return (
    <div className="debug-slider-row">
      <div className="debug-slider-head">
        <span className="debug-slider-label">{label}</span>
        <span className="debug-slider-value">
          {value.toFixed(value < 10 ? 1 : 0)} {unit}
          {secondary && <span className="debug-slider-secondary"> ({secondary})</span>}
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
