import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SpotifyAuth, SpotifyTrackSnapshot } from '../spotify/types'

type SpotifyState = {
  auth: SpotifyAuth | null
  // last polled snapshot. cleared when nothing is playing or on disconnect.
  current: SpotifyTrackSnapshot | null
  setAuth: (auth: SpotifyAuth | null) => void
  setCurrent: (snapshot: SpotifyTrackSnapshot | null) => void
  disconnect: () => void
}

export const useSpotifyStore = create<SpotifyState>()(
  persist(
    (set) => ({
      auth: null,
      current: null,
      setAuth: (auth) => set({ auth }),
      setCurrent: (current) => set({ current }),
      disconnect: () => set({ auth: null, current: null }),
    }),
    {
      name: 'spotify-store',
      // only auth needs persistence; current snapshot is short-lived.
      partialize: (s) => ({ auth: s.auth }),
    },
  ),
)
