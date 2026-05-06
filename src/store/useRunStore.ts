import { create } from 'zustand'
import type { Run } from '../types'
import { listRuns, saveRun, deleteRun } from '../db/runRepository'
import { DUMMY_RUNS } from '../utils/dummyData'

interface RunStore {
  runs: Run[]
  activeRunId: string | null
  loadRuns: () => Promise<void>
  addRun: (run: Run) => Promise<void>
  removeRun: (id: string) => Promise<void>
  setActiveRunId: (id: string | null) => void
}

export const useRunStore = create<RunStore>((set) => ({
  runs: [],
  activeRunId: null,

  loadRuns: async () => {
    try {
      const saved = await listRuns()
      set({ runs: saved.length > 0 ? saved : DUMMY_RUNS })
    } catch (e) {
      console.error('loadRuns failed', e)
      set({ runs: DUMMY_RUNS })
    }
  },

  addRun: async (run) => {
    await saveRun(run)
    set(state => ({ runs: [run, ...state.runs] }))
  },

  removeRun: async (id) => {
    await deleteRun(id)
    set(state => ({ runs: state.runs.filter(r => r.id !== id) }))
  },

  setActiveRunId: (id) => set({ activeRunId: id }),
}))
