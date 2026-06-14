import AVFoundation
import Capacitor
import Foundation

/// アンカーまでの距離フィードバック音をネイティブで鳴らすプラグイン。
///
/// なぜネイティブか:
/// iOS の WKWebView では Web Audio が WebContent プロセス側の AVAudioSession で再生され、
/// 既定の 'ambient' は消音スイッチに従って無音になる。`navigator.audioSession.type='playback'`
/// で消音は無視できるが、その場合は他アプリ (Spotify 等) の音を止めてしまい「混ぜて鳴らす」が
/// できない。アプリ本体プロセスの AVAudioSession を `.playback + .mixWithOthers` にすれば
/// 「消音無視」かつ「Spotify と混在」を両立できるため、音はネイティブ側で合成・再生する。
///
/// 音作りは Web 版 (PercussionEngine) と同等:
/// - 打音: ホワイトノイズ → lowpass(700Hz, Q0.5) → アタック12ms/減衰180msのエンベロープ。
/// - メロディ「トトトン」: C5/E5/G5 のトライアングル波、最後の音だけ長め。
/// 打音は lookahead スケジューラで AVAudioPlayerNode にサンプル精度で予約し、BPM を安定させる。
@objc(AnchorAudioPlugin)
public class AnchorAudioPlugin: CAPPlugin {
    private let engine = AVAudioEngine()
    private let tickPlayer = AVAudioPlayerNode()
    private let melodyPlayer = AVAudioPlayerNode()

    private var sampleRate: Double = 44100
    private var tickBuffer: AVAudioPCMBuffer?

    private var bpm: Double = 0
    private var samplesPerTick: Double = 0
    private var nextTickSample: AVAudioFramePosition = 0
    private var scheduling = false
    private var started = false

    /// AVAudioEngine の操作・スケジューリングを直列化する専用キュー。
    private let queue = DispatchQueue(label: "com.rennur.petamp.anchor-audio")
    private var timer: DispatchSourceTimer?

    private let lookaheadMs = 25
    private let scheduleAheadSeconds = 0.15

    // MARK: - JS から呼ばれるメソッド

    /// AudioSession/エンジンを準備する。ジェスチャ内から呼ぶ前提 (Web 版と同じ resume())。
    @objc func resume(_ call: CAPPluginCall) {
        queue.async {
            self.setupIfNeeded()
            call.resolve()
        }
    }

    /// 打音の BPM を設定する。0 (以下) で無音。
    @objc func setBpm(_ call: CAPPluginCall) {
        let value = call.getDouble("bpm") ?? 0
        queue.async {
            self.applyBpm(value)
            call.resolve()
        }
    }

    /// 「トトトン」を鳴らす。direction = "up" (近づいた=上昇) / "down" (遠のいた=下降)。
    @objc func playMelody(_ call: CAPPluginCall) {
        let direction = call.getString("direction") ?? "up"
        queue.async {
            self.setupIfNeeded()
            self.scheduleMelody(ascending: direction == "up")
            call.resolve()
        }
    }

    /// 完全停止し、AudioSession を解放する。
    @objc func stop(_ call: CAPPluginCall) {
        queue.async {
            self.teardown()
            call.resolve()
        }
    }

    // MARK: - セットアップ / 破棄

    private func setupIfNeeded() {
        guard !started else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            // .playback = 消音スイッチを無視 / .mixWithOthers = Spotify 等と混ぜて鳴らす。
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            print("⚠️ [anchor-audio] session error: \(error)")
        }

        engine.attach(tickPlayer)
        engine.attach(melodyPlayer)
        let mixer = engine.mainMixerNode
        let format = AVAudioFormat(standardFormatWithSampleRate: AVAudioSession.sharedInstance().sampleRate, channels: 1)
        engine.connect(tickPlayer, to: mixer, format: format)
        engine.connect(melodyPlayer, to: mixer, format: format)

        // 実際に再生されるレート (スケジューリングの基準)。
        sampleRate = tickPlayer.outputFormat(forBus: 0).sampleRate
        if sampleRate <= 0 { sampleRate = AVAudioSession.sharedInstance().sampleRate }
        tickBuffer = buildTickBuffer()

        do {
            try engine.start()
        } catch {
            print("⚠️ [anchor-audio] engine start error: \(error)")
            return
        }
        tickPlayer.play()
        melodyPlayer.play()
        started = true
        print("✅ [anchor-audio] native engine started sampleRate=\(sampleRate)")
    }

    private func teardown() {
        stopTimer()
        scheduling = false
        bpm = 0
        guard started else { return }
        tickPlayer.stop()
        melodyPlayer.stop()
        engine.stop()
        engine.detach(tickPlayer)
        engine.detach(melodyPlayer)
        started = false
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    // MARK: - BPM / 打音スケジューリング

    private func applyBpm(_ value: Double) {
        let next = value > 0 ? value : 0
        if next > 0 {
            setupIfNeeded()
            samplesPerTick = sampleRate * 60.0 / next
            if !scheduling {
                scheduling = true
                nextTickSample = currentSample(tickPlayer) + AVAudioFramePosition(sampleRate * 0.05)
                startTimer()
            }
            bpm = next
        } else {
            bpm = 0
            scheduling = false
            stopTimer()
        }
    }

    private func startTimer() {
        stopTimer()
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: .milliseconds(lookaheadMs))
        t.setEventHandler { [weak self] in self?.scheduleTicks() }
        timer = t
        t.resume()
    }

    private func stopTimer() {
        timer?.cancel()
        timer = nil
    }

    private func scheduleTicks() {
        guard scheduling, bpm > 0, let buf = tickBuffer else { return }
        let ahead = currentSample(tickPlayer) + AVAudioFramePosition(sampleRate * scheduleAheadSeconds)
        while nextTickSample < ahead {
            let when = AVAudioTime(sampleTime: nextTickSample, atRate: sampleRate)
            tickPlayer.scheduleBuffer(buf, at: when, options: [], completionHandler: nil)
            nextTickSample += AVAudioFramePosition(samplesPerTick)
        }
    }

    /// 指定プレイヤーの現在のサンプル位置 (再生開始からの経過フレーム)。
    private func currentSample(_ player: AVAudioPlayerNode) -> AVAudioFramePosition {
        guard let nodeTime = player.lastRenderTime,
              let playerTime = player.playerTime(forNodeTime: nodeTime) else { return 0 }
        return playerTime.sampleTime
    }

    // MARK: - メロディ

    private func scheduleMelody(ascending: Bool) {
        let ascendingNotes = [523.25, 659.25, 783.99] // C5 E5 G5
        let freqs = ascending ? ascendingNotes : ascendingNotes.reversed().map { $0 }
        let step = 0.13
        let base = currentSample(melodyPlayer) + AVAudioFramePosition(sampleRate * 0.05)
        for (i, f) in freqs.enumerated() {
            let isLast = i == freqs.count - 1
            // 「トトトン」: 最後の音 (ン) だけ少し長く伸ばす。
            let decay = isLast ? 0.32 : 0.16
            guard let buf = buildToneBuffer(freq: f, decay: decay) else { continue }
            let when = AVAudioTime(sampleTime: base + AVAudioFramePosition(Double(i) * step * sampleRate), atRate: sampleRate)
            melodyPlayer.scheduleBuffer(buf, at: when, options: [], completionHandler: nil)
        }
    }

    // MARK: - バッファ合成

    /// 打音 1 発のバッファ: ノイズ → lowpass(700Hz,Q0.5) → エンベロープ。
    private func buildTickBuffer() -> AVAudioPCMBuffer? {
        let dur = 0.22
        let frames = AVAudioFrameCount(sampleRate * dur)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1),
              let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buf.frameLength = frames
        let ptr = buf.floatChannelData![0]

        // RBJ クックブックの lowpass 係数 (700Hz, Q=0.5)。
        let f0 = 700.0, q = 0.5
        let w0 = 2.0 * Double.pi * f0 / sampleRate
        let cosw = cos(w0), sinw = sin(w0)
        let alpha = sinw / (2.0 * q)
        let a0 = 1 + alpha
        let nb0 = ((1 - cosw) / 2) / a0
        let nb1 = (1 - cosw) / a0
        let nb2 = ((1 - cosw) / 2) / a0
        let na1 = (-2 * cosw) / a0
        let na2 = (1 - alpha) / a0
        var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0

        let attack = 0.012, decayTo = 0.18
        let peak = 0.63 // Web 版の env.peak(0.7) × masterGain(0.9) 相当。
        let k = log(0.001 / peak) / (decayTo - attack)

        for i in 0..<Int(frames) {
            let t = Double(i) / sampleRate
            let x = Double.random(in: -1...1)
            let y = nb0 * x + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            var env: Double
            if t < attack {
                env = peak * (t / attack)
            } else if t < decayTo {
                env = peak * exp(k * (t - attack))
            } else {
                env = 0
            }
            ptr[i] = Float(y * env)
        }
        return buf
    }

    /// メロディ 1 音のバッファ: トライアングル波 + エンベロープ。
    private func buildToneBuffer(freq: Double, decay: Double) -> AVAudioPCMBuffer? {
        let dur = decay + 0.02
        let frames = AVAudioFrameCount(sampleRate * dur)
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1),
              let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buf.frameLength = frames
        let ptr = buf.floatChannelData![0]

        let attack = 0.01
        let peak = 0.45 // Web 版の peak(0.5) × masterGain(0.9) 相当。
        let k = log(0.001 / peak) / (decay - attack)
        var phase = 0.0
        let inc = freq / sampleRate

        for i in 0..<Int(frames) {
            let t = Double(i) / sampleRate
            let tri = 4.0 * abs(phase - 0.5) - 1.0 // -1..1 のトライアングル。
            phase += inc
            if phase >= 1 { phase -= 1 }
            var env: Double
            if t < attack {
                env = peak * (t / attack)
            } else {
                env = peak * exp(k * (t - attack))
            }
            ptr[i] = Float(tri * env)
        }
        return buf
    }
}
