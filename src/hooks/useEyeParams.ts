import { useEffect, useRef, useState } from 'react'
import { useSettingsStore, type EyeParams, type NavState } from '../store/useSettingsStore'

// FAB が状態間を移る際の補間時間。.bottom-sheet の transform transition (0.35s)
// と歩調を揃え、FAB位置の動きと目玉パラメータの動きが同時に着地するようにする。
const TWEEN_MS = 350

// 各 nav 状態における FAB の水平位置 (px)。.fab-pos-list / .fab-pos-profile の
// translateX と一致させ、source → target の水平移動方向を判定する。
// useMetaballSheet が PEAK_LEFT/RIGHT を mirror するのと同様、X bell も
// 移動方向に合わせて符号を flip する (canonical = 右方向)。
const NAV_STATE_FAB_X: Record<NavState, number> = {
  map: 0,
  list: -92,
  profile: 92,
  armed: 0,
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// eyeXOffset 以外は普通に lerp。eyeXOffset は呼び出し側 (tick) で別計算するので
// ここでは触らず、to の値を仮置きする (即上書きされる前提)。
function interp(from: EyeParams, to: EyeParams, k: number): EyeParams {
  return {
    fabIconSize: lerp(from.fabIconSize, to.fabIconSize, k),
    eyeYOffset: lerp(from.eyeYOffset, to.eyeYOffset, k),
    eyeXOffset: 0,
    eyeSizeScale: lerp(from.eyeSizeScale, to.eyeSizeScale, k),
    pupilSizeScale: lerp(from.pupilSizeScale, to.pupilSizeScale, k),
  }
}

function steadyOf(params: EyeParams): EyeParams {
  // 静止状態では eyeXOffset は常に 0。X は遷移中だけ bell でかかる。
  return { ...params, eyeXOffset: 0 }
}

/**
 * 指定の nav 状態に対応する EyeParams を返す。状態が変わると現在値から
 * キーフレーム値へ TWEEN_MS でイーズイン/アウト補間する。同じ状態のまま
 * 値だけ書き換わった (= スライダー編集) ときは補間せず即時反映する。
 *
 * eyeXOffset だけは「遷移中だけ効く」セマンティクスにしており、静止状態は
 * 常に 0、遷移中は sin(πt) を bell shape として peak = source.xOffset +
 * target.xOffset の山を通る。
 */
export function useEyeParams(navState: NavState): EyeParams {
  const keyframes = useSettingsStore(s => s.ui.eyeKeyframes)
  const target = keyframes[navState]

  const [current, setCurrent] = useState<EyeParams>(() => steadyOf(target))
  const currentRef = useRef<EyeParams>(current)
  const navStateRef = useRef<NavState>(navState)
  const rafRef = useRef<number | null>(null)

  // currentRef を current に追従させ、次回 navState 変化時に from として使う。
  useEffect(() => {
    currentRef.current = current
  }, [current])

  useEffect(() => {
    // 同じ状態のまま target が変わった (= スライダー編集) → 即時 snap。
    // 静止時の X は常に 0 に強制する。
    if (navStateRef.current === navState) {
      setCurrent(steadyOf(target))
      return
    }
    const sourceState = navStateRef.current
    navStateRef.current = navState
    // 遷移開始時点の source/target の X offset を peak の根拠にする (sum)。
    // どちらか一方にだけ -8 を打てば、その状態を含む遷移が -8 にぶれる。
    let xPeak = keyframes[sourceState].eyeXOffset + target.eyeXOffset
    // FAB が左方向に動く遷移では bell の符号を mirror する (canonical = 右方向)。
    // 例: list → map (FAB が左から中央=右方向に戻る) と map → list (中央から左へ)
    // でユーザー設定値が同じでも、目玉の bell が常に「移動方向に対して同じ向き」
    // となるよう統一する。armed のような水平移動の無い遷移では flip しない。
    const dx = NAV_STATE_FAB_X[navState] - NAV_STATE_FAB_X[sourceState]
    if (dx < 0) xPeak = -xPeak
    const from = steadyOf(currentRef.current)
    const startedAt = performance.now()

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / TWEEN_MS)
      const k = easeInOutCubic(t)
      const next = interp(from, target, k)
      // X は bell shape。peak は線形 t に対する sin で sin(0)=0, sin(π/2)=1, sin(π)=0。
      next.eyeXOffset = Math.sin(Math.PI * t) * xPeak
      setCurrent(next)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [navState, target, keyframes])

  return current
}
