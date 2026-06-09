import type { NamedPlace } from '../../character/domain/memory'

export function NamedPlacePopup({ place, onClose }: { place: NamedPlace; onClose: () => void }) {
  const description = (place.description ?? '').trim()

  return (
    <div className="named-place-popup" role="dialog" aria-label={`${place.name} の説明`}>
      <button
        type="button"
        className="named-place-popup-close"
        onClick={onClose}
        aria-label="閉じる"
      >
        ×
      </button>
      <div className="named-place-popup-name">{place.name}</div>
      <div className="named-place-popup-desc">
        {description !== '' ? description : '(まだ言葉になっていない場所)'}
      </div>
    </div>
  )
}
