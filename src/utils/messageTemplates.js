// Utilities for predefined message templates, tag normalization, compilation and validation
// Pure functions for unit testing and reuse in the communications UI

export const ALLOWED_TAGS = [
  'NOME',
  'RODADA',
  'LINK',
  'LIMITE',
  'DIVULGACAO',
  'RANKING_URL',
  'BRAND',
  'PIX',
  'DESTINATARIO'
];

// Template definitions (rich and plain)
export const MESSAGE_TEMPLATES = {
  'open-round': {
    rich: '🔔 {BRAND}\n\nA rodada de palpites "{RODADA}" está ABERTA!\nAcesse agora e garanta seus palpites: {LINK}\n\n{NOME}, vamos pra cima! 🏆',
    plain: 'AVISO ({BRAND}): rodada "{RODADA}" aberta. Acesse {LINK} e registre seus palpites. Incentivo: participe!'
  },
  'charge-pending': {
    rich: '⚠️ {BRAND} — Cobrança de palpites pendentes\n\nOlá, {NOME}. Conclua sua regularização até {LIMITE}.\nPagamento via PIX: {PIX}\n\nQualquer dúvida, estamos à disposição.',
    plain: 'COBRANÇA ({BRAND}): regularize seus palpites até {LIMITE}. PIX: {PIX}. Obrigado.'
  },
  'round-closed': {
    rich: '✅ {BRAND}\n\nRodada "{RODADA}" fechada! Obrigado pela participação de todos.\nBoa sorte! 🍀\nResultados serão divulgados em {DIVULGACAO}.',
    plain: 'Rodada "{RODADA}" encerrada. Obrigado pela participação. Resultados em {DIVULGACAO}.'
  },
  'final-result': {
    rich: '📣 {BRAND} — Resultado Final\n\nRodada "{RODADA}" finalizada! Parabéns aos vencedores!\nVeja o ranking completo: {RANKING_URL}',
    plain: 'RESULTADO FINAL ({BRAND}): rodada "{RODADA}" finalizada. Ranking: {RANKING_URL}.'
  }
};

// Category grouping for organized dropdowns
export const TEMPLATE_CATEGORIES = [
  { label: 'Abertura', items: [{ key: 'open-round', label: 'Aviso de Rodada Aberta' }] },
  { label: 'Cobrança', items: [{ key: 'charge-pending', label: 'Cobrança de Palpites Pendentes' }] },
  { label: 'Status', items: [{ key: 'round-closed', label: 'Aviso de Rodada Fechada' }] },
  { label: 'Resultado', items: [{ key: 'final-result', label: 'Resultado Final' }] }
];

// Normalize various tag formats to canonical {TAG}
export function normalizeTags(text) {
  if (!text) return '';
  let t = String(text);
  // Convert [[TAG]] or {{TAG}} to {TAG} and strip spaces
  t = t.replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (_, p) => `{${p.toUpperCase()}}`);
  t = t.replace(/\[\s*([A-Za-z_]+)\s*\]/g, (_, p) => `{${p.toUpperCase()}}`);
  t = t.replace(/\{\s*([A-Za-z_]+)\s*\}/g, (_, p) => `{${p.toUpperCase()}}`);
  // Remove duplicated trailing braces like {TAG}} -> {TAG}
  t = t.replace(/\{([A-Za-z_]+)\}\}/g, (_, p) => `{${p.toUpperCase()}}`);
  return t;
}

// Compile a template string by replacing allowed tags from context
export function compileTemplate(raw, context = {}) {
  const src = normalizeTags(raw);
  let out = src;
  const map = {
    NOME: context.NOME ?? context.userName ?? '{NOME}',
    RODADA: context.RODADA ?? context.roundName ?? 'Rodada',
    LINK: context.LINK ?? context.link ?? '{LINK}',
    LIMITE: context.LIMITE ?? context.deadline ?? '{LIMITE}',
    DIVULGACAO: context.DIVULGACAO ?? context.publish ?? '{DIVULGACAO}',
    RANKING_URL: context.RANKING_URL ?? context.ranking ?? '{RANKING_URL}',
    BRAND: context.BRAND ?? context.brand ?? '{BRAND}',
    PIX: context.PIX ?? context.pix ?? '{PIX}',
    DESTINATARIO: context.DESTINATARIO ?? context.destinatario ?? context.recipient ?? '{DESTINATARIO}'
  };
  for (const tag of ALLOWED_TAGS) {
    const val = map[tag] ?? `{${tag}}`;
    out = out.replace(new RegExp(`\\{${tag}\\}`, 'g'), val);
  }
  return out;
}

// Build text from a key/mode and a provided context
export function buildTemplateText(key, mode = 'rich', context = {}) {
  const tpl = MESSAGE_TEMPLATES[key]?.[mode] || '';
  return compileTemplate(tpl, context);
}

// Extract all tags from a message
export function extractTags(text) {
  const norm = normalizeTags(text);
  const re = /\{([A-Z_]+)\}/g;
  const tags = [];
  let m;
  while ((m = re.exec(norm))) {
    tags.push(m[1]);
  }
  return Array.from(new Set(tags));
}

// Validate tags in a message: unknown vs missing (no value in context)
export function validateMessageTags(text, context = {}) {
  const tags = extractTags(text);
  const unknownTags = tags.filter(t => !ALLOWED_TAGS.includes(t));
  const missingTags = ALLOWED_TAGS.filter(tag => tags.includes(tag)).filter(tag => {
    const map = {
      NOME: context.NOME ?? context.userName,
      RODADA: context.RODADA ?? context.roundName,
      LINK: context.LINK ?? context.link,
      LIMITE: context.LIMITE ?? context.deadline,
      DIVULGACAO: context.DIVULGACAO ?? context.publish,
      RANKING_URL: context.RANKING_URL ?? context.ranking,
      BRAND: context.BRAND ?? context.brand
    };
    const v = map[tag];
    return v === undefined || v === null || v === '';
  });
  return { unknownTags, missingTags };
}
