import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, type URLOpenListenerEvent } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

// iOS の Universal Links (applinks: で登録した本番ドメインの /invite/* を踏む or
// QR をカメラで読む) は、AppDelegate の continue userActivity 経由で Capacitor App
// プラグインに届く。ここで /invite/:uid を拾って React Router に流し、ブラウザを
// 挟まず（＝アプリは既にサインイン済みのまま）招待画面へ遷移させる。
//
// 経路は2つある:
//   - アプリ起動中に踏んだ場合 → `appUrlOpen` リスナー
//   - アプリ未起動からコールド起動した場合 → `App.getLaunchUrl()`
// 招待リンクは未起動から踏まれることがあるので両方を見る。
//
// Spotify の deep link (useSpotifyDeepLink) も同じ appUrlOpen を購読するが、
// あちらは spotify-callback を含む URL だけ処理し、こちらは pathname が /invite/ で
// 始まる URL だけ処理するので互いに干渉しない。
//
// useNavigate を使うため <BrowserRouter> の内側にマウントすること。
export function InviteDeepLinkListener(): null {
  const navigate = useNavigate()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    // /invite/:uid を SPA 内ナビゲーションとして処理する。pathname が一致しなければ無視。
    const handleUrl = (rawUrl: string): void => {
      let url: URL
      try {
        url = new URL(rawUrl)
      } catch {
        return
      }
      if (!url.pathname.startsWith('/invite/')) return
      navigate(url.pathname + url.search)
    }

    // コールド起動時の launch URL を一度だけ拾う。
    void App.getLaunchUrl().then((res) => {
      if (res?.url) handleUrl(res.url)
    })

    const handle = App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      handleUrl(event.url)
    })

    return () => {
      void handle.then((h) => h.remove())
    }
  }, [navigate])

  return null
}
