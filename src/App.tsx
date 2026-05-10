import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GalleryPage } from './pages/GalleryPage'
import { RecordingPage } from './pages/RecordingPage'
import { RunDetailPage } from './pages/RunDetailPage'
import { ShapeEditorPage } from './pages/ShapeEditorPage'
import { RunChatPage } from './pages/RunChatPage'
import { CharacterSmokePage } from './pages/CharacterSmokePage'
import { TransitionOverlay } from './components/transition/TransitionOverlay'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GalleryPage />} />
        <Route path="/record" element={<RecordingPage />} />
        <Route path="/run/:id" element={<RunDetailPage />} />
        <Route path="/run/:id/chat" element={<RunChatPage />} />
        <Route path="/shape-editor" element={<ShapeEditorPage />} />
        <Route path="/character-smoke" element={<CharacterSmokePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TransitionOverlay />
    </BrowserRouter>
  )
}

export default App
