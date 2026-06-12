import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GalleryPage } from './pages/GalleryPage'
import { RecordingPage } from './pages/RecordingPage'
import { RunDetailPage } from './pages/RunDetailPage'
import { RunResultPage } from './pages/RunResultPage'
import { RunChatPage } from './pages/RunChatPage'
import { NotationChatPage } from './pages/NotationChatPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { InvitePage } from './pages/InvitePage'
import { CreditsPage } from './pages/CreditsPage'
import { SpotifyCallbackPage } from './pages/SpotifyCallbackPage'
import { useSpotifyPlaybackPoller } from './hooks/useSpotifyPlayback'
import { useBpmSyncedBob } from './hooks/useBpmSyncedBob'
import { useSpotifyDeepLink } from './hooks/useSpotifyDeepLink'
import { TransitionOverlay } from './components/transition/TransitionOverlay'
import { LoadingScreen } from './components/ui/LoadingScreen'
import { PostRunLoadingScreen } from './components/transition/PostRunLoadingScreen'
import { CoRunLobby } from './components/corun/CoRunLobby'
import { CoRunInviteSheet } from './components/corun/CoRunInviteSheet'
import { InviteDeepLinkListener } from './components/friends/InviteDeepLinkListener'
import { ActivePaletteProvider } from './components/ui/ActivePaletteProvider'
import { useCoRunInviteListener } from './hooks/useCoRunInviteListener'
import { useApplyTheme } from './hooks/useApplyTheme'
import { useCharacterMemorySync } from './hooks/useCharacterMemorySync'
import { useEnsureUserDoc } from './hooks/useEnsureUserDoc'
import { useCurrentPosition } from './hooks/useCurrentPosition'
import { useBootStore, useBootReady } from './store/useBootStore'
import { useRunStore } from './store/useRunStore'
import { subscribeAuth } from './firebase/auth'
import { getMemoryStore, petampCharacter } from './character'
import './App.css'

// 開発専用ページ。import.meta.env.DEV は本番ビルドで false に畳み込まれるため、
// ページ本体もチャンクとして出力されない。
const devPages = import.meta.env.DEV
  ? {
      ShapeEditorPage: lazy(() => import('./pages/ShapeEditorPage').then(m => ({ default: m.ShapeEditorPage }))),
      JoystickEditorPage: lazy(() => import('./pages/JoystickEditorPage').then(m => ({ default: m.JoystickEditorPage }))),
      CharacterSmokePage: lazy(() => import('./pages/CharacterSmokePage').then(m => ({ default: m.CharacterSmokePage }))),
      PromptLogPage: lazy(() => import('./pages/PromptLogPage').then(m => ({ default: m.PromptLogPage }))),
      NamedPlacesDebugPage: lazy(() => import('./pages/NamedPlacesDebugPage').then(m => ({ default: m.NamedPlacesDebugPage }))),
    }
  : null

/**
 * ルート '/' のゲート。オンボーディング済か (semantic memory に fact.user_name があるか)
 * を確認してから GalleryPage を実マウントする。GalleryPage 内で gating すると
 * useMetaballSheet の effect が空 ref で空振りして以降復活しないので、ここで切る。
 */
function HomeRoute() {
  const [state, setState] = useState<'checking' | 'onboarding' | 'gallery'>('checking')
  useEffect(() => {
    let cancelled = false
    void getMemoryStore()
      .querySemantic({ characterId: petampCharacter.id, keyPrefix: 'fact.user_name' })
      .then(rows => {
        if (cancelled) return
        setState(rows.length > 0 ? 'gallery' : 'onboarding')
      })
    return () => {
      cancelled = true
    }
  }, [])
  if (state === 'checking') return <div className="page" />
  if (state === 'onboarding') return <Navigate to="/onboarding" replace />
  return <GalleryPage />
}

// ページ起動時の準備状況 (auth / geolocation / 初回データ取得) を BootStore に集約する。
// useBootReady() が true になった時点で LoadingScreen がアイリスアウトで閉じる。
// 8 秒のセーフティ: いずれかが応答しないまま残った場合も強制的に ready にして
// ローディングが永久に出続けるのを防ぐ。
const BOOT_TIMEOUT_MS = 8000

function useBootSignals(): void {
  const setAuthReady = useBootStore(s => s.setAuthReady)
  const setGeoReady = useBootStore(s => s.setGeoReady)
  const setDataReady = useBootStore(s => s.setDataReady)
  const position = useCurrentPosition()

  useEffect(() => {
    let first = true
    return subscribeAuth(() => {
      if (!first) return
      first = false
      setAuthReady()
    })
  }, [setAuthReady])

  useEffect(() => {
    if (position !== undefined) setGeoReady()
  }, [position, setGeoReady])

  useEffect(() => {
    const isDebug = new URLSearchParams(window.location.search).get('debug') === '1'
    void useRunStore.getState().loadRuns(isDebug).finally(() => setDataReady())
  }, [setDataReady])

  useEffect(() => {
    const t = window.setTimeout(() => {
      setAuthReady()
      setGeoReady()
      setDataReady()
    }, BOOT_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [setAuthReady, setGeoReady, setDataReady])
}

function App() {
  return (
    <ActivePaletteProvider>
      <AppContent />
    </ActivePaletteProvider>
  )
}

// useApplyTheme などパレットに依存するフックは ActivePaletteProvider 配下で
// 呼ぶ必要があるため、App 本体から切り出している。
function AppContent() {
  useApplyTheme()
  useEnsureUserDoc()
  useCharacterMemorySync()
  useBootSignals()
  useSpotifyPlaybackPoller()
  useBpmSyncedBob()
  useSpotifyDeepLink()
  useCoRunInviteListener()
  const bootReady = useBootReady()
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/record" element={<RecordingPage />} />
        <Route path="/run/:id" element={<RunDetailPage />} />
        <Route path="/run/:id/result" element={<RunResultPage />} />
        <Route path="/run/:id/chat" element={<RunChatPage />} />
        <Route path="/run/:id/notation" element={<NotationChatPage />} />
        {devPages && (
          <Route path="/shape-editor" element={<Suspense fallback={null}><devPages.ShapeEditorPage /></Suspense>} />
        )}
        {devPages && (
          <Route path="/joystick-editor" element={<Suspense fallback={null}><devPages.JoystickEditorPage /></Suspense>} />
        )}
        {devPages && (
          <Route path="/character-smoke" element={<Suspense fallback={null}><devPages.CharacterSmokePage /></Suspense>} />
        )}
        {devPages && (
          <Route path="/prompt-logs" element={<Suspense fallback={null}><devPages.PromptLogPage /></Suspense>} />
        )}
        {devPages && (
          <Route path="/named-places" element={<Suspense fallback={null}><devPages.NamedPlacesDebugPage /></Suspense>} />
        )}
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/invite/:uid" element={<InvitePage />} />
        <Route path="/credits" element={<CreditsPage />} />
        <Route path="/spotify-callback" element={<SpotifyCallbackPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InviteDeepLinkListener />
      <TransitionOverlay />
      <PostRunLoadingScreen />
      <CoRunLobby />
      <CoRunInviteSheet />
      <LoadingScreen ready={bootReady} />
    </BrowserRouter>
  )
}

export default App
