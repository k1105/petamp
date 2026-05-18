import { create } from 'zustand'

export type CurrentPosition = [number, number] | null

interface GpsStore {
  /**
   * undefined: まだ getCurrentPosition を呼んでいない。
   * null: 取得に失敗 / geolocation 利用不可。
   * tuple: 取得済み。
   *
   * 一度取れた位置はページ間のアンマウント／再マウントを跨いで残るので、
   * トップへ戻ったときに GPS の再取得待ちで地図表示が遅れない。
   */
  position: CurrentPosition | undefined
  setPosition: (p: CurrentPosition) => void
}

export const useGpsStore = create<GpsStore>((set) => ({
  position: undefined,
  setPosition: (position) => set({ position }),
}))
