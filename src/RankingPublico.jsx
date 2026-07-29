import React, { useState, useEffect } from 'react';
import { Trophy, Medal, Users, Calendar, Star } from 'lucide-react';

// ─── Componente principal ────────────────────────────────────────────────────
export default function RankingPublico({ roundId }) {
  const [state, setState] = useState({ status: 'loading', round: null, ranking: [], prize: null, error: null });

  useEffect(() => {
    if (!roundId) { setState(s => ({ ...s, status: 'error', error: 'ID de rodada inválido.' })); return; }
    let cancelled = false;

    async function load() {
      try {
        // Tudo vem de um endpoint: a página é pública e o Firestore, com razão,
        // não entrega usuários, palpites e configurações a visitante sem login.
        const r = await fetch(`/api/ranking/public?roundId=${encodeURIComponent(roundId)}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Não foi possível carregar o resultado.');
        if (!cancelled) setState({ status: 'ok', round: d.round, ranking: d.ranking, prize: d.prize, error: null });
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
