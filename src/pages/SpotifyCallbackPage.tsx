import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeCodeForTokens } from '../spotify/auth'
import { useSpotifyStore } from '../store/useSpotifyStore'

type Phase =
  | { kind: 'exchanging' }
  | { kind: 'success' }
  | { kind: 'error'; message: string }

// /spotify-callback — receives Spotify's OAuth redirect, exchanges code for
// tokens via PKCE, persists to store, then navigates home.
export function SpotifyCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const setAuth = useSpotifyStore((s) => s.setAuth)
  const [phase, setPhase] = useState<Phase>({ kind: 'exchanging' })
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const code = params.get('code')
    const state = params.get('state')
    const err = params.get('error')

    if (err) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase({ kind: 'error', message: `Spotify error: ${err}` })
      return
    }
    if (!code || !state) {
      setPhase({ kind: 'error', message: 'Missing code or state in callback URL' })
      return
    }

    exchangeCodeForTokens(code, state)
      .then((auth) => {
        setAuth(auth)
        setPhase({ kind: 'success' })
        // Small delay so user sees the success state before redirect.
        setTimeout(() => navigate('/', { replace: true }), 400)
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e)
        setPhase({ kind: 'error', message })
      })
  }, [params, navigate, setAuth])

  return (
    <div className="page credits-page">
      <div className="credits-container">
        <h1 className="credits-title">Spotify</h1>
        {phase.kind === 'exchanging' && <p className="credits-text">接続中…</p>}
        {phase.kind === 'success' && <p className="credits-text">接続しました。戻ります…</p>}
        {phase.kind === 'error' && (
          <>
            <p className="credits-text">接続に失敗しました。</p>
            <p className="credits-text" style={{ fontSize: 12, opacity: 0.7 }}>
              {phase.message}
            </p>
            <button
              className="settings-btn-secondary"
              onClick={() => navigate('/', { replace: true })}
              style={{ marginTop: 16 }}
            >
              戻る
            </button>
          </>
        )}
      </div>
    </div>
  )
}
