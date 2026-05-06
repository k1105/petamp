interface RecordButtonProps {
  isRecording: boolean
  onStart: () => void
  onStop: () => void
}

export function RecordButton({ isRecording, onStart, onStop }: RecordButtonProps) {
  return (
    <button
      onClick={isRecording ? onStop : onStart}
      className={`record-button ${isRecording ? 'recording' : ''}`}
    >
      {isRecording ? '停止' : '記録開始'}
    </button>
  )
}
