import type { Run } from '../../types'

export type GalleryListItem =
  | { kind: 'single'; run: Run }
  | { kind: 'corun'; sessionId: string; runs: Run[] }

export function buildGalleryListItems(runs: Run[]): GalleryListItem[] {
  const items: GalleryListItem[] = []
  const seenSessions = new Set<string>()

  for (const run of runs) {
    const sessionId = run.coRunSessionId
    if (sessionId) {
      if (seenSessions.has(sessionId)) continue
      seenSessions.add(sessionId)
      items.push({
        kind: 'corun',
        sessionId,
        runs: runs.filter(r => r.coRunSessionId === sessionId),
      })
      continue
    }

    items.push({ kind: 'single', run })
  }

  return items
}
