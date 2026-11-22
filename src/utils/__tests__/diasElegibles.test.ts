import { describirDia, diasElegibles } from '@/src/utils/diasElegibles';

const TEXTOS = { hoy: 'Hoy', ayer: 'Ayer' };
const HOY = new Date(2026, 10, 18, 9); // mié 18 de noviembre de 2026

describe('describirDia (T-282 t2)', () => {
  it('hoy y ayer llevan su palabra; el cubo igual muestra día y mes', () => {
    expect(describirDia(new Date(2026, 10, 18, 12), HOY, 'es', TEXTOS)).toMatchObject({ nombre: 'Hoy', dia: '18' });
    expect(describirDia(new Date(2026, 10, 17, 12), HOY, 'es', TEXTOS)).toMatchObject({ nombre: 'Ayer', dia: '17' });
  });

  it('los anteriores: día de semana abreviado + número, en el idioma pedido', () => {
    const es = describirDia(new Date(2026, 10, 15, 12), HOY, 'es', TEXTOS);
    const en = describirDia(new Date(2026, 10, 15, 12), HOY, 'en', TEXTOS);
    expect(es.nombre).toBe(new Date(2026, 10, 15).toLocaleDateString('es', { weekday: 'short', day: 'numeric' }));
    expect(en.nombre).toBe(new Date(2026, 10, 15).toLocaleDateString('en', { weekday: 'short', day: 'numeric' }));
    expect(es.nombre).not.toBe(en.nombre);
  });

  it('el mes sale abreviado, sin punto, en el idioma pedido', () => {
    expect(describirDia(new Date(2026, 8, 15, 12), HOY, 'es', TEXTOS).mes).not.toMatch(/\./);
    expect(describirDia(new Date(2026, 10, 15, 12), HOY, 'en', TEXTOS).mes).toBe('Nov');
  });

  it('nunca usa un locale fijo: sólo el que se le pasa', () => {
    const spy = jest.spyOn(Date.prototype, 'toLocaleDateString');
    describirDia(new Date(2026, 10, 15, 12), HOY, 'pt', TEXTOS);
    expect(spy.mock.calls.every(c => c[0] === 'pt')).toBe(true);
    spy.mockRestore();
  });
});

describe('diasElegibles (movida a utils, T-282 t2)', () => {
  it('7 días de hoy hacia atrás, a mediodía', () => {
    const dias = diasElegibles(false, HOY);
    expect(dias.map(d => d.getDate())).toEqual([18, 17, 16, 15, 14, 13, 12]);
    expect(dias.every(d => d.getHours() === 12)).toBe(true);
  });
});
