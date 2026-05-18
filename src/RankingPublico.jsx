import React, { useState, useEffect } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { Trophy, Medal, Users, Calendar, Star } from 'lucide-react';

// ─── Firebase (mesmo projeto do App.jsx) ────────────────────────────────────
const firebaseConfig = {
  apiKey: 'AIzaSyCDEbEF3wQQck2bbIZfW1tCNROJzJ39cXQ',
  authDomain: 'bolao-brasileirao-dev-kd.firebaseapp.com',
  projectId: 'bolao-brasileirao-dev-kd',
  storageBucket: 'bolao-brasileirao-dev-kd.firebasestorage.app',
  messagingSenderId: '1084218540237',
  appId: '1:1084218540237:web:3e9b1d8d194a2e93472984'
};
const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// ─── Helpers ────────────────────────────────────────────────────────────────
function calcPoints(ph, pa, rh, ra) {
  if (rh == null || ra == null) return 0;
  if (ph === rh && pa === ra) return 3;
  const pr = ph > pa ? 'H' : ph < pa ? 'A' : 'D';
  const mr = rh > ra ? 'H' : rh < ra ? 'A' : 'D';
  return pr === mr ? 1 : 0;
}

function fmtBRL(n) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function getSafeLogo(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || '?')}&background=ffffff&color=0f172a&size=64`;
}

// ─── Componente principal ────────────────────────────────────────────────────
export default function RankingPublico({ roundId }) {
  const [state, setState] = useState({ status: 'loading', round: null, ranking: [], prize: null, error: null });

  useEffect(() => {
    if (!roundId) { setState(s => ({ ...s, status: 'error', error: 'ID de rodada inválido.' })); return; }
    let cancelled = false;

    async function load() {
      try {
        // 1. Rodada
        const roundSnap = await getDoc(doc(db, 'rounds', roundId));
        if (!roundSnap.exists()) throw new Error('Rodada não encontrada.');
        const round = { id: roundSnap.id, ...roundSnap.data() };
        if (round.status !== 'finished') throw new Error('O resultado desta rodada ainda não foi apurado.');

        // 2. Settings (betValue)
        const settingsSnap = await getDocs(collection(db, 'settings'));
        const settings = settingsSnap.empty ? {} : settingsSnap.docs[0].data();
        const betValue = settings?.betValue || 15;

        // 3. Usuários (só name)
        const usersSnap = await getDocs(collection(db, 'users'));
        const nameMap = {};
        usersSnap.docs.forEach(d => { if (!d.data().isAdmin) nameMap[d.id] = d.data().name || 'Participante'; });

        // 4. Palpites pagos desta rodada
        const predsSnap = await getDocs(query(collection(db, 'predictions'), where('roundId', '==', roundId)));

        // 5. Agrupar por cartela e calcular pontos
        const cartelas = {};
        predsSnap.docs.forEach(d => {
          const p = d.data();
          if (!p.paid) return;
          const code = p.cartelaCode || 'ANTIGA';
          const key = `${p.userId}__${code}`;
          if (!cartelas[key]) cartelas[key] = { userId: p.userId, cartelaCode: code, preds: [] };
          cartelas[key].preds.push(p);
        });

        const ranking = Object.values(cartelas).map(c => {
          let pts = 0;
          for (const pred of c.preds) {
            const match = round.matches?.find(m => m.id === pred.matchId);
            if (!match || match.homeScore == null || match.awayScore == null) continue;
            pts += calcPoints(pred.homeScore, pred.awayScore, match.homeScore, match.awayScore);
          }
          return { userId: c.userId, name: nameMap[c.userId] || 'Participante', cartelaCode: c.cartelaCode, points: pts };
        }).sort((a, b) => b.points - a.points);

        // 6. Prêmio
        const totalPaid = ranking.length * betValue;
        const prizePool = totalPaid * 0.85;
        const maxPts = ranking[0]?.points ?? 0;
        const winners = ranking.filter(r => r.points === maxPts);
        const prizePerWinner = winners.length > 0 ? prizePool / winners.length : 0;
        const prize = { totalPaid, prizePool, prizePerWinner, winners };

        if (!cancelled) setState({ status: 'ok', round, ranking, prize, error: null });
      } catch (err) {
        if (!cancelled) setState(s => ({ ...s, status: 'error', error: err.message }));
      }
    }

    load();
    return () => { cancelled = true; };
  }, [roundId]);

  const { status, round, ranking, prize, error } = state;

  // ── Loading ──
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Carregando resultado...</p>
        </div>
      </div>
    );
  }

  // ── Erro ──
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <Trophy className="mx-auto text-gray-300 mb-4" size={56} />
          <h2 className="text-xl font-bold text-gray-800 mb-2">Resultado indisponível</h2>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  const medals = ['🥇', '🥈', '🥉'];
  const sortedMatches = [...(round.matches || [])].sort((a, b) => new Date(a.date) - new Date(b.date));

  // Posição considerando empates
  const getPosition = (index) => {
    const pts = ranking[index].points;
    return ranking.filter((r, i) => i < index && r.points > pts).length + 1;
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans">

      {/* ── Header ── */}
      <div className="bg-gradient-to-br from-green-700 to-green-900 text-white">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center">
              <Trophy size={20} className="text-yellow-400" />
            </div>
            <span className="text-sm font-semibold tracking-widest text-green-200 uppercase">Bolão Brasileirão 2026</span>
          </div>
          <h1 className="text-3xl font-bold mt-1">{round.name}</h1>
          <p className="text-green-200 text-sm mt-1">Resultado oficial • {ranking.length} cartela{ranking.length !== 1 ? 's' : ''} válida{ranking.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

        {/* ── Card do(s) Vencedor(es) ── */}
        {prize && prize.winners.length > 0 && (
          <div className="bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500 rounded-2xl p-6 text-white shadow-lg">
            <div className="flex items-center gap-3 mb-5">
              <Trophy size={36} />
              <div>
                <h2 className="text-2xl font-bold">{prize.winners.length > 1 ? 'Vencedores' : 'Campeão'} da Rodada!</h2>
                <p className="text-yellow-100 text-sm">{prize.winners.length > 1 ? 'Premiação dividida entre os vencedores' : 'Maior pontuação da rodada'}</p>
              </div>
            </div>

            {/* Prêmio */}
            <div className="bg-white/20 rounded-xl p-4 text-center mb-4">
              <p className="text-yellow-100 text-xs font-semibold uppercase tracking-wide mb-1">
                Prêmio {prize.winners.length > 1 ? 'por vencedor' : 'total'} (85%)
              </p>
              <p className="text-4xl font-bold">{fmtBRL(prize.prizePerWinner)}</p>
              <p className="text-yellow-100 text-xs mt-1">
                Total arrecadado: {fmtBRL(prize.totalPaid)} • Premiação: {fmtBRL(prize.prizePool)}
              </p>
            </div>

            {/* Vencedores */}
            <div className="space-y-3">
              {prize.winners.map(w => (
                <div key={`${w.userId}-${w.cartelaCode}`} className="bg-white rounded-xl p-4 text-gray-900 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-3xl flex-shrink-0">🏆</span>
                    <div className="min-w-0">
                      <p className="font-bold text-lg leading-tight truncate">{w.name}</p>
                      <p className="text-xs text-blue-600 font-mono">🎫 {w.cartelaCode}</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-2xl font-bold text-green-600">{w.points} pts</p>
                    <p className="text-sm font-semibold text-green-700">{fmtBRL(prize.prizePerWinner)}</p>
                  </div>
                </div>
              ))}
            </div>

            {prize.winners.length > 1 && (
              <p className="text-center text-yellow-100 text-sm mt-3">⚠️ Empate — premiação dividida igualmente</p>
            )}
          </div>
        )}

        {/* ── Tabela de Ranking ── */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="bg-gradient-to-r from-green-600 to-green-700 text-white px-5 py-4">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Users size={18} /> Ranking Completo
            </h3>
            <p className="text-green-100 text-xs mt-0.5">Apenas cartelas com pagamento confirmado</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Pos</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Participante</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Pts</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Prêmio</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ranking.map((item, idx) => {
                  const pos = getPosition(idx);
                  const isWinner = prize?.winners.some(w => w.userId === item.userId && w.cartelaCode === item.cartelaCode);
                  return (
                    <tr key={`${item.userId}-${item.cartelaCode}`}
                      className={`${isWinner ? 'bg-yellow-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                      <td className="px-4 py-3">
                        <span className="font-bold text-gray-700">
                          {medals[pos - 1] ? <span className="text-xl">{medals[pos - 1]}</span> : `${pos}º`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
                        <p className="text-xs text-blue-500 font-mono">🎫 {item.cartelaCode}</p>
                        {isWinner && (
                          <span className="inline-block mt-1 bg-yellow-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                            VENCEDOR
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-lg font-bold text-green-600">{item.points}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isWinner && prize ? (
                          <span className="font-bold text-green-600 text-sm">{fmtBRL(prize.prizePerWinner)}</span>
                        ) : (
                          <span className="text-gray-300 text-sm">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Jogos da Rodada ── */}
        {sortedMatches.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
            <div className="px-5 py-4 border-b">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Calendar size={18} className="text-green-600" /> Jogos da Rodada
              </h3>
            </div>
            <div className="divide-y">
              {sortedMatches.map((match, idx) => {
                const hasScore = match.homeScore != null && match.awayScore != null;
                const done = match.finished || hasScore;
                const homeName = match.homeTeamName || '?';
                const awayName = match.awayTeamName || '?';
                return (
                  <div key={match.id || idx} className="flex items-center px-4 py-3 gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                      <span className="text-sm font-semibold text-gray-800 truncate text-right">{homeName}</span>
                      <img src={getSafeLogo(homeName)} alt={homeName} className="w-7 h-7 object-contain flex-shrink-0 rounded bg-gray-50" />
                    </div>
                    <div className="flex-shrink-0 flex flex-col items-center w-20">
                      {hasScore ? (
                        <div className={`flex items-center gap-1 px-3 py-1 rounded-lg font-mono font-bold text-sm ${done ? 'bg-green-600 text-white' : 'bg-red-500 text-white'}`}>
                          <span>{match.homeScore}</span>
                          <span className="opacity-60">–</span>
                          <span>{match.awayScore}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 px-3 py-1 rounded-lg bg-gray-100 text-gray-400 font-bold text-sm">
                          <span>?</span><span>–</span><span>?</span>
                        </div>
                      )}
                      <span className={`text-[10px] font-semibold mt-1 ${done ? 'text-green-600' : 'text-gray-400'}`}>
                        {done ? '✅ Fim' : '⏰ Pendente'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <img src={getSafeLogo(awayName)} alt={awayName} className="w-7 h-7 object-contain flex-shrink-0 rounded bg-gray-50" />
                      <span className="text-sm font-semibold text-gray-800 truncate">{awayName}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="text-center py-4">
          <p className="text-xs text-gray-400">Bolão Brasileirão 2026 • Resultado oficial</p>
        </div>
      </div>
    </div>
  );
}
