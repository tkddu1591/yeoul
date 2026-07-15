import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './ui/tokens.css'
import './ui/base.css'
import './app.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
