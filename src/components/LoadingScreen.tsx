import { useEffect, useState } from 'react'
import { LoadingEyesBubble } from './LoadingEyesBubble'

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
      <LoadingEyesBubble text="loading..." />
    </div>
  )
}
