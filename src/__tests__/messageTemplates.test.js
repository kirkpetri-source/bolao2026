import { describe, it, expect } from 'vitest';
import { MESSAGE_TEMPLATES, buildTemplateText, normalizeTags, validateMessageTags, ALLOWED_TAGS } from '../utils/messageTemplates.js';

describe('messageTemplates utils', () => {
  const context = {
    userName: 'João',
    roundName: 'Rodada 1',
    link: 'https://app.example.com',
    deadline: '01/05/2025 18:00',
    publish: '02/05/2025 10:00',
    ranking: 'https://app.example.com?view=user&tab=ranking&round=abc',
    brand: 'Bolão Brasileiro 2025'
  };

  it('buildTemplateText compiles open-round rich template with context', () => {
    const text = buildTemplateText('open-round', 'rich', context);
    expect(text).toContain('🔔 Bolão Brasileiro 2025');
    expect(text).toContain('Rodada 1');
    expect(text).toContain('https://app.example.com');
    expect(text).toContain('João');
  });

  it('normalizes tag variants to canonical form', () => {
    const raw = 'Olá, {{nome}}! A rodada [[rodada]] usa link { link }.';
    const norm = normalizeTags(raw);
    expect(norm).toContain('{NOME}');
    expect(norm).toContain('{RODADA}');
    expect(norm).toContain('{LINK}');
  });

  it('validates unknown and missing tags', () => {
    const msg = 'Teste {NOME} {FOO} {RODADA} {DIVULGACAO}';
    const v = validateMessageTags(msg, { userName: 'A', roundName: 'B' });
    expect(v.unknownTags).toContain('FOO');
    // DIVULGACAO is missing in provided context
    expect(v.missingTags).toContain('DIVULGACAO');
    expect(ALLOWED_TAGS).toContain('RODADA');
  });

  it('builds final-result plain template with ranking', () => {
    const text = buildTemplateText('final-result', 'plain', context);
    expect(text).toContain('RESULTADO FINAL');
    expect(text).toContain(context.ranking);
  });
});