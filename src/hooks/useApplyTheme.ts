import { useEffect } from 'react'
import { useActivePalette } from './useActivePalette'

function hexToRgbTuple(hex: string): [number, number, number] | null {
  const m = hex.replace('#', '')
  if (m.length !== 6) return null
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
  return [r, g, b]
}

/**
 * アクティブパレットを :root の CSS 変数に書き込む。
 * App ルートで一度だけマウントすれば全ページに行き渡る。
 */
export function useApplyTheme(): void {
  const { palette } = useActivePalette()
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--bg', palette.bg)
    root.style.setProperty('--accent', palette.accent)
    const rgb = hexToRgbTuple(palette.accent)
    if (rgb) {
      root.style.setProperty('--accent-dim', `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.2)`)
    }
  }, [palette.bg, palette.accent])
}
