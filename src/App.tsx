import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GalleryPage } from './pages/GalleryPage'
import { RecordingPage } from './pages/RecordingPage'
import { RunDetailPage } from './pages/RunDetailPage'
import { ShapeEditorPage } from './pages/ShapeEditorPage'
import { RunChatPage } from './pages/RunChatPage'
import { CharacterSmokePage } from './pages/CharacterSmokePage'
import { PromptLogPage } from './pages/PromptLogPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { TransitionOverlay } from './components/transition/TransitionOverlay'
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

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/record" element={<RecordingPage />} />
        <Route path="/run/:id" element={<RunDetailPage />} />
        <Route path="/run/:id/chat" element={<RunChatPage />} />
        <Route path="/shape-editor" element={<ShapeEditorPage />} />
        <Route path="/character-smoke" element={<CharacterSmokePage />} />
        <Route path="/prompt-logs" element={<PromptLogPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TransitionOverlay />
    </BrowserRouter>
  )
}

export default App
