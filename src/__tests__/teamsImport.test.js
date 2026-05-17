import { describe, it, expect } from 'vitest';
import { normalizeName, mapApiTeamsToPayload, FALLBACK_TEAMS } from '../../api/brasileirao/teams.js';

describe('teams import helpers', () => {
  it('normalizeName removes accents and lowercases', () => {
    expect(normalizeName('São Paulo')).toBe('sao paulo');
    expect(normalizeName('Grêmio')).toBe('gremio');
    expect(normalizeName(' Atlético Mineiro ')).toBe('atletico mineiro');
  });

  it('mapApiTeamsToPayload maps fields and adds normalizedName', () => {
    const input = [
      { nome: 'Fluminense', shield: 'logo1.png' },
      { name: 'Vasco da Gama', logo: 'logo2.png' },
    ];
    const out = mapApiTeamsToPayload(input);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: 'Fluminense', logo: 'logo1.png', normalizedName: 'fluminense' });
    expect(out[1]).toEqual({ name: 'Vasco da Gama', logo: 'logo2.png', normalizedName: 'vasco da gama' });
  });

  it('fallback list provides 20 official teams and normalizes', () => {
    expect(FALLBACK_TEAMS).toHaveLength(20);
    const payload = mapApiTeamsToPayload(FALLBACK_TEAMS);
    expect(payload).toHaveLength(20);
    expect(payload.every(t => typeof t.normalizedName === 'string' && t.normalizedName.length > 0)).toBe(true);
  });

  it('normalizedName enables duplicate detection', () => {
    const input = [
      { name: 'São Paulo', logo: '' },
      { name: 'Sao Paulo', logo: '' },
    ];
    const out = mapApiTeamsToPayload(input);
    expect(out[0].normalizedName).toBe(out[1].normalizedName);
  });
});