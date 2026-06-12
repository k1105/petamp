import { useEffect, useMemo, useState } from 'react'
import type { Run, TrackPoint } from '../../types'
import { acceptedPoints } from '../../utils/geo/recordingFilters'
import { totalDistance, elevationGain } from '../../utils/geo/geoUtils'
import { formatDistance, formatElevation, formatDate } from '../../utils/ui/formatters'
import {
  computeSpeedBreakdown,
  computeAreaBreakdown,
  SPEED_SHARE_META,
  type AreaShare,
} from '../../utils/run/runNutrition'

interface Props {
  run: Run
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/**
 * ラン個別ページの "Nutrition Facts" タブ本体。軌跡が持つ情報を栄養成分表示
 * (nutrition label) 風のテーブルでグラフィカルに見せる。表記はすべて英語。
 *  - Distance / Elevation Gain … ヘッドラインの数値
 *  - Areas … 市区町村ごとの移動距離比率 (逆ジオコーディング・非同期)
 *  - Pace … run / walk / stop の滞在時間比率
 */
export function NutritionFacts({ run }: Props) {
  const pts = useMemo(() => acceptedPoints(run.trackPoints), [run])
  const distanceM = useMemo(() => totalDistance(pts), [pts])
  const gainM = useMemo(() => elevationGain(pts), [pts])
  const speedShares = useMemo(() => computeSpeedBreakdown(pts), [pts])

  // 逆ジオコーディングは非同期。結果は対象 pts と一緒に保持し、現在の pts と
  // 一致するときだけ表示する (一致しない間は loading 扱い)。これで pts 切替時の
  // 「effect 内 setState によるカスケード再描画」を避けつつ loading を出せる。
  const [resolvedArea, setResolvedArea] = useState<{
    pts: TrackPoint[]
    shares: AreaShare[]
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    computeAreaBreakdown(pts).then(shares => {
      if (!cancelled) setResolvedArea({ pts, shares })
    })
    return () => {
      cancelled = true
    }
  }, [pts])
  const areaShares = resolvedArea && resolvedArea.pts === pts ? resolvedArea.shares : null

  const labelByBehavior = useMemo(() => {
    const m = new Map(SPEED_SHARE_META.map(s => [s.behavior, s.label]))
    return m
  }, [])

  return (
    <div className="nutrition-facts" role="region" aria-label="Nutrition Facts">
      <h2 className="nf-title">Nutrition Facts</h2>
      <div className="nf-serving">1 run · {formatDate(run.startedAt)}</div>

      <div className="nf-rule nf-rule-thick" />

      <div className="nf-line nf-line-headline">
        <span className="nf-row-label">Distance</span>
        <span className="nf-row-value">{formatDistance(distanceM)}</span>
      </div>
      <div className="nf-rule" />
      <div className="nf-line nf-line-headline">
        <span className="nf-row-label">Elevation Gain</span>
        <span className="nf-row-value">↑ {formatElevation(gainM)}</span>
      </div>

      <div className="nf-rule nf-rule-thick" />

      <section className="nf-section">
        <h3 className="nf-section-title">Areas</h3>
        {areaShares === null ? (
          <p className="nf-empty">Loading…</p>
        ) : areaShares.length === 0 ? (
          <p className="nf-empty">No data</p>
        ) : (
          <ul className="nf-rows">
            {areaShares.map(share => (
              <li className="nf-line" key={share.name}>
                <span className="nf-row-label">{share.name}</span>
                <span className="nf-row-value">{pct(share.ratio)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="nf-rule nf-rule-thick" />

      <section className="nf-section">
        <h3 className="nf-section-title">Pace</h3>
        {speedShares.length === 0 ? (
          <p className="nf-empty">No data</p>
        ) : (
          <ul className="nf-rows">
            {speedShares.map(share => (
              <li className="nf-line" key={share.behavior}>
                <span className="nf-row-label">
                  {labelByBehavior.get(share.behavior) ?? share.behavior}
                </span>
                <span className="nf-row-value">{pct(share.ratio)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
