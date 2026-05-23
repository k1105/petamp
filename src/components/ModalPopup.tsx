import { useEffect, type ReactNode } from 'react'
import { Icon } from '@iconify/react'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
}

export function ModalPopup({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="debug-overlay modal-popup-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="debug-panel modal-popup-panel"
        onClick={e => e.stopPropagation()}
      >
        <div className="debug-header">
          <h2 className="debug-title">{title}</h2>
          <button
            type="button"
            className="modal-popup-close"
            onClick={onClose}
            aria-label="閉じる"
          >
            <Icon icon="lucide:x" />
          </button>
        </div>
        <div className="modal-popup-body">{children}</div>
      </div>
    </div>
  )
}
