import { ed25519 } from '@noble/curves/ed25519.js';
import { signCore, verifyCore } from '../recordSign';
import { coreFieldsOf, slotsOf, CORE_KINDS } from '../recordCore';
import { toHex } from '../hexBytes';
import { FIXTURES, alter, EXPENSE } from '@/src/test-utils/recordFixtures';

/**
 * Meta-test de mutación (riesgo 4 del §QUÉ de T-041).
 *
 * **Un test verde que nunca vio un núcleo alterado no prueba nada.** Acá se
 * rompe cada campo del núcleo POR SEPARADO y se exige que el verificador lo
 * vea; y se toca cada campo de afuera por separado y se exige que la firma
 * SIGA valiendo. Las dos direcciones importan: un núcleo que se queda corto
 * deja pasar la suplantación, y uno que se pasa de goloso rompe el borrado
 * consensuado el primer día.
 *
 * La lista de campos NO está escrita a mano: sale de la clasificación de
 * `recordCore`, así que agregar una entidad o un campo entra solo al meta-test.
 */

const priv = new Uint8Array(32).fill(3);
const PRIV = toHex(priv);
const PUB = toHex(ed25519.getPublicKey(priv));

function firmar(
  kind: (typeof CORE_KINDS)[number], record: Record<string, unknown>,
): Record<string, unknown> {
  return { ...record, ...signCore(kind, record as never, PRIV) };
}

describe.each(FIXTURES)('$kind — cada campo del núcleo, roto por separado', ({ kind, record }) => {
  const firmado = firmar(kind, record);

  it('la línea base verifica (si no, el resto no prueba nada)', () => {
    expect(verifyCore(kind, firmado as never, [PUB])).toBe('valida');
  });

  it.each(coreFieldsOf(kind))('romper `%s` invalida la firma', (campo) => {
    const roto = { ...firmado, [campo]: alter(firmado[campo as keyof typeof firmado]) };
    expect(roto[campo as keyof typeof roto]).not.toEqual(firmado[campo as keyof typeof firmado]);
    expect(verifyCore(kind, roto as never, [PUB])).toBe('invalida');
  });

  it.each(coreFieldsOf(kind))('BORRAR `%s` invalida la firma', (campo) => {
    const roto: Record<string, unknown> = { ...firmado };
    delete roto[campo];
    expect(verifyCore(kind, roto as never, [PUB])).toBe('invalida');
  });
});

describe.each(FIXTURES)('$kind — lo colaborativo NO puede invalidar la firma del autor', ({ kind, record }) => {
  const firmado = firmar(kind, record);
  const fuera = Object.entries(slotsOf(kind))
    .filter(([campo, slot]) => slot === 'fuera' && campo !== 'k' && campo !== 's')
    .map(([campo]) => campo);

  it('hay campos de afuera que probar', () => {
    expect(fuera.length).toBeGreaterThan(0);
  });

  it.each(fuera)('tocar `%s` deja la firma válida', (campo) => {
    const tocado = { ...firmado, [campo]: alter(firmado[campo as keyof typeof firmado]) };
    expect(verifyCore(kind, tocado as never, [PUB])).toBe('valida');
  });

  it.each(fuera)('BORRAR `%s` deja la firma válida', (campo) => {
    const tocado: Record<string, unknown> = { ...firmado };
    delete tocado[campo];
    expect(verifyCore(kind, tocado as never, [PUB])).toBe('valida');
  });
});

/**
 * Los tres escenarios de negocio que el §QUÉ nombra por su nombre. Están
 * cubiertos por los recorridos de arriba, pero se escriben aparte porque son la
 * razón de ser del ticket: si alguno se cae, la lectura de qué se rompió tiene
 * que ser inmediata, no "falló la fila 9 de un it.each".
 */
describe('los ataques del §QUÉ, uno por uno', () => {
  const firmado = firmar('expense', EXPENSE);

  it('cambiarle el monto a un gasto ajeno', () => {
    expect(verifyCore('expense', { ...firmado, amount: 1 } as never, [PUB])).toBe('invalida');
  });

  it('redistribuir los splits de un gasto ajeno', () => {
    const splits = [
      { userId: 'ana', amount: 12_345, isPaid: false },
      { userId: 'beto', amount: 0, isPaid: false },
    ];
    expect(verifyCore('expense', { ...firmado, splits } as never, [PUB])).toBe('invalida');
  });

  it('re-atribuir el gasto a otro autor', () => {
    expect(verifyCore('expense', { ...firmado, createdById: 'beto' } as never, [PUB]))
      .toBe('invalida');
  });

  it('subir `rev` sin poder re-firmar', () => {
    expect(verifyCore('expense', { ...firmado, rev: 9_999_999 } as never, [PUB]))
      .toBe('invalida');
  });

  /**
   * Éste es el que rompe el proyecto si el núcleo se pasa de goloso: el que vota
   * un borrado NO tiene la privada del autor y no puede re-firmar. Si
   * `updatedAt`/`deletionVotes` entraran al núcleo, votar invalidaría el gasto.
   */
  it('un tercero vota el borrado y la firma del autor SIGUE valiendo', () => {
    const votado = {
      ...firmado,
      updatedAt: (firmado.updatedAt as number) + 1,
      deletionVotes: [
        ...(firmado.deletionVotes as unknown[]),
        { userId: 'caro', votedAt: 9_000, action: 'delete' },
      ],
      isDeleted: true,
    };
    expect(verifyCore('expense', votado as never, [PUB])).toBe('valida');
  });

  /** C.1f: cualquier device materializa una plantilla ajena. */
  it('un tercero materializa la recurrente y la firma del autor SIGUE valiendo', () => {
    const rec = firmar('recurring', FIXTURES.find(f => f.kind === 'recurring')!.record);
    const materializado = { ...rec, lastMaterializedAt: 1_800_000_000_000, updatedAt: 9_000 };
    expect(verifyCore('recurring', materializado as never, [PUB])).toBe('valida');
  });
});
