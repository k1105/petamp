import { AppModal } from './AppModal'
import { useConfirmStore } from '../../store/useConfirmStore'

/**
 * useConfirmStore.confirm() を画面に描画するルートホスト。
 * アプリに 1 つだけマウントする。
 */
export function ConfirmHost() {
  const current = useConfirmStore(s => s.current)
  const settle = useConfirmStore(s => s.settle)
  if (!current) return null
  return (
    <AppModal
      variant={current.destructive ? 'warning' : 'accent'}
      title={current.title}
      onClose={() => settle(false)}
      actions={[
        {
          label: current.cancelLabel ?? 'キャンセル',
          variant: 'secondary',
          onClick: () => settle(false),
        },
        {
          label: current.confirmLabel ?? 'OK',
          variant: current.destructive ? 'danger' : 'primary',
          onClick: () => settle(true),
        },
      ]}
    >
      {current.message}
    </AppModal>
  )
}
