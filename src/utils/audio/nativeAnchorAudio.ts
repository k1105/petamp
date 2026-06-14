import { registerPlugin } from '@capacitor/core'

// ネイティブ実装は ios/App/App/Plugins/AnchorAudioPlugin.swift。
// iOS で Spotify 等と混ぜつつ消音スイッチを無視して鳴らすため、Web Audio ではなく
// アプリ本体プロセスの AVAudioSession (.playback + .mixWithOthers) 経由で再生する。

interface AnchorAudioPlugin {
  resume(): Promise<void>
  setBpm(options: { bpm: number }): Promise<void>
  playMelody(options: { direction: 'up' | 'down' }): Promise<void>
  stop(): Promise<void>
}

const AnchorAudio = registerPlugin<AnchorAudioPlugin>('AnchorAudio')

/**
 * ネイティブ (iOS) 版アンカー音エンジン。PercussionEngine と同じインターフェイスを持ち、
 * useAnchorAudio から差し替えで使える。
 */
export class NativeAnchorAudioEngine {
  async resume(): Promise<void> {
    console.log('[anchor-audio] JS->native resume() calling')
    try {
      await AnchorAudio.resume()
      console.log('[anchor-audio] JS->native resume() OK')
    } catch (e) {
      console.log('[anchor-audio] JS->native resume() REJECTED', String(e))
      throw e
    }
  }

  setBpm(bpm: number): void {
    AnchorAudio.setBpm({ bpm })
      .then(() => console.log('[anchor-audio] JS->native setBpm OK', bpm))
      .catch(e => console.log('[anchor-audio] JS->native setBpm REJECTED', bpm, String(e)))
  }

  playMelody(direction: 'up' | 'down'): void {
    AnchorAudio.playMelody({ direction })
      .then(() => console.log('[anchor-audio] JS->native playMelody OK', direction))
      .catch(e => console.log('[anchor-audio] JS->native playMelody REJECTED', direction, String(e)))
  }

  async stop(): Promise<void> {
    try {
      await AnchorAudio.stop()
    } catch {
      // 破棄時のエラーは無視。
    }
  }
}
