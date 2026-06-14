/**
 * メロディックでない「叩く音」を一定 BPM で鳴らす Web Audio エンジン。
 *
 * - ホワイトノイズのバースト → バンドパス → 急減衰エンベロープで打撃音 (tick/clack) を合成する。
 *   音程を持たないので「メロディックではない叩く音」になる。
 * - lookahead スケジューラ (setInterval + AudioContext.currentTime) で BPM を安定して刻む。
 *   setInterval 単体のジッタを避ける定石パターン。
 * - iOS WebView では AudioContext がユーザー操作後にしか resume できないため、
 *   resume() は必ずタップ等のジェスチャ内から呼ぶこと。
 */
export class PercussionEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  /** 現在の BPM。0 のときは無音 (スケジューラ停止)。 */
  private bpm = 0
  private nextNoteTime = 0
  private schedulerTimer: ReturnType<typeof setInterval> | null = null
  /** iOS の無音バッファによるアンロックを一度だけ行うフラグ。 */
  private unlocked = false
  /** スケジュール初回ヒットの診断ログを 1 回だけ出すフラグ。 */
  private loggedFirstHit = false

  /** スケジューラの起動間隔 (ms)。 */
  private readonly lookaheadMs = 25
  /** 何秒先までの打音を前もって予約するか (s)。 */
  private readonly scheduleAheadTime = 0.12

  /**
   * AudioContext を生成・再開する。iOS の自動再生制限を解除するため、
   * 必ずユーザー操作 (タップ) のハンドラ内から await すること。
   */
  async resume(): Promise<void> {
    // iOS WKWebView の Web Audio は WebContent プロセス側の AVAudioSession で鳴り、
    // 既定の 'ambient' は消音スイッチに従って無音になる。AppDelegate で app プロセスの
    // セッションを .playback にしても WebView 側は別物なので効かない。
    // navigator.audioSession.type='playback' が WebView 側セッションを制御する唯一の口。
    // (Safari/WKWebView 16.4+)
    const navAudio = navigator as unknown as { audioSession?: { type: string } }
    if (navAudio.audioSession) {
      navAudio.audioSession.type = 'playback'
      console.log('[anchor-audio] navigator.audioSession.type = playback')
    }
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = 0.9
      this.masterGain.connect(this.ctx.destination)
      this.noiseBuffer = this.buildNoiseBuffer(this.ctx)
    }
    // iOS WebView の確実なアンロック: ジェスチャ内で無音バッファを 1 回鳴らす。
    if (!this.unlocked) {
      const silent = this.ctx.createBufferSource()
      silent.buffer = this.ctx.createBuffer(1, 1, 22050)
      silent.connect(this.ctx.destination)
      silent.start(0)
      this.unlocked = true
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
    console.log('[anchor-audio] resume() done state=', this.ctx.state, 'sampleRate=', this.ctx.sampleRate)
  }

  /** BPM を設定する。0 (または負) で無音にする。 */
  setBpm(bpm: number): void {
    const next = bpm > 0 ? bpm : 0
    const crossed = (next > 0) !== (this.bpm > 0)
    this.bpm = next
    if (this.bpm > 0) {
      // 自動サスペンド対策: 既存 context が suspended に戻っていたら再開する。
      // (一度ジェスチャでアンロック済みなので、以後は非ジェスチャでも resume できる)
      if (this.ctx && this.ctx.state === 'suspended') {
        console.log('[anchor-audio] ctx suspended -> resuming')
        void this.ctx.resume()
      }
      if (crossed) console.log('[anchor-audio] setBpm', next, 'ctxState=', this.ctx?.state)
      this.startScheduler()
    } else {
      this.stopScheduler()
    }
  }

  /** エンジンを完全停止し、AudioContext を破棄する。 */
  async stop(): Promise<void> {
    this.stopScheduler()
    this.bpm = 0
    if (this.ctx) {
      const ctx = this.ctx
      this.ctx = null
      this.masterGain = null
      this.noiseBuffer = null
      try {
        await ctx.close()
      } catch {
        // 既に閉じている等は無視。
      }
    }
  }

  private startScheduler(): void {
    if (!this.ctx) {
      console.warn('[anchor-audio] startScheduler: no AudioContext (resume() not called in a gesture?)')
      return
    }
    if (this.schedulerTimer !== null) return
    console.log('[anchor-audio] scheduler START ctxState=', this.ctx.state, 'bpm=', this.bpm)
    // 直近の打音から始めると詰まるので少し先から。
    this.nextNoteTime = this.ctx.currentTime + 0.05
    this.schedulerTimer = setInterval(() => this.scheduler(), this.lookaheadMs)
  }

  private stopScheduler(): void {
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer)
      this.schedulerTimer = null
    }
  }

  private scheduler(): void {
    if (!this.ctx || this.bpm <= 0) return
    const interval = 60 / this.bpm
    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
      if (!this.loggedFirstHit) {
        console.log('[anchor-audio] first hit scheduled at', this.nextNoteTime.toFixed(3), 'now=', this.ctx.currentTime.toFixed(3), 'state=', this.ctx.state)
        this.loggedFirstHit = true
      }
      this.scheduleHit(this.nextNoteTime)
      this.nextNoteTime += interval
    }
  }

  /** 指定時刻に 1 発の打撃音を鳴らす。 */
  private scheduleHit(time: number): void {
    if (!this.ctx || !this.noiseBuffer || !this.masterGain) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuffer

    // やわらかい音にするため、低めの lowpass で高域の刺さりを落とす。
    const lowpass = this.ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 700
    lowpass.Q.value = 0.5

    const env = this.ctx.createGain()
    const peak = 0.7
    // アタックを 12ms まで伸ばしてクリック感を消し、減衰はやや長めで丸い余韻にする。
    env.gain.setValueAtTime(0, time)
    env.gain.linearRampToValueAtTime(peak, time + 0.012)
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.18)

    src.connect(lowpass)
    lowpass.connect(env)
    env.connect(this.masterGain)

    src.start(time)
    src.stop(time + 0.22)
  }

  /**
   * 「トトトン」の 3 音メロディを鳴らす。打音 (BPM) とは別の進捗合図。
   * @param direction 'up' = 近づいた (上昇) / 'down' = 遠のいた (下降)。
   */
  playMelody(direction: 'up' | 'down'): void {
    if (!this.ctx) return
    // C5 E5 G5 の長三和音。up は上昇、down は下降。
    const ascending = [523.25, 659.25, 783.99]
    const notes = direction === 'up' ? ascending : [...ascending].reverse()
    const start = this.ctx.currentTime + 0.05
    const step = 0.13
    notes.forEach((freq, i) => {
      const isLast = i === notes.length - 1
      // 「トトトン」: 最後の音 (ン) だけ少し長く伸ばす。
      this.scheduleTone(freq, start + i * step, isLast ? 0.32 : 0.16)
    })
  }

  /** 指定時刻に 1 音のやわらかいトーンを鳴らす。 */
  private scheduleTone(freq: number, time: number, decay: number): void {
    if (!this.ctx || !this.masterGain) return
    const osc = this.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq

    const env = this.ctx.createGain()
    const peak = 0.5
    env.gain.setValueAtTime(0, time)
    env.gain.linearRampToValueAtTime(peak, time + 0.01)
    env.gain.exponentialRampToValueAtTime(0.001, time + decay)

    osc.connect(env)
    env.connect(this.masterGain)
    osc.start(time)
    osc.stop(time + decay + 0.02)
  }

  /** 0.3 秒分のホワイトノイズバッファ (打音の素材)。 */
  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.3)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1
    }
    return buffer
  }
}
