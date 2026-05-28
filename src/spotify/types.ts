export type SpotifyAuth = {
  accessToken: string
  refreshToken: string
  // ms-since-epoch absolute expiry; refresh when within ~60s of this.
  expiresAt: number
}

export type SpotifyTrackSnapshot = {
  trackId: string
  name: string
  artists: string[]
  durationMs: number
  // serverProgressMs at the moment `localReceivedAt` was captured (Date.now ms).
  // current position estimate = serverProgressMs + (Date.now() - localReceivedAt) when isPlaying.
  serverProgressMs: number
  localReceivedAt: number
  isPlaying: boolean
}

export type SpotifyTokenResponse = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token?: string
  scope: string
}

export type CurrentlyPlayingResponse = {
  timestamp: number
  progress_ms: number | null
  is_playing: boolean
  item: {
    id: string
    name: string
    duration_ms: number
    artists: { name: string }[]
    type: 'track' | 'episode'
  } | null
}
