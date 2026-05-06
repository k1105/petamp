import { create } from 'zustand'

interface MapStore {
  currentTime: number
  isPlaying: boolean
  duration: number
  setCurrentTime: (t: number) => void
  setIsPlaying: (v: boolean) => void
  setDuration: (d: number) => void
}

export const useMapStore = create<MapStore>((set) => ({
  currentTime: 0,
  isPlaying: false,
  duration: 0,
  setCurrentTime: (t) => set({ currentTime: t }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setDuration: (d) => set({ duration: d }),
}))
