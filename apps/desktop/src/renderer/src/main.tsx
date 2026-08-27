import '@sun-typeface/suit/fonts/variable/woff2/SUIT-Variable.css'
import './ui/tokens.css'
import './ui/base.css'
import './layout.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
