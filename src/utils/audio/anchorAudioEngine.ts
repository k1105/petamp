import { Capacitor } from '@capacitor/core'
import { PercussionEngine } from './percussionEngine'
import { NativeAnchorAudioEngine } from './nativeAnchorAudio'

/**
 * アンカー音エンジンの共通インターフェイス。
 * - iOS: ネイティブ実装 (AVAudioSession .playback+.mixWithOthers)。
 *   消音スイッチを無視し、かつ Spotify 等と混ぜて鳴らせる。
 * - その他 (ブラウザ): Web Audio 実装 (PercussionEngine)。
 */
export interface AnchorAudioEngine {
  resume(): Promise<void>
  setBpm(bpm: number): void
  playMelody(direction: 'up' | 'down'): void
  stop(): Promise<void>
}

export function createAnchorAudioEngine(): AnchorAudioEngine {
  if (Capacitor.getPlatform() === 'ios') return new NativeAnchorAudioEngine()
  return new PercussionEngine()
}
