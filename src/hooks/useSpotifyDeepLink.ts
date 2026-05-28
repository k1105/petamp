import { useEffect } from 'react'
import { App, type URLOpenListenerEvent } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { exchangeCodeForTokens } from '../spotify/auth'
import { useSpotifyStore } from '../store/useSpotifyStore'

// On Capacitor native (iOS), the Spotify OAuth redirect comes back through the
// app's custom URL scheme (com.rennur.petamp://spotify-callback?code=...&state=...).
// iOS routes that to the app via `appUrlOpen`. This hook listens for it,
// finishes the PKCE token exchange, dismisses the in-app Safari, and writes
// the auth tokens to the store. Web users hit the /spotify-callback route
// (see SpotifyCallbackPage) and never trigger this hook.
//
// Mount once near the app root (alongside useSpotifyPlaybackPoller).
export function useSpotifyDeepLink(): void {
  const setAuth = useSpotifyStore((s) => s.setAuth)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const handle = App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      void handleSpotifyCallback(event.url, setAuth)
    })

    return () => {
      void handle.then((h) => h.remove())
    }
  }, [setAuth])
}

async function handleSpotifyCallback(
  rawUrl: string,
  setAuth: (auth: ReturnType<typeof useSpotifyStore.getState>['auth']) => void,
): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    console.warn('[spotify-deep-link] invalid url', rawUrl)
    return
  }
  // We only care about our spotify-callback path. The Info.plist URL scheme
  // could in principle be reused for other future deep links; ignore those.
  if (!rawUrl.includes('spotify-callback')) return

  const err = url.searchParams.get('error')
  if (err) {
    console.warn('[spotify-deep-link] spotify returned error', err)
    await Browser.close().catch(() => {})
    return
  }
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    console.warn('[spotify-deep-link] missing code/state', rawUrl)
    await Browser.close().catch(() => {})
    return
  }

  try {
    const auth = await exchangeCodeForTokens(code, state)
    setAuth(auth)
  } catch (e) {
    console.warn('[spotify-deep-link] token exchange failed', e)
  } finally {
    // Dismiss the in-app Safari overlay that the Browser plugin opened.
    await Browser.close().catch(() => {})
  }
}
