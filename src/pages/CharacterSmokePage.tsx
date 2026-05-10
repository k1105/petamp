import { useMemo, useState } from 'react'
import {
  GeminiClient,
  petampCharacter,
  type FewShotExample,
  type LLMMessage,
  type LLMReply,
} from '../character'

interface SmokeResult {
  reply: LLMReply
  model: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
}

function renderFewShot(example: FewShotExample): LLMMessage[] {
  return [
    { role: 'user', content: example.user },
    { role: 'assistant', content: JSON.stringify(example.assistant) },
  ]
}

export function CharacterSmokePage() {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined
  const client = useMemo(
    () => (apiKey ? new GeminiClient({ apiKey }) : null),
    [apiKey],
  )
  const [usePetamp, setUsePetamp] = useState(true)
  const [input, setInput] = useState('はじめまして。')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SmokeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const buildMessages = (): LLMMessage[] => {
    if (!usePetamp) {
      return [
        {
          role: 'system',
          content:
            'あなたは穏やかで観察力のあるランニング相棒キャラ。短く、親しみやすく返す。',
        },
        { role: 'user', content: input },
      ]
    }
    const messages: LLMMessage[] = [
      { role: 'system', content: petampCharacter.persona },
    ]
    for (const ex of petampCharacter.fewShot) {
      messages.push(...renderFewShot(ex))
    }
    messages.push({ role: 'user', content: input })
    return messages
  }

  const onRun = async () => {
    if (!client) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const r = await client.replyAsCharacter(buildMessages())
      setResult({
        reply: r.reply,
        model: r.meta.model,
        latencyMs: r.meta.finishedAt - r.meta.startedAt,
        inputTokens: r.meta.usage?.inputTokens,
        outputTokens: r.meta.usage?.outputTokens,
      })
    } catch (e) {
      setError(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h2 style={{ marginTop: 0 }}>Character Smoke Test</h2>
      <p style={{ fontSize: 13, color: '#666' }}>
        API key: {apiKey ? '✓ loaded' : '✗ missing (set VITE_GEMINI_API_KEY)'}
      </p>
      <label style={{ display: 'block', fontSize: 13, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={usePetamp}
          onChange={e => setUsePetamp(e.target.checked)}
        />{' '}
        ペタンプ persona + few-shot を使う
      </label>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        rows={3}
        style={{ width: '100%', fontSize: 14, padding: 8, boxSizing: 'border-box' }}
      />
      <button
        onClick={onRun}
        disabled={!client || running}
        style={{ marginTop: 8, padding: '8px 16px', fontSize: 14 }}
      >
        {running ? '送信中…' : 'Geminiに送る'}
      </button>

      {error && (
        <pre style={{
          marginTop: 16, padding: 12, background: '#fee', color: '#900',
          whiteSpace: 'pre-wrap', fontSize: 12, borderRadius: 4,
        }}>
          {error}
        </pre>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
            model: {result.model} / {result.latencyMs}ms
            {result.inputTokens !== undefined &&
              ` / in:${result.inputTokens} out:${result.outputTokens ?? '?'}`}
          </div>
          <div style={{ padding: 12, background: '#eef', borderRadius: 4, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#669' }}>thought</div>
            <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{result.reply.thought}</div>
          </div>
          <div style={{ padding: 12, background: '#efe', borderRadius: 4 }}>
            <div style={{ fontSize: 11, color: '#696' }}>say</div>
            <div style={{ fontSize: 16, whiteSpace: 'pre-wrap' }}>{result.reply.say}</div>
          </div>
        </div>
      )}
    </div>
  )
}
