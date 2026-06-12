import { ModalPopup } from '../ui/ModalPopup'
import { SettingsPanel } from './SettingsPanel'

type Props = {
  onClose: () => void
}

export function SettingsPopup({ onClose }: Props) {
  return (
    <ModalPopup title="設定" onClose={onClose}>
      <SettingsPanel />
    </ModalPopup>
  )
}
