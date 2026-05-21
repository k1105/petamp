/**
 * キャラ返答 (replyAsCharacter) で要求する JSON schema。
 * Gemini の responseJsonSchema にそのまま渡す形式。
 */
export const REPLY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    thought: {
      type: 'string',
      description: 'キャラの内的独白。ユーザには表示しない。素直に書く。',
    },
    say: {
      type: 'string',
      description: 'キャラがユーザに向けて実際に発する一言。「seg N」「セグメント」などのメタなラベルは絶対に含めない。場所は「ここ」「あそこ」などの指示語で。',
    },
    topic: {
      type: 'object',
      description: '発話が指す軌跡上の場所。ビジュアル側でハイライトされる。1ターンに1箇所。',
      properties: {
        kind: {
          type: 'string',
          enum: ['whole', 'segment', 'point'],
          description: '"whole" = ラン全体 / "segment" = 特定区間 / "point" = 軌跡上の特定の1点',
        },
        segmentIndex: {
          type: 'integer',
          description: 'kind=segment のとき、0-basedのセグメントindex。',
        },
        pointIdx: {
          type: 'integer',
          description: 'kind=point のとき、軌跡点列の0-based index。指したい場所が「ある一点」のときに使う。',
        },
      },
      required: ['kind'],
    },
  },
  required: ['thought', 'say', 'topic'],
} as const
