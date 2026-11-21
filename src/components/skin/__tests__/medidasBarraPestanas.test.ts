import { medidasBarraPestanas, ALTO_PILDORA, HUELLA_MAXIMA_IOS } from '@/src/components/skin/medidasBarraPestanas';

describe('medidasBarraPestanas', () => {
  it('iPhone con indicador de inicio (34): huella <= 86 y píldora redonda', () => {
    const m = medidasBarraPestanas({ insetBottom: 34, plataforma: 'ios', margenLateral: 16 });
    expect(m.altoPildora).toBe(ALTO_PILDORA);
    expect(m.radio).toBe(ALTO_PILDORA / 2);
    expect(m.margenLateral).toBe(16);
    expect(m.huella).toBeLessThanOrEqual(HUELLA_MAXIMA_IOS);
    expect(m.huella).toBe(m.bottom + m.altoPildora);
  });

  it('Android con tres botones (48): la píldora queda entera sobre la barra del sistema', () => {
    const m = medidasBarraPestanas({ insetBottom: 48, plataforma: 'android', margenLateral: 16 });
    expect(m.bottom).toBeGreaterThan(48);
  });

  it('sin inset: al menos 12 de aire en ambas plataformas', () => {
    for (const plataforma of ['ios', 'android'] as const) {
      expect(medidasBarraPestanas({ insetBottom: 0, plataforma, margenLateral: 16 }).bottom).toBeGreaterThanOrEqual(12);
    }
  });

  it('el alto de la píldora no depende del inset', () => {
    const a = medidasBarraPestanas({ insetBottom: 0, plataforma: 'ios', margenLateral: 16 });
    const b = medidasBarraPestanas({ insetBottom: 48, plataforma: 'android', margenLateral: 16 });
    expect(a.altoPildora).toBe(b.altoPildora);
  });
});
