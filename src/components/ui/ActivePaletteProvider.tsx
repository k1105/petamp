import { type ReactNode } from 'react'
import { ActivePaletteContext, useComputeActivePalette } from '../../hooks/useActivePalette'

/**
 * アクティブパレットをルートで一度だけ計算し、Context で全 consumer に配る。
 * これにより useApplyTheme (ページ背景 --bg) と BaseMap (マップ fog)、各レイヤーが
 * 同一のパレット値を参照し、天気/時刻の非同期解決による色のズレが起きなくなる。
 */
export function ActivePaletteProvider({ children }: { children: ReactNode }) {
  const palette = useComputeActivePalette()
  return (
    <ActivePaletteContext.Provider value={palette}>
      {children}
    </ActivePaletteContext.Provider>
  )
}
