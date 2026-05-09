import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Radii {
  tubeRadius: number
  rawTubeRadius: number
  dotRadius: number
}

export interface FilterSettings {
  maxSpeed: number
}

export const DEFAULT_RADII: Radii = {
  tubeRadius: 1.3,
  rawTubeRadius: 1.2,
  dotRadius: 9.5,
}

export const DEFAULT_FILTER_SETTINGS: FilterSettings = {
  maxSpeed: 15,
}

interface SettingsState {
  radii: Radii
  filterSettings: FilterSettings
  setRadii: (partial: Partial<Radii>) => void
  resetRadii: () => void
  setFilterSettings: (partial: Partial<FilterSettings>) => void
  resetFilterSettings: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      radii: DEFAULT_RADII,
      filterSettings: DEFAULT_FILTER_SETTINGS,
      setRadii: (partial) => set((s) => ({ radii: { ...s.radii, ...partial } })),
      resetRadii: () => set({ radii: DEFAULT_RADII }),
      setFilterSettings: (partial) =>
        set((s) => ({ filterSettings: { ...s.filterSettings, ...partial } })),
      resetFilterSettings: () => set({ filterSettings: DEFAULT_FILTER_SETTINGS }),
    }),
    { name: 'petamp.settings' },
  ),
)
