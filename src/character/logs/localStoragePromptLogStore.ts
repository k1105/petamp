import type {
  PromptLogEntry,
  PromptLogId,
  PromptLogQuery,
  PromptLogStore,
} from './promptLog'

const ENTRY_PREFIX = 'prompt_log:entry:'
const INDEX_KEY = 'prompt_log:index'

/** indexに載せる軽量メタ。query高速化用。本体は別キー。 */
interface IndexRow {
  id: PromptLogId
  timestamp: number
  characterId: string
  threadId: string
  purpose: string
}

function readIndex(): IndexRow[] {
  const raw = localStorage.getItem(INDEX_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as IndexRow[]) : []
  } catch {
    return []
  }
}

function writeIndex(rows: IndexRow[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(rows))
}

function entryKey(id: PromptLogId): string {
  return `${ENTRY_PREFIX}${id}`
}

function matches(row: IndexRow, q: PromptLogQuery): boolean {
  if (q.characterId && row.characterId !== q.characterId) return false
  if (q.threadId && row.threadId !== q.threadId) return false
  if (q.purpose && row.purpose !== q.purpose) return false
  if (q.since !== undefined && row.timestamp < q.since) return false
  if (q.until !== undefined && row.timestamp > q.until) return false
  return true
}

export class LocalStoragePromptLogStore implements PromptLogStore {
  async append(entry: PromptLogEntry): Promise<void> {
    localStorage.setItem(entryKey(entry.id), JSON.stringify(entry))
    const index = readIndex()
    index.push({
      id: entry.id,
      timestamp: entry.timestamp,
      characterId: entry.characterId,
      threadId: entry.threadId,
      purpose: entry.purpose,
    })
    writeIndex(index)
  }

  async get(id: PromptLogId): Promise<PromptLogEntry | undefined> {
    const raw = localStorage.getItem(entryKey(id))
    if (!raw) return undefined
    return JSON.parse(raw) as PromptLogEntry
  }

  async query(q: PromptLogQuery): Promise<PromptLogEntry[]> {
    const rows = readIndex()
      .filter(r => matches(r, q))
      .sort((a, b) => b.timestamp - a.timestamp)
    const limited = q.limit !== undefined ? rows.slice(0, q.limit) : rows
    const entries = await Promise.all(limited.map(r => this.get(r.id)))
    return entries.filter((e): e is PromptLogEntry => e !== undefined)
  }

  async rate(
    id: PromptLogId,
    rating: NonNullable<PromptLogEntry['rating']>,
  ): Promise<void> {
    const entry = await this.get(id)
    if (!entry) throw new Error(`PromptLogEntry not found: ${id}`)
    const updated: PromptLogEntry = { ...entry, rating }
    localStorage.setItem(entryKey(id), JSON.stringify(updated))
  }

  async clear(q?: PromptLogQuery): Promise<number> {
    const index = readIndex()
    if (!q) {
      for (const row of index) localStorage.removeItem(entryKey(row.id))
      writeIndex([])
      return index.length
    }
    const toDelete = index.filter(r => matches(r, q))
    const keep = index.filter(r => !matches(r, q))
    for (const row of toDelete) localStorage.removeItem(entryKey(row.id))
    writeIndex(keep)
    return toDelete.length
  }

  async exportAll(): Promise<PromptLogEntry[]> {
    return this.query({})
  }
}
