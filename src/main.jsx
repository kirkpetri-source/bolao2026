import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import RankingPublico from './RankingPublico.jsx'
import './index.css'

// Detectar rota pública /ranking/:roundId sem react-router
const pathname = window.location.pathname;
const rankingMatch = pathname.match(/^\/ranking\/([^/?#]+)/);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {rankingMatch
      ? <RankingPublico roundId={rankingMatch[1]} />
      : <App />
    }
  </React.StrictMode>,
)
