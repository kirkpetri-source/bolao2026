import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Trophy, Users, Calendar, Clock, TrendingUp, LogOut, Eye, EyeOff, Plus, Edit2, Trash2, Upload, ExternalLink, X, UserPlus, Target, Award, ChevronDown, ChevronUp, Check, Key, DollarSign, CheckCircle, XCircle, AlertCircle, FileText, Download, Store, Filter, Loader2, Megaphone, Send, Search, Bell, Copy, RefreshCcw, History, Moon, Sun } from 'lucide-react';
import { collection, addDoc, updateDoc, deleteDoc, doc, setDoc, getDocs, getDoc, onSnapshot, serverTimestamp, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from './firebase.js';
import { useApp } from './AppContext.js';
import { RulesCard, DarkToggle } from './components/shared.jsx';
import { generateCartelaCode, fmtBRL, sortMatchesByDate, MATCH_FINISH_AFTER_MS, MATCH_IN_PROGRESS_STATUSES, isMatchEffectivelyFinished, getSafeLogo, markdownToHtml } from './utils/helpers.js';
import { isMatchPostponed, resumoDaRodada, matchCountsForScoring, isMatchSettled, isMatchManual, jogosManuaisPendentes } from '../api/_shared/matchStatus.js';
import { calcPoints } from '../api/_shared/scoring.js';
import { CampoSenha } from './components/CampoSenha.jsx';
import { validaSenha, MIN_SENHA } from '../api/_shared/senha.js';
import { changeMyPassword, authErrorMessage } from './authService.js';
import { isBlocked } from '../api/_shared/subscription.js';

const UserPanel = ({ setView }) => {
  const { currentUser, setCurrentUser, logout, teams, rounds, predictions, users, establishments, addPrediction, settings, deleteCartelaPredictions, updateUser, tenantId } = useApp();
  const [activeTab, setActiveTab] = useState('predictions');

  const nomeDoBolao = (settings?.brandName || '').trim() || 'Bolão';

  // Situação da assinatura do bolão. O participante não tem nada a ver com a
  // mensalidade do organizador — mas precisa saber que não adianta palpitar.
  const [bolaoBloqueado, setBolaoBloqueado] = useState(false);
  const [mostrarIndisponivel, setMostrarIndisponivel] = useState(false);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'tenants', tenantId));
        if (vivo && snap.exists()) setBolaoBloqueado(isBlocked(snap.data().subscription));
      } catch { /* sem acesso: segue liberado e a regra do banco decide */ }
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  // WhatsApp do organizador, para o participante falar com quem pode resolver.
  const contatoDoOrganizador = (users.find(u => u.isAdmin)?.whatsapp || '').replace(/\D/g, '');

  // Confirmação de entrada. Com vários bolões na mesma plataforma, um link
  // errado levava a pessoa a se cadastrar e palpitar no bolão de outra sem
  // perceber. Aparece uma vez por sessão, e só para participante.
  const chaveConfirmacao = `bolao-confirmado:${currentUser?.id}:${tenantId}`;
  const [confirmado, setConfirmado] = useState(() => {
    try { return sessionStorage.getItem(chaveConfirmacao) === '1'; } catch { return true; }
  });
  const confirmarEntrada = () => {
    try { sessionStorage.setItem(chaveConfirmacao, '1'); } catch { /* sem sessionStorage: só não lembra */ }
    setConfirmado(true);
  };
  const [selectedRound, setSelectedRound] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingPredictions, setPendingPredictions] = useState(null);
  const [expandedRounds, setExpandedRounds] = useState({});
  const [selectedRankingRound, setSelectedRankingRound] = useState(null);
  const [editingPredictions, setEditingPredictions] = useState(null);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [cartelaDetails, setCartelaDetails] = useState(null);
  // Estados para a aba "Rodadas Finalizadas"
  const [selectedFinishedRound, setSelectedFinishedRound] = useState(null);
  const [finishedStartDate, setFinishedStartDate] = useState('');
  const [finishedEndDate, setFinishedEndDate] = useState('');
  const [finishedPeriod, setFinishedPeriod] = useState('all'); // all | 3m | 6m | 12m
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentContext, setPaymentContext] = useState(null);
  const [paymentLocks, setPaymentLocks] = useState({});
  const [showChangePassword, setShowChangePassword] = useState(false);

  // Deep-link para ranking: ?view=user&tab=ranking&round=<id>
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const tab = params.get('tab');
      const roundId = params.get('round');
      if (tab === 'ranking') setActiveTab('ranking');
      if (roundId) setSelectedRankingRound(roundId);
    } catch {}
  }, []);

  const toggleRound = (roundId) => {
    setExpandedRounds(prev => ({ ...prev, [roundId]: !prev[roundId] }));
  };

  // Helper local para fechar rodada por horário, compartilhando a mesma regra do Admin
  const isRoundTimedClosed = (round) => {
    if (!round?.closeAt) return false;
    const ts = new Date(round.closeAt).getTime();
    return !isNaN(ts) && Date.now() >= ts;
  };

  // Helper local de formatação de data/hora (pt-BR)
  const formatDateTime = (value) => {
    if (!value) return null;
    const dt = new Date(value);
    if (isNaN(dt.getTime())) return null;
    return dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  };

  const openRounds = rounds.filter(r => r.status === 'open' && !isRoundTimedClosed(r));
  const closedRounds = rounds.filter(r => r.status === 'closed' || (r.status === 'open' && isRoundTimedClosed(r))).sort((a, b) => b.number - a.number);
  const finishedRounds = rounds.filter(r => r.status === 'finished').sort((a, b) => b.number - a.number);
  const rankableRounds = rounds
    .filter(r => r.status === 'finished' || r.status === 'closed')
    .sort((a, b) => (b.number || 0) - (a.number || 0));
  const upcomingRounds = rounds.filter(r => r.status === 'upcoming').sort((a, b) => a.number - b.number);
  const openRoundsForBetting = rounds
    .filter(r => r.status === 'open' && !isRoundTimedClosed(r))
    .sort((a, b) => a.number - b.number);
  const upcomingRoundsForView = rounds
    .filter(r => r.status === 'upcoming')
    .sort((a, b) => a.number - b.number);

  // Rodadas fechadas com pelo menos um jogo com placar disponível (em andamento ou finalizado)
  const closedRoundsActive = closedRounds.filter(r =>
    r.matches?.some(m => m.homeScore !== null && m.awayScore !== null)
  );

  // Minhas rodadas: apenas as que o usuário está participando
  const myRoundIds = new Set(
    predictions
      .filter(p => p.userId === currentUser.id)
      .map(p => p.roundId)
  );
  const myOpenOrUpcomingRounds = rounds
    .filter(r => myRoundIds.has(r.id) && (r.status === 'open' || r.status === 'upcoming') && !isRoundTimedClosed(r))
    .sort((a, b) => a.number - b.number);
  const myClosedRounds = rounds
    .filter(r => myRoundIds.has(r.id) && (r.status === 'closed' || (r.status === 'open' && isRoundTimedClosed(r))))
    .sort((a, b) => b.number - a.number);
  const myFinishedRounds = rounds
    .filter(r => myRoundIds.has(r.id) && r.status === 'finished')
    .sort((a, b) => b.number - a.number);

  useEffect(() => {
    if (rankableRounds.length > 0) {
      const latestRound = rankableRounds[0];
      if (selectedRankingRound !== latestRound.id) {
        setSelectedRankingRound(latestRound.id);
      }
    }
  }, [rankableRounds]);

  const getRoundPredictions = (roundId) => {
    return predictions.filter(p => p.userId === currentUser.id && p.roundId === roundId);
  };

  const getUserCartelasForRound = (roundId) => {
    const userPreds = predictions.filter(p => p.userId === currentUser.id && p.roundId === roundId);
    const cartelaMap = {};
    
    userPreds.forEach(pred => {
      const code = pred.cartelaCode || 'ANTIGA';
      if (!cartelaMap[code]) {
        cartelaMap[code] = {
          code,
          predictions: [],
          paid: pred.paid || false,
          establishmentId: pred.establishmentId
        };
      }
      cartelaMap[code].predictions.push(pred);
    });
    
    return Object.values(cartelaMap);
  };

  // Abrir detalhes da cartela a partir de uma linha do ranking
  const openRankingCartelaDetails = (roundId, item) => {
    const round = rounds.find(r => r.id === roundId);
    if (!round) return;
    const preds = predictions.filter(p => p.userId === item.user.id && p.roundId === roundId && (p.cartelaCode || 'ANTIGA') === item.cartelaCode);
    if (preds.length === 0) return;
    const cartela = {
      code: item.cartelaCode,
      predictions: preds,
      establishmentId: preds[0]?.establishmentId || null,
      paid: preds[0]?.paid || false
    };
    setCartelaDetails({ round, cartela });
  };

  const calculateRoundPoints = (roundId) => {
    const round = rounds.find(r => r.id === roundId);
    if (!round) return null;
    const canScore = round.status === 'finished' || round.status === 'closed' || isRoundTimedClosed(round);
    if (!canScore) return null;
    
    const cartelas = getUserCartelasForRound(roundId);
    const cartelaPoints = {};
    
    cartelas.forEach(cartela => {
      if (!cartela.paid) {
        cartelaPoints[cartela.code] = 0;
        return;
      }
      
      // Conta assim que o placar existe — NÃO espera o campo `finished` da
      // fonte. Era essa a causa do ranking parado: a mesma tela mostrava
      // "Final: 1x1" (isMatchEffectivelyFinished) e somava zero ponto, porque a
      // TheSportsDB tinha mandado o placar sem virar o status para encerrado.
      // O painel do organizador já contava assim; só o participante ficava para
      // trás, o que fazia os dois verem rankings diferentes.
      let points = 0;
      round.matches?.forEach(match => {
        const pred = cartela.predictions.find(p => p.matchId === match.id);
        if (!pred || !matchCountsForScoring(match)) return;
        points += calcPoints(pred.homeScore, pred.awayScore, match.homeScore, match.awayScore);
      });
      cartelaPoints[cartela.code] = points;
    });
    
    return cartelaPoints;
  };

  const handleStartPrediction = (round) => {
    // Barra ANTES de abrir o formulário. Antes o participante montava a cartela
    // inteira e só levava a recusa no "confirmar" — trabalho perdido e a
    // impressão de que o erro foi dele.
    if (bolaoBloqueado) {
      setMostrarIndisponivel(true);
      return;
    }
    // Bloqueio automático por fechamento programado
    if (isRoundTimedClosed(round)) {
      alert('Rodada fechada para palpites pelo cronograma definido.');
      return;
    }
    setSelectedRound(round);
  };

  const handleDeleteCartela = async (roundId, cartelaCode) => {
    const confirmed = window.confirm('Excluir palpites desta cartela pendente? Esta ação não pode ser desfeita.');
    if (!confirmed) return;
    try {
      await deleteCartelaPredictions(currentUser.id, roundId, cartelaCode);
    } catch (err) {
      alert('Erro ao excluir cartela: ' + err.message);
    }
  };



  const RoundAccordion = ({ round }) => {
    const isExpanded = expandedRounds[round.id];
    const userCartelas = getUserCartelasForRound(round.id);
    const hasPredictions = userCartelas.length > 0;
    const points = calculateRoundPoints(round.id);
    const timedClosed = isRoundTimedClosed(round);
    const isOpenOrUpcoming = round.status === 'open' || round.status === 'upcoming';
    const canPredictNoExisting = round.status === 'open' && !timedClosed && !hasPredictions;
    const isUpcomingViewOnly = round.status === 'upcoming' && !hasPredictions;
    const isTimedClosedOpenOrUpcoming = isOpenOrUpcoming && timedClosed;
    const totalMatches = round.matches?.length || 0;
    const finishedMatchesCount = round.matches?.filter(m => m.finished && m.homeScore !== null && m.awayScore !== null).length || 0;
    const hasAnyFinished = finishedMatchesCount > 0;
    const progressPercent = totalMatches ? Math.round((finishedMatchesCount / totalMatches) * 100) : 0;
    
    const getStatusInfo = () => {
      const effStatus = (round.status === 'open' && timedClosed) ? 'closed' : round.status;
      switch (effStatus) {
        case 'upcoming':
          return { text: 'Futura', color: 'bg-gray-100 text-gray-700', icon: '🔜' };
        case 'open':
          return { text: hasPredictions ? 'Palpites Feitos' : 'Aberta', color: hasPredictions ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700', icon: hasPredictions ? '✅' : '⏰' };
        case 'closed':
          return { text: 'Aguardando', color: 'bg-yellow-100 text-yellow-700', icon: '🔒' };
        case 'finished':
          return { text: 'Finalizada', color: 'bg-purple-100 text-purple-700', icon: '🏁' };
        default:
          return { text: 'Status', color: 'bg-gray-100 text-gray-700', icon: '❓' };
      }
    };

    const status = getStatusInfo();
    const totalPoints = points ? Object.values(points).reduce((a, b) => a + b, 0) : 0;

    return (
      <div className="rounded-xl shadow-sm border overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--txt-1)' }}>
        <button
          onClick={() => toggleRound(round.id)}
          className="w-full p-6 flex items-center justify-between transition"
          style={{ backgroundColor: 'transparent', color: 'inherit' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-raised)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-xl ${status.color}`}>
              {round.number}
            </div>
            <div className="text-left">
              <h3 className="text-lg font-bold" style={{ color: 'var(--txt-1)' }}>{round.name}</h3>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.color}`}>
                  {status.icon} {status.text}
                </span>
                {round.closeAt && (
                  <span className="bg-gray-100 text-gray-700 px-3 py-1 rounded-full text-xs font-medium">
                    Fecha: {formatDateTime(round.closeAt) || round.closeAt}
                  </span>
                )}
                {hasPredictions && (
                  <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-medium">
                    {userCartelas.length} cartela(s)
                  </span>
                )}
                {((round.status === 'finished') || ((round.status === 'closed' || timedClosed) && hasAnyFinished)) && (
                  <span className="bg-green-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                    {totalPoints} pontos total
                  </span>
                )}
                {(round.status === 'closed' || timedClosed) && hasAnyFinished && (
                  <span className="bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full text-xs font-medium">
                    Parcial
                  </span>
                )}
                {(round.status === 'finished' || round.status === 'closed' || timedClosed) && totalMatches > 0 && (
                  <span className="flex items-center gap-2 ml-2">
                    <span className="w-28 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <span className="block h-2 bg-green-600" style={{ width: `${progressPercent}%` }} />
                    </span>
                    <span className="text-xs" style={{ color: 'var(--txt-3)' }}>{finishedMatchesCount}/{totalMatches}</span>
                  </span>
                )}
                {canPredictNoExisting && (
                  <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-medium">
                    Sem palpites
                  </span>
                )}
                {isTimedClosedOpenOrUpcoming && (
                  <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-xs font-medium">
                    Fechada automaticamente
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--txt-3)' }}>{(() => { const r = resumoDaRodada(round.matches || []); return r.adiados ? `${r.valendo} jogos (${r.adiados} adiado${r.adiados > 1 ? 's' : ''})` : `${r.total} jogos`; })()}</span>
            {isExpanded ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
          </div>
        </button>

        {isExpanded && (
          <div className="border-t p-6" style={{ backgroundColor: 'var(--bg-raised)' }}>
            {/* Jogo manual não recebe placar automático. Sem este aviso, o
                participante vê a rodada encerrada, o ranking parado e conclui
                que o sistema falhou — quando na verdade falta o organizador
                lançar um resultado que só ele tem. */}
            {jogosManuaisPendentes(round.matches || []).length > 0 && (
              <div className="mb-5 rounded-xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-500/10 p-4">
                <p className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
                  {jogosManuaisPendentes(round.matches || []).length === 1
                    ? 'Um jogo desta rodada aguarda o organizador'
                    : `${jogosManuaisPendentes(round.matches || []).length} jogos desta rodada aguardam o organizador`}
                </p>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  São jogos lançados manualmente, que não têm placar automático. O
                  ranking final desta rodada sai quando o organizador informar esses
                  resultados.
                </p>
              </div>
            )}

            {canPredictNoExisting && (
              <div className="text-center py-8">
                <Target className="mx-auto text-orange-500 mb-3" size={48} />
                <p className="text-gray-800 font-bold mb-2">Você ainda não fez seus palpites!</p>
                <button
                  onClick={() => handleStartPrediction(round)}
                  className="mt-4 bg-green-600 text-white px-6 py-2 rounded-lg font-semibold"
                >
                  Fazer Palpites Agora
                </button>
              </div>
            )}
            {isUpcomingViewOnly && (
              <div className="text-center py-8">
                <Clock className="mx-auto text-gray-400 mb-3" size={48} />
                <p className="text-gray-700 font-medium">Esta rodada ainda não está aberta para palpites.</p>
                <p className="text-gray-500 text-sm mt-1">Confira os jogos abaixo e aguarde a abertura oficial.</p>
              </div>
            )}
            {isTimedClosedOpenOrUpcoming && (
              <div className="text-center py-8">
                <AlertCircle className="mx-auto text-yellow-600 mb-3" size={48} />
                <p className="text-gray-800 font-bold">Rodada fechada automaticamente para palpites.</p>
                {round.closeAt && (
                  <p className="text-gray-600 text-sm mt-1">Fechada em {formatDateTime(round.closeAt) || round.closeAt}</p>
                )}
              </div>
            )}

            {hasPredictions && (
              <div className="space-y-6">
                {userCartelas.map((cartela, cartelaIndex) => {
                  const est = establishments.find(e => e.id === cartela.establishmentId);
                  const cartelaPoints = points ? points[cartela.code] || 0 : 0;
                  
                  return (
                    <div key={cartela.code} className="bg-white rounded-lg border-2 border-blue-200 overflow-hidden">
                      <div className="bg-blue-50 p-4 border-b border-blue-200">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <p className="font-mono text-lg font-bold text-blue-700">🎫 {cartela.code}</p>
                            {est && (
                              <p className="text-xs text-orange-600 flex items-center gap-1 mt-1">
                                <Store size={12} /> {est.name}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${cartela.paid ? 'bg-green-600 text-white' : 'bg-orange-100 text-orange-700'}`}>
                              {cartela.paid ? '💰 Pago' : '⚠️ Pendente'}
                            </span>
                            {((round.status === 'finished') || ((round.status === 'closed' || timedClosed) && hasAnyFinished)) && (
                              <span className="bg-green-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                                {cartelaPoints} pontos
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-4 space-y-3">
                        {[...(round.matches || [])].sort(sortMatchesByDate).map((match) => {
                          const homeTeam = teams.find(t => t.id === match.homeTeamId);
                          const awayTeam = teams.find(t => t.id === match.awayTeamId);
                          const pred = cartela.predictions.find(p => p.matchId === match.id);

                          let matchPoints = null;
                          const matchIsLive = !isMatchEffectivelyFinished(match) && match.homeScore !== null && match.awayScore !== null;
                          if ((round.status === 'finished' || round.status === 'closed' || timedClosed) && match.homeScore !== null && match.awayScore !== null && pred && cartela.paid) {
                            if (pred.homeScore === match.homeScore && pred.awayScore === match.awayScore) {
                              matchPoints = 3;
                            } else {
                              const predResult = pred.homeScore > pred.awayScore ? 'home' : pred.homeScore < pred.awayScore ? 'away' : 'draw';
                              const matchResult = match.homeScore > match.awayScore ? 'home' : match.homeScore < match.awayScore ? 'away' : 'draw';
                              if (predResult === matchResult) {
                                matchPoints = 1;
                              } else {
                                matchPoints = 0;
                              }
                            }
                          }

                          return (
                            <div key={match.id} className="bg-gray-50 rounded-lg p-3 border">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <img src={getSafeLogo(homeTeam)} alt={homeTeam?.name || ''} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={24} height={24} />
                                    <span className="font-medium text-xs truncate">{homeTeam?.name}</span>
                                  </div>
                                  <span className="text-gray-400 font-bold text-xs px-1 flex-shrink-0">VS</span>
                                  <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                                    <span className="font-medium text-xs truncate">{awayTeam?.name}</span>
                                    <img src={getSafeLogo(awayTeam)} alt={awayTeam?.name || ''} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={24} height={24} />
                                  </div>
                                </div>
                                
                                {pred && (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-xs text-gray-500">Palpite:</span>
                                    <div className="flex items-center gap-2">
                                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded font-bold text-sm">{pred.homeScore}</span>
                                      <span className="text-gray-400 font-bold text-xs">X</span>
                                      <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded font-bold text-sm">{pred.awayScore}</span>
                                    </div>
                                  </div>
                                )}
                                
                                {match.homeScore !== null && match.awayScore !== null && (
                                  <div className="flex items-center justify-center gap-2">
                                    <span className="text-xs text-gray-500 flex items-center gap-1">
                                      {isMatchEffectivelyFinished(match) ? 'Final:' : <><span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse inline-block" />Parcial:</>}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <span className={`px-2 py-1 rounded font-bold text-sm text-white ${isMatchEffectivelyFinished(match) ? 'bg-green-600' : 'bg-red-500'}`}>{match.homeScore}</span>
                                      <span className="text-gray-400 font-bold text-xs">X</span>
                                      <span className={`px-2 py-1 rounded font-bold text-sm text-white ${isMatchEffectivelyFinished(match) ? 'bg-green-600' : 'bg-red-500'}`}>{match.awayScore}</span>
                                    </div>
                                  </div>
                                )}

                                {matchPoints !== null && (
                                  <div className="flex justify-center items-center gap-1.5 pt-2">
                                    {matchPoints === 3 && <span className={`text-white px-2 py-1 rounded-full text-xs font-bold ${matchIsLive ? 'bg-orange-500' : 'bg-green-600'}`}>{matchIsLive ? '~' : '+'}3</span>}
                                    {matchPoints === 1 && <span className={`text-white px-2 py-1 rounded-full text-xs font-bold ${matchIsLive ? 'bg-orange-400' : 'bg-blue-600'}`}>{matchIsLive ? '~' : '+'}1</span>}
                                    {matchPoints === 0 && <span className="bg-red-100 text-red-700 px-2 py-1 rounded-full text-xs font-bold">0</span>}
                                    {matchIsLive && matchPoints !== null && <span className="text-xs text-orange-500 font-medium">parcial</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      
                      {round.status === 'finished' && !cartela.paid && (
                        <div className="p-3 bg-orange-50 border-t border-orange-200">
                          <p className="text-xs text-orange-700 font-medium text-center">
                            ⚠️ Pagamento pendente - Pontos não computados
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {(() => {
                  const pendingCartelas = userCartelas.filter(c => !c.paid);
                  const pendingCodes = pendingCartelas.map(c => c.code);
                  const totalAmount = (settings?.betValue || 15) * pendingCartelas.length;
                  if (pendingCartelas.length === 0) return null;
                  return (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" aria-live="polite">
                      <div className="flex items-center gap-2">
                        <DollarSign className="text-blue-600" size={20} />
                        <p className="text-sm text-blue-800">
                          Você tem {pendingCartelas.length} participação(ões) pendentes nesta rodada.
                        </p>
                      </div>
                      <button
                        onClick={() => openPaymentForRound(round, pendingCodes, totalAmount)}
                        disabled={!!paymentLocks[round.id]}
                        className={`px-4 py-2 rounded-lg font-semibold focus:outline-none focus:ring-2 ${paymentLocks[round.id] ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-400'}`}
                        aria-label={`Gerar pagamento de ${fmtBRL(totalAmount)} para ${pendingCartelas.length} participação(ões)`}
                      >
                        {paymentLocks[round.id] ? 'Processando...' : `Gerar Pagamento • ${fmtBRL(totalAmount)}`}
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const openPaymentForRound = (round, cartelaCodes, amount) => {
    if (paymentLocks[round.id]) return;
    setPaymentLocks(prev => ({ ...prev, [round.id]: true }));
    setPaymentContext({ roundId: round.id, roundName: round.name, cartelaCodes, amount });
    setPaymentModalOpen(true);
  };

  const PredictionForm = ({ round, initialPredictions = null }) => {
    const [localPreds, setLocalPreds] = useState({});
    const [cartelaCode] = useState(generateCartelaCode());
    const timedClosed = isRoundTimedClosed(round);
    // Adiado nao entra no formulario nem na cartela: nao vai acontecer e nao
    // pontua para ninguem, entao pedir palpite seria so frustracao.
    const jogosAdiados = (round?.matches || []).filter(isMatchPostponed);
    const jogosValendo = (round?.matches || []).filter(m => !isMatchPostponed(m));
    
    useEffect(() => {
      if (initialPredictions) {
        const predsObj = {};
        initialPredictions.forEach(pred => {
          predsObj[pred.match.id] = {
            home: pred.homeScore,
            away: pred.awayScore
          };
        });
        setLocalPreds(predsObj);
      }
    }, [initialPredictions]);

    const handleSubmit = () => {
      if (timedClosed) {
        alert('Rodada fechada para palpites pelo cronograma definido.');
        return;
      }
      if (!Array.isArray(round.matches) || round.matches.length === 0) {
        alert('Rodada sem jogos configurados. Aguarde o administrador adicionar os confrontos.');
        return;
      }
      const allPreds = round.matches.filter(m => !isMatchPostponed(m)).map(match => ({
        match,
        homeScore: localPreds[match.id]?.home !== undefined ? parseInt(localPreds[match.id].home) : null,
        awayScore: localPreds[match.id]?.away !== undefined ? parseInt(localPreds[match.id].away) : null
      }));

      // Validar preenchimento e faixas válidas (apenas inteiros entre 0 e 20)
      const hasEmpty = allPreds.some(p => p.homeScore === null || p.awayScore === null);
      if (hasEmpty) {
        alert('Preencha todos os palpites!');
        return;
      }
      const invalidValues = allPreds.some(p => {
        const hs = p.homeScore; const as = p.awayScore;
        return !Number.isInteger(hs) || !Number.isInteger(as) || hs < 0 || as < 0 || hs > 20 || as > 20;
      });
      if (invalidValues) {
        alert('Insira pontuações válidas (0–20) inteiras em todos os jogos.');
        return;
      }

      setPendingPredictions({ round, predictions: allPreds, cartelaCode, establishmentId: currentUser.establishmentId || null });
      setShowConfirmModal(true);
    };

    const selectedEst = establishments.find(e => e.id === currentUser.establishmentId);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b sticky top-0 bg-white">
            <h3 className="text-2xl font-bold">{round.name}</h3>
            <div className="flex items-center gap-3 mt-2">
              <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-mono font-bold">
                🎫 {cartelaCode}
              </span>
              <span className="text-gray-600 text-sm">R$ {settings?.betValue?.toFixed(2) || '15,00'}</span>
              {selectedEst && (
                <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-1">
                  <Store size={14} /> {selectedEst.name}
                </span>
              )}
            </div>
          </div>
          <div className="p-6 space-y-4">
            {timedClosed && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg">
                🔒 Rodada fechada automaticamente {round.closeAt && (<span>em {formatDateTime(round.closeAt) || round.closeAt}</span>)}.
              </div>
            )}
            {/* Jogos adiados ficam de fora: pedir palpite para partida que nao
                vai acontecer so gera frustracao, e ela nao pontua para ninguem. */}
            {jogosAdiados.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 text-orange-800 px-4 py-3 rounded-lg text-sm">
                <strong>{jogosAdiados.length} jogo(s) adiado(s)</strong> nesta rodada e fora do palpite:
                {' '}{jogosAdiados.map(m => `${m.homeTeamName} x ${m.awayTeamName}`).join(', ')}.
                {' '}Sua cartela vale {jogosValendo.length} jogo(s).
              </div>
            )}
            {[...jogosValendo].sort(sortMatchesByDate).map((match) => {
              const homeTeam = teams.find(t => t.id === match.homeTeamId);
              const awayTeam = teams.find(t => t.id === match.awayTeamId);
              return (
                <div key={match.id} className="bg-gray-50 p-4 rounded-lg">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1">
                        <img src={getSafeLogo(homeTeam)} alt={homeTeam?.name || ''} className="w-8 h-8 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={32} height={32} />
                        <span className="font-medium text-sm truncate">{homeTeam?.name}</span>
                      </div>
                      <span className="text-gray-400 font-bold px-2">VS</span>
                      <div className="flex items-center gap-2 flex-1 justify-end">
                        <span className="font-medium text-sm truncate">{awayTeam?.name}</span>
                        <img src={getSafeLogo(awayTeam)} alt={awayTeam?.name || ''} className="w-8 h-8 object-contain rounded bg-white ring-1 ring-gray-200 flex-shrink-0" width={32} height={32} />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-center gap-3">
                      <input 
                        type="number" 
                        min="0" 
                        max="9" 
                        value={localPreds[match.id]?.home ?? ''} 
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val !== '' && (parseInt(val) < 0 || parseInt(val) > 9)) return;
                          setLocalPreds({ ...localPreds, [match.id]: { ...localPreds[match.id], home: val } });
                        }} 
                        disabled={timedClosed}
                        className="w-16 px-2 py-2 border rounded text-center font-bold" 
                      />
                      <span className="font-bold text-gray-400">X</span>
                      <input 
                        type="number" 
                        min="0" 
                        max="9" 
                        value={localPreds[match.id]?.away ?? ''} 
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val !== '' && (parseInt(val) < 0 || parseInt(val) > 9)) return;
                          setLocalPreds({ ...localPreds, [match.id]: { ...localPreds[match.id], away: val } });
                        }} 
                        disabled={timedClosed}
                        className="w-16 px-2 py-2 border rounded text-center font-bold" 
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="p-6 border-t flex gap-3 sticky bottom-0 bg-white">
            <button onClick={() => { setSelectedRound(null); setEditingPredictions(null); setPendingPredictions(null); }} className="px-6 py-2 border rounded-lg">Cancelar</button>
            <button onClick={handleSubmit} disabled={timedClosed} className={`px-6 py-2 rounded-lg ${timedClosed ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : 'bg-green-600 text-white'}`}>Confirmar</button>
          </div>
        </div>
      </div>
    );
  };

  const ConfirmModal = ({ round, predictionsData, cartelaCode, establishmentId, onConfirm, onCancel }) => {
    const handleRevisar = () => {
      setEditingPredictions(predictionsData);
      setShowConfirmModal(false);
    };

    const selectedEst = establishments.find(e => e.id === establishmentId);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-t-2xl">
            <div className="flex items-center gap-3">
              <Award size={32} />
              <div>
                <h3 className="text-2xl font-bold">Confirmar Palpites</h3>
                <p className="text-yellow-100">{round.name}</p>
                <p className="text-yellow-100 font-mono text-sm mt-1">🎫 {cartelaCode}</p>
                {selectedEst && (
                  <p className="text-yellow-100 text-sm mt-1 flex items-center gap-1">
                    <Store size={14} /> {selectedEst.name}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <div className="bg-red-500 text-white p-2 rounded-full"><X size={20} /></div>
                <div>
                  <h4 className="font-bold text-red-900 text-lg mb-2">⚠️ Atenção!</h4>
                  <p className="text-red-800 font-medium">Após confirmar, você <span className="underline">NÃO PODERÁ MAIS</span> alterar!</p>
                  <p className="text-red-700 text-sm mt-2">💰 Lembre-se de efetuar o pagamento de R$ {Number(settings?.betValue ?? 15).toFixed(2).replace('.', ',')} para validar seus pontos.</p>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 mb-6 max-h-60 overflow-y-auto">
              <h4 className="font-semibold mb-3">Seus palpites:</h4>
              <div className="space-y-2">
                {[...(round?.matches || [])].sort(sortMatchesByDate).map((match) => {
                  const pred = predictionsData.find(p => p.match?.id === match.id);
                  if (!pred) return null;
                  const homeTeam = teams.find(t => t.id === match.homeTeamId);
                  const awayTeam = teams.find(t => t.id === match.awayTeamId);
                  return (
                    <div key={match.id} className="flex items-center justify-between bg-white p-3 rounded-lg border">
                      <div className="flex items-center gap-2 text-sm">
                        <img src={getSafeLogo(homeTeam)} alt={homeTeam?.name || ''} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200" width={24} height={24} />
                        <span className="font-medium">{homeTeam?.name}</span>
                      </div>
                      <div className="flex items-center gap-2 font-bold text-green-600">
                        <span className="bg-green-100 px-3 py-1 rounded">{pred.homeScore}</span>
                        <span className="text-gray-400">X</span>
                        <span className="bg-green-100 px-3 py-1 rounded">{pred.awayScore}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <img src={getSafeLogo(awayTeam)} alt={awayTeam?.name || ''} className="w-6 h-6 object-contain rounded bg-white ring-1 ring-gray-200" width={24} height={24} />
                        <span className="font-medium">{awayTeam?.name}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
              <div className="flex justify-between">
                <span className="text-green-800 font-medium">Valor:</span>
                <span className="text-2xl font-bold text-green-600">R$ {settings?.betValue?.toFixed(2) || '15,00'}</span>
              </div>
            </div>
          </div>
          <div className="p-6 border-t flex gap-3">
            <button onClick={handleRevisar} className="flex-1 px-6 py-3 border-2 rounded-lg font-semibold hover:bg-gray-50">Revisar Palpites</button>
            <button onClick={onConfirm} className="flex-1 px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg font-bold hover:from-green-700 hover:to-green-800">Confirmar Definitivo</button>
          </div>
        </div>
      </div>
    );
  };

  const CartelaDetailsModal = ({ round, cartela, onClose }) => {
    const { teams, establishments } = useApp();
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white w-[95%] max-w-3xl rounded-xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between p-4 border-b">
            <div>
              <h3 className="text-lg font-bold">Palpites do Participante</h3>
              <p className="text-sm text-gray-500">{round?.name}</p>
            </div>
            <button className="p-2 rounded hover:bg-gray-100" onClick={onClose} aria-label="Fechar">
              <X size={20} />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded">{cartela?.code}</span>
                {cartela?.establishmentId && (
                  <span className="inline-flex items-center gap-1 text-xs text-orange-600">
                    <Store size={12} /> {(establishments.find(e => e.id === cartela.establishmentId) || {}).name}
                  </span>
                )}
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg border overflow-x-auto">
              <table className="min-w-[420px] w-full text-xs sm:text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Jogo</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-600">Palpite</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-600">Placar Final</th>
                    <th className="px-3 py-2 text-center font-medium text-gray-600">Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[...(round?.matches || [])].sort(sortMatchesByDate).map((match) => {
                    const p = cartela?.predictions?.find(pr => pr.matchId === match.id);
                    if (!p) return null;
                    const homeTeam = teams.find(t => t.id === match.homeTeamId) || teams.find(t => t.name === match.homeTeam);
                    const awayTeam = teams.find(t => t.id === match.awayTeamId) || teams.find(t => t.name === match.awayTeam);

                    let pts = 0;
                    if (isMatchEffectivelyFinished(match) && match.homeScore !== null && match.awayScore !== null) {
                      if (p.homeScore === match.homeScore && p.awayScore === match.awayScore) {
                        pts = 3;
                      } else {
                        const predRes = p.homeScore > p.awayScore ? 'home' : p.homeScore < p.awayScore ? 'away' : 'draw';
                        const matchRes = match.homeScore > match.awayScore ? 'home' : match.homeScore < match.awayScore ? 'away' : 'draw';
                        if (predRes === matchRes) pts = 1;
                      }
                    }

                    return (
                      <tr key={match.id}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <img src={getSafeLogo(homeTeam)} alt={homeTeam?.name || ''} className="w-5 h-5 object-contain rounded bg-white ring-1 ring-gray-200" width={20} height={20} />
                            <span className="truncate max-w-[8rem]">{homeTeam?.name}</span>
                            <span className="text-gray-400 font-bold mx-2">X</span>
                            <span className="truncate max-w-[8rem]">{awayTeam?.name}</span>
                            <img src={getSafeLogo(awayTeam)} alt={awayTeam?.name || ''} className="w-5 h-5 object-contain rounded bg-white ring-1 ring-gray-200" width={20} height={20} />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center gap-2">
                            <span className="text-sm font-bold bg-gray-100 px-2 py-1 rounded">{p.homeScore}</span>
                            <span className="text-sm font-bold bg-gray-100 px-2 py-1 rounded">{p.awayScore}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isMatchEffectivelyFinished(match) ? (
                            <span className="text-xs text-gray-700">{match.homeScore} x {match.awayScore}</span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs font-bold px-2 py-1 rounded ${pts > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{pts}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-4 border-t">
            <button onClick={onClose} className="w-full px-4 py-2 border rounded-lg">Fechar</button>
          </div>
        </div>
      </div>
    );
  };

  const PaymentModal = ({ open, onClose, context, currentUser, onStart, onApproved, onError }) => {
    const { users, settings, predictions } = useApp();
    const [stage, setStage] = useState('collect'); // collect | creating | showing | expired | approved | error
    const [error, setError] = useState('');
    const [tx, setTx] = useState(null);
    const [copied, setCopied] = useState('');
    const [timeLeftMs, setTimeLeftMs] = useState(0);
    const [retryCount, setRetryCount] = useState(0);
    const [approvedAt, setApprovedAt] = useState(null);
    const [qrDataUrl, setQrDataUrl] = useState(null);
    const [payer, setPayer] = useState({
      name: currentUser?.name || '',
      email: currentUser?.email || '',
      cpf: '',
      pixKey: ''
    });
    const pollRef = useRef(null);
    const creatingRef = useRef(false);       // guarda contra chamadas concorrentes
    const approvedRef = useRef(false);       // bloqueia permanentemente após aprovação

    useEffect(() => {
      if (!open) return;
      if (approvedRef.current) return;         // pagamento já aprovado, nada a fazer
      if (stage === 'approved') return;
      if (stage !== 'collect') return;
      setError(''); setTx(null); setCopied('');
      try {
        const roundId = context?.roundId;
        const codes = Array.isArray(context?.cartelaCodes) ? context.cartelaCodes : [];
        const myPreds = predictions.filter(p => p.userId === currentUser?.id && p.roundId === roundId && (codes.length ? codes.includes(p.cartelaCode) : true));
        const anyPending = myPreds.length > 0 ? myPreds.some(p => !p.paid) : true;
        if (!anyPending) {
          approvedRef.current = true;
          setApprovedAt(new Date());
          setStage('approved');
        } else {
          setStage('collect');
        }
      } catch {
        setStage('collect');
      }
    }, [open, stage]);

    // Ao abrir, criar automaticamente as instruções e ir direto para a exibição
    useEffect(() => {
      if (!open) return;
      if (approvedRef.current) return;         // pagamento já aprovado, bloqueia
      if (stage !== 'collect') return;
      handleCreate();
    }, [open, stage]);

    // Monitora atualizações de pagamento no banco e muda para 'approved'
    useEffect(() => {
      if (!open) return;
      const roundId = context?.roundId;
      const codes = Array.isArray(context?.cartelaCodes) ? context.cartelaCodes : [];
      if (!roundId || !currentUser?.id) return;
      const myPreds = predictions.filter(p => p.userId === currentUser.id && p.roundId === roundId && (codes.length ? codes.includes(p.cartelaCode) : true));
      if (myPreds.length > 0 && myPreds.every(p => !!p.paid)) {
        approvedRef.current = true; // bloqueia permanentemente novos QR Codes
        setApprovedAt(new Date());
        setStage('approved');
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, [predictions, open, context?.roundId, context?.cartelaCodes, currentUser?.id]);

    useEffect(() => {
      if (!tx?.expiration) return;
      const update = () => {
        const remaining = Math.max(0, new Date(tx.expiration).getTime() - Date.now());
        setTimeLeftMs(remaining);
        if (remaining === 0 && !approvedRef.current) setStage(s => s === 'showing' ? 'expired' : s);
      };
      update();
      const id = setInterval(update, 1000);
      return () => clearInterval(id);
    }, [tx?.expiration]);

    useEffect(() => {
      if (!tx?.brCode) { setQrDataUrl(null); return; }
      import('qrcode').then(mod => {
        const QRCode = mod.default;
        QRCode.toDataURL(tx.brCode, { width: 192, margin: 2 })
          .then(url => setQrDataUrl(url))
          .catch(() => setQrDataUrl(null));
      }).catch(() => setQrDataUrl(null));
    }, [tx?.brCode]);

    const formatLeft = () => {
      const s = Math.floor(timeLeftMs / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      return h > 0
        ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
        : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    };

    const handleCreate = async () => {
      if (stage !== 'collect') return;
      if (creatingRef.current) return;   // impede chamadas simultâneas
      if (approvedRef.current) return;   // pagamento já aprovado, não cria novo
      creatingRef.current = true;
      try {
        setError(''); setStage('creating');
        try { if (typeof onStart === 'function') onStart(); } catch {}

        // wooviEnabled vem do public_config (usuário) ou é derivado do appId (admin).
        const wooviEnabled = settings?.wooviEnabled ?? !!settings?.woovi?.appId?.trim();
        const cartelaCode = Array.isArray(context?.cartelaCodes) ? context.cartelaCodes[0] : null;

        // Modo Woovi: gerar QR Code PIX automático
        if (wooviEnabled && cartelaCode) {
          // Sempre adiciona timestamp para garantir correlationID único no Woovi
          const correlationID = `${cartelaCode}_${Date.now()}`;
          const res = await fetch('/api/payments/woovi-charge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: currentUser?.id,
              roundId: context?.roundId,
              cartelaCode,
              amount: context?.amount,
              correlationID
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.details || data.error || 'Erro Woovi');
          setTx({ mode: 'woovi', qrCodeImage: data.qrCodeImage, brCode: data.brCode, expiration: data.expiresAt, value: data.value });
        } else {
          // Modo manual: mostrar chave PIX
          const pixKey = (settings?.payment?.pixKey ?? settings?.pixKey ?? '').trim() || 'CHAVE-PIX-MOCK-TESTE';
          setTx({ mode: 'manual', pixKey });
        }

        setStage('showing');
        try {
          await addDoc(collection(db, 'user_events'), {
            userId: currentUser?.id,
            type: 'pix_instructions_viewed',
            roundId: context?.roundId || null,
            amount: context?.amount || null,
            createdAt: serverTimestamp()
          });
        } catch {}
      } catch (e) {
        setError(e?.message || 'Falha ao preparar instruções PIX');
        setStage('error');
        try { if (typeof onError === 'function') onError(e); } catch {}
      } finally {
        creatingRef.current = false;
      }
    };

    const handleCopy = async () => {
      const key = (settings?.payment?.pixKey ?? settings?.pixKey ?? '').trim();
      if (!key) return;
      try {
        await navigator.clipboard.writeText(key);
        setCopied('copiado');
        setTimeout(() => setCopied(''), 1500);
        try {
          await addDoc(collection(db, 'user_events'), {
            userId: currentUser?.id,
            type: 'pix_key_copied',
            roundId: context?.roundId || null,
            amount: context?.amount || null,
            createdAt: serverTimestamp()
          });
        } catch {}
      } catch {
        setCopied('erro');
        setTimeout(() => setCopied(''), 1500);
      }
    };

    const closeModal = () => {
      if (pollRef.current) clearInterval(pollRef.current);
      onClose();
    };

    const formatDateTimeBR = (date) => {
      try {
        return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date);
      } catch {
        return (date || new Date()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      }
    };

    const normalizePhone = (s) => {
      const d = String(s || '').replace(/\D/g, '');
      return d.length > 11 ? d.slice(-11) : d; // DDD+numero
    };

    const handleCopyTxId = async () => {
      if (!tx?.id) return;
      try {
        await navigator.clipboard.writeText(tx.id);
        setCopied('copiado');
        setTimeout(() => setCopied(''), 1500);
      } catch {
        setCopied('erro');
        setTimeout(() => setCopied(''), 1500);
      }
    };

    // Sem cópia de mensagem para WhatsApp; apenas exibição de chave e nome do recebedor

    const supportHref = `mailto:?subject=Suporte%20Pagamento%20PIX&body=Descreva%20o%20problema%20e%20informe%20rodada,%20valor%20e%20participações.`;

    if (!open) return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label="Pagamento Checkout">
        <div className="bg-white rounded-xl w-[95%] sm:w-full max-w-xl max-h-[90vh] overflow-y-auto">
          <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
            <div className="flex items-center gap-2">
              <DollarSign className="text-green-600" size={22} />
              <h3 className="text-lg font-bold">Pagamento</h3>
            </div>
            <button onClick={closeModal} className="p-2 rounded hover:bg-gray-100" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>

          {stage === 'collect' && (
            <div className="p-6 text-center space-y-3">
              <Loader2 className="mx-auto animate-spin text-green-600" size={28} />
              <p className="text-sm text-gray-700">Carregando instruções do PIX...</p>
            </div>
          )}

          {stage === 'creating' && (
            <div className="p-6 text-center space-y-3">
              <Loader2 className="mx-auto animate-spin text-green-600" size={28} />
              <p className="text-sm text-gray-700">Preparando instruções...</p>
            </div>
          )}

          {stage === 'expired' && (
            <div className="p-8 text-center space-y-4">
              <Clock className="mx-auto text-orange-400" size={48} />
              <p className="text-gray-800 font-semibold text-lg">QR Code expirado</p>
              <p className="text-gray-500 text-sm">O tempo para pagar este PIX esgotou.<br/>Gere um novo QR Code para continuar.</p>
              <button
                onClick={() => { if (!approvedRef.current) { setTx(null); setTimeLeftMs(0); setRetryCount(r => r + 1); setStage('collect'); } }}
                className="bg-green-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-700"
              >
                Gerar novo QR Code
              </button>
            </div>
          )}

          {stage === 'showing' && tx && (
            <div className="p-4 space-y-4">
              <div className="text-center">
                <p className="text-xl font-bold text-green-700">{fmtBRL(context?.amount || tx?.value || 0)}</p>
              </div>

              {/* Modo Woovi: QR Code PIX */}
              {tx.mode === 'woovi' && (
                <div className="flex flex-col items-center gap-3">
                  {(qrDataUrl || tx.qrCodeImage) && (
                    <img src={qrDataUrl || tx.qrCodeImage} alt="QR Code PIX" className="w-48 h-48 border rounded-lg" />
                  )}
                  <p className="text-sm text-gray-600 text-center">Escaneie o QR Code ou copie o código PIX abaixo</p>
                  {tx.brCode && (
                    <div className="w-full">
                      <div className="flex gap-2">
                        <input readOnly value={tx.brCode} className="flex-1 px-3 py-2 border rounded-lg text-xs font-mono bg-gray-50" />
                        <button
                          onClick={async () => {
                            try { await navigator.clipboard.writeText(tx.brCode); setCopied('copiado'); setTimeout(() => setCopied(''), 1500); } catch { setCopied('erro'); setTimeout(() => setCopied(''), 1500); }
                          }}
                          className="px-3 py-2 bg-gray-800 text-white rounded text-sm"
                        >Copiar</button>
                      </div>
                      {copied === 'copiado' && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check size={12} />Código copiado!</p>}
                    </div>
                  )}
                  {tx.expiration && timeLeftMs > 0 && (
                    <p className="text-sm font-mono font-semibold text-orange-500">
                      ⏱ Expira em: {formatLeft()}
                    </p>
                  )}
                  <div className="w-full bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                    <p className="font-semibold mb-1">Como pagar:</p>
                    <p>1) Escaneie o QR Code ou copie o código PIX acima.</p>
                    <p>2) Abra seu banco e pague via PIX Copia e Cola.</p>
                    <p>3) Aguarde — a confirmação é automática! ✅</p>
                  </div>
                </div>
              )}

              {/* Modo manual: chave PIX */}
              {tx.mode !== 'woovi' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Chave PIX (administrador)</label>
                    <div className="flex gap-2">
                      <input readOnly value={settings?.payment?.pixKey ?? settings?.pixKey ?? ''} className="flex-1 px-3 py-2 border rounded-lg text-xs" />
                      <button onClick={handleCopy} className="px-3 py-2 bg-gray-800 text-white rounded text-sm">Copiar</button>
                    </div>
                    {copied === 'copiado' && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check size={12} />Chave copiada!</p>}
                    {(() => { const name = (settings?.payment?.pixRecipientName ?? settings?.pixRecipientName ?? '').trim(); return name ? <p className="text-xs text-gray-500 mt-1">Destinatário: {name}</p> : null; })()}
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p className="font-medium">Como pagar:</p>
                    <p>1) Abra seu banco e pague via PIX com a chave acima.</p>
                    <p>2) Confirme o destinatário e o valor.</p>
                    <p>3) Envie o comprovante ao administrador pelo WhatsApp.</p>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button onClick={closeModal} className="px-4 py-2 border rounded">Fechar</button>
              </div>
            </div>
          )}

          {stage === 'approved' && (
            <div className="p-6 space-y-4">
              <div className="text-center">
                <CheckCircle className="mx-auto text-green-600 animate-bounce" size={48} />
                <p className="mt-3 text-xl font-bold text-green-700">✅ Pagamento Confirmado!</p>
                <p className="text-sm text-gray-600 mt-1">Seus palpites estão válidos. Boa sorte! 🍀</p>
                <p className="text-xs text-gray-400 mt-2">Esta janela será fechada automaticamente...</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-green-700 font-medium">Valor pago</span>
                  <span className="text-green-800 font-bold">{fmtBRL(context?.amount || 0)}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-green-700 font-medium">Data/hora</span>
                  <span className="text-green-800">{formatDateTimeBR(approvedAt || new Date())}</span>
                </div>
              </div>
              <button onClick={closeModal} className="w-full px-4 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700">
                Fechar
              </button>
            </div>
          )}

          {stage === 'error' && (
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-2 text-red-700">
                <XCircle size={22} />
                <p className="font-semibold">Falha ao preparar instruções de pagamento</p>
              </div>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">{error}</div>}
              <div className="flex items-center gap-2">
                <button onClick={() => { if (!approvedRef.current) { setStage('collect'); setError(''); } }} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Tentar novamente</button>
                <a href={supportHref} className="px-4 py-2 border rounded" target="_blank" rel="noopener noreferrer">Suporte</a>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const confirmAndSave = async () => {
    if (!pendingPredictions) return;
    try {
      const { round, predictions: preds, cartelaCode, establishmentId } = pendingPredictions;
      // Checagem adicional antes de salvar
      if (isRoundTimedClosed(round)) {
        alert('Rodada fechada para palpites pelo cronograma definido.');
        return;
      }
      if (!Array.isArray(round.matches) || round.matches.length === 0) {
        alert('Rodada sem jogos configurados. Aguarde o administrador adicionar os confrontos.');
        return;
      }
      // Confere contra os jogos que VALEM, não contra a rodada inteira: os
      // adiados saem do formulário, então exigir todos deixava a cartela
      // impossível de enviar.
      const jogosExigidos = round.matches.filter(m => !isMatchPostponed(m));
      if (preds.length !== jogosExigidos.length) {
        alert('Palpites incompletos. Revise e preencha todos os jogos.');
        return;
      }
      const invalidValues = preds.some(p => {
        const hs = p.homeScore; const as = p.awayScore;
        return !Number.isInteger(hs) || !Number.isInteger(as) || hs < 0 || as < 0 || hs > 20 || as > 20;
      });
      if (invalidValues) {
        alert('Insira pontuações válidas (0–20) inteiras em todos os jogos.');
        return;
      }
      
      for (const pred of preds) {
        await addPrediction({
          userId: currentUser.id,
          roundId: round.id,
          matchId: pred.match.id,
          homeScore: pred.homeScore,
          awayScore: pred.awayScore,
          cartelaCode: cartelaCode,
          establishmentId: establishmentId || null,
          finalized: true
        });
      }
      
      // Enviar confirmação via WhatsApp automático (Evolution API, server-side)
      try {
        const settingsSnapshot = await getDocs(query(collection(db, 'settings'), where('tenantId', '==', tenantId)));
        const valorRodada = (settings?.betValue ?? 15).toFixed(2).replace('.', ',');
        let messageTemplate = `🏆 *BOLÃO BRASILEIRÃO 2026*\n\n📋 *{RODADA}*\n🎫 *Cartela: {CARTELA}*\n✅ Palpites registrados!\n\n{PALPITES}\n\n💰 *Valor: R$ {VALOR}*\n\n👉 Para ativar seus palpites, clique em *Efetuar Pagamento* na tela da rodada.\n\nBoa sorte! 🍀`;
        let evolutionCfg = null;

        if (!settingsSnapshot.empty) {
          const sd = settingsSnapshot.docs[0].data();
          if (sd.whatsappMessage) messageTemplate = sd.whatsappMessage;
          if (sd?.devolution?.link && sd?.devolution?.instanceName && sd?.devolution?.token) {
            evolutionCfg = { link: sd.devolution.link, instance: sd.devolution.instanceName, token: sd.devolution.token };
          }
        }

        // Montar texto dos palpites
        let palpitesText = '';
        preds.forEach((pred, i) => {
          const ht = teams.find(t => t.id === pred.match.homeTeamId);
          const at = teams.find(t => t.id === pred.match.awayTeamId);
          palpitesText += `${i + 1}. ${ht?.name || '?'} ${pred.homeScore} x ${pred.awayScore} ${at?.name || '?'}\n`;
        });

        // Substituir tags da mensagem
        let message = messageTemplate
          .replace('{RODADA}', round.name)
          .replace('{CARTELA}', cartelaCode)
          .replace('{PALPITES}', palpitesText.trim())
          .replace('{VALOR}', valorRodada);

        // Enviar via proxy serverless (sem abrir WhatsApp Web)
        if (evolutionCfg && currentUser.whatsapp) {
          let phone = currentUser.whatsapp.replace(/\D/g, '');
          if (!phone.startsWith('55')) phone = '55' + phone;
          fetch('/api/evolution/sendText', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: phone, text: message, ...evolutionCfg })
          }).catch(err => console.error('WhatsApp send error:', err));
        } else {
          console.warn('Evolution API não configurada; mensagem de confirmação não enviada.');
        }
      } catch (whatsappError) {
        console.error('Erro ao enviar WhatsApp de confirmação:', whatsappError);
      }

      setShowConfirmModal(false);
      setPendingPredictions(null);
      setSelectedRound(null);
      setEditingPredictions(null);

      // Abrir modal de pagamento automaticamente logo após a confirmação
      const betValue = settings?.betValue || 15;
      openPaymentForRound(round, [cartelaCode], betValue);

    } catch (error) {
      console.error('❌ Erro ao salvar palpites:', error);
      alert('Erro ao salvar palpites: ' + error.message);
    }
  };

  const calculateUserRoundPoints = (userId, roundId, cartelaCode = null) => {
    const round = rounds.find(r => r.id === roundId);
    if (!round || (round.status !== 'finished' && round.status !== 'closed')) return 0;
    
    if (cartelaCode) {
      const cartelaPreds = predictions.filter(p => 
        p.userId === userId && 
        p.roundId === roundId && 
        p.cartelaCode === cartelaCode
      );
      
      if (cartelaPreds.length === 0) return 0;
      const isPaid = cartelaPreds[0]?.paid;
      if (!isPaid) return 0;
      
      // Regra e escala vêm de api/_shared/scoring.js e matchStatus.js: painel,
      // participante, crons e página pública precisam somar igual.
      let points = 0;
      round.matches?.forEach(match => {
        const pred = cartelaPreds.find(p => p.matchId === match.id);
        if (!pred || !matchCountsForScoring(match)) return;
        points += calcPoints(pred.homeScore, pred.awayScore, match.homeScore, match.awayScore);
      });
      return points;
    }

    const userRoundPreds = predictions.filter(p => p.userId === userId && p.roundId === roundId);
    const cartelaCodes = [...new Set(userRoundPreds.map(p => p.cartelaCode || 'ANTIGA'))];

    return cartelaCodes.reduce((sum, code) => {
      return sum + calculateUserRoundPoints(userId, roundId, code);
    }, 0);
  };

  const getRankingForRound = (roundId) => {
    if (!roundId) return [];
    
    const rankingEntries = [];
    
    users.filter(u => !u.isAdmin).forEach(user => {
      const userRoundPreds = predictions.filter(p => p.userId === user.id && p.roundId === roundId);
      const cartelaCodes = [...new Set(userRoundPreds.map(p => p.cartelaCode || 'ANTIGA'))];
      
      cartelaCodes.forEach(cartelaCode => {
        const cartelaPreds = userRoundPreds.filter(p => (p.cartelaCode || 'ANTIGA') === cartelaCode);
        const isPaid = cartelaPreds.length > 0 && cartelaPreds[0]?.paid;
        
        if (!isPaid) return;
        
        const points = calculateUserRoundPoints(user.id, roundId, cartelaCode);
        
        rankingEntries.push({
          user,
          cartelaCode,
          establishmentId: cartelaPreds[0]?.establishmentId,
          points,
          predictions: cartelaPreds.length,
          isPaid: true
        });
      });
    });
    
    return rankingEntries.sort((a, b) => b.points - a.points);
  };

  const getRoundPrize = (roundId) => {
    const round = rounds.find(r => r.id === roundId);
    if (!round || round.status !== 'finished') return null;

    const betValue = settings?.betValue || 15;
    const ranking = getRankingForRound(roundId);
    if (ranking.length === 0) return null;

    const totalPaid = ranking.length * betValue;
    const prizePool = totalPaid * 0.85;
    const maxPoints = ranking[0].points;
    const winners = ranking.filter(r => r.points === maxPoints);
    const prizePerWinner = prizePool / winners.length;

    return {
      totalPaid,
      prizePool,
      winners,
      prizePerWinner
    };
  };

  const userPredictions = predictions.filter(p => p.userId === currentUser.id);
  const totalPoints = rounds
    .filter(r => r.status === 'finished')
    .reduce((sum, round) => {
      const cartelaPoints = calculateRoundPoints(round.id);
      if (cartelaPoints) {
        return sum + Object.values(cartelaPoints).reduce((a, b) => a + b, 0);
      }
      return sum;
    }, 0);
  
  // Cache do ranking para melhorar performance
  const ranking = useMemo(() => {
    return selectedRankingRound ? getRankingForRound(selectedRankingRound) : [];
  }, [selectedRankingRound, predictions, rounds, users]);
  
  const roundPrize = useMemo(() => {
    return selectedRankingRound ? getRoundPrize(selectedRankingRound) : null;
  }, [selectedRankingRound, settings]);

  // Utilitário de timestamp de rodada para ordenação/filtragem
  const roundToTimestamp = (r) => {
    if (r?.closeAt) {
      const t = new Date(r.closeAt).getTime();
      if (!isNaN(t)) return t;
    }
    const ca = r?.createdAt;
    if (ca && typeof ca.toDate === 'function') {
      return ca.toDate().getTime();
    }
    if (ca && typeof ca === 'object' && typeof ca.seconds === 'number') {
      return ca.seconds * 1000;
    }
    return typeof r?.number === 'number' ? r.number : 0;
  };

  // Lista de rodadas finalizadas com ordenação cronológica (mais recente primeiro)
  const finishedRoundsAll = useMemo(() => {
    return rounds
      .filter(r => r.status === 'finished')
      .sort((a, b) => (b.number || 0) - (a.number || 0));
  }, [rounds]);

  // Todas as rodadas finalizadas disponíveis para seleção
  const finishedRoundsBase = finishedRoundsAll;

  // Aplicar filtros por data/período
  const filteredFinishedRounds = useMemo(() => {
    const now = Date.now();
    const periodMs = {
      '3m': 1000 * 60 * 60 * 24 * 90,
      '6m': 1000 * 60 * 60 * 24 * 180,
      '12m': 1000 * 60 * 60 * 24 * 365,
      'all': null
    }[finishedPeriod] || null;

    const startTs = finishedStartDate ? new Date(finishedStartDate).getTime() : null;
    const endTs = finishedEndDate ? new Date(finishedEndDate).getTime() : null;
    const periodStart = periodMs ? now - periodMs : null;

    return finishedRoundsBase.filter(r => {
      const ts = roundToTimestamp(r);
      if (periodStart && ts < periodStart) return false;
      if (startTs && ts < startTs) return false;
      if (endTs && ts > endTs) return false;
      return true;
    });
  }, [finishedRoundsBase, finishedStartDate, finishedEndDate, finishedPeriod]);

  // Selecionar automaticamente a rodada mais recente do filtro ao entrar/alterar filtros
  useEffect(() => {
    if (activeTab === 'finished') {
      const latest = filteredFinishedRounds[0];
      if (latest && selectedFinishedRound !== latest.id) {
        setSelectedFinishedRound(latest.id);
      }
    }
  }, [activeTab, filteredFinishedRounds]);

  // Cache do ranking e prêmio para rodadas finalizadas
  const finishedRanking = useMemo(() => {
    return selectedFinishedRound ? getRankingForRound(selectedFinishedRound) : [];
  }, [selectedFinishedRound, predictions, rounds, users]);

  const finishedPrize = useMemo(() => {
    return selectedFinishedRound ? getRoundPrize(selectedFinishedRound) : null;
  }, [selectedFinishedRound, settings]);

  if (!confirmado) {
    return (
      <div className="min-h-screen page-bg font-body flex items-center justify-center p-5">
        <div className="bg-white rounded-2xl border shadow-modal max-w-md w-full p-7 text-center animate-slide-up">
          <div className="w-14 h-14 rounded-2xl bg-campo-600 flex items-center justify-center mx-auto mb-5">
            <Trophy size={26} className="text-ouro-500" />
          </div>
          <p className="text-noite-400 text-xs font-semibold uppercase mb-2" style={{ letterSpacing: '0.18em' }}>
            Você está entrando no bolão
          </p>
          <h1 className="font-display text-3xl text-noite-900 mb-4 break-words" style={{ letterSpacing: '0.02em' }}>
            {nomeDoBolao}
          </h1>
          <p className="text-sm text-noite-500 leading-relaxed mb-6">
            Confira se é o bolão em que você se cadastrou. Seus palpites e pagamentos
            valem só aqui dentro.
          </p>
          <button onClick={confirmarEntrada} className="v2-btn-primary w-full py-3 text-base mb-3">
            Sim, é este — entrar
          </button>
          <button
            onClick={() => { logout(); setView('login'); }}
            className="text-sm text-noite-400 hover:text-noite-700">
            Não é este bolão, sair
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen page-bg font-body">

      {/* Palpites indisponíveis. A mensagem não cita mensalidade nem dívida: o
          problema é entre o organizador e a plataforma, e expor isso ao
          participante constrangeria quem não tem nada a ver com a cobrança. */}
      {mostrarIndisponivel && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-modal animate-slide-up p-7 text-center">
            <div className="w-14 h-14 rounded-2xl bg-ouro-50 flex items-center justify-center mx-auto mb-4">
              <Clock size={26} className="text-ouro-600" />
            </div>
            <h3 className="font-display text-xl text-noite-900 mb-2" style={{ letterSpacing: '0.03em' }}>
              PALPITES INDISPONÍVEIS
            </h3>
            <p className="text-sm text-noite-500 leading-relaxed mb-5">
              O <strong>{nomeDoBolao}</strong> não está recebendo palpites no momento.
              Fale com o organizador para saber quando volta.
            </p>
            {contatoDoOrganizador && (
              <a
                href={`https://wa.me/${contatoDoOrganizador.startsWith('55') ? contatoDoOrganizador : '55' + contatoDoOrganizador}`}
                target="_blank" rel="noopener noreferrer"
                className="v2-btn-primary w-full py-3 text-sm mb-3">
                <Send size={16} /> Falar com o organizador
              </a>
            )}
            <button onClick={() => setMostrarIndisponivel(false)}
              className="text-sm text-noite-400 hover:text-noite-700">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ── Scoreboard header ── */}
      <div className="bg-campo-700 dark:bg-noite-900 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {/* Top row: brand + actions */}
          <div className="flex items-center justify-between py-3.5 border-b border-white/10 dark:border-white/8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-white/15 dark:bg-campo-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Trophy size={15} className="text-white dark:text-ouro-500" />
              </div>
              {/* Nome do bolão, não um título fixo: o participante precisa
                  saber o tempo todo em qual bolão ele está. */}
              <div className="min-w-0">
                <span className="block font-display text-white text-sm truncate" style={{ letterSpacing: '0.14em' }}>
                  {nomeDoBolao}
                </span>
                <span className="block text-white/50 text-[10px] font-medium" style={{ letterSpacing: '0.12em' }}>
                  BOLÃO BRASILEIRÃO 2026
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {openRounds.length > 0 && (
                <span className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white/15 border border-white/20 text-white dark:bg-campo-600/20 dark:border-campo-500/30 dark:text-campo-300">
                  <span className="w-1.5 h-1.5 bg-white dark:bg-campo-400 rounded-full animate-pulse-dot" />
                  {openRounds.length} aberta{openRounds.length > 1 ? 's' : ''}
                </span>
              )}
              <DarkToggle />
              <button onClick={() => setShowChangePassword(true)} className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm font-medium transition-colors duration-150">
                <Key size={15} /> <span className="hidden sm:inline">Senha</span>
              </button>
              <button onClick={() => { logout(); setView('login'); }} className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm font-medium transition-colors duration-150">
                <LogOut size={15} /> <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>
          {/* Name / scoreboard row */}
          <div className="py-5">
            <p className="text-white/55 dark:text-noite-600 text-xs font-semibold uppercase" style={{ letterSpacing: '0.22em' }}>Bem-vindo de volta</p>
            <h1 className="font-display text-white mt-1 leading-none" style={{ fontSize: 'clamp(32px, 5vw, 52px)', letterSpacing: '0.06em' }}>
              {currentUser.name.toUpperCase()}
            </h1>
          </div>
        </div>
      </div>

      {/* ── Tab navigation ── */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex overflow-x-auto pb-px scrollbar-hide">
            {['predictions', 'ranking', 'finished', 'history'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-shrink-0 relative py-3.5 px-4 sm:px-5 text-sm font-semibold whitespace-nowrap border-b-2 flex items-center gap-2 transition-all duration-200 ${
                activeTab === tab
                  ? 'border-campo-600 text-campo-700'
                  : 'border-transparent text-noite-400 hover:text-noite-700 hover:border-noite-200'
              }`}>
                {tab === 'predictions' && <><Target size={15} />Palpites</>}
                {tab === 'ranking' && <><TrendingUp size={15} />Ranking</>}
                {tab === 'finished' && <>
                  <Calendar size={15} />Finalizadas
                  {finishedRoundsBase.length > 0 && (
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${activeTab === tab ? 'bg-campo-100 text-campo-700' : 'bg-ouro-100 text-ouro-700'}`}>
                      {finishedRoundsBase.length}
                    </span>
                  )}
                </>}
                {tab === 'history' && <><History size={15} />Minhas Rodadas</>}
              </button>
            ))}
            <button onClick={() => setShowRulesModal(true)} className="ml-auto py-3.5 px-4 sm:px-5 text-sm font-medium whitespace-nowrap border-b-2 border-transparent text-noite-400 hover:text-noite-700 hover:border-noite-200 flex items-center gap-2 transition-all duration-200">
              <FileText size={15} />Regras
            </button>
          </div>
        </div>
      </div>

      {showRulesModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-modal animate-slide-up">
            <div className="p-6 border-b flex justify-between items-center">
              <div className="flex items-center gap-3">
                <FileText className="text-campo-600" size={24} />
                <h3 className="font-display text-2xl text-noite-900" style={{ letterSpacing: '0.04em' }}>REGRAS DO BOLÃO</h3>
              </div>
              <button onClick={() => setShowRulesModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
            </div>
            <div className="p-6"><RulesCard /></div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {activeTab === 'predictions' && bolaoBloqueado && (
          <div className="rounded-xl border-2 border-ouro-500 bg-ouro-50 dark:bg-ouro-500/10 p-4 mb-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="flex items-start gap-3">
              <Clock size={20} className="text-ouro-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-noite-900">Palpites indisponíveis no momento</p>
                <p className="text-sm text-noite-600">
                  O {nomeDoBolao} não está recebendo palpites. Fale com o organizador.
                </p>
              </div>
            </div>
            {contatoDoOrganizador && (
              <a
                href={`https://wa.me/${contatoDoOrganizador.startsWith('55') ? contatoDoOrganizador : '55' + contatoDoOrganizador}`}
                target="_blank" rel="noopener noreferrer"
                className="v2-btn-primary px-4 py-2.5 text-sm justify-center flex-shrink-0">
                <Send size={15} /> Falar com o organizador
              </a>
            )}
          </div>
        )}

        {activeTab === 'predictions' && (
          <div className="space-y-10">

            {/* — Rodadas Abertas — apostas permitidas */}
            <div>
              <h2 className="text-2xl font-bold mb-2">Rodadas Abertas</h2>
              <p className="text-gray-600 mb-6">Rodadas disponíveis para palpites agora • R$ {settings?.betValue?.toFixed(2) || '15,00'} por participação</p>
              {openRoundsForBetting.length === 0 ? (
                <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                  <Calendar className="mx-auto text-gray-400 mb-4" size={48} />
                  <h3 className="text-xl font-semibold mb-2">Nenhuma rodada aberta no momento</h3>
                  <p className="text-gray-500 text-sm">Confira as próximas rodadas abaixo.</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {openRoundsForBetting.map((round) => {
                    const userCartelas = getUserCartelasForRound(round.id);
                    return (
                      <div key={round.id} className="bg-white rounded-xl shadow-sm border p-6">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-xl font-bold">{round.name}</h3>
                              <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">✅ Aberta</span>
                            </div>
                            <p className="text-gray-600">{(() => { const r = resumoDaRodada(round.matches || []); return r.adiados ? `${r.valendo} jogos (${r.adiados} adiado${r.adiados > 1 ? 's' : ''})` : `${r.total} jogos`; })()} • R$ {settings?.betValue?.toFixed(2) || '15,00'} por participação</p>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                            <button
                              onClick={() => handleStartPrediction(round)}
                              className="w-full sm:w-auto justify-center flex items-center gap-2 bg-green-600 text-white px-4 sm:px-6 py-3 rounded-lg font-medium hover:bg-green-700"
                            >
                              <Plus size={20} />
                              Nova Participação
                            </button>
                            {(() => {
                              const pendingCartelas = (getUserCartelasForRound(round.id) || []).filter(c => !c.paid);
                              const pendingCodes = pendingCartelas.map(c => c.code);
                              const totalAmount = (settings?.betValue || 15) * pendingCartelas.length;
                              const disabled = pendingCartelas.length === 0 || !!paymentLocks[round.id] || !!paymentModalOpen;
                              return (
                                <button
                                  onClick={() => openPaymentForRound(round, pendingCodes, totalAmount)}
                                  disabled={disabled}
                                  className={`w-full sm:w-auto justify-center flex items-center gap-2 px-4 sm:px-6 py-3 rounded-lg font-semibold focus:outline-none focus:ring-2 ${disabled ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-400'}`}
                                  aria-label={`Efetuar pagamento da rodada ${round.name} no valor de ${fmtBRL(totalAmount)}`}
                                >
                                  <DollarSign size={20} />
                                  {paymentLocks[round.id] ? 'Processando...' : 'Efetuar Pagamento da Rodada'}
                                  {!disabled && <span> • {fmtBRL(totalAmount)}</span>}
                                </button>
                              );
                            })()}
                          </div>
                        </div>

                        {userCartelas.length > 0 && (
                          <div className="mt-4 pt-4 border-t">
                            <h4 className="text-sm font-semibold text-gray-700 mb-3">
                              Suas Participações ({userCartelas.length})
                            </h4>
                            <div className="grid gap-2">
                              {userCartelas.map((cartela, index) => {
                                const est = establishments.find(e => e.id === cartela.establishmentId);
                                return (
                                  <div key={cartela.code} className="bg-gray-50 p-3 rounded-lg flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm">
                                        {index + 1}
                                      </div>
                                      <div>
                                        <button
                                          onClick={() => setCartelaDetails({ round, cartela })}
                                          className="font-mono text-sm font-bold text-blue-700 hover:underline"
                                          title="Ver detalhes da cartela"
                                        >
                                          {cartela.code}
                                        </button>
                                        <div className="flex items-center gap-2">
                                          <p className="text-xs text-gray-600">{cartela.predictions.length} palpites</p>
                                          {est && (
                                            <span className="text-xs text-orange-600 flex items-center gap-1">
                                              <Store size={12} /> {est.name}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${cartela.paid ? 'bg-green-600 text-white' : 'bg-orange-100 text-orange-700'}`}>
                                        {cartela.paid ? '💰 Pago' : '⚠️ Pendente'}
                                      </span>
                                      {!cartela.paid && (
                                        <button
                                          onClick={() => handleDeleteCartela(round.id, cartela.code)}
                                          className="px-2 py-1 border rounded-lg text-xs text-red-700 hover:bg-red-50 flex items-center gap-1"
                                          title="Excluir cartela"
                                        >
                                          <Trash2 size={14} /> Excluir
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                              <p className="text-sm text-blue-800">
                                <strong>Total a pagar:</strong> R$ {(userCartelas.length * (settings?.betValue || 15)).toFixed(2)}
                                {userCartelas.filter(c => !c.paid).length > 0 && (
                                  <span className="ml-2 text-orange-700">
                                    • {userCartelas.filter(c => !c.paid).length} pendente(s)
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* — Jogos em Andamento — placar ao vivo para rodadas fechadas */}
            {closedRoundsActive.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold">Jogos em Andamento</h2>
                  <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-red-100 text-red-700">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    Ao Vivo
                  </span>
                </div>
                <p className="text-gray-500 text-sm mb-5">Placares atualizados automaticamente a cada 5 minutos</p>
                <div className="space-y-4">
                  {closedRoundsActive.map(round => {
                    const totalM = round.matches?.length || 0;
                    const doneM = round.matches?.filter(m => isMatchEffectivelyFinished(m)).length || 0;
                    const liveM = round.matches?.filter(m => !isMatchEffectivelyFinished(m) && m.homeScore !== null).length || 0;
                    return (
                      <div key={round.id} className="bg-white rounded-2xl shadow-sm border overflow-hidden">
                        {/* Header da rodada */}
                        <div className="flex items-center justify-between px-5 py-3.5 border-b bg-gray-50">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-gray-900">{round.name}</span>
                            {liveM > 0 && (
                              <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />{liveM} ao vivo
                              </span>
                            )}
                            {doneM > 0 && (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">{doneM} finalizado{doneM > 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400">{doneM}/{totalM} jogos</span>
                        </div>

                        {/* Lista de jogos */}
                        <div className="divide-y">
                          {[...(round.matches || [])].sort(sortMatchesByDate).map((match, idx) => {
                            const homeTeam = teams.find(t => t.id === match.homeTeamId);
                            const awayTeam = teams.find(t => t.id === match.awayTeamId);
                            const hasScore = match.homeScore !== null && match.awayScore !== null;
                            const isLive = hasScore && !isMatchEffectivelyFinished(match);
                            const isDone = hasScore && isMatchEffectivelyFinished(match);

                            return (
                              <div key={idx} className={`flex items-center px-5 py-3 gap-3 ${isLive ? 'bg-red-50/40' : ''}`}>
                                {/* Casa */}
                                <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                                  <span className="text-sm font-semibold text-gray-800 truncate text-right">{homeTeam?.name || match.homeTeamName}</span>
                                  <img src={getSafeLogo(homeTeam || { logo: match.homeTeamLogo, name: match.homeTeamName })} alt="" className="w-7 h-7 object-contain flex-shrink-0" />
                                </div>

                                {/* Placar central */}
                                <div className="flex-shrink-0 flex flex-col items-center w-24">
                                  {hasScore ? (
                                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-lg ${isDone ? 'bg-green-600 text-white' : 'bg-red-500 text-white'}`}>
                                      <span>{match.homeScore}</span>
                                      <span className="text-white/60 text-sm">–</span>
                                      <span>{match.awayScore}</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 text-gray-400 font-bold text-sm">
                                      <span>?</span><span>–</span><span>?</span>
                                    </div>
                                  )}
                                  <span className={`text-[10px] font-semibold mt-1 ${isDone ? 'text-green-600' : isLive ? 'text-red-500' : 'text-gray-400'}`}>
                                    {isDone ? '✅ FIM' : isLive ? '🔴 AO VIVO' : '⏰ EM BREVE'}
                                  </span>
                                </div>

                                {/* Visitante */}
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <img src={getSafeLogo(awayTeam || { logo: match.awayTeamLogo, name: match.awayTeamName })} alt="" className="w-7 h-7 object-contain flex-shrink-0" />
                                  <span className="text-sm font-semibold text-gray-800 truncate">{awayTeam?.name || match.awayTeamName}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* — Próximas Rodadas — somente visualização */}
            {upcomingRoundsForView.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold mb-2">Próximas Rodadas</h2>
                <p className="text-gray-600 mb-6">Confira os jogos. Os palpites serão liberados quando cada rodada for aberta.</p>
                <div className="grid gap-4">
                  {upcomingRoundsForView.map((round) => {
                    const firstMatchDate = round.matches
                      ?.map(m => m.date)
                      .filter(Boolean)
                      .sort()[0];
                    return (
                      <div key={round.id} className="bg-white rounded-xl shadow-sm border p-6 opacity-90">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-xl font-bold">{round.name}</h3>
                              <span className="bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-0.5 rounded-full">🔜 Em breve</span>
                            </div>
                            <p className="text-gray-500 text-sm">
                              {(() => { const r = resumoDaRodada(round.matches || []); return r.adiados ? `${r.valendo} jogos (${r.adiados} adiado${r.adiados > 1 ? 's' : ''})` : `${r.total} jogos`; })()}
                              {firstMatchDate && ` • Inicia em ${formatDateTime(firstMatchDate)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 text-gray-400">
                            <Clock size={20} />
                            <span className="text-sm font-medium">Aguardando abertura</span>
                          </div>
                        </div>

                        {round.matches?.length > 0 && (
                          <div className="mt-2 space-y-2">
                            {[...round.matches].sort(sortMatchesByDate).slice(0, 5).map((match, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2 text-sm text-gray-700">
                                <span className="font-medium w-2/5 text-right">{match.homeTeamName}</span>
                                <span className="text-gray-400 mx-3 font-bold">×</span>
                                <span className="font-medium w-2/5 text-left">{match.awayTeamName}</span>
                              </div>
                            ))}
                            {resumoDaRodada(round.matches || []).valendo > 5 && (
                              <p className="text-xs text-gray-400 text-center pt-1">
                                + {resumoDaRodada(round.matches || []).valendo - 5} jogo(s) a confirmar
                              </p>
                            )}
                          </div>
                        )}

                        <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-center">
                          <p className="text-sm text-gray-500">Palpites liberados quando a rodada for aberta pelo administrador</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}

        {activeTab === 'ranking' && (
          <div>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold">Ranking</h2>
                <p className="text-gray-600 mt-1">Classificação por rodada • Premiação: 85%</p>
              </div>
              <div className="w-64">
                <label className="block text-sm font-medium mb-2">Selecione a Rodada</label>
                <select
                  value={selectedRankingRound || ''}
                  onChange={(e) => setSelectedRankingRound(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-white"
                >
                  {rankableRounds.length === 0 && (
                    <option value="">Nenhuma rodada fechada ou finalizada</option>
                  )}
                  {rankableRounds.map(round => (
                    <option key={round.id} value={round.id}>
                      {round.name} {round.status === 'closed' ? '• Parcial' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!selectedRankingRound || rankableRounds.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                <Trophy className="mx-auto text-gray-400 mb-4" size={48} />
                <h3 className="text-xl font-semibold mb-2">Nenhuma rodada fechada ou finalizada</h3>
                <p className="text-gray-500">O ranking aparece para rodadas fechadas (parcial) e finalizadas (final)</p>
              </div>
            ) : (
              <div className="space-y-6">
                {roundPrize && roundPrize.winners.length > 0 && (
                  <div className="bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500 rounded-xl p-8 text-white">
                    <div className="flex items-center gap-3 mb-6">
                      <Trophy size={48} />
                      <div>
                        <h3 className="text-3xl font-bold">Premiação (85%)</h3>
                        <p className="text-yellow-100">
                          {roundPrize.winners.length > 1 ? `${roundPrize.winners.length} Vencedores (Empate)` : 'Campeão da Rodada'}
                        </p>
                      </div>
                    </div>

                    <div className="bg-white bg-opacity-20 rounded-xl p-6 mb-6">
                      <div className="text-center">
                        <p className="text-yellow-100 text-sm font-medium">PRÊMIO {roundPrize.winners.length > 1 ? 'POR VENCEDOR' : 'TOTAL'}</p>
                        <p className="text-5xl font-bold mt-2">R$ {roundPrize.prizePerWinner.toFixed(2)}</p>
                        <p className="text-yellow-100 text-sm mt-2">
                          Total arrecadado: R$ {roundPrize.totalPaid.toFixed(2)} | Premiação: R$ {roundPrize.prizePool.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {roundPrize.winners.map((winner) => {
                        const est = establishments.find(e => e.id === winner.establishmentId);
                        return (
                          <div key={`${winner.user.id}-${winner.cartelaCode}`} className="bg-white rounded-lg p-4 text-gray-900 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                              <Trophy className="text-yellow-500" size={32} />
                              <div>
                                <p className="font-bold text-xl">{winner.user.name}</p>
                                <p className="text-sm text-gray-600">{winner.user.whatsapp}</p>
                                <p className="text-xs text-blue-600 font-mono">🎫 {winner.cartelaCode}</p>
                                {est && (
                                  <p className="text-xs text-orange-600 flex items-center gap-1 mt-1">
                                    <Store size={12} /> {est.name}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-3xl font-bold text-green-600">{winner.points} pts</p>
                              <p className="text-lg font-bold text-green-700">+ R$ {roundPrize.prizePerWinner.toFixed(2)}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {roundPrize.winners.length > 1 && (
                      <div className="bg-white bg-opacity-20 rounded-xl p-4 text-center mt-4">
                        <p className="text-sm">⚠️ Empate detectado! Premiação dividida igualmente.</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                  <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="font-bold text-lg">
                        {rounds.find(r => r.id === selectedRankingRound)?.name}
                      </h3>
                      {(() => {
                        const selRound = rounds.find(r => r.id === selectedRankingRound);
                        const liveMatches = selRound?.matches?.filter(m => !m.finished && m.homeScore !== null) || [];
                        if (liveMatches.length > 0) {
                          return (
                            <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500 text-white">
                              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                              AO VIVO • atualiza a cada 5 min
                            </span>
                          );
                        }
                        if (selRound?.status === 'closed') {
                          return <span className="text-xs text-yellow-200 font-medium">Aguardando placares</span>;
                        }
                        return null;
                      })()}
                    </div>
                    <p className="text-sm text-green-100 mt-1">⚠️ Apenas palpites pagos • Pontos parciais incluem jogos em andamento</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[500px]">
                      <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">Posição</th>
                        <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">Participante</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Pontos</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Premiação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {ranking.map((item, index) => {
                        const isWinner = roundPrize && roundPrize.winners.some(w => w.user.id === item.user.id && w.cartelaCode === item.cartelaCode);
                        
                        // Calcular posição considerando empates
                        let position = 1;
                        let uniqueScores = [];
                        
                        // Coletar pontuações únicas maiores que a pontuação atual
                        for (let i = 0; i < ranking.length; i++) {
                          if (ranking[i].points > item.points && !uniqueScores.includes(ranking[i].points)) {
                            uniqueScores.push(ranking[i].points);
                          }
                        }
                        
                        // A posição é o número de pontuações únicas maiores + 1
                        position = uniqueScores.length + 1;
                        
                        const est = establishments.find(e => e.id === item.establishmentId);
                        
                        return (
                          <tr
                            key={`${item.user.id}-${item.cartelaCode}`}
                            onClick={() => openRankingCartelaDetails(selectedRankingRound, item)}
                            className={`cursor-pointer hover:bg-gray-50 ${item.user.id === currentUser.id ? 'bg-green-50' : ''} ${isWinner ? 'bg-yellow-50' : ''}`}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-lg font-bold">{position}º</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div>
                                <span className="font-medium">{item.user.name}</span>
                                {item.user.id === currentUser.id && (
                                  <span className="ml-2 bg-green-600 text-white text-xs px-2 py-1 rounded-full">Você</span>
                                )}
                                {isWinner && (
                                  <span className="ml-2 bg-yellow-500 text-white text-xs px-2 py-1 rounded-full">Vencedor</span>
                                )}
                                <p className="text-xs text-blue-600 font-mono mt-1">🎫 {item.cartelaCode}</p>
                                {est && (
                                  <p className="text-xs text-orange-600 flex items-center gap-1 mt-1">
                                    <Store size={12} /> {est.name}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="text-xl font-bold text-green-600">{item.points}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              {isWinner && roundPrize ? (
                                <span className="text-lg font-bold text-green-600">R$ {roundPrize.prizePerWinner.toFixed(2)}</span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                  
                  {ranking.length === 0 && (
                    <div className="p-12 text-center">
                      <Users className="mx-auto text-gray-400 mb-4" size={48} />
                      <h3 className="text-xl font-semibold mb-2">Nenhum participante pagou ainda</h3>
                      <p className="text-gray-500">Apenas participantes com pagamento confirmado aparecem no ranking</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'finished' && (
          <div className="transition-opacity">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold">Rodadas Finalizadas</h2>
                <p className="text-gray-600 mt-1">Ranking de rodadas antigas • Filtre por período</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full md:w-auto">
                <div>
                  <label className="block text-sm font-medium mb-1">Período</label>
                  <select
                    value={finishedPeriod}
                    onChange={(e) => setFinishedPeriod(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg bg-white"
                    title="Selecione um período rápido (3, 6, 12 meses ou todos)"
                  >
                    <option value="all">Todos</option>
                    <option value="3m">Últimos 3 meses</option>
                    <option value="6m">Últimos 6 meses</option>
                    <option value="12m">Últimos 12 meses</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Início</label>
                  <input
                    type="date"
                    value={finishedStartDate}
                    onChange={(e) => setFinishedStartDate(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg bg-white"
                    title="Data inicial para filtrar rodadas finalizadas"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Fim</label>
                  <input
                    type="date"
                    value={finishedEndDate}
                    onChange={(e) => setFinishedEndDate(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg bg-white"
                    title="Data final para filtrar rodadas finalizadas"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-between items-start mb-6">
              <div className="w-64">
                <label className="block text-sm font-medium mb-2">Selecione a Rodada</label>
                <select
                  value={selectedFinishedRound || ''}
                  onChange={(e) => setSelectedFinishedRound(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-white"
                  title="Escolha a rodada finalizada para ver o ranking"
                >
                  {filteredFinishedRounds.length === 0 && (
                    <option value="">Nenhuma rodada finalizada</option>
                  )}
                  {filteredFinishedRounds.map((round) => (
                    <option key={round.id} value={round.id}>
                      {round.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setFinishedStartDate(''); setFinishedEndDate(''); setFinishedPeriod('all'); }}
                  className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-50"
                  title="Limpar filtros aplicados"
                >
                  Limpar filtros
                </button>
              </div>
            </div>

            {!selectedFinishedRound || filteredFinishedRounds.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                <Trophy className="mx-auto text-gray-400 mb-4" size={48} />
                <h3 className="text-xl font-semibold mb-2">Nenhuma rodada finalizada</h3>
                <p className="text-gray-500">Use os filtros acima para encontrar rodadas antigas</p>
              </div>
            ) : (
              <div className="space-y-6">
                {finishedPrize && finishedPrize.winners.length > 0 && (
                  <div className="bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500 rounded-xl p-8 text-white">
                    <div className="flex items-center gap-3 mb-6">
                      <Trophy size={28} />
                      <h3 className="text-2xl font-bold">Premiação</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white/10 rounded-lg p-4">
                        <p className="text-sm text-yellow-100">Total Pago</p>
                        <p className="text-2xl font-bold">R$ {finishedPrize.totalPaid.toFixed(2)}</p>
                      </div>
                      <div className="bg-white/10 rounded-lg p-4">
                        <p className="text-sm text-yellow-100">Premiação (85%)</p>
                        <p className="text-2xl font-bold">R$ {finishedPrize.prizePool.toFixed(2)}</p>
                      </div>
                      <div className="bg-white/10 rounded-lg p-4">
                        <p className="text-sm text-yellow-100">Por vencedor</p>
                        <p className="text-2xl font-bold">R$ {finishedPrize.prizePerWinner.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-xl overflow-hidden shadow">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[500px]">
                      <thead>
                        <tr className="bg-gray-50">
                        <th className="px-6 py-4 text-left text-xs font-medium text-gray-500 uppercase">Participante</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Cartela</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Estabelecimento</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Pontos</th>
                        <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase">Premiação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {finishedRanking.map((item) => {
                        const isWinner = finishedPrize && finishedPrize.winners.some(w => w.user.id === item.user.id && w.cartelaCode === item.cartelaCode);
                        const establishment = establishments.find(e => e.id === item.establishmentId);
                        return (
                          <tr key={`${item.user.id}-${item.cartelaCode}`}>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold">
                                  {item.user.name?.charAt(0) || '?'}
                                </div>
                                <div>
                                  <p className="font-medium">{item.user.name}</p>
                                  <p className="text-xs text-gray-500">{item.user.whatsapp}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="font-mono text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded">{item.cartelaCode}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              {establishment ? (
                                <span className="text-sm font-medium text-orange-600" title="Estabelecimento vinculador da cartela">{establishment.name}</span>
                              ) : (
                                <span className="text-xs text-gray-400">Nenhum</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="text-xl font-bold text-green-600">{item.points}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              {isWinner && finishedPrize ? (
                                <span className="text-lg font-bold text-green-600">R$ {finishedPrize.prizePerWinner.toFixed(2)}</span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>

                  {finishedRanking.length === 0 && (
                    <div className="p-12 text-center">
                      <Users className="mx-auto text-gray-400 mb-4" size={48} />
                      <h3 className="text-xl font-semibold mb-2">Nenhum participante pagou ainda</h3>
                      <p className="text-gray-500">Apenas participantes com pagamento confirmado aparecem no ranking</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Minhas Rodadas</h2>
            <p className="text-gray-600 mb-6">Veja apenas as rodadas em que você já participa</p>

            {myOpenOrUpcomingRounds.length === 0 && myClosedRounds.length === 0 && myFinishedRounds.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center border-2 border-dashed">
                <Calendar className="mx-auto text-gray-400 mb-4" size={48} />
                <h3 className="text-xl font-semibold mb-2">Você ainda não participa de nenhuma rodada</h3>
                <p className="text-gray-500">Vá em "Rodadas Disponíveis" para entrar em uma rodada</p>
              </div>
            ) : (
              <div className="space-y-8">
                {myOpenOrUpcomingRounds.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm">
                        {myOpenOrUpcomingRounds.length}
                      </span>
                      Rodadas Ativas
                    </h3>
                    <div className="space-y-3">
                      {myOpenOrUpcomingRounds.map(round => <RoundAccordion key={round.id} round={round} />)}
                    </div>
                  </div>
                )}

                {myClosedRounds.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <span className="bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full text-sm">
                        {myClosedRounds.length}
                      </span>
                      Rodadas Aguardando Resultados
                    </h3>
                    <div className="space-y-3">
                      {myClosedRounds.map(round => <RoundAccordion key={round.id} round={round} />)}
                    </div>
                  </div>
                )}

                {myFinishedRounds.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm">
                        {myFinishedRounds.length}
                      </span>
                      Rodadas Finalizadas
                    </h3>
                    <div className="space-y-3">
                      {myFinishedRounds.map(round => <RoundAccordion key={round.id} round={round} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedRound && <PredictionForm round={selectedRound} initialPredictions={editingPredictions} />}
      {showConfirmModal && pendingPredictions && (
        <ConfirmModal 
          round={pendingPredictions.round} 
          predictionsData={pendingPredictions.predictions}
          cartelaCode={pendingPredictions.cartelaCode}
          establishmentId={pendingPredictions.establishmentId}
          onConfirm={confirmAndSave} 
          onCancel={() => { setShowConfirmModal(false); setEditingPredictions(pendingPredictions.predictions); }} 
        />
      )}
      {cartelaDetails && (
        <CartelaDetailsModal
          round={cartelaDetails.round}
          cartela={cartelaDetails.cartela}
          onClose={() => setCartelaDetails(null)}
        />
      )}
      {paymentModalOpen && paymentContext && (
        <PaymentModal
          open={paymentModalOpen}
          onClose={() => { if (paymentContext?.roundId) setPaymentLocks(prev => ({ ...prev, [paymentContext.roundId]: false })); setPaymentModalOpen(false); setPaymentContext(null); }}
          context={paymentContext}
          currentUser={currentUser}
          onStart={() => { /* lock already set on open */ }}
          onApproved={() => { if (paymentContext?.roundId) setPaymentLocks(prev => ({ ...prev, [paymentContext.roundId]: false })); }}
          onError={() => { if (paymentContext?.roundId) setPaymentLocks(prev => ({ ...prev, [paymentContext.roundId]: false })); }}
        />
      )}
      {showChangePassword && <ChangeMyPasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
};

const ChangeMyPasswordModal = ({ onClose }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!current) { setError('Informe a senha atual'); return; }
    const checagem = validaSenha(next);
    if (!checagem.ok) { setError(checagem.erro); return; }
    if (next !== confirm) { setError('A confirmação não confere'); return; }
    setError(''); setSaving(true);
    try {
      await changeMyPassword(current, next);
      alert('✅ Senha alterada com sucesso!');
      onClose();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-modal animate-slide-up">
        <div className="p-6 border-b flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Key className="text-campo-600" size={22} />
            <h3 className="font-display text-xl text-noite-900" style={{ letterSpacing: '0.04em' }}>TROCAR MINHA SENHA</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
        </div>
        <div className="p-6 space-y-4">
          <CampoSenha rotulo="Senha atual" valor={current} onChange={setCurrent}
            className="w-full px-4 py-2 border rounded-lg" autoComplete="current-password"
            placeholder="Sua senha atual (ou a temporária)" />
          <CampoSenha rotulo="Nova senha" valor={next} onChange={setNext} medidor
            className="w-full px-4 py-2 border rounded-lg" autoComplete="new-password"
            placeholder={`Mínimo ${MIN_SENHA} caracteres`} />
          <CampoSenha rotulo="Confirmar nova senha" valor={confirm} onChange={setConfirm}
            className="w-full px-4 py-2 border rounded-lg" autoComplete="new-password"
            onEnter={handleSave} placeholder="Repita a nova senha" />
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
        <div className="p-6 border-t flex gap-3">
          <button onClick={onClose} className="flex-1 px-6 py-2 border rounded-lg">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg disabled:opacity-60">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Tela de Manutenção

export default UserPanel;
