import { create } from 'zustand'
import type { InProgressRun } from '../db/inProgressRun'

// 中断ランの「再開」時に、復元する下書きを RecordingPage へ受け渡すための一時ストア。
// RecordingPage がマウント時に同期的に読み取り、即クリアする。
interface ResumeRunStore {
  draft: InProgressRun | null
  setDraft: (d: InProgressRun | null) => void
}

export const useResumeRunStore = create<ResumeRunStore>(set => ({
  draft: null,
  setDraft: draft => set({ draft }),
}))
