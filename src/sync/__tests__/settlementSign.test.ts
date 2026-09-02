import { ed25519 } from '@noble/curves/ed25519.js';
import { signSettlement, verifySettlement } from '../settlementSign';
import { canonicalSettlement, settlementStatement, SETTLEMENT_VERSION } from '../settlementCore';
import { toHex } from '../hexBytes';
import type { SettlementConfirmation } from '@/src/types/models';

const PRIV = 'a'.repeat(64);
const PUB  = toHex(ed25519.getPublicKey(Buffer.from(PRIV, 'hex')));

const acuse = (o: Partial<SettlementConfirmation> = {}): SettlementConfirmation => ({
  userId: 'beto', confirmedAt: 1_000, action: 'confirm', ...o,
});

describe('firmar y verificar un acuse', () => {
  it('lo firmado por el aparato verifica', () => {
    const c = { ...acuse(), ...signSettlement('p1', acuse(), PRIV) };
    expect(verifySettlement('p1', c, [PUB])).toBe('valida');
  });

  /**
   * **El vector que justifica que `paymentId` vaya adentro de la firma.** Sin
   * él, un "sí, lo recibí" de un saldado de mil pesos se copia tal cual a uno
   * de cien mil y la firma sigue cerrando.
   */
  it('un acuse NO vale para otro pago', () => {
    const c = { ...acuse(), ...signSettlement('p1', acuse(), PRIV) };
    expect(verifySettlement('p2', c, [PUB])).toBe('invalida');
  });

  it('cambiarle la acción rompe la firma', () => {
    const c = { ...acuse(), ...signSettlement('p1', acuse(), PRIV) };
    expect(verifySettlement('p1', { ...c, action: 'reject' }, [PUB])).toBe('invalida');
  });

  it('cambiarle el usuario rompe la firma', () => {
    const c = { ...acuse(), ...signSettlement('p1', acuse(), PRIV) };
    expect(verifySettlement('p1', { ...c, userId: 'caro' }, [PUB])).toBe('invalida');
  });

  // Falta de información, no sospecha: un peer que no actualizó manda esto.
  it('sin firma es no_verificable, no una acusación', () => {
    expect(verifySettlement('p1', acuse(), [PUB])).toBe('no_verificable');
  });

  it('sin claves del autor tampoco se acusa a nadie', () => {
    const c = { ...acuse(), ...signSettlement('p1', acuse(), PRIV) };
    expect(verifySettlement('p1', c, [])).toBe('no_verificable');
  });

  it('firmado con una clave ajena al autor: inválida', () => {
    const otra = toHex(ed25519.getPublicKey(Buffer.from('b'.repeat(64), 'hex')));
    const c = { ...acuse(), ...signSettlement('p1', acuse(), PRIV) };
    expect(verifySettlement('p1', c, [otra])).toBe('invalida');
  });

  it('hex roto no tira: es una firma que no cierra', () => {
    expect(verifySettlement('p1', { ...acuse(), k: PUB, s: 'nada' }, [PUB])).toBe('invalida');
  });
});

describe('el enunciado', () => {
  it('lleva el pago y su propio tipo, para no leerse como otra cosa', () => {
    const st = settlementStatement('p1', acuse());
    expect(st).toMatchObject({ v: SETTLEMENT_VERSION, t: 'settlement', paymentId: 'p1' });
  });

  it('dos acuses iguales producen el mismo mensaje', () => {
    expect(canonicalSettlement('p1', acuse())).toBe(canonicalSettlement('p1', acuse()));
  });

  // La clave del `k`/`s` no entra en lo firmado: firmar la propia firma no
  // cierra nunca.
  it('la firma no se firma a sí misma', () => {
    const a = canonicalSettlement('p1', acuse());
    const b = canonicalSettlement('p1', { ...acuse(), k: PUB, s: 'x' });
    expect(a).toBe(b);
  });
});

/**
 * D9 de T-041: el derivador de estado corre en cada render de balance. Si este
 * grafo arrastrara `@noble`, se pagarían 18 ms por acuse (medido en el device
 * del PO) en el camino más caliente de la app.
 */
describe('el núcleo del acuse no toca criptografía', () => {
  it('settlementCore no importa @noble', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'settlementCore.ts'), 'utf8');
    // Sólo los `import`: el docblock del archivo NOMBRA a @noble para explicar
    // por qué no está, y un guard que se tropieza con su propia explicación
    // enseña a borrar la explicación.
    const imports = src.split('\n').filter((l: string) => /^\s*import\b/.test(l)).join('\n');
    expect(imports).not.toMatch(/@noble/);
  });
});
