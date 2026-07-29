import React, { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';

// Avisa quando existe versão nova publicada.
//
// O index.html deixou de ser guardado em cache, então recarregar já basta para
// pegar o código novo. O problema restante é a aba que fica aberta por dias: ela
// continua rodando o bundle antigo sem nenhum sinal, e o usuário só descobre
// quando algo quebra de um jeito que não faz sentido.

const INTERVALO_MS = 10 * 60 * 1000;

export default function NovaVersao() {
  const [temNova, setTemNova] = useState(false);

  useEffect(() => {
    // Em desenvolvimento não existe version.json publicado.
    if (import.meta.env?.DEV) return;

    let vivo = true;
    const verificar = async () => {
      try {
        const r = await fetch('/version.json', { cache: 'no-store' });
        if (!r.ok) return;
        const { buildId } = await r.json();
        if (vivo && buildId && buildId !== __BUILD_ID__) setTemNova(true);
      } catch { /* offline ou deploy em andamento: tenta de novo depois */ }
    };

    verificar();
    const t = setInterval(verificar, INTERVALO_MS);
    // Voltar para a aba é o momento mais provável de ter havido um deploy.
    const aoFocar = () => verificar();
    window.addEventListener('focus', aoFocar);
    return () => { vivo = false; clearInterval(t); window.removeEventListener('focus', aoFocar); };
  }, []);

  if (!temNova) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] w-[min(92vw,26rem)]">
      <div className="bg-noite-900 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3">
        <RefreshCcw size={18} className="flex-shrink-0" />
        <p className="text-sm flex-1 leading-snug">
          Uma versão nova do sistema foi publicada.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-ouro-500 text-[#0a0f1a] font-semibold text-sm px-3 py-1.5 rounded-lg flex-shrink-0">
          Atualizar
        </button>
      </div>
    </div>
  );
}
