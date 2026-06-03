// GetSongBPM API wrapper — looks up a song's tempo + related metadata by
// title + artist. API docs: https://getsongbpm.com/api
// Endpoint /search/?type=both&lookup=song:X artist:Y → array of songs with
// fields including tempo, time_sig, danceability.
// Note: tempo/time_sig come back as String in some responses (per their docs),
// hence the defensive parsing on read.

const API_BASE = 'https://api.getsong.co'

function apiKey(): string {
  const k = import.meta.env.VITE_GETSONGBPM_API_KEY
  if (!k) throw new Error('VITE_GETSONGBPM_API_KEY is not set')
  return k
}

export type SongInfo = {
  bpm: number
  // Numerator of time signature ("4/4" → 4, "3/4" → 3, "6/8" → 6). Defaults
  // to 4 when unknown — handles vast majority of pop/rock music.
  beatsPerBar: number
  // 0..100 from GetSongBPM. Defaults to 50 (neutral) when missing.
  danceability: number
}

type SearchHit = {
  id: string
  title: string
  tempo: number | string
  time_sig?: number | string
  danceability?: number | string
  artist?: { name?: string }
}

type SearchResponse = {
  search: SearchHit[] | string
}

function parseIntSafe(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function parseBeatsPerBar(raw: number | string | undefined): number {
  if (raw == null) return 4
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    // "4/4" → take numerator. Plain "4" also works.
    const numerator = raw.split('/')[0]
    const n = parseInt(numerator, 10)
    if (Number.isFinite(n) && n >= 2 && n <= 12) return n
  }
  return 4
}

// Spotify often appends provenance suffixes to track titles that GetSongBPM's
// canonical entries don't include. Strip the common ones so a track like
// "Bohemian Rhapsody - Remastered 2011" still matches "Bohemian Rhapsody".
// Order matters: longer/more specific patterns first.
const TITLE_SUFFIX_PATTERNS: RegExp[] = [
  / - From ['"].+?['"]$/i,                      // - From "Movie"
  / - From The .+$/i,                           // - From The Movie X
  / - Live at .+$/i,                            // - Live at Wembley
  / - Live in .+$/i,                            // - Live in Tokyo
  / - Live( Version)?$/i,                       // - Live / - Live Version
  / - \d{4} Remaster(ed)?$/i,                   // - 2011 Remastered
  / - Remastered( \d{4})?$/i,                   // - Remastered 2011
  / - (Single|Album|Acoustic|Stereo|Mono|Radio|Extended|Bonus|Demo|Original) (Version|Edit|Mix|Track|Cut)$/i,
  / - (Single Version|Album Version|Acoustic|Stereo Version|Mono Version|Radio Edit|Extended Mix|Bonus Track|Demo|Original Version)$/i,
  / \((feat\.|with) .+?\)$/i,                    // (feat. X) / (with X)
  / \(Remastered( \d{4})?\)$/i,                  // (Remastered 2011)
  / \(\d{4} Remaster(ed)?\)$/i,                  // (2011 Remastered)
  / \((Live|Single Version|Album Version|Acoustic|Demo|Original Version)\)$/i,
]

function cleanTrackTitle(raw: string): string {
  let s = raw.trim()
  // Apply repeatedly so chains like "Title - Remastered (feat. X)" collapse.
  for (let i = 0; i < 3; i++) {
    let changed = false
    for (const re of TITLE_SUFFIX_PATTERNS) {
      const next = s.replace(re, '').trim()
      if (next !== s) {
        s = next
        changed = true
      }
    }
    if (!changed) break
  }
  return s
}

// Returns enriched song info, or null if the song isn't in GetSongBPM's catalog.
export async function lookupSongInfo(name: string, artist: string): Promise<SongInfo | null> {
  const cleanedName = cleanTrackTitle(name)
  const params = new URLSearchParams({
    api_key: apiKey(),
    type: 'both',
    lookup: `song:${cleanedName} artist:${artist}`,
    limit: '1',
  })
  const res = await fetch(`${API_BASE}/search/?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`GetSongBPM search failed (${res.status})`)
  }
  const json = (await res.json()) as SearchResponse
  if (!Array.isArray(json.search) || json.search.length === 0) return null
  const hit = json.search[0]
  const bpm = parseIntSafe(hit.tempo, NaN)
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 220) return null
  return {
    bpm: Math.round(bpm),
    beatsPerBar: parseBeatsPerBar(hit.time_sig),
    danceability: parseIntSafe(hit.danceability, 50),
  }
}
