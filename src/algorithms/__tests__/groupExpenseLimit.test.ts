import { debeAvisar, estaBloqueado } from '../groupExpenseLimit';
import { LIMITE_GASTOS_GRUPO, AVISO_GASTOS_GRUPO } from '@/src/constants/groupLimits';

describe('límite de gastos por grupo', () => {
  it('las constantes son las acordadas (450 duro / 350 aviso)', () => {
    expect(LIMITE_GASTOS_GRUPO).toBe(450);
    expect(AVISO_GASTOS_GRUPO).toBe(350);
  });

  it('no avisa por debajo del umbral', () => {
    expect(debeAvisar(349)).toBe(false);
  });

  it('avisa desde el umbral', () => {
    expect(debeAvisar(350)).toBe(true);
  });

  it('deja de avisar (porque ya está bloqueado) en el límite duro', () => {
    expect(debeAvisar(450)).toBe(false);
  });

  it('avisa justo antes del límite duro', () => {
    expect(debeAvisar(449)).toBe(true);
  });

  it('no bloquea por debajo del límite duro', () => {
    expect(estaBloqueado(449)).toBe(false);
  });

  it('bloquea en el límite duro', () => {
    expect(estaBloqueado(450)).toBe(true);
  });

  it('sigue bloqueado por encima del límite duro', () => {
    expect(estaBloqueado(451)).toBe(true);
  });
});
