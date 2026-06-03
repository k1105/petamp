import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { Capacitor } from '@capacitor/core'
import type { CharacterId } from '../../character/domain/character'
import type { DialogueTurn, ThreadId, TurnId } from '../../character/domain/dialogue'
import type { PersistNameProposalResult } from '../../character/logs/promptLog'
import { isHiddenTriggerContent } from '../../utils/runChatPrompts'
import { submitReport } from '../../reports/reportStore'
import type { Report } from '../../reports/types'
import pkg from '../../../package.json'

interface Props {
  onClose: () => void
  uid: string
  characterId: CharacterId
  threadId: ThreadId | null
  turns: DialogueTurn[]
  /** このスレッドの命名永続化結果。対話が締まっていれば付く。Report に同梱する。 */
  naming?: PersistNameProposalResult | null
  locationPath: string
}

type Status = 'idle' | 'submitting' | 'submitted' | 'error'

// state は内部でしか持たない。開閉は親側でマウント/アンマウントすることでリセットされる。
export function ReportSheet({
  onClose,
  uid,
  characterId,
  threadId,
  turns,
  naming,
  locationPath,
}: Props) {
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Set<TurnId>>(() => new Set())
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 送信成功後の自動クローズ
  useEffect(() => {
    if (status !== 'submitted') return
    const t = window.setTimeout(() => onClose(), 1500)
    return () => window.clearTimeout(t)
  }, [status, onClose])

  // 隠しトリガ (opener など) は除外。表示順は時系列のまま。
  const visibleTurns = useMemo(
    () =>
      turns.filter(
        t => !(t.role === 'user' && isHiddenTriggerContent(t.content)),
      ),
    [turns],
  )

  const toggle = (id: TurnId) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canSubmit =
    status === 'idle' && message.trim().length > 0 && threadId != null

  const onSubmit = async () => {
    if (!canSubmit || threadId == null) return
    setStatus('submitting')
    setErrorMsg(null)
    const report: Report = {
      id: crypto.randomUUID(),
      uid,
      characterId,
      threadId,
      createdAt: Date.now(),
      message: message.trim(),
      selectedTurnIds: Array.from(selected),
      turns: visibleTurns,
      naming: naming ?? null,
      client: {
        userAgent: navigator.userAgent,
        appVersion: pkg.version,
        platform: Capacitor.isNativePlatform() ? 'capacitor' : 'web',
        locationPath,
      },
    }
    try {
      await submitReport(report)
      setStatus('submitted')
    } catch (e) {
      setStatus('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="report-backdrop" role="dialog" aria-modal="true">
      <div className="report-sheet">
        <header className="report-sheet-header">
          <h2 className="report-sheet-title">問題を報告</h2>
          <button
            type="button"
            className="report-sheet-close"
            onClick={onClose}
            aria-label="閉じる"
            disabled={status === 'submitting'}
          >
            <Icon icon="lucide:x" width={20} height={20} />
          </button>
        </header>

        {status === 'submitted' ? (
          <div className="report-sheet-done">ありがとうございました</div>
        ) : (
          <>
            <p className="report-sheet-hint">
              気になったペタンプの発言にチェックを入れて、内容を書いてください。
            </p>

            <div className="report-sheet-list">
              {visibleTurns.length === 0 && (
                <div className="report-sheet-empty">対話履歴がありません</div>
              )}
              {visibleTurns.map(turn => {
                const isPetamp = turn.role === 'character'
                const checked = selected.has(turn.id)
                return (
                  <label
                    key={turn.id}
                    className={[
                      'report-turn',
                      isPetamp ? 'report-turn-petamp' : 'report-turn-user',
                      checked ? 'is-checked' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {isPetamp ? (
                      <input
                        type="checkbox"
                        className="report-turn-check"
                        checked={checked}
                        onChange={() => toggle(turn.id)}
                        disabled={status === 'submitting'}
                      />
                    ) : (
                      <span className="report-turn-check report-turn-check-spacer" />
                    )}
                    <div className="report-turn-body">
                      <div className="report-turn-role">
                        {isPetamp ? 'ペタンプ' : 'わたし'}
                      </div>
                      <div className="report-turn-content">{turn.content}</div>
                    </div>
                  </label>
                )
              })}
            </div>

            <textarea
              className="report-sheet-textarea"
              placeholder="どんな問題がありましたか？"
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={4}
              disabled={status === 'submitting'}
            />

            {status === 'error' && (
              <div className="report-sheet-error">
                送信に失敗しました{errorMsg ? `: ${errorMsg}` : ''}
              </div>
            )}

            <div className="report-sheet-actions">
              <button
                type="button"
                className="report-sheet-btn report-sheet-btn-cancel"
                onClick={onClose}
                disabled={status === 'submitting'}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="report-sheet-btn report-sheet-btn-submit"
                onClick={() => void onSubmit()}
                disabled={!canSubmit}
              >
                {status === 'submitting' ? '送信中…' : '送信'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
