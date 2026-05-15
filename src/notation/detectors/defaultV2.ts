import type { MotifDetector, Motif, Phoneme } from '../types'

const MIN_LEN = 2
const MAX_LEN = 3
const MIN_INSTANCES = 2

/**
 * 長さ 2-8 の音素並びを全Runs横断で走査し、2回以上出現する canonical 形をモチーフとして抽出する。
 *
 * canonical id は **持続時間を無視した形状** で定義する (`ペタン↑ ピー ペタン` のような並び)。
 * 同じ「形」が複数Runで現れたら同一概念とみなすため、durationMs は同一性判定に含めない。
 *
 * instances には Run内の trackPoint index 範囲を残し、マップ上の発光・指差しに使えるようにする。
 *
 * 副作用: 長い motif が短い motif を包含するケースで両方が残る (例: `A B C` と `A B` が両方検出される)。
 * これは「概念の階層性は残しておく」設計判断 (#4 階層構文は凍結中だが、検出層では情報を捨てない)。
 */
export const defaultV2Detector: MotifDetector = {
  id: 'notation.detector.defaultV2',
  detect(input): Motif[] {
    const candidates = new Map<
      string,
      { pattern: Phoneme[]; instances: Motif['instances'] }
    >()

    for (const { runId, phonemes } of input) {
      for (let L = MIN_LEN; L <= MAX_LEN; L++) {
        for (let i = 0; i + L <= phonemes.length; i++) {
          const slice = phonemes.slice(i, i + L)
          const id = canonicalize(slice)
          const instance = {
            runId,
            startPointIdx: slice[0].startPointIdx,
            endPointIdx: slice[slice.length - 1].endPointIdx,
          }
          const existing = candidates.get(id)
          if (existing) {
            existing.instances.push(instance)
          } else {
            candidates.set(id, {
              pattern: slice.map(stripDuration),
              instances: [instance],
            })
          }
        }
      }
    }

    const motifs: Motif[] = []
    for (const [id, v] of candidates) {
      if (v.instances.length < MIN_INSTANCES) continue
      motifs.push({ id, pattern: v.pattern, instances: v.instances })
    }
    // 短い → 多く出現 を優先。ペタンプの語彙が長文化することを防ぐ
    motifs.sort((a, b) => {
      if (a.pattern.length !== b.pattern.length) return a.pattern.length - b.pattern.length
      return b.instances.length - a.instances.length
    })
    return motifs
  },
}

function stripDuration(p: Phoneme): Phoneme {
  return { ...p, durationMs: 0, startPointIdx: 0, endPointIdx: 0 }
}

function canonicalize(slice: Phoneme[]): string {
  return slice.map(canonicalSymbol).join(' ')
}

function canonicalSymbol(p: Phoneme): string {
  let base = p.symbol
  if (p.weak) base = toHiragana(base)
  if (p.sharp) base = base.replace(/ン$|ん$/, 'ッ')
  if (p.pitch > 0) return base + '↑'
  if (p.pitch < 0) return base + '↓'
  return base
}

function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  )
}
