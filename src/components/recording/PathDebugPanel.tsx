import { useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import type { Run, TrackPoint } from '../../types'
import { useReverseGeocode } from '../../hooks/useReverseGeocode'
import { useAuth } from '../../hooks/useAuth'
import { cloudSaveRun } from '../../firebase/runCloud'
import {
  applyAltitudePipeline,
  DEFAULT_ALTITUDE_FILTER_PARAMS,
  rawAltitudeOf,
  type AltitudeFilterParams,
} from '../../utils/geo/altitudeFilters'

interface Props {
  trackPoints: TrackPoint[]
  areaName?: string
  run?: Run
  onProceed?: () => void
  onCancel: () => void
  proceedLabel?: string
}

type MigrateLog = { ts: number; level: 'info' | 'ok' | 'error'; text: string }

export function PathDebugPanel({ trackPoints, areaName, run, onProceed, onCancel, proceedLabel = '結果画面へ' }: Props) {
  const { user } = useAuth()
  const [migrateBusy, setMigrateBusy] = useState(false)
  const [migrateLogs, setMigrateLogs] = useState<MigrateLog[]>([])

  const appendLog = (level: MigrateLog['level'], text: string) => {
    setMigrateLogs(prev => [...prev, { ts: Date.now(), level, text }])
  }

  const handleMigrate = async () => {
    if (!run) return
    setMigrateBusy(true)
    appendLog('info', `uid=${user?.uid ?? '(未ログイン)'} run.id=${run.id}`)
    appendLog('info', `points=${run.trackPoints.length} notes=${run.notes.length}`)
    try {
      await cloudSaveRun(run)
      appendLog('ok', 'cloudSaveRun 成功 (users/{uid}/runs/{id} に書き込み)')
    } catch (e) {
      const err = e as { code?: string; name?: string; message?: string }
      appendLog('error', `失敗: ${err.code ?? err.name ?? 'error'} :: ${err.message ?? String(e)}`)
      console.error('migrate failed', e)
    } finally {
      setMigrateBusy(false)
    }
  }

  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [filterParams, setFilterParams] = useState<AltitudeFilterParams>(DEFAULT_ALTITUDE_FILTER_PARAMS)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // textarea 表示用 (人間が中身を spot-check する用途)。
  const json = useMemo(() => JSON.stringify(trackPoints, null, 2), [trackPoints])
  // ダウンロード用は indent 無しで容量を抑える (visualizer 側は標準 JSON.parse で読める)。
  const compactJson = useMemo(() => JSON.stringify(trackPoints), [trackPoints])

  const summary = useMemo(() => {
    if (trackPoints.length === 0) return null
    const first = trackPoints[0]
    const last = trackPoints[trackPoints.length - 1]
    const durationMs = last.timestamp - first.timestamp
    const altitudes = trackPoints.map(p => p.altitude).filter((a): a is number => a !== null)
    const lats = trackPoints.map(p => p.lat)
    const lngs = trackPoints.map(p => p.lng)
    const latMin = Math.min(...lats)
    const latMax = Math.max(...lats)
    const lngMin = Math.min(...lngs)
    const lngMax = Math.max(...lngs)
    return {
      count: trackPoints.length,
      durationSec: Math.round(durationMs / 1000),
      startedAt: new Date(first.timestamp).toISOString(),
      finishedAt: new Date(last.timestamp).toISOString(),
      altitudeCount: altitudes.length,
      centerLng: (lngMin + lngMax) / 2,
      centerLat: (latMin + latMax) / 2,
      bbox: { latMin, latMax, lngMin, lngMax },
    }
  }, [trackPoints])

  // 現在のスライダー値でフィルタを適用した結果の統計。
  // 生 altitude (raw, barometric > GPS) と、パイプライン後の値を比較する。
  const filterStats = useMemo(() => {
    if (trackPoints.length === 0) return null
    const raw = trackPoints.map(rawAltitudeOf)
    const filtered = applyAltitudePipeline(trackPoints, filterParams)
    const rawValid = raw.filter((v): v is number => v != null)
    const filtValid = filtered.filter((v): v is number => v != null)
    const stats = (xs: number[]) => {
      if (xs.length === 0) return null
      let mn = Infinity
      let mx = -Infinity
      for (const v of xs) {
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      return { count: xs.length, min: mn, max: mx, range: mx - mn }
    }
    return { raw: stats(rawValid), filtered: stats(filtValid) }
  }, [trackPoints, filterParams])

  const fetchedAreaName = useReverseGeocode(
    areaName ? null : summary?.centerLng,
    areaName ? null : summary?.centerLat,
  )
  const displayAreaName = areaName ?? fetchedAreaName

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(json)
        setCopyStatus('ok')
      } else {
        const ta = textareaRef.current
        if (!ta) throw new Error('textarea unavailable')
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        setCopyStatus(ok ? 'ok' : 'fail')
      }
    } catch {
      setCopyStatus('fail')
    }
    setTimeout(() => setCopyStatus('idle'), 2000)
  }

  const handleDownload = async () => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `petamp-trackpoints-${ts}.json`
    const blob = new Blob([compactJson], { type: 'application/json' })

    // iOS WKWebView では Web Share API で共有シート (AirDrop など) を出せる。
    // ファイル共有可否は canShare で事前判定する。
    if (typeof navigator.canShare === 'function' && typeof navigator.share === 'function') {
      try {
        const file = new File([blob], filename, { type: 'application/json' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename })
          setDownloadStatus('ok')
          setTimeout(() => setDownloadStatus('idle'), 2000)
          return
        }
      } catch (e) {
        // ユーザーが共有シートを閉じた場合は失敗扱いにしない。
        if ((e as Error)?.name === 'AbortError') {
          setDownloadStatus('idle')
          return
        }
        // その他のエラーは下のフォールバックに落とす。
      }
    }

    // Web 標準フォールバック: ダウンロード属性付きアンカーをクリックする。
    try {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDownloadStatus('ok')
    } catch {
      setDownloadStatus('fail')
    }
    setTimeout(() => setDownloadStatus('idle'), 2000)
  }

  return (
    <div className="debug-overlay" role="dialog" aria-label="パスデータ デバッグ">
      <div className="debug-panel">
        <div className="debug-header">
          <h2 className="debug-title">パスデータ デバッグ</h2>
          <span className="debug-badge">{trackPoints.length} points</span>
        </div>

        {displayAreaName && <div className="debug-area">{displayAreaName}</div>}

        {summary ? (
          <dl className="debug-summary">
            <div><dt>件数</dt><dd>{summary.count}</dd></div>
            <div><dt>記録時間</dt><dd>{summary.durationSec}s</dd></div>
            <div><dt>標高あり</dt><dd>{summary.altitudeCount}</dd></div>
            <div><dt>開始</dt><dd>{summary.startedAt}</dd></div>
            <div><dt>終了</dt><dd>{summary.finishedAt}</dd></div>
            <div><dt>BBox lat</dt><dd>{summary.bbox.latMin.toFixed(6)} 〜 {summary.bbox.latMax.toFixed(6)}</dd></div>
            <div><dt>BBox lng</dt><dd>{summary.bbox.lngMin.toFixed(6)} 〜 {summary.bbox.lngMax.toFixed(6)}</dd></div>
          </dl>
        ) : (
          <div className="debug-empty">trackPoints は空です</div>
        )}

        {trackPoints.length > 0 && (
          <details className="debug-filter-details">
            <summary>高度フィルタ閾値テスト</summary>
            <div className="debug-sliders">
              <SliderRow
                label="垂直精度ゲート"
                value={filterParams.accuracyMaxM}
                min={1}
                max={50}
                step={1}
                unit="m"
                onChange={v => setFilterParams(p => ({ ...p, accuracyMaxM: v }))}
              />
              <SliderRow
                label="垂直速度ゲート"
                value={filterParams.verticalSpeedMaxMps}
                min={0.5}
                max={20}
                step={0.5}
                unit="m/s"
                onChange={v => setFilterParams(p => ({ ...p, verticalSpeedMaxMps: v }))}
              />
              <SliderRow
                label="メディアン kernel"
                value={filterParams.medianKernel}
                min={1}
                max={31}
                step={2}
                unit=""
                onChange={v => setFilterParams(p => ({ ...p, medianKernel: v }))}
              />
              <SliderRow
                label="移動平均 window"
                value={filterParams.movingAvgWindow}
                min={1}
                max={31}
                step={1}
                unit=""
                onChange={v => setFilterParams(p => ({ ...p, movingAvgWindow: v }))}
              />
              <button
                type="button"
                className="btn-ghost debug-filter-reset"
                onClick={() => setFilterParams(DEFAULT_ALTITUDE_FILTER_PARAMS)}
              >
                <Icon icon="lucide:rotate-ccw" />
                <span>デフォルトに戻す</span>
              </button>
            </div>
            {filterStats && (
              <dl className="debug-summary">
                <div><dt>raw 有効点</dt><dd>{filterStats.raw?.count ?? 0}</dd></div>
                <div><dt>フィルタ後 有効点</dt><dd>{filterStats.filtered?.count ?? 0}</dd></div>
                {filterStats.raw && (
                  <div><dt>raw 高度範囲</dt><dd>{filterStats.raw.min.toFixed(1)} 〜 {filterStats.raw.max.toFixed(1)} m ({filterStats.raw.range.toFixed(1)})</dd></div>
                )}
                {filterStats.filtered && (
                  <div><dt>フィルタ後 高度範囲</dt><dd>{filterStats.filtered.min.toFixed(1)} 〜 {filterStats.filtered.max.toFixed(1)} m ({filterStats.filtered.range.toFixed(1)})</dd></div>
                )}
              </dl>
            )}
          </details>
        )}

        {run && (
          <div className="debug-migrate">
            <div className="debug-migrate-head">
              <span>Firestore マイグレーション</span>
              <span className="debug-migrate-user">{user ? user.email ?? user.uid : '未ログイン'}</span>
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleMigrate}
              disabled={migrateBusy || !user}
            >
              <Icon icon={migrateBusy ? 'lucide:loader' : 'lucide:cloud-upload'} />
              <span>{migrateBusy ? '送信中…' : 'この Run を Firestore に送信'}</span>
            </button>
            {migrateLogs.length > 0 && (
              <ul className="debug-migrate-logs">
                {migrateLogs.map((l, i) => (
                  <li key={i} data-level={l.level}>
                    <span className="debug-migrate-time">{new Date(l.ts).toLocaleTimeString()}</span>
                    <span className="debug-migrate-text">{l.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="debug-textarea"
          readOnly
          value={json}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
        />

        <div className="debug-actions">
          <button className="btn-ghost" onClick={handleDownload} disabled={trackPoints.length === 0}>
            <Icon icon={downloadStatus === 'ok' ? 'lucide:check' : downloadStatus === 'fail' ? 'lucide:x' : 'lucide:download'} />
            <span>{downloadStatus === 'ok' ? '完了' : downloadStatus === 'fail' ? '失敗' : 'JSONを保存/共有'}</span>
          </button>
          <button className="btn-ghost" onClick={handleCopy}>
            <Icon icon={copyStatus === 'ok' ? 'lucide:check' : copyStatus === 'fail' ? 'lucide:x' : 'lucide:copy'} />
            <span>{copyStatus === 'ok' ? 'コピーしました' : copyStatus === 'fail' ? 'コピー失敗' : 'JSONをコピー'}</span>
          </button>
          <button className="btn-ghost" onClick={onCancel}>
            <Icon icon="lucide:x" />
            <span>閉じる</span>
          </button>
          {onProceed && (
            <button
              className="btn-primary"
              onClick={onProceed}
              disabled={trackPoints.length === 0}
            >
              <Icon icon="lucide:arrow-right" />
              <span>{proceedLabel}</span>
            </button>
          )}
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
  return (
    <div className="debug-slider-row">
      <div className="debug-slider-head">
        <span className="debug-slider-label">{label}</span>
        <span className="debug-slider-value">{value % 1 === 0 ? value : value.toFixed(1)} {unit}</span>
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
