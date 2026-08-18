import { suggestedSettlement } from '../settleSuggestion';
import type { Balance } from '@/src/types/models';

const bal = (userId: string, amount: number): Balance => ({ userId, amount });

describe('cuánto autocompletar al saldar', () => {
  it('el que debe menos que lo que le deben al otro paga todo lo suyo', () => {
    const balances = [bal('ana', -3000), bal('beto', 5000)];
    expect(suggestedSettlement(balances, 'ana', 'beto')).toBe(3000);
  });

  // Pagarle de más lo dejaría en verde: se mudaría la deuda en vez de saldarla.
  it('NO se paga más de lo que le deben al que cobra', () => {
    const balances = [bal('ana', -5000), bal('beto', 3000), bal('caro', 2000)];
    expect(suggestedSettlement(balances, 'ana', 'beto')).toBe(3000);
  });

  it('montos iguales saldan a los dos exactamente', () => {
    const balances = [bal('ana', -4000), bal('beto', 4000)];
    expect(suggestedSettlement(balances, 'ana', 'beto')).toBe(4000);
  });
});

describe('pares que no tienen sentido dan 0', () => {
  it('el que paga no debe nada', () => {
    expect(suggestedSettlement([bal('ana', 1000), bal('beto', 2000)], 'ana', 'beto')).toBe(0);
  });

  it('al que cobra no le deben nada', () => {
    expect(suggestedSettlement([bal('ana', -1000), bal('beto', -2000)], 'ana', 'beto')).toBe(0);
  });

  it('los dos están en cero', () => {
    expect(suggestedSettlement([bal('ana', 0), bal('beto', 0)], 'ana', 'beto')).toBe(0);
  });

  it('pagarse a uno mismo', () => {
    expect(suggestedSettlement([bal('ana', -1000)], 'ana', 'ana')).toBe(0);
  });

  it('alguien que no está en el grupo', () => {
    expect(suggestedSettlement([bal('ana', -1000)], 'ana', 'fantasma')).toBe(0);
    expect(suggestedSettlement([bal('beto', 1000)], 'fantasma', 'beto')).toBe(0);
  });

  it('sin balances', () => {
    expect(suggestedSettlement([], 'ana', 'beto')).toBe(0);
  });
});
