import { create } from 'zustand'
import {
  type CoRunSession,
  coRunCreateSession,
  coRunLeave,
  coRunSetMemberState,
  coRunSetStatus,
  isAllFinished,
  isAllReady,
  subscribeSession,
} from '../firebase/coRunCloud'

/**
 * 「一緒に走る」モードのクライアント状態。
 *
 * - `session`: 自分が今参加しているセッション (host として作成 or 招待を承諾)。
 * - `incomingInvites`: グローバル lobby リスナー (useCoRunInviteListener) が流し込む、
 *   自分宛ての未応答招待。
 *
 * host クライアントだけが status をフリップする (開始ゲート/終了ゲート)。
 * その判定はアクティブセッションのスナップショットコールバック内で行う。
 */

type Members = { uid: string; displayName: string | null }[]

interface CoRunState {
  myUid: string | null
  session: CoRunSession | null
  incomingInvites: CoRunSession[]
  /** ギャラリーの「友達と走る」導線でフレンド選択ロビーを開いているか。 */
  pickerOpen: boolean

  setMyUid: (uid: string | null) => void
  setIncomingInvites: (sessions: CoRunSession[]) => void
  openPicker: () => void
  closePicker: () => void

  createSession: (members: Members) => Promise<void>
  joinInvite: (session: CoRunSession) => Promise<void>
  declineInvite: (session: CoRunSession) => Promise<void>
  markRunning: () => Promise<void>
  markFinished: (runId: string) => Promise<void>
  leave: () => Promise<void>
  /** 購読を止めローカル状態をクリア (ラン完了/離脱の後始末)。リモート書込みはしない。 */
  clearLocal: () => void
}

// アクティブセッションの購読ハンドルと host フリップの多重発火ガード (モジュールスコープ)。
let sessionUnsub: (() => void) | null = null
let flipInFlight = false

export const useCoRunStore = create<CoRunState>((set, get) => {
  function subscribeActive(id: string): void {
    sessionUnsub?.()
    sessionUnsub = subscribeSession(id, session => {
      set({ session })
      if (!session) return
      const { myUid } = get()
      if (myUid && session.hostUid === myUid) maybeHostFlip(session)
    })
  }

  // host のみ: 開始/終了ゲートが開いたら status をフリップする。
  function maybeHostFlip(session: CoRunSession): void {
    if (flipInFlight) return
    if (session.status === 'lobby' && isAllReady(session)) {
      flipInFlight = true
      coRunSetStatus(session.id, 'running', { startedAt: Date.now() })
        .catch(e => console.error('coRun start-gate flip failed', e))
        .finally(() => {
          flipInFlight = false
        })
    } else if (session.status === 'running' && isAllFinished(session)) {
      flipInFlight = true
      coRunSetStatus(session.id, 'finished')
        .catch(e => console.error('coRun end-gate flip failed', e))
        .finally(() => {
          flipInFlight = false
        })
    }
  }

  return {
    myUid: null,
    session: null,
    incomingInvites: [],
    pickerOpen: false,

    setMyUid: uid => set({ myUid: uid }),
    openPicker: () => set({ pickerOpen: true }),
    closePicker: () => set({ pickerOpen: false }),

    setIncomingInvites: sessions => {
      const { myUid, session } = get()
      const invites = sessions.filter(
        s => !!myUid && s.members[myUid]?.state === 'invited' && s.id !== session?.id,
      )
      set({ incomingInvites: invites })
    },

    createSession: async members => {
      const session = await coRunCreateSession(members)
      set({ session })
      subscribeActive(session.id)
    },

    joinInvite: async session => {
      set({ session })
      subscribeActive(session.id)
      await coRunSetMemberState(session.id, 'ready')
    },

    declineInvite: async session => {
      await coRunSetMemberState(session.id, 'declined')
      set(s => ({ incomingInvites: s.incomingInvites.filter(x => x.id !== session.id) }))
    },

    markRunning: async () => {
      const { session } = get()
      if (!session) return
      await coRunSetMemberState(session.id, 'running')
    },

    markFinished: async runId => {
      const { session } = get()
      if (!session) return
      await coRunSetMemberState(session.id, 'finished', { runId })
    },

    leave: async () => {
      const { session, myUid } = get()
      if (session) {
        try {
          await coRunLeave(session.id, session.hostUid === myUid)
        } catch (e) {
          console.error('coRun leave failed', e)
        }
      }
      sessionUnsub?.()
      sessionUnsub = null
      set({ session: null, pickerOpen: false })
    },

    clearLocal: () => {
      sessionUnsub?.()
      sessionUnsub = null
      set({ session: null, pickerOpen: false })
    },
  }
})
