import { useEffect } from 'react'
import { useSpotifyStore } from '../store/useSpotifyStore'
import { ensureFreshAuth, fetchCurrentlyPlaying, SpotifyAuthError } from '../spotify/api'

const POLL_INTERVAL_MS = 3000

// Polls Spotify currently-playing every 3s while auth is present.
// Writes the latest snapshot into the store. Consumers read the store and
// interpolate progress locally with rAF (see usePlaybackPositionMs below).
// Mount once near the app root.
export function useSpotifyPlaybackPoller(): void {
  const auth = useSpotifyStore((s) => s.auth)
  const setAuth = useSpotifyStore((s) => s.setAuth)
  const setCurrent = useSpotifyStore((s) => s.setCurrent)

  useEffect(() => {
    if (!auth) {
      setCurrent(null)
      return
    }
    let cancelled = false
    let timer: number | null = null

    const tick = async () => {
      try {
        const fresh = await ensureFreshAuth(auth)
        if (fresh !== auth) setAuth(fresh)
        const snapshot = await fetchCurrentlyPlaying(fresh)
        if (!cancelled) setCurrent(snapshot)
      } catch (e) {
        if (e instanceof SpotifyAuthError) {
          if (!cancelled) {
            // Token rejected even after pre-refresh attempt; force re-auth.
            useSpotifyStore.getState().disconnect()
          }
          return
        }
        console.warn('[spotify] poll error', e)
      }
      if (!cancelled) timer = window.setTimeout(tick, POLL_INTERVAL_MS)
    }
    void tick()

    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
    }
  }, [auth, setAuth, setCurrent])
}
