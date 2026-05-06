import { get, set, del, keys } from 'idb-keyval'
import type { Run } from '../types'

const PREFIX = 'run:'

export async function saveRun(run: Run): Promise<void> {
  await set(`${PREFIX}${run.id}`, run)
}

export async function loadRun(id: string): Promise<Run | undefined> {
  return get<Run>(`${PREFIX}${id}`)
}

export async function listRuns(): Promise<Run[]> {
  const allKeys = await keys<string>()
  const runKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith(PREFIX))
  const runs = await Promise.all(runKeys.map(k => get<Run>(k)))
  return (runs.filter(Boolean) as Run[]).sort((a, b) => b.startedAt - a.startedAt)
}

export async function deleteRun(id: string): Promise<void> {
  await del(`${PREFIX}${id}`)
}
