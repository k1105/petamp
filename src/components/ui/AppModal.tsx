import { useEffect, type ReactNode } from 'react'

export type ModalAction = {
  label: string
  onClick: () => void
  /** primary=白塗り / secondary=枠線 / danger=赤塗り。既定 primary。 */
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}

type Props = {
  /** 背景色。'warning' は赤、それ以外は accent。既定 'accent'。 */
  variant?: 'accent' | 'warning'
  title?: string
  children?: ReactNode
  actions?: ModalAction[]
  /** ボタンを縦並び・全幅にする (3 ボタン等)。既定は横並び右寄せ。 */
  stackedActions?: boolean
  /** 背景クリック / Esc で閉じる。渡したときのみ dismiss 可能にする。 */
  onClose?: () => void
}

/**
 * warning / note / confirm を統一した共通モーダル。
 * 中央オーバーレイ + カード (warning は赤、他は accent 背景)。
 */
export function AppModal({
  variant = 'accent',
  title,
  children,
  actions,
  stackedActions,
  onClose,
}: Props) {
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="app-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className={`app-modal${variant === 'warning' ? ' is-warning' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {title && <p className="app-modal-title">{title}</p>}
        {children != null && <div className="app-modal-body">{children}</div>}
        {actions && actions.length > 0 && (
          <div className={`app-modal-actions${stackedActions ? ' is-stacked' : ''}`}>
            {actions.map((a, i) => (
              <button
                key={i}
                type="button"
                className={`app-modal-btn is-${a.variant ?? 'primary'}`}
                onClick={a.onClick}
                disabled={a.disabled}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
