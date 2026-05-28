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

// Returns enriched song info, or null if the song isn't in GetSongBPM's catalog.
export async function lookupSongInfo(name: string, artist: string): Promise<SongInfo | null> {
  const params = new URLSearchParams({
    api_key: apiKey(),
    type: 'both',
    lookup: `song:${name} artist:${artist}`,
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
