import { create } from 'zustand'
import type { Run } from '../types'
import type { PublicUser } from '../firebase/userCloud'
import { getUserDoc } from '../firebase/userCloud'
import { listMyFriendUids } from '../firebase/friends'
import { cloudListRunsOf } from '../firebase/runCloud'

type SocialFeedState = {
  // 後方互換のためフィールド名は followedXxx を維持する (UI 側はフレンドのランを「フォロー先」と同じ枠で扱う)
  followedUsers: PublicUser[]
  followedRuns: Run[]
  loading: boolean
  loaded: boolean
  refresh: () => Promise<void>
  reset: () => void
  getRun: (id: string) => Run | null
}

export const useSocialFeedStore = create<SocialFeedState>((set, get) => ({
  followedUsers: [],
  followedRuns: [],
  loading: false,
  loaded: false,

  refresh: async () => {
    set({ loading: true })
    try {
      const friendUids = await listMyFriendUids()
      const [users, runsByUser] = await Promise.all([
        Promise.all(friendUids.map(uid => getUserDoc(uid))),
        Promise.all(
          friendUids.map(async uid => {
            const runs = await cloudListRunsOf(uid)
            return runs.map(r => ({ ...r, ownerUid: uid }))
          }),
        ),
      ])
      const followedUsers = users.filter((u): u is PublicUser => !!u)
      const followedRuns = runsByUser.flat()
      set({ followedUsers, followedRuns, loading: false, loaded: true })
    } catch (e) {
      console.error('socialFeed refresh failed', e)
      set({ loading: false })
    }
  },

  reset: () => set({ followedUsers: [], followedRuns: [], loading: false, loaded: false }),

  getRun: (id: string) => get().followedRuns.find(r => r.id === id) ?? null,
}))
