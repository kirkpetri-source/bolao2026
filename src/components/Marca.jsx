import React from 'react';

// Identidade do BrasilBolão, num lugar só.
//
// Escudo com bola: é a forma que todo torcedor já lê como "time". Verde do
// campo no corpo, contorno e bola em dourado de troféu — as duas cores que o
// app inteiro usa (campo/ouro do tailwind.config).
//
// Detalhes que fazem a diferença em tamanho pequeno (32px na barra):
// - keyline interna: dá profundidade sem depender de sombra, que suja no ícone
//   da aba;
// - bola com gomos de verdade (pentágono central + costuras), não uma bola
//   genérica — em 32px lê como bola, em 120px aguenta o zoom;
// - brilho superior sutil, para o escudo não parecer adesivo chapado.
//
// SVG em vez de arquivo de imagem: pesa nada, fica nítido em qualquer tela e
// não depende de pasta pública (o projeto não tem /public).

export function Escudo({ size = 38, idSufixo = '' }) {
  // Os ids precisam ser únicos por instância: dois SVGs com o mesmo id na
  // página fazem o segundo herdar o gradiente do primeiro.
  const g = `bb-corpo${idSufixo}`;
  const gb = `bb-brilho${idSufixo}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className="flex-shrink-0">
      <defs>
        <linearGradient id={g} x1="24" y1="1" x2="24" y2="47" gradientUnits="userSpaceOnUse">
          <stop stopColor="#13c25e" />
          <stop offset="0.5" stopColor="#008542" />
          <stop offset="1" stopColor="#002b16" />
        </linearGradient>
        <linearGradient id={gb} x1="10" y1="4" x2="30" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Corpo do escudo */}
      <path d="M24 2.2 41.2 7.3v17.4c0 10.2-7.1 17.9-17.2 21.1C13.9 42.6 6.8 34.9 6.8 24.7V7.3L24 2.2z"
        fill={`url(#${g})`} stroke="#FFD700" strokeWidth="1.7" strokeLinejoin="round" />
      {/* Keyline interna */}
      <path d="M24 5.6 38 9.7v14.9c0 8.6-6 15.2-14 18-8-2.8-14-9.4-14-18V9.7L24 5.6z"
        stroke="#FFD700" strokeOpacity="0.32" strokeWidth="0.9" fill="none" strokeLinejoin="round" />
      {/* Brilho */}
      <path d="M24 2.2 41.2 7.3v6.2C34 8.9 29.2 6.7 24 6.7S14 8.9 6.8 13.5V7.3L24 2.2z" fill={`url(#${gb})`} />

      {/* Bola: círculo, pentágono central e costuras */}
      <circle cx="24" cy="24.4" r="8.6" fill="#0b2a18" fillOpacity="0.45" stroke="#FFD700" strokeWidth="1.5" />
      <path d="M24 19.4l3.9 2.8-1.5 4.6h-4.8l-1.5-4.6L24 19.4z" fill="#FFD700" />
      <path d="M24 19.4V15.9M27.9 22.2l3.3-1.1M26.4 26.8l2.1 2.9M21.6 26.8l-2.1 2.9M20.1 22.2l-3.3-1.1"
        stroke="#FFD700" strokeWidth="1.25" strokeLinecap="round" strokeOpacity="0.9" />
    </svg>
  );
}

// Tamanhos nomeados em vez de números soltos: a marca precisa ser a MESMA em
// toda tela, e "compacto/normal/grande" é o que evita cada tela escolher um
// tamanho por conta e a identidade sair desalinhada.
const TAMANHOS = {
  compacto: { escudo: 32, texto: '0.95rem' },
  normal:   { escudo: 38, texto: '1.05rem' },
  grande:   { escudo: 54, texto: '1.5rem' },
};

// `claro` força a versão para fundo escuro. Serve para superfícies que são
// escuras nos DOIS temas (a página de venda, por exemplo).
//
// Sem `claro`, as cores acompanham o tema pelas classes utilitárias. Era esse o
// bug do print: a tela de entrar usava a versão de fundo claro, então no tema
// escuro o "BRASIL" saía em cinza-chumbo sobre fundo quase preto — sumia.
export function Marca({ compacto = false, tamanho, claro = false, idSufixo = '' }) {
  const t = TAMANHOS[tamanho] || (compacto ? TAMANHOS.compacto : TAMANHOS.normal);
  return (
    <span className="inline-flex items-center gap-3 min-w-0">
      <Escudo size={t.escudo} idSufixo={idSufixo} />
      <span className="font-display leading-none truncate" style={{ letterSpacing: '0.1em', fontSize: t.texto }}>
        <span className={claro ? '' : 'text-noite-900'} style={claro ? { color: '#cfe6d6' } : undefined}>BRASIL</span>
        <span className={claro ? '' : 'text-ouro-600 dark:text-ouro-500'} style={claro ? { color: '#FFD700' } : undefined}>BOLÃO</span>
      </span>
    </span>
  );
}
