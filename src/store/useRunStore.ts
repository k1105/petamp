import { create } from 'zustand'
import type { Run } from '../types'
import { listRuns, loadRun, saveRun, deleteRun, putRunLocal } from '../db/runRepository'
import { cloudListRuns } from '../firebase/runCloud'
import { DUMMY_RUNS } from '../utils/dummyData'

async function syncCloudIntoLocal(): Promise<void> {
  let cloudRuns: Run[] = []
  try {
    cloudRuns = await cloudListRuns()
  } catch (e) {
    console.warn('cloudListRuns failed', e)
    return
  }
  const local = await listRuns()
  const localById = new Map(local.map(r => [r.id, r]))
  for (const cloud of cloudRuns) {
    const localRun = localById.get(cloud.id)
    if (!localRun) {
      await putRunLocal(cloud)
      continue
    }
    if ((cloud.finishedAt ?? 0) > (localRun.finishedAt ?? 0)) {
      const merged: Run = {
        ...cloud,
        notes: cloud.notes.map(cn => {
          const ln = localRun.notes.find(n => n.id === cn.id)
          return ln?.photoDataUrl ? { ...cn, photoDataUrl: ln.photoDataUrl } : cn
        }),
      }
      await putRunLocal(merged)
    }
  }
}

interface RunStore {
  runs: Run[]
  activeRunId: string | null
  loadRuns: (useDummy?: boolean) => Promise<void>
  addRun: (run: Run) => Promise<void>
  updateRun: (id: string, partial: Partial<Run>) => Promise<Run | null>
  removeRun: (id: string) => Promise<void>
  setActiveRunId: (id: string | null) => void
}

export const useRunStore = create<RunStore>((set) => ({
  runs: [],
  activeRunId: null,

  loadRuns: async (useDummy = false) => {
    if (useDummy) {
      set({ runs: DUMMY_RUNS })
      return
    }
    try {
      await syncCloudIntoLocal()
      const saved = await listRuns()
      set({ runs: saved })
    } catch (e) {
      console.error('loadRuns failed', e)
      set({ runs: [] })
    }
  },

  addRun: async (run) => {
    await saveRun(run)
    set(state => ({ runs: [run, ...state.runs] }))
  },

  updateRun: async (id, partial) => {
    const current = await loadRun(id)
    if (!current) return null
    const updated = { ...current, ...partial }
    await saveRun(updated)
    set(state => ({ runs: state.runs.map(r => r.id === id ? updated : r) }))
    return updated
  },

  removeRun: async (id) => {
    await deleteRun(id)
    set(state => ({ runs: state.runs.filter(r => r.id !== id) }))
  },

  setActiveRunId: (id) => set({ activeRunId: id }),
}))
