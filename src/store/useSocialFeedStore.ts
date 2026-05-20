import { create } from 'zustand'
import type { Run } from '../types'
import type { PublicUser } from '../firebase/userCloud'
import { getUserDoc } from '../firebase/userCloud'
import { listMyOutgoing } from '../firebase/follows'
import { cloudListRunsOf } from '../firebase/runCloud'

type SocialFeedState = {
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
      const outgoing = await listMyOutgoing()
      const accepted = outgoing.filter(f => f.status === 'accepted')
      const [users, runsByUser] = await Promise.all([
        Promise.all(accepted.map(f => getUserDoc(f.followeeUid))),
        Promise.all(
          accepted.map(async f => {
            const runs = await cloudListRunsOf(f.followeeUid)
            return runs.map(r => ({ ...r, ownerUid: f.followeeUid }))
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
