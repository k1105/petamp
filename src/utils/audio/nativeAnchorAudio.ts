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
    await AnchorAudio.resume()
  }

  setBpm(bpm: number): void {
    void AnchorAudio.setBpm({ bpm })
  }

  playMelody(direction: 'up' | 'down'): void {
    void AnchorAudio.playMelody({ direction })
  }

  async stop(): Promise<void> {
    await AnchorAudio.stop()
  }
}
