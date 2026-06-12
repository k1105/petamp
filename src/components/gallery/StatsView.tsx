import { useMemo } from 'react'
import type { Run } from '../../types'
import { computeRunStatsAggregate } from '../../utils/run/runStatsAggregate'
import { formatDistance, formatDuration } from '../../utils/ui/formatters'
import { catmullRomPath, type Point2D } from '../../utils/path/splinePath'

interface Props {
  runs: Run[]
}

const COMPASS_SIZE = 240
const COMPASS_CX = COMPASS_SIZE / 2
const COMPASS_CY = COMPASS_SIZE / 2
const COMPASS_MAX_R = COMPASS_SIZE / 2 - 32
const COMPASS_MIN_R = COMPASS_MAX_R * 0.18

const HIST_W = 280
const HIST_H = 140
const HIST_PAD_X = 8
const HIST_BASELINE = HIST_H
const HIST_LABEL_Y = HIST_H + 14

function formatSpeedRange(from: number, to: number): string {
  if (!Number.isFinite(to)) return `${from}+`
  return `${from}-${to}`
}

function polarToXY(cx: number, cy: number, r: number, deg: number): [number, number] {
  // 0=N, 時計回り。SVG は y 下向きなので sin/-cos で N が上に来る。
  const rad = (deg * Math.PI) / 180
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)]
}

export function StatsView({ runs }: Props) {
  const stats = useMemo(() => computeRunStatsAggregate(runs), [runs])

  if (stats.runCount === 0) {
    return <p className="empty-hint">統計を表示できるランがまだありません</p>
  }

  const maxSpeedBinDist = Math.max(1, ...stats.speedHistogram.map(b => b.distanceM))
  const maxDirDist = Math.max(1, ...stats.directionBins.map(b => b.distanceM))

  // ヒストグラム: bin 中心を点列にして Catmull-Rom で面チャート化。
  const histInner = HIST_W - HIST_PAD_X * 2
  const histStep = histInner / (stats.speedHistogram.length - 1)
  const histPoints: Point2D[] = stats.speedHistogram.map((bin, i) => ({
    x: HIST_PAD_X + i * histStep,
    y: HIST_BASELINE - (bin.distanceM / maxSpeedBinDist) * HIST_H,
  }))
  const histCurve = catmullRomPath(histPoints)
  const histAreaPath = histPoints.length
    ? `${histCurve} L ${histPoints[histPoints.length - 1].x.toFixed(2)} ${HIST_BASELINE} L ${histPoints[0].x.toFixed(2)} ${HIST_BASELINE} Z`
    : ''

  // コンパス: 8 方位の半径点を閉じたスプラインでブロブ化。
  // 全 bin が 0 でも視認できるよう最小半径を持たせる。
  const compassPoints: Point2D[] = stats.directionBins.map(bin => {
    const r = COMPASS_MIN_R + (bin.distanceM / maxDirDist) * (COMPASS_MAX_R - COMPASS_MIN_R)
    const [x, y] = polarToXY(COMPASS_CX, COMPASS_CY, r, bin.centerDeg)
    return { x, y }
  })
  const compassBlob = catmullRomPath(compassPoints, { closed: true })

  return (
    <div className="stats-view">
      <section className="stats-card stats-summary-card">
        <div className="stats-summary-row">
          <div className="stats-summary-item">
            <div className="stats-summary-label">累計距離</div>
            <div className="stats-summary-value">{formatDistance(stats.totalDistanceM)}</div>
          </div>
          <div className="stats-summary-item">
            <div className="stats-summary-label">累計時間</div>
            <div className="stats-summary-value">{formatDuration(stats.totalDurationSec)}</div>
          </div>
          <div className="stats-summary-item">
            <div className="stats-summary-label">ラン数</div>
            <div className="stats-summary-value">{stats.runCount}</div>
          </div>
          <div className="stats-summary-item">
            <div className="stats-summary-label">平均速度</div>
            <div className="stats-summary-value">
              {stats.averageSpeedKmh !== null ? `${stats.averageSpeedKmh.toFixed(1)} km/h` : '—'}
            </div>
          </div>
        </div>
      </section>

      <section className="stats-card">
        <h3 className="stats-card-title">移動速度のヒストグラム</h3>
        <p className="stats-card-sub">距離加重 / km/h</p>
        <svg
          className="stats-histogram"
          viewBox={`0 0 ${HIST_W} ${HIST_H + 28}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="移動速度ヒストグラム"
        >
          <line
            x1={HIST_PAD_X}
            y1={HIST_BASELINE}
            x2={HIST_W - HIST_PAD_X}
            y2={HIST_BASELINE}
            className="stats-axis-line"
          />
          <path d={histAreaPath} className="stats-area" />
          <path d={histCurve} className="stats-area-stroke" />
          {histPoints.map((pt, i) => (
            <circle
              key={`pt-${i}`}
              cx={pt.x}
              cy={pt.y}
              r={2.5}
              className="stats-area-dot"
            />
          ))}
          {stats.speedHistogram.map((bin, i) => (
            <text
              key={`lbl-${i}`}
              x={HIST_PAD_X + i * histStep}
              y={HIST_LABEL_Y}
              className="stats-axis-label"
              textAnchor="middle"
            >
              {formatSpeedRange(bin.from, bin.to)}
            </text>
          ))}
        </svg>
      </section>

      <section className="stats-card">
        <h3 className="stats-card-title">移動方位の累計</h3>
        <p className="stats-card-sub">8 方位 / 距離比</p>
        <svg
          className="stats-compass"
          viewBox={`0 0 ${COMPASS_SIZE} ${COMPASS_SIZE}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="移動方位 累計"
        >
          <circle
            cx={COMPASS_CX}
            cy={COMPASS_CY}
            r={COMPASS_MAX_R}
            className="stats-compass-ring"
          />
          <circle
            cx={COMPASS_CX}
            cy={COMPASS_CY}
            r={COMPASS_MAX_R * 0.5}
            className="stats-compass-ring stats-compass-ring-inner"
          />
          <path d={compassBlob} className="stats-compass-blob" />
          <path d={compassBlob} className="stats-compass-blob-stroke" />
          {compassPoints.map((pt, i) => (
            <circle
              key={`cp-${i}`}
              cx={pt.x}
              cy={pt.y}
              r={2.5}
              className="stats-compass-dot"
            />
          ))}
          {stats.directionBins.map(bin => {
            const [x, y] = polarToXY(COMPASS_CX, COMPASS_CY, COMPASS_MAX_R + 18, bin.centerDeg)
            return (
              <text
                key={`${bin.label}-label`}
                x={x}
                y={y}
                className="stats-compass-label"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {bin.label}
              </text>
            )
          })}
        </svg>
      </section>
    </div>
  )
}
