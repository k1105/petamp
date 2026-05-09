import { useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import type { TrackPoint } from '../../types'
import { useReverseGeocode } from '../../hooks/useReverseGeocode'

interface Props {
  trackPoints: TrackPoint[]
  areaName?: string
  onProceed?: () => void
  onCancel: () => void
  proceedLabel?: string
}

export function PathDebugPanel({ trackPoints, areaName, onProceed, onCancel, proceedLabel = '結果画面へ' }: Props) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'fail'>('idle')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const json = useMemo(() => JSON.stringify(trackPoints, null, 2), [trackPoints])

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

        <textarea
          ref={textareaRef}
          className="debug-textarea"
          readOnly
          value={json}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
        />

        <div className="debug-actions">
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
