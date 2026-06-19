import { useEffect, useMemo, useRef, useState } from 'react'
import { useTransitionStore } from '../../store/useTransitionStore'
import { superellipseOutline } from './superellipse'

/**
 * アイリス〜緑フレームを SVG の super-ellipse パスで描く。
 * overlay 全面を緑で塗り、中央の super-ellipse 穴を evenodd でくり抜くことで
 * 「穴の外側に緑が残る」= フレームを作る。corner-shape と違い WebKit でも
 * 全辺が湾曲した形が出せ、JS でモーフィングするので正円→スクワークルを連続描画できる。
 *
 * フェーズ:
 *  iris            正円が点から PAUSE_DIAMETER まで拡大 (n=2)
 *  iris-paused     正円で静止
 *  iris-finishing  正円 → super-ellipse フレームへモーフ (n=2 → exponent)
 *  framed          フレームで静止 (run 中ずっと)
 */

/** paused 時の正円の直径 (vw)。 */
const PAUSE_DIAMETER_VW = 70
const IRIS_GROW_MS = 350
const IRIS_FINISH_MS = 500
/** フレームを「アウト」させる (穴を広げて枠を消す) アニメ時間。 */
const FRAME_HIDE_MS = 460
/** アウト時に穴を画面外まで広げる倍率 (角の緑も完全に消えるよう 1 以上)。 */
const FRAME_OPEN_SCALE = 1.25
/** 残す緑フレームの太さ (px)。画面端から穴までの余白。 */
const FRAME_INSET = 14
/** フレームの super-ellipse 指数。4.8 = ほぼ長方形だが全辺がゆるく湾曲。 */
const FRAME_EXPONENT = 4.8
/** 輪郭のサンプル点数。多いほど滑らか。 */
const SEGMENTS = 96

interface Geom {
  /** 横半径 (px) */
  rx: number
  /** 縦半径 (px) */
  ry: number
  /** super-ellipse 指数 */
  n: number
}

/** 画面全面の矩形 + 中央のくり抜き穴。evenodd で穴の外側だけ塗られる。 */
function framePath(w: number, h: number, g: Geom): string {
  const outer = `M0 0 H${w} V${h} H0 Z`
  const hole = superellipseOutline(w / 2, h / 2, g.rx, g.ry, g.n, SEGMENTS)
  return hole ? `${outer} ${hole}` : outer
}

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3)
const easeInOutCubic = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpGeom = (a: Geom, b: Geom, t: number): Geom => ({
  rx: lerp(a.rx, b.rx, t),
  ry: lerp(a.ry, b.ry, t),
  n: lerp(a.n, b.n, t),
})

function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])
  return vp
}

export function IrisFrame() {
  const phase = useTransitionStore(s => s.phase)
  const frameHidden = useTransitionStore(s => s.frameHidden)
  const { w, h } = useViewport()

  // paused の正円 / framed のフレーム、それぞれの到達ジオメトリ。
  const pauseGeom = useMemo<Geom>(() => {
    const r = (PAUSE_DIAMETER_VW / 200) * w
    return { rx: r, ry: r, n: 2 }
  }, [w])
  const frameGeom = useMemo<Geom>(
    () => ({
      rx: Math.max(0, (w - FRAME_INSET * 2) / 2),
      ry: Math.max(0, (h - FRAME_INSET * 2) / 2),
      n: FRAME_EXPONENT,
    }),
    [w, h],
  )
  // 「アウト」時の到達ジオメトリ: 指数 (n) はそのままに rx/ry を画面外まで広げ、
  // 穴が画面全体を覆う = 緑フレームが完全に消える。framed のときだけ使う。
  const openGeom = useMemo<Geom>(
    () => ({
      rx: (w / 2) * FRAME_OPEN_SCALE,
      ry: (h / 2) * FRAME_OPEN_SCALE,
      n: FRAME_EXPONENT,
    }),
    [w, h],
  )

  // モーフィング中の中間ジオメトリ。rAF コールバックでのみ更新する。
  const [animGeom, setAnimGeom] = useState<Geom>({ rx: 0, ry: 0, n: 2 })
  // framed 中のフレーム「アウト」進捗 (0 = 通常フレーム, 1 = 完全アウト)。
  // frameGeom ↔ openGeom を rAF で補間する。ref は途中反転の起点に使う。
  const [hideT, setHideT] = useState(0)
  const hideTRef = useRef(0)

  useEffect(() => {
    // 静止フェーズ (iris-paused / framed) は render で直接描くので何もしない。
    if (phase !== 'iris' && phase !== 'iris-finishing') return

    // iris は点から、iris-finishing は paused の正円から始める。
    const from: Geom = phase === 'iris' ? { rx: 0, ry: 0, n: 2 } : pauseGeom
    const to = phase === 'iris' ? pauseGeom : frameGeom
    const dur = phase === 'iris' ? IRIS_GROW_MS : IRIS_FINISH_MS
    const ease = phase === 'iris' ? easeOutCubic : easeInOutCubic

    let startTs: number | null = null
    let raf = 0
    const step = (ts: number) => {
      if (startTs === null) startTs = ts
      const p = Math.min(1, (ts - startTs) / dur)
      setAnimGeom(lerpGeom(from, to, ease(p)))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [phase, pauseGeom, frameGeom])

  // framed 中に frameHidden が切り替わったら、hideT を 0↔1 へアニメする。
  // 途中反転にも対応するため、起点は現在値 (hideTRef) を使う。
  useEffect(() => {
    if (phase !== 'framed') return
    const fromT = hideTRef.current
    const toT = frameHidden ? 1 : 0
    if (fromT === toT) return

    let startTs: number | null = null
    let raf = 0
    const step = (ts: number) => {
      if (startTs === null) startTs = ts
      const p = Math.min(1, (ts - startTs) / FRAME_HIDE_MS)
      const val = fromT + (toT - fromT) * easeInOutCubic(p)
      hideTRef.current = val
      setHideT(val)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [phase, frameHidden])

  // 静止フェーズはストア/リサイズに即追従 (GUI ライブ反映)、進行中は rAF の値。
  // framed は hideT で frameGeom ↔ openGeom を補間 (resize にも追従)。
  const displayGeom: Geom =
    phase === 'iris-paused'
      ? pauseGeom
      : phase === 'framed'
        ? lerpGeom(frameGeom, openGeom, hideT)
        : animGeom

  return (
    <svg className="transition-frame" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={framePath(w, h, displayGeom)} fillRule="evenodd" />
    </svg>
  )
}
