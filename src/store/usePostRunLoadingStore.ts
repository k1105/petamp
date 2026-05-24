import { create } from 'zustand'

/**
 * ラン終了 (FINISH) → 対話準備完了までを 1 枚のローディング画面で覆うための state。
 *
 *   entering : FINISH ボタンを起点に緑のディスクが広がり画面を覆う (iris-out)。
 *   loading  : 緑のローディング画面を表示し、対話 (RunResultPage の opener) を待つ。
 *   closing  : 中央に透明な穴が広がり背後の画面が現れる (iris-in)。
 *
 * 対話側 (RunResultPage) が `setReady()` を呼んだら、現在 entering 中ならフラグだけ立て
 * (`readyPending`)、loading 中ならそのまま closing へ遷移する。これでアニメ衝突を避ける。
 */

export type PostRunLoadingPhase = 'idle' | 'entering' | 'loading' | 'closing'

interface State {
  phase: PostRunLoadingPhase
  origin: { x: number; y: number } | null
  readyPending: boolean
}

interface Actions {
  start: (origin: { x: number; y: number }) => void
  setPhase: (phase: PostRunLoadingPhase) => void
  setReady: () => void
  reset: () => void
}

export const usePostRunLoadingStore = create<State & Actions>((set, get) => ({
  phase: 'idle',
  origin: null,
  readyPending: false,
  start: (origin) => set({ phase: 'entering', origin, readyPending: false }),
  setPhase: (phase) => set({ phase }),
  setReady: () => {
    const cur = get().phase
    if (cur === 'loading') set({ phase: 'closing' })
    else if (cur === 'entering') set({ readyPending: true })
  },
  reset: () => set({ phase: 'idle', origin: null, readyPending: false }),
}))
