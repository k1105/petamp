import { useCallback, useEffect, useRef } from 'react'
import { useCoRunStore } from '../../store/useCoRunStore'

/** 終了ゲートの自己ハードタイムアウト。誰かが落ちても結果画面が永久ブロックされないようにする。 */
const SELF_TIMEOUT_MS = 90 * 1000

type Props = {
  /** ゲートが開いた (全員ゴール or タイムアウト) ときに 1 回だけ呼ばれる。 */
  onProceed: () => void
}

/**
 * FINISH 後、全員のゴールを待つオーバーレイ。
 * session.status==='finished' (host が全員ゴールを検知) もしくは自己タイムアウトで onProceed。
 */
export function CoRunWaitOverlay({ onProceed }: Props) {
  const session = useCoRunStore(s => s.session)
  const myUid = useCoRunStore(s => s.myUid)
  const firedRef = useRef(false)

  const proceed = useCallback(() => {
    if (firedRef.current) return
    firedRef.current = true
    onProceed()
  }, [onProceed])

  useEffect(() => {
    if (session && (session.status === 'finished' || session.status === 'cancelled')) {
      proceed()
    }
  }, [session, proceed])

  useEffect(() => {
    const t = window.setTimeout(proceed, SELF_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [proceed])

  const others = session
    ? session.memberUids
        .filter(uid => uid !== myUid)
        .map(uid => session.members[uid])
        .filter(m => !!m && m.state !== 'declined' && m.state !== 'left')
    : []

  return (
    <div className="co-run-wait-overlay">
      <div className="co-run-wait-card">
        <div className="co-run-wait-title">みんなのゴールを待っています…</div>
        <ul className="co-run-wait-list">
          {others.map((m, i) => (
            <li key={i} className="co-run-member-row">
              <span className="co-run-member-name">{m.displayName || '匿名ランナー'}</span>
              <span
                className={`co-run-member-state co-run-state-${m.state === 'finished' ? 'finished' : 'running'}`}
              >
                {m.state === 'finished' ? 'ゴール' : '走行中'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
