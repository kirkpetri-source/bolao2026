// Componentes compartilhados por várias telas (LoginScreen, AdminPanel, UserPanel).
import React from 'react';
import { FileText, Sun, Moon } from 'lucide-react';
import { useApp } from '../AppContext.js';
import { markdownToHtml } from '../utils/helpers.js';

// Card reutilizável com as regras do bolão.
export const RulesCard = () => {
  const { settings } = useApp();
  const betValue = settings?.betValue != null ? settings.betValue.toFixed(2) : '15,00';

  const hasCustomRules = settings?.rulesText || settings?.scoringCriteria || settings?.tiebreakRules;

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText size={20} className="text-green-600" />
        <h2 className="text-xl font-bold">Regras do Bolão</h2>
      </div>

      {hasCustomRules ? (
        <div className="space-y-6">
          {settings?.rulesText && (
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900">Texto Completo</h3>
              <div className="text-gray-700 text-sm" dangerouslySetInnerHTML={{ __html: markdownToHtml(settings.rulesText) }} />
            </div>
          )}
          {settings?.scoringCriteria && (
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900">Critérios de Pontuação</h3>
              <div className="text-gray-700 text-sm" dangerouslySetInnerHTML={{ __html: markdownToHtml(settings.scoringCriteria) }} />
            </div>
          )}
          {settings?.tiebreakRules && (
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900">Regras de Desempate</h3>
              <div className="text-gray-700 text-sm" dangerouslySetInnerHTML={{ __html: markdownToHtml(settings.tiebreakRules) }} />
            </div>
          )}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            Valor por cartela: R$ {betValue}
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Participação</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>Faça seus palpites antes do início das partidas.</li>
              <li>Valor por cartela: R$ {betValue}.</li>
              <li>Somente cartelas pagas entram no ranking e na premiação.</li>
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Pontuação</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>Placar exato: 3 pontos.</li>
              <li>Resultado correto (vitória/empate): 1 ponto.</li>
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Premiação</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>85% do total pago na rodada compõe o prêmio.</li>
              <li>Dividido igualmente entre os vencedores com maior pontuação.</li>
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900">Desempate</h3>
            <ul className="list-disc list-inside text-gray-700 space-y-1">
              <li>Posição igual para empates em pontos.</li>
              <li>Premiação dividida igualmente entre empatados no topo.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

// Botão de alternância de modo escuro/claro, usado nos headers.
export const DarkToggle = ({ variant = 'dark' }) => {
  const { darkMode, toggleDark } = useApp();
  const cls = variant === 'light'
    ? 'text-noite-400 hover:text-noite-700 hover:bg-gray-100 dark:text-yellow-400 dark:hover:bg-white/10'
    : 'text-white/50 hover:text-white hover:bg-white/10';
  return (
    <button
      onClick={toggleDark}
      title={darkMode ? 'Modo claro' : 'Modo noturno'}
      aria-label="Alternar modo noturno"
      className={`p-2.5 rounded-xl transition-all duration-200 flex-shrink-0 ${cls}`}
    >
      {darkMode ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
};
