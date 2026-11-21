import { rutaVerTodos, mesDeParams } from '@/src/screens/personal/utils/rutaVerTodos';

describe('navegación de «Ver todos» (T-277)', () => {
  it('lleva el mes visible por parámetro', () => {
    expect(rutaVerTodos('2026-10')).toEqual({ pathname: '/personal/movimientos', params: { month: '2026-10' } });
  });
  it('mesDeParams acepta un mes válido y cae al corriente si no', () => {
    expect(mesDeParams('2026-10', '2026-11')).toBe('2026-10');
    expect(mesDeParams(undefined, '2026-11')).toBe('2026-11');
    expect(mesDeParams('basura', '2026-11')).toBe('2026-11');
  });
});
