import { create } from 'zustand'

interface BootStore {
  authReady: boolean
  geoReady: boolean
  dataReady: boolean
  setAuthReady: () => void
  setGeoReady: () => void
  setDataReady: () => void
}

export const useBootStore = create<BootStore>((set) => ({
  authReady: false,
  geoReady: false,
  dataReady: false,
  setAuthReady: () => set({ authReady: true }),
  setGeoReady: () => set({ geoReady: true }),
  setDataReady: () => set({ dataReady: true }),
}))

export function useBootReady(): boolean {
  return useBootStore(s => s.authReady && s.geoReady && s.dataReady)
}
