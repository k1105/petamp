import { useEffect, useRef } from 'react'
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
  // useNavigate の identity はナビゲーションのたびに変わりうる。これを effect の依存に
  // 直接入れると、招待画面の「ホームへ」で location が変わるたび effect が貼り直され、
  // 下の getLaunchUrl が「起動時の /invite URL」を再消費してホームから invite へ
  // 引き戻してしまう。ref 経由で最新の navigate を参照し、effect はマウント時の一度だけ
  // 張る (getLaunchUrl もそこで一度だけ消費される)。
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

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
      navigateRef.current(url.pathname + url.search)
    }

    // コールド起動時の launch URL を一度だけ拾う。getLaunchUrl はセッション中ずっと同じ
    // URL を返し続けるので、effect が再実行されると再ナビゲーションの原因になる。
    void App.getLaunchUrl().then((res) => {
      if (res?.url) handleUrl(res.url)
    })

    const handle = App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      handleUrl(event.url)
    })

    return () => {
      void handle.then((h) => h.remove())
    }
  }, [])

  return null
}
