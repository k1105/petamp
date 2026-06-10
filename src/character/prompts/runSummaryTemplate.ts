import type { RunSegment, RunSummary } from '../domain/runSummary'

/**
 * RunSummary を LLM 用テキストに整形する pure function 群。
 * default (v1) 実装。差し替え可能。
 */

function describeShape(topo: RunSummary['topology']): string {
  const label =
    topo.shape === 'loop' ? 'ぐるっと回る道'
    : topo.shape === 'out_and_back' ? '同じ道を往復'
    : topo.shape === 'figure_eight' ? '8の字'
    : topo.shape === 'lollipop' ? '一本道のあとにぐるっと回る道'
    : topo.shape === 'complex' ? '何度も交差する入りくんだ道'
    : '一方通行'
  return `${label} (${topo.shape}, 蛇行度${topo.squiggliness.toFixed(2)})`
}

function describeBehavior(b: RunSegment['behavior']): string {
  switch (b) {
    case 'resting': return '止まっていた'
    case 'walking': return '歩いていた'
    case 'running': return '走っていた'
  }
}

export function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm - m * 60)
  return `${m}'${s.toString().padStart(2, '0')}"`
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const m = Math.floor(total / 60)
  const s = total - m * 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function pct(frac: number): string {
  return `${Math.round(frac * 100)}%`
}

export function renderRunSummary(s: RunSummary): string {
  const overallLines = [
    s.areaName ? `エリア: ${s.areaName}` : null,
    `全体: ${(s.distanceM / 1000).toFixed(2)}km, ${Math.round(s.durationSec / 60)}分, ` +
      `${s.avgPaceSecPerKm !== null ? `平均${formatPace(s.avgPaceSecPerKm)}/km, ` : ''}` +
      `↑${Math.round(s.elevationGainM)}m ↓${Math.round(s.elevationLossM)}m, ${s.timeOfDay}`,
    `形: ${describeShape(s.topology)}`,
    `ペース帯: 速い ${pct(s.paceDistribution.fastFraction)} / ふつう ${pct(s.paceDistribution.normalFraction)} / 遅い ${pct(s.paceDistribution.slowFraction)}`,
    `メモ: ${s.noteCount}件`,
    s.vsAreaAverage
      ? `同エリア平均比: 距離x${s.vsAreaAverage.distanceRatio.toFixed(2)} / ペースx${s.vsAreaAverage.paceRatio.toFixed(2)} / 標高x${s.vsAreaAverage.elevationRatio.toFixed(2)}`
      : null,
  ].filter((l): l is string => l !== null)

  const sections: string[] = [overallLines.join('\n')]

  if (s.segments.length > 0) {
    const segLines = s.segments.map(seg => {
      const startKm = (seg.startDistanceM / 1000).toFixed(2)
      const endKm = (seg.endDistanceM / 1000).toFixed(2)
      const pace = seg.avgPaceSecPerKm !== null ? `${formatPace(seg.avgPaceSecPerKm)}/km` : '?'
      const dur = formatDuration(seg.durationSec)
      return `seg ${seg.index} (${describeBehavior(seg.behavior)}): ${startKm}-${endKm}km, ${dur}, ${pace}, ↑${Math.round(seg.elevationGainM)}m ↓${Math.round(seg.elevationLossM)}m`
    })
    sections.push(['セグメント (振る舞いベース):', ...segLines].join('\n'))
  }

  if (s.events.length > 0) {
    const evtLines = s.events.map(e => {
      const pp = `${Math.round(e.progress * 100)}%`
      return `seg ${e.segmentIndex} (進行 ${pp}): ${e.description}`
    })
    sections.push(['特徴的なポイント:', ...evtLines].join('\n'))
  }

  return sections.join('\n\n')
}
