import { useState } from 'react'
import QRCode from 'react-qr-code'
import { Icon } from '@iconify/react'

type Props = {
  myUid: string
}

/**
 * 自分の招待 QR と招待リンクを表示する。リンクは `${origin}/invite/${uid}` 形式の固定 URL。
 * 受け取った相手がサインイン状態で開くと即時相互フレンドが成立する (InvitePage 側で実装)。
 */
export function InviteTab({ myUid }: Props) {
  const inviteUrl = `${window.location.origin}/invite/${myUid}`
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error('copy failed', e)
    }
  }

  const handleShare = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'petamp で友達になろう',
          text: 'このリンクから友達追加できます',
          url: inviteUrl,
        })
      } catch (e) {
        if ((e as { name?: string })?.name !== 'AbortError') {
          console.error('share failed', e)
        }
      }
    } else {
      void handleCopy()
    }
  }

  return (
    <div className="profile-invite">
      <p className="profile-invite-lead">
        このQRコードを相手にスキャンしてもらうか、リンクを送ると<br />
        互いに友達として登録されます。
      </p>
      <div className="profile-invite-qr">
        <QRCode
          value={inviteUrl}
          size={208}
          bgColor="#ffffff"
          fgColor="#000000"
          level="M"
        />
      </div>
      <div className="profile-invite-url">{inviteUrl}</div>
      <div className="profile-invite-actions">
        <button
          type="button"
          className="profile-screen-action"
          onClick={handleCopy}
        >
          <Icon icon={copied ? 'lucide:check' : 'lucide:copy'} />
          {copied ? 'コピーしました' : 'リンクをコピー'}
        </button>
        {typeof navigator.share === 'function' && (
          <button
            type="button"
            className="profile-screen-action is-primary"
            onClick={handleShare}
          >
            <Icon icon="lucide:share-2" />
            共有
          </button>
        )}
      </div>
    </div>
  )
}
