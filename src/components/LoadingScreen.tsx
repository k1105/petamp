import { useEffect, useState } from 'react'
import { EyesIcon } from './gallery/EyesIcon'

const CLOSING_DURATION_MS = 1000

export function LoadingScreen({ ready }: { ready: boolean }) {
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!ready) return
    const t = window.setTimeout(() => setDone(true), CLOSING_DURATION_MS)
    return () => window.clearTimeout(t)
  }, [ready])

  if (done) return null

  const phase = ready ? 'closing' : 'loading'

  return (
    <div className={`loading-screen phase-${phase}`} aria-hidden={phase !== 'loading'}>
      <div className="loading-screen-inner">
        <div className="loading-screen-eyes">
          <EyesIcon />
        </div>
        <div className="loading-screen-text">loading...</div>
      </div>
    </div>
  )
}
