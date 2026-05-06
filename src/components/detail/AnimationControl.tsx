import { Icon } from '@iconify/react'

interface AnimationControlProps {
  currentTime: number
  duration: number
  isPlaying: boolean
  onPlay: () => void
  onStop: () => void
  onSeek: (t: number) => void
  onReset: () => void
}

export function AnimationControl({
  currentTime, duration, isPlaying, onPlay, onStop, onSeek, onReset,
}: AnimationControlProps) {
  return (
    <div className="animation-control">
      <input
        type="range"
        min={0}
        max={duration}
        step={0.1}
        value={currentTime}
        onChange={e => onSeek(Number(e.target.value))}
        className="animation-seek"
      />
      <div className="animation-buttons">
        <button onClick={onReset} aria-label="リセット">
          <Icon icon="lucide:rotate-ccw" />
        </button>
        <button onClick={isPlaying ? onStop : onPlay} aria-label={isPlaying ? '一時停止' : '再生'}>
          <Icon icon={isPlaying ? 'lucide:pause' : 'lucide:play'} />
        </button>
      </div>
    </div>
  )
}
