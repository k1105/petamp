import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { GalleryPage } from './pages/GalleryPage'
import { RecordingPage } from './pages/RecordingPage'
import { RunDetailPage } from './pages/RunDetailPage'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GalleryPage />} />
        <Route path="/record" element={<RecordingPage />} />
        <Route path="/run/:id" element={<RunDetailPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
