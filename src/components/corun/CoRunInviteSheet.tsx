import { useCoRunStore } from '../../store/useCoRunStore'

/**
 * 自分宛ての招待が届いたときに、どの画面にいても出る受信シート。
 * 既にアクティブセッションがあるときは出さない。
 */
export function CoRunInviteSheet() {
  const incomingInvites = useCoRunStore(s => s.incomingInvites)
  const session = useCoRunStore(s => s.session)
  const joinInvite = useCoRunStore(s => s.joinInvite)
  const declineInvite = useCoRunStore(s => s.declineInvite)

  if (session || incomingInvites.length === 0) return null

  const invite = incomingInvites[0]
  const hostName = invite.members[invite.hostUid]?.displayName || '誰か'

  return (
    <div className="co-run-invite-sheet" role="dialog" aria-label="一緒に走る招待">
      <div className="co-run-invite-text">
        <strong>{hostName}さん</strong>が一緒に走るランに誘っています（{invite.memberUids.length}人）
      </div>
      <div className="co-run-invite-actions">
        <button
          type="button"
          className="co-run-btn co-run-btn-ghost"
          onClick={() => void declineInvite(invite)}
        >
          辞退
        </button>
        <button
          type="button"
          className="co-run-btn co-run-btn-primary"
          onClick={() => void joinInvite(invite)}
        >
          参加
        </button>
      </div>
    </div>
  )
}
