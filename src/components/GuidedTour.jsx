import React, { useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';

// Tour de primeira execução: destaca um elemento por vez e explica para que
// serve. Cada passo aponta para um `data-tour` no DOM — assim o texto do tour
// não precisa saber onde o botão está na tela, só quem ele é.
//
// Passos sem `alvo` aparecem centralizados (abertura e fechamento).

const MARGEM = 8;      // respiro entre o recorte e o elemento
const LARGURA = 320;   // largura do balão

export default function GuidedTour({ passos, aoTrocarAba, aoFechar }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);

  const passo = passos[i];
  const ultimo = i === passos.length - 1;

  // Troca de aba antes de medir: o alvo pode estar numa aba que não está aberta.
  useEffect(() => {
    if (passo?.aba && aoTrocarAba) aoTrocarAba(passo.aba);
  }, [i]);

  const medir = useCallback(() => {
    if (!passo?.alvo) { setRect(null); return; }
    const el = document.querySelector(`[data-tour="${passo.alvo}"]`);
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [passo]);

  // Rolar e medir são separados de propósito: com scroll suave, ler a posição
  // logo após pedir a rolagem devolveria a posição antiga e o destaque cairia
  // no lugar errado. Aqui a rolagem acontece uma vez por passo, e a medição
  // reage aos eventos de scroll — inclusive aos que a própria rolagem dispara.
  useLayoutEffect(() => {
    if (!passo?.alvo) { setRect(null); return; }
    const el = document.querySelector(`[data-tour="${passo.alvo}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [passo]);

  useLayoutEffect(() => {
    // A aba pode ter acabado de trocar; algumas medições até o layout assentar.
    const timers = [0, 120, 320, 600].map(ms => setTimeout(medir, ms));
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [medir]);

  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'Escape') aoFechar();
      if (e.key === 'ArrowRight') setI(v => Math.min(v + 1, passos.length - 1));
      if (e.key === 'ArrowLeft') setI(v => Math.max(v - 1, 0));
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [passos.length, aoFechar]);

  if (!passo) return null;

  // Balão abaixo do alvo quando cabe; acima quando não cabe.
  const posicao = (() => {
    if (!rect) return { centralizado: true };
    const abaixo = rect.top + rect.height + MARGEM + 190 < window.innerHeight;
    const top = abaixo ? rect.top + rect.height + MARGEM + 6 : Math.max(12, rect.top - MARGEM - 196);
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - LARGURA / 2),
      window.innerWidth - LARGURA - 12
    );
    return { top, left };
  })();

  const recorte = rect && {
    top: rect.top - MARGEM,
    left: rect.left - MARGEM,
    width: rect.width + MARGEM * 2,
    height: rect.height + MARGEM * 2,
  };

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Escurecimento com recorte. Quatro faixas em vez de máscara SVG: o
          elemento destacado continua nítido e clicável por baixo. */}
      {recorte ? (
        <>
          <div className="absolute left-0 right-0 top-0 bg-black/60" style={{ height: Math.max(0, recorte.top) }} />
          <div className="absolute left-0 right-0 bottom-0 bg-black/60" style={{ top: recorte.top + recorte.height }} />
          <div className="absolute bg-black/60" style={{ top: recorte.top, left: 0, width: Math.max(0, recorte.left), height: recorte.height }} />
          <div className="absolute bg-black/60" style={{ top: recorte.top, left: recorte.left + recorte.width, right: 0, height: recorte.height }} />
          <div
            className="absolute rounded-xl pointer-events-none"
            style={{
              top: recorte.top, left: recorte.left, width: recorte.width, height: recorte.height,
              boxShadow: '0 0 0 3px #FFD700, 0 0 24px rgba(255,215,0,.45)',
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/70" />
      )}

      <div
        className="absolute bg-white dark:bg-[#112118] rounded-2xl shadow-2xl p-5"
        style={posicao.centralizado
          ? { width: LARGURA, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
          : { width: LARGURA, top: posicao.top, left: posicao.left }}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <p className="text-[11px] font-bold uppercase text-campo-600" style={{ letterSpacing: '0.14em' }}>
            Passo {i + 1} de {passos.length}
          </p>
          <button onClick={aoFechar} aria-label="Fechar tutorial" className="text-noite-400 hover:text-noite-700 -mt-1">
            <X size={18} />
          </button>
        </div>

        <h3 className="font-display text-lg text-noite-900 mb-1.5" style={{ letterSpacing: '0.03em' }}>
          {passo.titulo}
        </h3>
        <p className="text-sm text-noite-500 leading-relaxed">{passo.texto}</p>

        <div className="flex items-center justify-between gap-2 mt-5">
          <button onClick={aoFechar} className="text-xs text-noite-400 hover:text-noite-700">
            Pular tutorial
          </button>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <button onClick={() => setI(i - 1)}
                className="px-3 py-2 rounded-lg border text-sm inline-flex items-center gap-1 text-noite-600">
                <ChevronLeft size={15} /> Voltar
              </button>
            )}
            <button
              onClick={() => (ultimo ? aoFechar() : setI(i + 1))}
              className="v2-btn-primary px-4 py-2 text-sm">
              {ultimo ? <><Check size={15} /> Concluir</> : <>Próximo <ChevronRight size={15} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
