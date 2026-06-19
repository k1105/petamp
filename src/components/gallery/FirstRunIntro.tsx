import { AppModal } from '../ui/AppModal'

export function FirstRunIntro({ onDismiss }: { onDismiss: () => void }) {
  return (
    <AppModal
      title="最初のラン、お疲れさまでした！"
      actions={[{ label: 'OK', onClick: onDismiss }]}
    >
      <p>
        ペタンプは、あなたの住む世界のことを何も知らない存在です。ランニングの記録をつけたら、そのランニングがどんな体験だったかをペタンプに教えてあげることで、ペタンプはどんどん成長していきます。もしかすると、あなたも知らなかった自分の好みや、このセカイのことに気づかせてくれるようになるかもしれません。
      </p>
    </AppModal>
  )
}
