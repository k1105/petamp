import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { setMemoryStoreFactory } from './character'
import { CompositeMemoryStore } from './firebase/compositeMemoryStore'
import App from './App.tsx'

// MemoryStore を IDB + Firestore のコンポジットに差し替える。
// thread/turn はローカル、episodic/semantic/relational/namedPlace は両方に書く。
setMemoryStoreFactory(() => new CompositeMemoryStore())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
