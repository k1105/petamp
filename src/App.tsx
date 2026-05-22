import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GalleryPage } from './pages/GalleryPage'
import { RecordingPage } from './pages/RecordingPage'
import { RunDetailPage } from './pages/RunDetailPage'
import { RunResultPage } from './pages/RunResultPage'
import { ShapeEditorPage } from './pages/ShapeEditorPage'
import { RunChatPage } from './pages/RunChatPage'
import { NotationChatPage } from './pages/NotationChatPage'
import { CharacterSmokePage } from './pages/CharacterSmokePage'
import { PromptLogPage } from './pages/PromptLogPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { InvitePage } from './pages/InvitePage'
import { TransitionOverlay } from './components/transition/TransitionOverlay'
import { LoadingScreen } from './components/LoadingScreen'
import { useApplyTheme } from './hooks/useApplyTheme'
import { useCharacterMemorySync } from './hooks/useCharacterMemorySync'
import { useEnsureUserDoc } from './hooks/useEnsureUserDoc'
import { useCurrentPosition } from './hooks/useCurrentPosition'
import { useBootStore, useBootReady } from './store/useBootStore'
import { useRunStore } from './store/useRunStore'
import { subscribeAuth } from './firebase/auth'
import { getMemoryStore, petampCharacter } from './character'
import './App.css'

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
  useApplyTheme()
  useEnsureUserDoc()
  useCharacterMemorySync()
  useBootSignals()
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
        <Route path="/shape-editor" element={<ShapeEditorPage />} />
        <Route path="/character-smoke" element={<CharacterSmokePage />} />
        <Route path="/prompt-logs" element={<PromptLogPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/invite/:uid" element={<InvitePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TransitionOverlay />
      <LoadingScreen ready={bootReady} />
    </BrowserRouter>
  )
}

export default App
