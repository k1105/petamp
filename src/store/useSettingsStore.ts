import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PaletteKey, Palette, Weather, TimeOfDay } from '../utils/themePalettes'

export interface ThemeSettings {
  weatherMode: 'auto' | Weather
  timeMode: 'auto' | TimeOfDay
  /** key = `${weather}-${time}`、未指定セルはデフォルトパレット。 */
  overrides: Partial<Record<PaletteKey, Partial<Palette>>>
}

export interface Radii {
  // zoomThreshold での実半径 (m)。アンカー1点。
  // zoom >= zoomThreshold: そのまま (m単位固定 → 寄ると画面上で太く)
  // zoom <  zoomThreshold: × 2^(zoomThreshold - zoom) で展開 (画面ピクセル一定)
  tubeRadius: number
  rawTubeRadius: number
  dotRadius: number
  zoomThreshold: number
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
  tubeRadius: 1.0,
  rawTubeRadius: 0.9,
  dotRadius: 3.0,
  zoomThreshold: 16,
}

export const DEFAULT_FILTER_SETTINGS: FilterSettings = {
  maxSpeed: 15,
}

export const DEFAULT_UI_SETTINGS: UiSettings = {
  fabIconSize: 52,
  eyeYOffset: -12,
  eyeSizeScale: 1.15,
  pupilSizeScale: 1.10,
  mapPaddingMeters: 100,
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  weatherMode: 'auto',
  timeMode: 'auto',
  overrides: {},
}

interface SettingsState {
  radii: Radii
  filterSettings: FilterSettings
  ui: UiSettings
  theme: ThemeSettings
  setRadii: (partial: Partial<Radii>) => void
  resetRadii: () => void
  setFilterSettings: (partial: Partial<FilterSettings>) => void
  resetFilterSettings: () => void
  setUi: (partial: Partial<UiSettings>) => void
  resetUi: () => void
  setTheme: (partial: Partial<ThemeSettings>) => void
  setPaletteOverride: (key: PaletteKey, patch: Partial<Palette> | null) => void
  resetTheme: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      radii: DEFAULT_RADII,
      filterSettings: DEFAULT_FILTER_SETTINGS,
      ui: DEFAULT_UI_SETTINGS,
      theme: DEFAULT_THEME_SETTINGS,
      setRadii: (partial) => set((s) => ({ radii: { ...s.radii, ...partial } })),
      resetRadii: () => set({ radii: DEFAULT_RADII }),
      setFilterSettings: (partial) =>
        set((s) => ({ filterSettings: { ...s.filterSettings, ...partial } })),
      resetFilterSettings: () => set({ filterSettings: DEFAULT_FILTER_SETTINGS }),
      setUi: (partial) => set((s) => ({ ui: { ...s.ui, ...partial } })),
      resetUi: () => set({ ui: DEFAULT_UI_SETTINGS }),
      setTheme: (partial) => set((s) => ({ theme: { ...s.theme, ...partial } })),
      setPaletteOverride: (key, patch) =>
        set((s) => {
          const next = { ...s.theme.overrides }
          if (patch === null) {
            delete next[key]
          } else {
            next[key] = { ...(next[key] ?? {}), ...patch }
          }
          return { theme: { ...s.theme, overrides: next } }
        }),
      resetTheme: () => set({ theme: DEFAULT_THEME_SETTINGS }),
    }),
    {
      name: 'petamp.settings',
      // v2: Radii の意味論が変わった (Fixed/Live二値 → 閾値1点アンカー)。旧値は捨て。
      // v3: 新ロジック下で再調整したデフォルトを適用するため radii を再リセット。
      version: 3,
      migrate: (persistedState, version) => {
        const s = (persistedState ?? {}) as Partial<SettingsState>
        if (version < 3) {
          return { ...s, radii: DEFAULT_RADII }
        }
        return s as SettingsState
      },
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
          theme: { ...current.theme, ...(p.theme ?? {}) },
        }
      },
    },
  ),
)
