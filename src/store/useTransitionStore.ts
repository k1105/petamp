import { create } from 'zustand'
import type { MovementType } from '../types'
import { DEFAULT_MOVEMENT_TYPE } from '../utils/run/movementType'

export type TransitionPhase =
  | 'idle'
  // → /record (iris-in)
  | 'expanding'        // green disc grows from FAB origin to cover the screen
  | 'iris'             // a circular hole grows from centre, 0 → 70vw
  | 'iris-paused'      // hold at 70vw, render area-name on top
  | 'iris-finishing'   // hole morphs 70vw circle → rounded-rect frame
  | 'framed'           // green frame rests around the screen edge during the run
  // → /run/:id (eye-translate)
  | 'run-expand'       // green disc grows from FAB origin to cover the screen
  | 'run-fade'         // eye translates from FAB origin to bottom-right
  | 'run-settle'       // /run/:id mounted, overlay fades out

interface State {
  phase: TransitionPhase
  origin: { x: number; y: number } | null
  areaName: string | null
  runId: string | null
  /** 「一緒に走る」セッション経由の /record か。null ならソロ。 */
  sessionId: string | null
  /** onboarding → /record 経由かどうか。初回チュートリアル popup の出し分けに使う。 */
  fromOnboarding: boolean
  /** ラン開始前 (Gallery armed) に選んだ移動種別。/record が snapshot して保存に使う。 */
  movementType: MovementType
  /** 緑フレームを一時的にアニメーションで隠すか (デバッグ/アンカー設置画面など)。 */
  frameHidden: boolean
}

interface Actions {
  startRecord: (
    origin: { x: number; y: number },
    areaName: string | null,
    sessionId?: string | null,
    opts?: { fromOnboarding?: boolean; movementType?: MovementType },
  ) => void
  startRunDetail: (origin: { x: number; y: number }, runId: string) => void
  setPhase: (phase: TransitionPhase) => void
  setFrameHidden: (hidden: boolean) => void
  reset: () => void
}

export const useTransitionStore = create<State & Actions>(set => ({
  phase: 'idle',
  origin: null,
  areaName: null,
  runId: null,
  sessionId: null,
  fromOnboarding: false,
  movementType: DEFAULT_MOVEMENT_TYPE,
  frameHidden: false,
  startRecord: (origin, areaName, sessionId, opts) =>
    set({
      phase: 'expanding',
      origin,
      areaName,
      runId: null,
      sessionId: sessionId ?? null,
      fromOnboarding: opts?.fromOnboarding ?? false,
      movementType: opts?.movementType ?? DEFAULT_MOVEMENT_TYPE,
    }),
  startRunDetail: (origin, runId) =>
    set({ phase: 'run-expand', origin, areaName: null, runId, sessionId: null, fromOnboarding: false }),
  setPhase: (phase) => set({ phase }),
  setFrameHidden: (frameHidden) => set({ frameHidden }),
  reset: () =>
    set({ phase: 'idle', origin: null, areaName: null, runId: null, sessionId: null, fromOnboarding: false, movementType: DEFAULT_MOVEMENT_TYPE, frameHidden: false }),
}))
