import { Icon } from '@iconify/react'
import type { MovementType } from '../types'
import { MOVEMENT_TYPES } from '../utils/movementType'

interface Props {
  value: MovementType
  onChange: (type: MovementType) => void
  /** ラベルを隠してアイコンのみにする (省スペース用)。デフォルトは表示。 */
  hideLabels?: boolean
}

/**
 * 移動種別を選ぶ 2x2 グリッドセレクタ。記録画面と編集シートで共用する。
 */
export function MovementTypeSelector({ value, onChange, hideLabels = false }: Props) {
  return (
    <div className="movement-selector" role="radiogroup" aria-label="移動種別">
      {MOVEMENT_TYPES.map(t => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={value === t.value}
          className={`movement-selector-item${value === t.value ? ' is-active' : ''}`}
          onClick={() => onChange(t.value)}
        >
          <span className="movement-selector-icon">
            <Icon icon={t.icon} />
          </span>
          {!hideLabels && <span className="movement-selector-label">{t.label}</span>}
        </button>
      ))}
    </div>
  )
}
