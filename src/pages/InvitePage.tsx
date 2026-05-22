import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { signInWithGoogle } from '../firebase/auth'
import { getUserDoc, type PublicUser } from '../firebase/userCloud'
import { addFriend, isFriendWith } from '../firebase/friends'
import { useSocialFeedStore } from '../store/useSocialFeedStore'

type LookupState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'ready'; inviter: PublicUser; already: boolean }
  | { kind: 'error'; message: string }

type ActionState =
  | { kind: 'idle' }
  | { kind: 'adding' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

type Phase =
  | 'loading'
  | 'self'
  | 'not-found'
  | 'signin-required'
  | 'confirm'
  | 'adding'
  | 'already'
  | 'done'
  | 'error'

/**
 * `/invite/:uid` — QR / リンクから開かれる招待ページ。
 * サインイン済みなら相手プロフィールを確認した上でボタン押下で相互フレンドを成立させる。
 * 未サインインなら Google ログインを促し、戻ってきた後同じ動線で進める。
 */
export function InvitePage() {
  const { uid: inviterUid } = useParams<{ uid: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

  const [lookup, setLookup] = useState<LookupState>({ kind: 'idle' })
  const [action, setAction] = useState<ActionState>({ kind: 'idle' })
  const [signInError, setSignInError] = useState<string | null>(null)

  // 同期的に判定できる枝 (uid 不正・自分自身) は state ではなく派生で扱う。
  // ルックアップが必要な場合のみ useEffect で非同期に取得する。
  const canLookup =
    !!inviterUid && !authLoading && !!user && user.uid !== inviterUid

  useEffect(() => {
    if (!canLookup || !inviterUid) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLookup({ kind: 'loading' })
    void (async () => {
      try {
        const [profile, already] = await Promise.all([
          getUserDoc(inviterUid),
          isFriendWith(inviterUid),
        ])
        if (cancelled) return
        if (!profile) {
          setLookup({ kind: 'not-found' })
          return
        }
        setLookup({ kind: 'ready', inviter: profile, already })
      } catch (e) {
        if (cancelled) return
        console.error('invite load failed', e)
        setLookup({
          kind: 'error',
          message: e instanceof Error ? e.message : String(e),
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canLookup, inviterUid])

  const phase = useMemo<Phase>(() => {
    if (!inviterUid) return 'not-found'
    if (authLoading) return 'loading'
    if (!user) return 'signin-required'
    if (user.uid === inviterUid) return 'self'
    if (action.kind === 'adding') return 'adding'
    if (action.kind === 'done') return 'done'
    if (action.kind === 'error') return 'error'
    if (lookup.kind === 'idle' || lookup.kind === 'loading') return 'loading'
    if (lookup.kind === 'not-found') return 'not-found'
    if (lookup.kind === 'error') return 'error'
    return lookup.already ? 'already' : 'confirm'
  }, [action, authLoading, inviterUid, lookup, user])

  const inviter = lookup.kind === 'ready' ? lookup.inviter : null
  const errorMessage =
    action.kind === 'error'
      ? action.message
      : lookup.kind === 'error'
        ? lookup.message
        : signInError

  const handleSignIn = async () => {
    setSignInError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      console.error('signIn failed', e)
      setSignInError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleConfirm = async () => {
    if (!inviterUid) return
    setAction({ kind: 'adding' })
    try {
      await addFriend(inviterUid)
      void useSocialFeedStore.getState().refresh()
      setAction({ kind: 'done' })
    } catch (e) {
      console.error('addFriend failed', e)
      setAction({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return (
    <div className="invite-page">
      <div className="invite-card">
        {phase === 'loading' && <div className="invite-msg">読み込み中…</div>}

        {phase === 'self' && (
          <>
            <div className="invite-msg">これはあなた自身の招待リンクです。</div>
            <button
              type="button"
              className="profile-screen-action"
              onClick={() => navigate('/', { replace: true })}
            >
              ホームへ
            </button>
          </>
        )}

        {phase === 'not-found' && (
          <>
            <div className="invite-msg">招待リンクが無効です。</div>
            <button
              type="button"
              className="profile-screen-action"
              onClick={() => navigate('/', { replace: true })}
            >
              ホームへ
            </button>
          </>
        )}

        {phase === 'signin-required' && (
          <>
            <div className="invite-msg">
              友達になるには Google でログインしてください。
            </div>
            <button
              type="button"
              className="profile-screen-action is-primary"
              onClick={handleSignIn}
            >
              Google でログイン
            </button>
            {errorMessage ? (
              <div className="profile-screen-error">{errorMessage}</div>
            ) : null}
          </>
        )}

        {(phase === 'confirm' || phase === 'adding') && inviter && (
          <>
            <div className="invite-avatar">
              {inviter.photoURL ? (
                <img src={inviter.photoURL} alt="" referrerPolicy="no-referrer" />
              ) : (
                <Icon icon="lucide:user" />
              )}
            </div>
            <div className="invite-name">{inviter.displayName ?? '名無し'}</div>
            <div className="invite-msg">友達として登録しますか？</div>
            <div className="invite-actions">
              <button
                type="button"
                className="profile-screen-action"
                onClick={() => navigate('/', { replace: true })}
                disabled={phase === 'adding'}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="profile-screen-action is-primary"
                onClick={handleConfirm}
                disabled={phase === 'adding'}
              >
                {phase === 'adding' ? '追加中…' : '友達になる'}
              </button>
            </div>
          </>
        )}

        {phase === 'already' && inviter && (
          <>
            <div className="invite-avatar">
              {inviter.photoURL ? (
                <img src={inviter.photoURL} alt="" referrerPolicy="no-referrer" />
              ) : (
                <Icon icon="lucide:user" />
              )}
            </div>
            <div className="invite-name">{inviter.displayName ?? '名無し'}</div>
            <div className="invite-msg">すでに友達です。</div>
            <button
              type="button"
              className="profile-screen-action"
              onClick={() => navigate('/', { replace: true })}
            >
              ホームへ
            </button>
          </>
        )}

        {phase === 'done' && inviter && (
          <>
            <div className="invite-avatar">
              {inviter.photoURL ? (
                <img src={inviter.photoURL} alt="" referrerPolicy="no-referrer" />
              ) : (
                <Icon icon="lucide:user" />
              )}
            </div>
            <div className="invite-name">{inviter.displayName ?? '名無し'}</div>
            <div className="invite-msg">友達になりました！</div>
            <button
              type="button"
              className="profile-screen-action is-primary"
              onClick={() => navigate('/', { replace: true })}
            >
              ホームへ
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="invite-msg">エラーが発生しました。</div>
            {errorMessage ? (
              <div className="profile-screen-error">{errorMessage}</div>
            ) : null}
            <button
              type="button"
              className="profile-screen-action"
              onClick={() => navigate('/', { replace: true })}
            >
              ホームへ
            </button>
          </>
        )}
      </div>
    </div>
  )
}
