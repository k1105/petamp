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

export interface UiSettings {
  fabIconSize: number       // .fab-icon の幅高 (px)
  eyeYOffset: number        // SVG単位 (-側で上, +側で下)
  eyeSizeScale: number      // 白目サイズ倍率
  pupilSizeScale: number    // 瞳サイズ倍率
}

export const DEFAULT_RADII: Radii = {
  tubeRadius: 1.3,
  rawTubeRadius: 1.2,
  dotRadius: 9.5,
}

export const DEFAULT_FILTER_SETTINGS: FilterSettings = {
  maxSpeed: 15,
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  fabIconSize: 52,
  eyeYOffset: -3,
  eyeSizeScale: 1.15,
  pupilSizeScale: 1.15,
}

interface SettingsState {
  radii: Radii
  filterSettings: FilterSettings
  ui: UiSettings
  setRadii: (partial: Partial<Radii>) => void
  resetRadii: () => void
  setFilterSettings: (partial: Partial<FilterSettings>) => void
  resetFilterSettings: () => void
  setUi: (partial: Partial<UiSettings>) => void
  resetUi: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      radii: DEFAULT_RADII,
      filterSettings: DEFAULT_FILTER_SETTINGS,
      ui: DEFAULT_UI_SETTINGS,
      setRadii: (partial) => set((s) => ({ radii: { ...s.radii, ...partial } })),
      resetRadii: () => set({ radii: DEFAULT_RADII }),
      setFilterSettings: (partial) =>
        set((s) => ({ filterSettings: { ...s.filterSettings, ...partial } })),
      resetFilterSettings: () => set({ filterSettings: DEFAULT_FILTER_SETTINGS }),
      setUi: (partial) => set((s) => ({ ui: { ...s.ui, ...partial } })),
      resetUi: () => set({ ui: DEFAULT_UI_SETTINGS }),
    }),
    { name: 'petamp.settings' },
  ),
)
