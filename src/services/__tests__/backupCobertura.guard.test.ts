import { COBERTURA_FUSION, EXCLUIDOS_FUSION } from '@/src/store/accountLink';
import { INCLUIDOS_BACKUP, EXCLUIDOS_BACKUP } from '../backup';

/**
 * Guard de la misma clase de bug que `accountCoverage.test.ts` cierra para la
 * fusión de cuentas, ahora para el backup (T-213): un módulo que persiste
 * scopeado por cuenta y que nadie decidió si el backup lo exporta o no.
 *
 * No vuelve a escanear `src/` — ESO ya lo hace `accountCoverage.test.ts`, que
 * es la fuente de verdad de "qué persiste por cuenta" (`COBERTURA_FUSION` ∪
 * `EXCLUIDOS_FUSION`). Esta guard compara esa misma lista de ids de módulo
 * contra las tablas del backup: cada módulo tiene que estar en
 * `INCLUIDOS_BACKUP` (qué campo del `BackupFile` lo lleva) o en
 * `EXCLUIDOS_BACKUP` (por qué no), nunca en ninguna, nunca en las dos.
 */
const MODULOS_POR_CUENTA = [
  ...Object.keys(COBERTURA_FUSION),
  ...Object.keys(EXCLUIDOS_FUSION),
];

describe('T-213: todo módulo por cuenta está en el backup o excluido con motivo', () => {
  it('ningún módulo por cuenta queda sin declarar en el backup', () => {
    const sinDeclarar = MODULOS_POR_CUENTA.filter(
      id => !(id in INCLUIDOS_BACKUP) && !(id in EXCLUIDOS_BACKUP),
    );
    expect(sinDeclarar).toEqual([]);
  });

  it('nada está incluido y excluido del backup a la vez', () => {
    const ambos = Object.keys(INCLUIDOS_BACKUP).filter(id => id in EXCLUIDOS_BACKUP);
    expect(ambos).toEqual([]);
  });

  it('no quedan declaraciones de módulos que ya no persisten por cuenta', () => {
    const reales = new Set(MODULOS_POR_CUENTA);
    const declarados = [...Object.keys(INCLUIDOS_BACKUP), ...Object.keys(EXCLUIDOS_BACKUP)];
    expect(declarados.filter(id => !reales.has(id))).toEqual([]);
  });

  it('cada inclusión dice a qué campo del BackupFile va', () => {
    for (const [modulo, campo] of Object.entries(INCLUIDOS_BACKUP)) {
      expect(`${modulo}: ${campo}`.length).toBeGreaterThan(15);
    }
  });

  it('cada exclusión lleva un motivo escrito, no un pase libre', () => {
    // Mismo criterio que accountCoverage.test.ts: no prueba que el motivo sea
    // cierto (ninguna aserción puede) — descarta el pase libre de una palabra.
    for (const [modulo, motivo] of Object.entries(EXCLUIDOS_BACKUP)) {
      expect(`${modulo}: ${motivo}`.length).toBeGreaterThan(40);
    }
  });
});
