import { useEffect, useState } from 'react'
import { usePostRunLoadingStore } from '../../store/usePostRunLoadingStore'
import { LoadingEyesBubble } from '../ui/LoadingEyesBubble'
import { superellipseOutline } from './superellipse'

const ENTER_DURATION_MS = 400
const CLOSE_DURATION_MS = 1000
/** マスクの指数。2 = 正円 (record 入場の iris と同じく中央へ正円で収束させる)。 */
const CIRCLE_EXPONENT = 2
/** 画面の角まで確実に覆う余裕倍率 (正円は外接円 = 対角線の半分で覆う)。 */
const COVER_SCALE = 1.05

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3)
const easeInOutCubic = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2

/**
 * 現在のフェーズと進捗 t から clip-path 文字列を組み立てる。中央の正円の穴
 * (矩形 + 逆巻きリングの nonzero ドーナツ) の半径を動かす。rx = ry なので常に正円。
 *  entering: 穴を 外接円 → 0 へ縮める = 緑が外周から中央へ正円で収束する
 *            (record 入場の「中央から正円が開く」動きの逆再生)。
 *  closing : 穴を 0 → 外接円 へ広げる = 中央から正円で背後の結果画面が開く。
 *  loading : クリップ無し (全面表示)。
 */
function buildClip(phase: string, t: number, w: number, h: number): string | undefined {
  if (phase !== 'entering' && phase !== 'closing') return undefined
  // entering は穴が縮む (1→0)、closing は穴が広がる (0→1)。
  const holeProgress = phase === 'entering' ? 1 - t : t
  // 矩形の外接円 (対角線の半分) を基準にすれば、正円のまま画面全体を覆える。
  const coverR = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2) * COVER_SCALE
  const r = coverR * holeProgress
  const outer = `M0 0 H${w} V${h} H0 Z`
  // 逆巻き (clockwise=false) のリングを nonzero でくり抜く = ドーナツ (中央が透明)。
  const hole = superellipseOutline(w / 2, h / 2, r, r, CIRCLE_EXPONENT, 96, false)
  return `path("${outer} ${hole}")`
}

export function PostRunLoadingScreen() {
  const phase = usePostRunLoadingStore(s => s.phase)
  const setPhase = usePostRunLoadingStore(s => s.setPhase)
  const reset = usePostRunLoadingStore(s => s.reset)

  // フェーズ進行 (entering → loading/closing → reset)。
  useEffect(() => {
    if (phase === 'idle') return
    // loading は対話側からの setReady() を待つだけなのでタイマー不要。
    if (phase === 'loading') return
    const dur = phase === 'entering' ? ENTER_DURATION_MS : CLOSE_DURATION_MS
    const t = window.setTimeout(() => {
      if (phase === 'entering') {
        // entering 中に setReady() が来ていたら loading をスキップして closing へ。
        const { readyPending } = usePostRunLoadingStore.getState()
        setPhase(readyPending ? 'closing' : 'loading')
      } else if (phase === 'closing') {
        reset()
      }
    }, dur)
    return () => window.clearTimeout(t)
  }, [phase, setPhase, reset])

  // super-ellipse マスクの進捗を rAF でアニメ。phase ごと値を持ち、phase 切替時は
  // 自動的に 0 起点になる (anim.phase が現在 phase と一致するまで t=0 扱い → ちらつき防止)。
  const [anim, setAnim] = useState<{ phase: string; t: number }>({ phase: 'idle', t: 0 })
  useEffect(() => {
    if (phase !== 'entering' && phase !== 'closing') return
    const dur = phase === 'entering' ? ENTER_DURATION_MS : CLOSE_DURATION_MS
    const ease = phase === 'entering' ? easeInOutCubic : easeOutCubic
    let startTs: number | null = null
    let raf = 0
    const step = (ts: number) => {
      if (startTs === null) startTs = ts
      const p = Math.min(1, (ts - startTs) / dur)
      setAnim({ phase, t: ease(p) })
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  if (phase === 'idle') return null

  const t = anim.phase === phase ? anim.t : 0
  const clipPath = buildClip(phase, t, window.innerWidth, window.innerHeight)

  return (
    <div
      className={`post-run-loading phase-${phase}`}
      style={clipPath ? { clipPath, WebkitClipPath: clipPath } : undefined}
      aria-hidden={phase !== 'loading'}
    >
      <LoadingEyesBubble text="loading..." />
    </div>
  )
}
