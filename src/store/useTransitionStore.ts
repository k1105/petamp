import { create } from 'zustand'

export type TransitionPhase =
  | 'idle'
  | 'expanding'      // green disc grows from FAB origin to cover the screen
  | 'iris'           // a circular hole grows from centre, 0 → 70vw
  | 'iris-paused'    // hold at 70vw, render area-name on top
  | 'iris-finishing' // hole grows from 70vw to fully reveal /record

interface State {
  phase: TransitionPhase
  origin: { x: number; y: number } | null
  areaName: string | null
}

interface Actions {
  start: (origin: { x: number; y: number }, areaName: string | null) => void
  setPhase: (phase: TransitionPhase) => void
  reset: () => void
}

export const useTransitionStore = create<State & Actions>(set => ({
  phase: 'idle',
  origin: null,
  areaName: null,
  start: (origin, areaName) => set({ phase: 'expanding', origin, areaName }),
  setPhase: (phase) => set({ phase }),
  reset: () => set({ phase: 'idle', origin: null, areaName: null }),
}))
