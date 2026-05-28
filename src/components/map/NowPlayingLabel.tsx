import { useSpotifyStore } from '../../store/useSpotifyStore'

// 現在再生中の Spotify トラックを AreaLabel の下に小さく表示する。
// Spotify 未接続 / 再生中の曲なし / track ではない (=podcast 等) の場合は
// 何も描画しない。
export function NowPlayingLabel() {
  const auth = useSpotifyStore((s) => s.auth)
  const current = useSpotifyStore((s) => s.current)
  if (!auth || !current) return null
  const artists = current.artists.join(', ')
  return (
    <div className="now-playing-label" aria-live="polite">
      <span className="now-playing-title">{current.name}</span>
      {artists && <span className="now-playing-artist">{artists}</span>}
    </div>
  )
}
