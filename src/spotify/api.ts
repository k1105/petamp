import { refreshAccessToken } from './auth'
import type { CurrentlyPlayingResponse, SpotifyAuth, SpotifyTrackSnapshot } from './types'

const API_BASE = 'https://api.spotify.com/v1'

// Ensure the auth's access token is fresh enough to use (≥60s remaining).
// Returns the (possibly refreshed) auth; caller should persist it.
export async function ensureFreshAuth(auth: SpotifyAuth): Promise<SpotifyAuth> {
  if (auth.expiresAt - Date.now() > 60_000) return auth
  return refreshAccessToken(auth.refreshToken)
}

// Fetch /me/player/currently-playing.
// Returns null when nothing is playing (Spotify returns 204) or when the
// payload is an episode (we only handle tracks).
// Throws on auth/network errors; caller is responsible for catching and
// rotating the auth on 401.
export async function fetchCurrentlyPlaying(
  auth: SpotifyAuth,
): Promise<SpotifyTrackSnapshot | null> {
  const res = await fetch(`${API_BASE}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  })
  if (res.status === 204) return null
  if (res.status === 401) throw new SpotifyAuthError('access token rejected')
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Spotify currently-playing failed (${res.status}): ${text}`)
  }
  const localReceivedAt = Date.now()
  const json = (await res.json()) as CurrentlyPlayingResponse
  if (!json.item || json.item.type !== 'track' || json.progress_ms == null) {
    return null
  }
  return {
    trackId: json.item.id,
    name: json.item.name,
    artists: json.item.artists.map(a => a.name),
    durationMs: json.item.duration_ms,
    serverProgressMs: json.progress_ms,
    localReceivedAt,
    isPlaying: json.is_playing,
  }
}

export class SpotifyAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpotifyAuthError'
  }
}
