/**
 * closeThread (サマライズ) で要求する構造化レスポンス。
 * - summary: ペタンプの日記 (短文)。
 * - nameProposal: 「忘れたくない」と思った場所への命名 (任意)。null や省略可。
 *
 * runSummary に segments[] が含まれる。命名するときは:
 * - segment 全体を指すなら target='segment', segmentIndex を入れる
 * - 1点を指すなら target='point', pointIdx を入れる (acceptedPoints の index)
 */
export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'ペタンプの日記。子供らしいことばで1〜3文。',
    },
    nameProposal: {
      type: 'object',
      nullable: true,
      description:
        'この対話の中で「忘れたくない」と強く思った場所があれば、ここに命名する。特に無ければ省略または null。会話の流れと観察に基づいて1個だけ。refinesPlaceId が入っていれば、既存の名前を新しい名前と描写で置き換える (refine)。',
      properties: {
        target: {
          type: 'string',
          enum: ['segment', 'point'],
          description: 'segment = 区間に、point = 1点に名前をつける。',
        },
        segmentIndex: {
          type: 'integer',
          description: 'target=segment のとき、0-based の segment index。',
        },
        pointIdx: {
          type: 'integer',
          description: 'target=point のとき、acceptedPoints の 0-based index。',
        },
        name: {
          type: 'string',
          description:
            '短く、子供らしいことば。ひらがな多め。例: 「いつものおりかえし」「つかれちゃうさか」「ふしぎなとこ」',
        },
        description: {
          type: 'string',
          description:
            'なぜこの名前にしたのか、どんな場所だと思ったかを1-2文、ペタンプ口調で。あとで読み返したときに思い出せる粒度で。例:「ユーザがここを坂で疲れると言っていた。高さがゆっくり上がっていた。」',
        },
        refinesPlaceId: {
          type: 'string',
          description:
            '近くの既存 NamedPlace を refine (置き換え) するときに、その id を入れる。会話の中で同じ場所を別のことばで言いたくなったときや、描写を更新したいときに使う。新規命名のときは省略 (または空文字)。',
        },
      },
      required: ['target', 'name', 'description'],
    },
  },
  required: ['summary'],
} as const

export interface SummaryStructured {
  summary: string
  nameProposal?: {
    target: 'segment' | 'point'
    segmentIndex?: number
    pointIdx?: number
    name: string
    description: string
    /** 既存 NamedPlace を置き換える (refine) なら、その id を入れる。 */
    refinesPlaceId?: string
  } | null
}

export function isSummaryStructured(v: unknown): v is SummaryStructured {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.summary !== 'string' || o.summary.trim() === '') return false
  if (o.nameProposal === undefined || o.nameProposal === null) return true
  if (typeof o.nameProposal !== 'object') return false
  const n = o.nameProposal as Record<string, unknown>
  if (n.target !== 'segment' && n.target !== 'point') return false
  if (typeof n.name !== 'string' || n.name.trim() === '') return false
  // description は必須にする (空文字は OK = 旧データ互換のため許容)。
  if (typeof n.description !== 'string') return false
  if (n.refinesPlaceId !== undefined && typeof n.refinesPlaceId !== 'string') return false
  if (n.target === 'segment') {
    if (typeof n.segmentIndex !== 'number') return false
  }
  if (n.target === 'point') {
    if (typeof n.pointIdx !== 'number') return false
  }
  return true
}
