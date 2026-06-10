import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PaletteKey, Palette, Weather, TimeOfDay } from '../utils/themePalettes'

interface ThemeSettings {
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
  /** Kalman プロセスノイズ (加速度σ, m/s²)。 */
  kalmanSigmaA: number
  /** Kalman ゲート閾値 (Mahalanobis², 自由度2)。 */
  kalmanGateChi2: number
}

export interface EyeParams {
  fabIconSize: number     // .fab-icon の幅高 (px)
  eyeYOffset: number      // SVG単位 (-側で上, +側で下)
  eyeXOffset: number      // SVG単位、両目を同方向にシフト (-側で左, +側で右)
  eyeSizeScale: number    // 白目サイズ倍率
  pupilSizeScale: number  // 瞳サイズ倍率
}

// gallery nav の状態。FAB位置・目玉パラメータをこの単位でキーフレーム保持する。
export type NavState = 'map' | 'list' | 'profile' | 'armed'

export const NAV_STATES: readonly NavState[] = ['map', 'list', 'profile', 'armed'] as const

export const NAV_STATE_LABEL: Record<NavState, string> = {
  map: 'マップ (idle)',
  list: 'ラン一覧',
  profile: 'プロフィール',
  armed: 'armed (record前)',
}

interface UiSettings {
  /** nav状態ごとの目玉パラメータ。状態遷移時に値を補間する。 */
  eyeKeyframes: Record<NavState, EyeParams>
  mapPaddingMeters: number  // 軌跡bbox周囲のパディング (m) - gallery map制約
  hasSeenFirstRunIntro: boolean  // 「最初のラン」紹介ポップを表示済みか
  altitudeScale: number     // run detail (単色表現時) の高度可視化倍率。0 で平面。
  /** トップ画面マップの軌跡表現。'tube'=線, 'points'=半透明の点群ビルボード。 */
  galleryTrailStyle: 'tube' | 'points'
}

interface ExperimentalSettings {
  /** 環世界記譜法。ON で /run/:id/notation 系のテスト画面が解禁される。既存 chat/Diary 系には影響しない。 */
  notation: boolean
}

const DEFAULT_RADII: Radii = {
  tubeRadius: 1.0,
  rawTubeRadius: 0.9,
  dotRadius: 3.0,
  zoomThreshold: 16,
}

const DEFAULT_FILTER_SETTINGS: FilterSettings = {
  maxSpeed: 15,
  kalmanSigmaA: 2,
  kalmanGateChi2: 9.21,
}

const BASE_EYE_PARAMS: EyeParams = {
  fabIconSize: 52,
  eyeYOffset: -12,
  eyeXOffset: 0,
  eyeSizeScale: 1.15,
  pupilSizeScale: 1.10,
}

function cloneEyeKeyframes(src: Record<NavState, EyeParams>): Record<NavState, EyeParams> {
  return {
    map: { ...src.map },
    list: { ...src.list },
    profile: { ...src.profile },
    armed: { ...src.armed },
  }
}

const DEFAULT_EYE_KEYFRAMES: Record<NavState, EyeParams> = {
  map: { ...BASE_EYE_PARAMS },
  list: { ...BASE_EYE_PARAMS },
  profile: { ...BASE_EYE_PARAMS },
  armed: { ...BASE_EYE_PARAMS },
}

const DEFAULT_UI_SETTINGS: UiSettings = {
  eyeKeyframes: DEFAULT_EYE_KEYFRAMES,
  mapPaddingMeters: 100,
  hasSeenFirstRunIntro: false,
  altitudeScale: 3,
  galleryTrailStyle: 'tube',
}

const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  weatherMode: 'auto',
  timeMode: 'auto',
  overrides: {},
}

const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  notation: false,
}

interface SettingsState {
  radii: Radii
  filterSettings: FilterSettings
  ui: UiSettings
  theme: ThemeSettings
  experimental: ExperimentalSettings
  setRadii: (partial: Partial<Radii>) => void
  resetRadii: () => void
  setFilterSettings: (partial: Partial<FilterSettings>) => void
  resetFilterSettings: () => void
  setUi: (partial: Partial<UiSettings>) => void
  resetUi: () => void
  setEyeKeyframe: (state: NavState, patch: Partial<EyeParams>) => void
  resetEyeKeyframes: () => void
  setTheme: (partial: Partial<ThemeSettings>) => void
  setPaletteOverride: (key: PaletteKey, patch: Partial<Palette> | null) => void
  resetTheme: () => void
  setExperimental: (partial: Partial<ExperimentalSettings>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      radii: DEFAULT_RADII,
      filterSettings: DEFAULT_FILTER_SETTINGS,
      ui: DEFAULT_UI_SETTINGS,
      theme: DEFAULT_THEME_SETTINGS,
      experimental: DEFAULT_EXPERIMENTAL_SETTINGS,
      setRadii: (partial) => set((s) => ({ radii: { ...s.radii, ...partial } })),
      resetRadii: () => set({ radii: DEFAULT_RADII }),
      setFilterSettings: (partial) =>
        set((s) => ({ filterSettings: { ...s.filterSettings, ...partial } })),
      resetFilterSettings: () => set({ filterSettings: DEFAULT_FILTER_SETTINGS }),
      setUi: (partial) => set((s) => ({ ui: { ...s.ui, ...partial } })),
      resetUi: () => set({ ui: { ...DEFAULT_UI_SETTINGS, eyeKeyframes: cloneEyeKeyframes(DEFAULT_EYE_KEYFRAMES) } }),
      setEyeKeyframe: (state, patch) =>
        set((s) => ({
          ui: {
            ...s.ui,
            eyeKeyframes: {
              ...s.ui.eyeKeyframes,
              [state]: { ...s.ui.eyeKeyframes[state], ...patch },
            },
          },
        })),
      resetEyeKeyframes: () =>
        set((s) => ({ ui: { ...s.ui, eyeKeyframes: cloneEyeKeyframes(DEFAULT_EYE_KEYFRAMES) } })),
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
      setExperimental: (partial) =>
        set((s) => ({ experimental: { ...s.experimental, ...partial } })),
    }),
    {
      name: 'petamp.settings',
      // v2: Radii の意味論が変わった (Fixed/Live二値 → 閾値1点アンカー)。旧値は捨て。
      // v3: 新ロジック下で再調整したデフォルトを適用するため radii を再リセット。
      // v4: 目玉/FAB パラメータを 4 状態キーフレーム化。旧 ui.fabIconSize 等を
      //     全状態に seed する。
      version: 4,
      migrate: (persistedState, version) => {
        const s = (persistedState ?? {}) as Partial<SettingsState> & {
          ui?: Partial<UiSettings> & {
            fabIconSize?: number
            eyeYOffset?: number
            eyeSizeScale?: number
            pupilSizeScale?: number
          }
        }
        let next: Partial<SettingsState> = s
        if (version < 3) {
          next = { ...next, radii: DEFAULT_RADII }
        }
        if (version < 4) {
          const oldUi = s.ui ?? ({} as NonNullable<typeof s.ui>)
          const seeded: EyeParams = {
            fabIconSize: oldUi.fabIconSize ?? BASE_EYE_PARAMS.fabIconSize,
            eyeYOffset: oldUi.eyeYOffset ?? BASE_EYE_PARAMS.eyeYOffset,
            eyeXOffset: BASE_EYE_PARAMS.eyeXOffset,
            eyeSizeScale: oldUi.eyeSizeScale ?? BASE_EYE_PARAMS.eyeSizeScale,
            pupilSizeScale: oldUi.pupilSizeScale ?? BASE_EYE_PARAMS.pupilSizeScale,
          }
          const eyeKeyframes: Record<NavState, EyeParams> = {
            map: seeded,
            list: { ...seeded },
            profile: { ...seeded },
            armed: { ...seeded },
          }
          // 旧スカラーを落として新フィールドへ
          const {
            fabIconSize: _f, eyeYOffset: _y, eyeSizeScale: _s, pupilSizeScale: _p,
            ...uiRest
          } = oldUi
          void _f; void _y; void _s; void _p
          next = { ...next, ui: { ...uiRest, eyeKeyframes } as UiSettings }
        }
        return next as SettingsState
      },
      // Default merge replaces nested objects wholesale, so old persisted state
      // missing newly added fields (e.g. ui.mapPaddingMeters) leaves them
      // undefined and crashes consumers. Deep-merge keeps current defaults for
      // any key the persisted state doesn't carry.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        const pUi = (p.ui ?? {}) as Partial<UiSettings>
        const mergedKeyframes: Record<NavState, EyeParams> = {
          map: { ...current.ui.eyeKeyframes.map, ...(pUi.eyeKeyframes?.map ?? {}) },
          list: { ...current.ui.eyeKeyframes.list, ...(pUi.eyeKeyframes?.list ?? {}) },
          profile: { ...current.ui.eyeKeyframes.profile, ...(pUi.eyeKeyframes?.profile ?? {}) },
          armed: { ...current.ui.eyeKeyframes.armed, ...(pUi.eyeKeyframes?.armed ?? {}) },
        }
        return {
          ...current,
          ...p,
          radii: { ...current.radii, ...(p.radii ?? {}) },
          filterSettings: { ...current.filterSettings, ...(p.filterSettings ?? {}) },
          ui: { ...current.ui, ...pUi, eyeKeyframes: mergedKeyframes },
          theme: { ...current.theme, ...(p.theme ?? {}) },
          experimental: { ...current.experimental, ...(p.experimental ?? {}) },
        }
      },
    },
  ),
)
