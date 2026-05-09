import { create } from 'zustand'
import type { Run } from '../types'
import { listRuns, loadRun, saveRun, deleteRun } from '../db/runRepository'
import { DUMMY_RUNS } from '../utils/dummyData'

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
