import { Icon } from '@iconify/react'

interface AnimationControlProps {
  currentTime: number
  duration: number
  isPlaying: boolean
  onPlay: () => void
  onStop: () => void
  onSeek: (t: number) => void
}

export function AnimationControl({
  currentTime, duration, isPlaying, onPlay, onStop, onSeek,
}: AnimationControlProps) {
  return (
    <div className="animation-control">
      <button
        className="animation-play-btn"
        onClick={isPlaying ? onStop : onPlay}
        aria-label={isPlaying ? '一時停止' : '再生'}
      >
        <Icon icon={isPlaying ? 'lucide:pause' : 'lucide:play'} />
      </button>
      <input
        type="range"
        min={0}
        max={duration}
        step={0.1}
        value={currentTime}
        onChange={e => onSeek(Number(e.target.value))}
        className="animation-seek"
      />
    </div>
  )
}
