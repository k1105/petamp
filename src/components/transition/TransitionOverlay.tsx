import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTransitionStore } from '../../store/useTransitionStore'

const PHASE_DURATION_MS: Record<string, number> = {
  expanding: 400,
  iris: 350,
  'iris-paused': 3000,
  'iris-finishing': 500,
}

export function TransitionOverlay() {
  const phase = useTransitionStore(s => s.phase)
  const origin = useTransitionStore(s => s.origin)
  const areaName = useTransitionStore(s => s.areaName)
  const setPhase = useTransitionStore(s => s.setPhase)
  const reset = useTransitionStore(s => s.reset)
  const navigate = useNavigate()

  useEffect(() => {
    if (phase === 'idle') return

    // /record needs to be mounted by the time the iris hole starts revealing it.
    // Navigate at the moment we transition into 'iris'.
    if (phase === 'iris') {
      navigate('/record')
    }

    const dur = PHASE_DURATION_MS[phase] ?? 0
    const t = window.setTimeout(() => {
      if (phase === 'expanding') setPhase('iris')
      else if (phase === 'iris') setPhase('iris-paused')
      else if (phase === 'iris-paused') setPhase('iris-finishing')
      else if (phase === 'iris-finishing') reset()
    }, dur)
    return () => window.clearTimeout(t)
  }, [phase, setPhase, reset, navigate])

  if (phase === 'idle') return null

  const style = origin
    ? ({
        '--origin-x': `${origin.x}px`,
        '--origin-y': `${origin.y}px`,
      } as React.CSSProperties)
    : undefined

  return (
    <div className={`transition-overlay phase-${phase}`} style={style}>
      {(phase === 'iris-paused' || phase === 'iris-finishing') && areaName && (
        <div className="transition-area">{areaName}</div>
      )}
    </div>
  )
}
