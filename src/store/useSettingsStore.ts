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
  mapPaddingMeters: number  // 軌跡bbox周囲のパディング (m) - gallery map制約
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
  eyeYOffset: -12,
  eyeSizeScale: 1.15,
  pupilSizeScale: 1.10,
  mapPaddingMeters: 200,
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
    {
      name: 'petamp.settings',
      // Default merge replaces nested objects wholesale, so old persisted state
      // missing newly added fields (e.g. ui.mapPaddingMeters) leaves them
      // undefined and crashes consumers. Deep-merge keeps current defaults for
      // any key the persisted state doesn't carry.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        return {
          ...current,
          ...p,
          radii: { ...current.radii, ...(p.radii ?? {}) },
          filterSettings: { ...current.filterSettings, ...(p.filterSettings ?? {}) },
          ui: { ...current.ui, ...(p.ui ?? {}) },
        }
      },
    },
  ),
)
