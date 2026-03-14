import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext'
import { UpdatePrompt } from './components/UpdatePrompt'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
      <UpdatePrompt />
    </AuthProvider>
  </StrictMode>,
)
