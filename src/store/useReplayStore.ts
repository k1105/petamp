import { create } from 'zustand'

/**
 * ランのリプレイ再生状態 (RunDetailPage + useAnimation 専用)。
 * 地図そのものの状態は持たない (mapbox instance は MapContext が供給する)。
 */
interface ReplayStore {
  currentTime: number
  isPlaying: boolean
  duration: number
  setCurrentTime: (t: number) => void
  setIsPlaying: (v: boolean) => void
  setDuration: (d: number) => void
}

export const useReplayStore = create<ReplayStore>((set) => ({
  currentTime: 0,
  isPlaying: false,
  duration: 0,
  setCurrentTime: (t) => set({ currentTime: t }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setDuration: (d) => set({ duration: d }),
}))
