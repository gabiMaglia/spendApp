import { DURACION, ESCALA_PRESION, ESCALONADO_MS, RESORTE_MARCA, duracionSegun } from '@/src/constants/movimiento';

describe('movimiento — tokens de la marca', () => {
  it('el resorte de la marca es el del abanico (sharp, swift and soft)', () => {
    expect(RESORTE_MARCA).toEqual({ stiffness: 560, damping: 38, mass: 1 });
  });

  it('las duraciones crecen de la más corta a la más larga', () => {
    const orden = [DURACION.fundido, DURACION.salida, DURACION.corta, DURACION.media, DURACION.larga];
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it('la escala de presión achica un poco, nunca invierte', () => {
    expect(ESCALA_PRESION).toBeGreaterThan(0.9);
    expect(ESCALA_PRESION).toBeLessThan(1);
    expect(ESCALONADO_MS).toBeGreaterThan(0);
  });

  it('con reducir movimiento la duración es 0; sin él, la pedida', () => {
    expect(duracionSegun(DURACION.corta, true)).toBe(0);
    expect(duracionSegun(DURACION.corta, false)).toBe(DURACION.corta);
    // `null` = la consulta de accesibilidad aún no resolvió: se anima, como hace el resto de la app.
    expect(duracionSegun(DURACION.corta, null)).toBe(DURACION.corta);
  });
});
