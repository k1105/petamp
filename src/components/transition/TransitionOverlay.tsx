import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTransitionStore, type TransitionPhase } from '../../store/useTransitionStore'
import { EyesIcon } from '../gallery/EyesIcon'
import { IrisFrame } from './IrisFrame'

const PHASE_DURATION_MS: Record<TransitionPhase, number> = {
  idle: 0,
  expanding: 400,
  iris: 350,
  'iris-paused': 3000,
  'iris-finishing': 500,
  framed: 0,
  'run-expand': 400,
  'run-fade': 600,
  'run-settle': 400,
}

export function TransitionOverlay() {
  const phase = useTransitionStore(s => s.phase)
  const origin = useTransitionStore(s => s.origin)
  const areaName = useTransitionStore(s => s.areaName)
  const runId = useTransitionStore(s => s.runId)
  const setPhase = useTransitionStore(s => s.setPhase)
  const reset = useTransitionStore(s => s.reset)
  const navigate = useNavigate()

  useEffect(() => {
    if (phase === 'idle') return

    // Navigation hooks: mount the destination page at the moment its content
    // needs to start being visible behind the overlay.
    if (phase === 'iris') navigate('/record')
    if (phase === 'run-settle' && runId) navigate(`/run/${runId}`)

    // The frame rests on screen for the whole run; RecordingPage resets it on
    // unmount. No timer here, otherwise it would tear itself down.
    if (phase === 'framed') return

    const dur = PHASE_DURATION_MS[phase]
    const t = window.setTimeout(() => {
      switch (phase) {
        case 'expanding':       setPhase('iris'); break
        case 'iris':            setPhase('iris-paused'); break
        case 'iris-paused':     setPhase('iris-finishing'); break
        case 'iris-finishing':  setPhase('framed'); break
        case 'run-expand':      setPhase('run-fade'); break
        case 'run-fade':        setPhase('run-settle'); break
        case 'run-settle':      reset(); break
      }
    }, dur)
    return () => window.clearTimeout(t)
  }, [phase, runId, setPhase, reset, navigate])

  if (phase === 'idle') return null

  const style = origin
    ? ({
        '--origin-x': `${origin.x}px`,
        '--origin-y': `${origin.y}px`,
      } as React.CSSProperties)
    : undefined

  const isRunPhase = phase === 'run-expand' || phase === 'run-fade' || phase === 'run-settle'
  const isIrisPhase =
    phase === 'iris' || phase === 'iris-paused' || phase === 'iris-finishing' || phase === 'framed'

  return (
    <>
      <div className={`transition-overlay phase-${phase}`} style={style}>
        {/* SVG super-ellipse that paints the green frame and morphs the window
            from a true circle to a curved-sided super-ellipse. */}
        {isIrisPhase && <IrisFrame />}
        {(phase === 'iris-paused' || phase === 'iris-finishing') && areaName && (
          <div className="transition-area">{areaName}</div>
        )}
      </div>
      {/* Eye for the run-detail transition. Sibling so it isn't subject to the
          overlay's mask or fade-out — needs to remain visible while the
          overlay fades and the run-detail page comes in behind it. */}
      {isRunPhase && (
        <div className={`transition-eye phase-${phase}`} style={style}>
          <EyesIcon />
        </div>
      )}
    </>
  )
}
