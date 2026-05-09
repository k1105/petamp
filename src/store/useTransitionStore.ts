import { create } from 'zustand'

export type TransitionPhase =
  | 'idle'
  // → /record (iris-in)
  | 'expanding'        // green disc grows from FAB origin to cover the screen
  | 'iris'             // a circular hole grows from centre, 0 → 70vw
  | 'iris-paused'      // hold at 70vw, render area-name on top
  | 'iris-finishing'   // hole grows from 70vw to fully reveal /record
  // → /run/:id (eye-translate)
  | 'run-expand'       // green disc grows from FAB origin to cover the screen
  | 'run-fade'         // eye translates from FAB origin to bottom-right
  | 'run-settle'       // /run/:id mounted, overlay fades out

interface State {
  phase: TransitionPhase
  origin: { x: number; y: number } | null
  areaName: string | null
  runId: string | null
}

interface Actions {
  startRecord: (origin: { x: number; y: number }, areaName: string | null) => void
  startRunDetail: (origin: { x: number; y: number }, runId: string) => void
  setPhase: (phase: TransitionPhase) => void
  reset: () => void
}

export const useTransitionStore = create<State & Actions>(set => ({
  phase: 'idle',
  origin: null,
  areaName: null,
  runId: null,
  startRecord: (origin, areaName) => set({ phase: 'expanding', origin, areaName, runId: null }),
  startRunDetail: (origin, runId) => set({ phase: 'run-expand', origin, areaName: null, runId }),
  setPhase: (phase) => set({ phase }),
  reset: () => set({ phase: 'idle', origin: null, areaName: null, runId: null }),
}))
