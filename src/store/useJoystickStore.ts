import { create } from 'zustand'

// MapJoystick の armed 状態 (= petamp が joystick に飛び移った状態) を
// GalleryPage 側から観測するための共有フラグ。FAB の peak を一時的に
// 隠す (useMetaballSheet に peakHiddenRef として渡す) 用途。
// あわせて、armed 〜 disarm 完了までの間に「peak を表示する位置」を
// 固定する用の storedFabRect を持つ。disarm 中は FAB 自体が slide-up
// していて live の getBoundingClientRect が移動中の値を返すため、peak
// を arm 時点に保存した元位置に固定して handle の flyback target と
// 揃える。
interface State {
  armed: boolean
  storedFabRect: DOMRect | null
}
interface Actions {
  setArmed: (a: boolean) => void
  setStoredFabRect: (r: DOMRect | null) => void
}

export const useJoystickStore = create<State & Actions>(set => ({
  armed: false,
  storedFabRect: null,
  setArmed: (a) => set({ armed: a }),
  setStoredFabRect: (r) => set({ storedFabRect: r }),
}))
