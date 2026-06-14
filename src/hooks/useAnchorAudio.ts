import { useCallback, useEffect, useRef, useState } from 'react'
import { createAnchorAudioEngine } from '../utils/audio/anchorAudioEngine'
import {
  distanceToBpm,
  ANCHOR_PROGRESS_INTERVAL_MS,
  ANCHOR_PROGRESS_THRESHOLD_M,
} from '../utils/anchor/anchorAudio'

/**
 * アンカーまでの距離に応じた打音フィードバックを鳴らす。
 * さらに 1 分ごとに、前回からの増減で「トトトン」メロディ (近づいた=上昇 / 遠のいた=下降) を鳴らす。
 *
 * @param distance アンカーまでの距離 (m)。null のときは無音 (アンカー未設置/現在地不明)。
 * @returns resume: iOS の自動再生制限を解除する関数。タップ等のジェスチャ内で呼ぶこと。
 */
export function useAnchorAudio(distance: number | null) {
  // AudioContext は constructor では作らず resume() まで遅延するので、
  // ここでインスタンス生成しても自動再生制限に触れない。
  const [engine] = useState(() => createAnchorAudioEngine())

  // ジェスチャ内から呼んで AudioContext を解除する。
  const resume = useCallback(() => engine.resume(), [engine])

  // 1 分インターバルから最新距離を参照するための ref。
  const distanceRef = useRef(distance)
  // eslint-disable-next-line react-hooks/refs
  distanceRef.current = distance
  // 前回チェック時 (= 1 分前 / アンカー設置時) の距離。
  const lastCheckedRef = useRef<number | null>(null)

  // 距離が更新されるたびに BPM を反映する。
  useEffect(() => {
    if (distance == null) {
      engine.setBpm(0)
      // アンカー解除/現在地ロストで進捗の基準もリセットする。
      lastCheckedRef.current = null
      return
    }
    engine.setBpm(distanceToBpm(distance))
    // 初回 (アンカー設置直後) は基準距離だけ覚える。
    if (lastCheckedRef.current == null) lastCheckedRef.current = distance
  }, [engine, distance])

  // 1 分ごとに前回からの増減で接近/離脱メロディを鳴らす。
  useEffect(() => {
    const timer = setInterval(() => {
      const cur = distanceRef.current
      if (cur == null) return
      const prev = lastCheckedRef.current
      lastCheckedRef.current = cur
      if (prev == null) return
      const delta = cur - prev
      if (delta < -ANCHOR_PROGRESS_THRESHOLD_M) engine.playMelody('up') // 近づいた
      else if (delta > ANCHOR_PROGRESS_THRESHOLD_M) engine.playMelody('down') // 遠のいた
    }, ANCHOR_PROGRESS_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [engine])

  // アンマウント時にエンジンを破棄する。
  useEffect(() => {
    return () => {
      void engine.stop()
    }
  }, [engine])

  return { resume }
}
