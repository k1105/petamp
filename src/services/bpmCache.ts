import { lookupSongInfo, type SongInfo } from './getsongbpm'

// Per-Spotify-trackId song info cache. `null` = looked up and not found;
// `undefined` = never looked up. Persisted to localStorage so repeat plays
// are free.

const STORAGE_KEY = 'petamp.song-info-cache.v2'

type StoredCache = Record<string, SongInfo | null>

function loadStored(): StoredCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as StoredCache
    }
  } catch {
    // ignore malformed cache
  }
  return {}
}

const memCache = new Map<string, SongInfo | null>(Object.entries(loadStored()))
const pending = new Map<string, Promise<SongInfo | null>>()

function persist(): void {
  try {
    const obj: StoredCache = {}
    for (const [k, v] of memCache) obj[k] = v
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch {
    // quota or storage disabled — non-fatal
  }
}

export function getCachedSongInfo(trackId: string): SongInfo | null | undefined {
  return memCache.has(trackId) ? memCache.get(trackId)! : undefined
}

// Fetches and caches. Dedupes concurrent calls for the same trackId.
export async function fetchSongInfoForTrack(
  trackId: string,
  name: string,
  artist: string,
): Promise<SongInfo | null> {
  if (memCache.has(trackId)) return memCache.get(trackId)!
  const inflight = pending.get(trackId)
  if (inflight) return inflight

  const p = lookupSongInfo(name, artist)
    .then((info) => {
      memCache.set(trackId, info)
      persist()
      return info
    })
    .catch((e) => {
      console.warn('[song-info-cache] lookup failed', { trackId, name, artist, error: e })
      // Do NOT cache failures — transient network/CORS issues should be retried.
      throw e
    })
    .finally(() => {
      pending.delete(trackId)
    })
  pending.set(trackId, p)
  return p
}
