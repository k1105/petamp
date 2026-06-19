import { create } from 'zustand'

export type ConfirmOptions = {
  message: string
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 確定ボタンを破壊的操作 (削除など) の見た目にする。 */
  destructive?: boolean
}

type ActiveConfirm = ConfirmOptions & { resolve: (ok: boolean) => void }

interface ConfirmStore {
  current: ActiveConfirm | null
  /** window.confirm の置き換え。確定で true、キャンセルで false を返す。 */
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  /** ホスト側から結果を確定させる (内部用)。 */
  settle: (ok: boolean) => void
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  current: null,
  confirm: opts =>
    new Promise<boolean>(resolve => {
      set({ current: { ...opts, resolve } })
    }),
  settle: ok => {
    const cur = get().current
    if (cur) cur.resolve(ok)
    set({ current: null })
  },
}))

/** コンポーネント外からも呼べるショートカット。 */
export const confirm = (opts: ConfirmOptions): Promise<boolean> =>
  useConfirmStore.getState().confirm(opts)
