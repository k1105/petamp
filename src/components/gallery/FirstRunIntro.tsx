export function FirstRunIntro({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="first-run-intro" role="dialog" aria-label="最初のランの案内">
      <div className="first-run-intro-inner">
        <h2 className="first-run-intro-title">最初のラン、お疲れさまでした！</h2>
        <p className="first-run-intro-body">
          ペタンプは、あなたの住む世界のことを何も知らない存在です。ランニングの記録をつけたら、そのランニングがどんな体験だったかをペタンプに教えてあげることで、ペタンプはどんどん成長していきます。もしかすると、あなたも知らなかった自分の好みや、このセカイのことに気づかせてくれるようになるかもしれません。
        </p>
        <button className="first-run-intro-ok" onClick={onDismiss}>
          OK
        </button>
      </div>
    </div>
  )
}
