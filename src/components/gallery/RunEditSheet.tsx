import { useEffect } from 'react'
import { Icon } from '@iconify/react'
import type { MovementType, Run } from '../../types'
import { getMovementType } from '../../utils/run/movementType'
import { MovementTypeSelector } from './MovementTypeSelector'

interface Props {
  run: Run
  /** 移動種別が選択されたとき。即保存する。 */
  onChangeType: (type: MovementType) => void
  /** 削除ボタン。確認ダイアログを開く想定。 */
  onDelete: () => void
  onClose: () => void
}

/**
 * ランの長押しで開く編集シート。移動種別の変更と削除を 1 画面に統合する。
 * 種別を選ぶと即保存し、削除は確認を挟む。
 */
export function RunEditSheet({ run, onChangeType, onDelete, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="confirm-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="ランの編集"
      onClick={onClose}
    >
      <div className="confirm-dialog-panel run-edit-sheet" onClick={e => e.stopPropagation()}>
        <p className="run-edit-sheet-title">移動の種類</p>
        <MovementTypeSelector value={getMovementType(run)} onChange={onChangeType} />
        <button
          type="button"
          className="run-edit-sheet-delete"
          onClick={onDelete}
        >
          <Icon icon="lucide:trash-2" />
          <span>このランを削除</span>
        </button>
      </div>
    </div>
  )
}
