import { useCoRunStore } from '../../store/useCoRunStore'

/** 録画中に表示する「〇〇さんと一緒に移動中」ステータスバナー (GPS は同期しない)。 */
export function CoRunBanner() {
  const session = useCoRunStore(s => s.session)
  const myUid = useCoRunStore(s => s.myUid)
  if (!session) return null

  const names = session.memberUids
    .filter(uid => uid !== myUid)
    .map(uid => session.members[uid])
    .filter(m => !!m && m.state !== 'declined' && m.state !== 'left')
    .map(m => m.displayName || '匿名ランナー')
  if (names.length === 0) return null

  const label =
    names.length === 1
      ? `${names[0]}さんと一緒に移動中`
      : `${names[0]}さん他${names.length - 1}人と一緒に移動中`

  return (
    <div className="co-run-banner">
      <span className="co-run-banner-dot" />
      {label}
    </div>
  )
}
