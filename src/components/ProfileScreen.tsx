import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { useAuth } from '../hooks/useAuth'
import { signInWithGoogle } from '../firebase/auth'
import { getUserDoc, type PublicUser } from '../firebase/userCloud'
import { listMyFriends } from '../firebase/friends'
import { useSocialFeedStore } from '../store/useSocialFeedStore'
import { InviteTab } from './profile/InviteTab'
import { FriendsTab } from './profile/FriendsTab'
import { StatsView } from './gallery/StatsView'
import { ModalPopup } from './ModalPopup'
import { getMemoryStore, petampCharacter } from '../character'
import type { SemanticMemory } from '../character/domain/memory'
import type { Run } from '../types'

const NAME_MAX_LENGTH = 20

type Props = {
  onClose: () => void
  runs: Run[]
}

function formatError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  if (typeof e === 'object' && e !== null) {
    const obj = e as { code?: string; message?: string }
    if (obj.code || obj.message) return `${obj.code ?? 'error'}: ${obj.message ?? ''}`
    try { return JSON.stringify(e) } catch { return String(e) }
  }
  return String(e)
}

export function ProfileScreen({ onClose, runs }: Props) {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [friends, setFriends] = useState<PublicUser[] | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)

  const [friendsOpen, setFriendsOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)

  // オンボーディングで登録した名前 (semantic memory 内の fact.user_name)。
  // Google アカウント名ではなくこちらを優先表示する。upsert のため row 全体を保持。
  const [savedRow, setSavedRow] = useState<SemanticMemory | null>(null)
  const savedName = savedRow?.value ?? null
  useEffect(() => {
    let cancelled = false
    void getMemoryStore()
      .querySemantic({ characterId: petampCharacter.id, keyPrefix: 'fact.user_name' })
      .then(rows => {
        if (cancelled) return
        setSavedRow(rows[0] ?? null)
      })
      .catch(e => {
        console.error('load user_name failed', e)
      })
    return () => { cancelled = true }
  }, [])

  // 名前の inline 編集状態
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const startEditName = () => {
    setDraftName(savedName ?? '')
    setNameError(null)
    setEditingName(true)
  }

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus()
  }, [editingName])

  const cancelEditName = () => {
    setEditingName(false)
    setNameError(null)
  }

  const saveName = async () => {
    const trimmed = draftName.trim()
    if (trimmed.length === 0) {
      setNameError('名前を入力してね')
      return
    }
    if (savingName) return
    setSavingName(true)
    setNameError(null)
    const now = Date.now()
    const next: SemanticMemory = {
      id: savedRow?.id ?? crypto.randomUUID(),
      characterId: petampCharacter.id,
      key: 'fact.user_name',
      value: trimmed,
      confidence: 1,
      createdAt: savedRow?.createdAt ?? now,
      updatedAt: now,
    }
    try {
      await getMemoryStore().putSemantic(next)
      setSavedRow(next)
      setEditingName(false)
    } catch (e) {
      console.error('saveName failed', e)
      setNameError(formatError(e))
    } finally {
      setSavingName(false)
    }
  }

  const uid = user?.uid
  const refresh = useCallback(async () => {
    if (!uid) return
    try {
      const docs = await listMyFriends()
      const otherUids = docs.map(f => (f.members[0] === uid ? f.members[1] : f.members[0]))
      const profiles = await Promise.all(otherUids.map(u => getUserDoc(u)))
      setFriends(profiles.filter((u): u is PublicUser => !!u))
      setDataError(null)
      // フレンドが変わるとフィードに出るランも増減するので feed も更新
      void useSocialFeedStore.getState().refresh()
    } catch (e) {
      console.error('profile data load failed', e)
      setDataError(formatError(e))
    }
  }, [uid])

  useEffect(() => {
    if (!uid) return
    let cancelled = false
    void (async () => {
      try {
        const docs = await listMyFriends()
        if (cancelled) return
        const otherUids = docs.map(f => (f.members[0] === uid ? f.members[1] : f.members[0]))
        const profiles = await Promise.all(otherUids.map(u => getUserDoc(u)))
        if (cancelled) return
        setFriends(profiles.filter((u): u is PublicUser => !!u))
        setDataError(null)
      } catch (e) {
        if (cancelled) return
        console.error('profile data load failed', e)
        setDataError(formatError(e))
      }
    })()
    return () => { cancelled = true }
  }, [uid])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const friendsCount = friends?.length ?? 0

  const handleSignIn = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      console.error('signIn failed', e)
      setError(formatError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="profile-slide" role="dialog" aria-label="プロフィール">
      {user ? (
        <div className="profile-screen-body">
          <div className="profile-tab-self">
            <div className="profile-screen-avatar">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
              ) : (
                <Icon icon="lucide:user" />
              )}
            </div>
            <div className="profile-screen-name-row">
              {editingName ? (
                <>
                  <input
                    ref={nameInputRef}
                    type="text"
                    className="profile-screen-name-input"
                    value={draftName}
                    maxLength={NAME_MAX_LENGTH}
                    onChange={e => setDraftName(e.currentTarget.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void saveName()
                      else if (e.key === 'Escape') cancelEditName()
                    }}
                    disabled={savingName}
                    aria-label="名前"
                  />
                  <button
                    type="button"
                    className="profile-screen-name-btn is-confirm"
                    onClick={() => void saveName()}
                    disabled={savingName}
                    aria-label="保存"
                  >
                    <Icon icon="lucide:check" />
                  </button>
                  <button
                    type="button"
                    className="profile-screen-name-btn"
                    onClick={cancelEditName}
                    disabled={savingName}
                    aria-label="キャンセル"
                  >
                    <Icon icon="lucide:x" />
                  </button>
                </>
              ) : (
                <>
                  <div className="profile-screen-name">{savedName ?? 'ゲスト'}</div>
                  <button
                    type="button"
                    className="profile-screen-name-btn"
                    onClick={startEditName}
                    aria-label="名前を編集"
                  >
                    <Icon icon="lucide:pencil" />
                  </button>
                </>
              )}
            </div>
            {nameError ? <div className="profile-screen-error">{nameError}</div> : null}
            <div className="profile-screen-stats">
              <button
                type="button"
                className="profile-screen-stat profile-screen-stat-btn"
                onClick={() => setFriendsOpen(true)}
                aria-label="友達一覧を開く"
              >
                <span className="profile-screen-stat-value">{friendsCount}</span>
                <span className="profile-screen-stat-label">友達</span>
              </button>
              <button
                type="button"
                className="profile-screen-stat-add"
                onClick={() => setInviteOpen(true)}
                aria-label="友達を追加"
              >
                <Icon icon="lucide:plus" />
              </button>
            </div>
          </div>
          <div className="stats-view-wrap">
            <StatsView runs={runs} />
          </div>
          {dataError ? <div className="profile-screen-error">{dataError}</div> : null}

          {friendsOpen && (
            <ModalPopup title="友達" onClose={() => setFriendsOpen(false)}>
              {friends === null ? (
                <div className="profile-empty">読み込み中…</div>
              ) : (
                <FriendsTab friends={friends} onChanged={refresh} />
              )}
            </ModalPopup>
          )}
          {inviteOpen && (
            <ModalPopup title="友達を招待" onClose={() => setInviteOpen(false)}>
              <InviteTab myUid={user.uid} />
            </ModalPopup>
          )}
        </div>
      ) : (
        <div className="profile-screen-body">
          <div className="profile-tab-self">
            <div className="profile-screen-avatar">
              <Icon icon="lucide:user" />
            </div>
            <div className="profile-screen-name">ゲスト</div>
            <button
              type="button"
              className="profile-screen-action is-primary"
              onClick={handleSignIn}
              disabled={busy}
            >
              Google でログイン
            </button>
            {error ? <div className="profile-screen-error">{error}</div> : null}
          </div>
          {/* 未ログインでもローカル（idb-keyval）の軌跡から累計・ヒストグラムを表示する */}
          <div className="stats-view-wrap">
            <StatsView runs={runs} />
          </div>
        </div>
      )}
    </div>
  )
}
