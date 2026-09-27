import { ed25519 } from '@noble/curves/ed25519.js';
import { toHex } from '../hexBytes';
import { signCore } from '../recordSign';
import { rememberAuthorKey, forgetAuthorKeys } from '../authorKeys';
import { enDisputa, autoresVerificados } from '../autoriaTrust';
import { mergeRecord } from '@/src/store/mergeLevels';
import type { Expense } from '@/src/types/models';

/**
 * T-170 · D-2, enmienda de disputa firmada — ronda 2 (dictamen del
 * verificador D-3: «basta inyectar un id sin reescribir el núcleo»).
 *
 * `enDisputa`/`autoresVerificados` son lo que decide si una disputa
 * REGISTRADA por el merge (unión estructural, `autoria.ts`) es ATRIBUIBLE de
 * verdad: sólo cuenta un autor cuyo núcleo (vigente o competidor) verifica
 * `valida` contra su clave conocida. Con crypto real —no hex de adorno— para
 * que un mutante que acepte cualquier entrada sin verificar tumbe el test.
 */

const NOW = 1_800_000_000_000;
const PRIV_ANA = toHex(new Uint8Array(32).fill(5));
const PUB_ANA = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(5)));
const PRIV_MALLORY = toHex(new Uint8Array(32).fill(6));
const PUB_MALLORY = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(6)));

const base = {
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS', paidById: 'ana',
  createdById: 'ana', splits: [], splitMode: 'equal', category: 'food', date: NOW - 10_000,
  createdAt: NOW - 10_000, updatedAt: NOW - 10_000, isDeleted: false, rev: NOW - 10_000,
  deletionVotes: [],
} as unknown as Expense;

const deAna = { ...base, ...signCore('expense', base as never, PRIV_ANA) } as Expense;
const malloryNucleo = { ...base, createdById: 'mallory', amount: 1, rev: NOW - 9_000, updatedAt: NOW - 9_000 } as Expense;
const deMallory = { ...malloryNucleo, ...signCore('expense', malloryNucleo as never, PRIV_MALLORY) } as Expense;

afterEach(() => forgetAuthorKeys());

describe('enDisputa / autoresVerificados (T-170 · D-2, verificación real)', () => {
  it('un gasto sin disputa registrada: un solo autor, no hay disputa', () => {
    rememberAuthorKey('ana', PUB_ANA);
    expect(enDisputa(deAna)).toBe(false);
    expect(autoresVerificados(deAna)).toEqual(['ana']);
  });

  it('Mallory re-estampa el núcleo y lo firma con su clave: disputa ATRIBUIDA a los dos', () => {
    rememberAuthorKey('ana', PUB_ANA);
    rememberAuthorKey('mallory', PUB_MALLORY);
    const disputado = mergeRecord('expense', deAna, deMallory, NOW);

    expect(enDisputa(disputado)).toBe(true);
    expect([...autoresVerificados(disputado)]).toEqual(['ana', 'mallory']);
  });

  it('sin la clave de NINGUNO de los dos: no se puede atribuir nada — no hay disputa', () => {
    const disputado = mergeRecord('expense', deAna, deMallory, NOW);
    expect(enDisputa(disputado)).toBe(false);
    expect(autoresVerificados(disputado)).toEqual([]);
  });

  it('con la clave de uno solo: sólo ESE cuenta — sigue sin haber disputa (hace falta a los dos)', () => {
    rememberAuthorKey('ana', PUB_ANA);
    const disputado = mergeRecord('expense', deAna, deMallory, NOW);
    expect(enDisputa(disputado)).toBe(false);
    expect(autoresVerificados(disputado)).toEqual(['ana']);
  });

  it('ronda 1 (ya cerrada): inyectar SÓLO el id, sin núcleo ni firma, no abre nada — Ana conserva "Forzar"', () => {
    rememberAuthorKey('ana', PUB_ANA);
    const inyectado = { ...deAna, autoriaDisputada: ['ana', 'mallory'] } as unknown as Expense;
    expect(enDisputa(inyectado)).toBe(false);
  });

  it('firma basura (misma forma, no verifica): se ignora — la entrada NO cuenta', () => {
    rememberAuthorKey('ana', PUB_ANA);
    rememberAuthorKey('mallory', PUB_MALLORY);
    // Mallory gana el núcleo (rev mayor): queda como VIGENTE, con su firma real
    // intacta. La entrada de `autoriaDisputada` que queda es la de Ana (la
    // perdedora) — se corrompe ESA, para no confundir "la vigente ya verificaba
    // igual" con "la entrada corrupta se ignoró".
    const disputado = mergeRecord('expense', deAna, deMallory, NOW);
    const conBasura = {
      ...disputado,
      autoriaDisputada: disputado.autoriaDisputada!.map(n =>
        n.createdById === 'ana' ? { ...n, s: 'ff'.repeat(64) } : n),
    };
    // La de Ana ya no verifica (firma basura); sólo Mallory (vigente) cuenta.
    expect(autoresVerificados(conBasura)).toEqual(['mallory']);
    expect(enDisputa(conBasura)).toBe(false);
  });

  it('convergencia: el mismo par mergeado en los DOS órdenes da la misma disputa atribuida', () => {
    rememberAuthorKey('ana', PUB_ANA);
    rememberAuthorKey('mallory', PUB_MALLORY);
    const a = mergeRecord('expense', deAna, deMallory, NOW);
    const b = mergeRecord('expense', deMallory, deAna, NOW);
    expect(autoresVerificados(a)).toEqual(autoresVerificados(b));
    expect(enDisputa(a)).toBe(enDisputa(b));
  });

  it('el verificador se puede inyectar (no depende del directorio real en el test)', () => {
    const e = { ...deAna, autoriaDisputada: [{ ...deMallory } as never] } as unknown as Expense;
    const siempreValida = () => 'valida' as const;
    expect(enDisputa(e, siempreValida)).toBe(true);
    const siempreInvalida = () => 'invalida' as const;
    expect(enDisputa(e, siempreInvalida)).toBe(false);
  });

  /**
   * T-170 · D-3, ronda de retorno 2 (dictamen del verificador, defecto 1):
   * Mallory NO necesita re-estampar nada. Le alcanza con pegar en
   * `autoriaDisputada` de un gasto CUALQUIERA (e1, de Ana) el núcleo
   * LEGÍTIMO —y legítimamente firmado— de OTRO gasto de Beto (`e-otro`). La
   * firma de Beto cierra (es de verdad SU núcleo, de SU gasto), pero
   * `calcular` no exigía que ese núcleo fuera del gasto que lo aloja. PoC
   * P3c del verifier: Mallory queda anónima, Beto aparece acusado, y Ana
   * pierde su "Forzar".
   */
  it('PoC P3c: un núcleo legítimo de OTRO gasto (mismo id/groupId distintos) no cuenta como disputa de ESTE gasto', () => {
    rememberAuthorKey('ana', PUB_ANA);
    const PRIV_BETO = toHex(new Uint8Array(32).fill(7));
    const PUB_BETO = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(7)));
    rememberAuthorKey('beto', PUB_BETO);

    // El núcleo REAL de Beto, para OTRO gasto (`e-otro`, incluso otro grupo).
    const deOtroGasto = {
      ...base, id: 'e-otro', groupId: 'g-otro', createdById: 'beto', rev: 1,
    };
    const nucleoDeBetoParaOtroGasto =
      { ...deOtroGasto, ...signCore('expense', deOtroGasto as never, PRIV_BETO) };

    // Mallory lo pega, tal cual, en el gasto de Ana (e1) — sin re-estampar nada.
    const replay = {
      ...deAna,
      autoriaDisputada: [nucleoDeBetoParaOtroGasto as never],
    } as unknown as Expense;

    expect(autoresVerificados(replay)).toEqual(['ana']);
    expect(enDisputa(replay)).toBe(false);
  });

  /**
   * T-185. Un gasto editado por alguien que no es el autor es ahora el caso
   * NORMAL (cualquier miembro edita, sin gate) — no un ataque. `calcular`
   * tiene que verificar el núcleo VIGENTE contra el firmante EFECTIVO
   * (`editedById ?? createdById`), no sólo contra `createdById`: si no, la
   * firma real de quien editó jamás cerraría contra su propia clave, y ese
   * editor legítimo desaparecería en silencio de `autoresVerificados` en
   * cuanto el gasto entrara en CUALQUIER disputa por otro motivo (por ejemplo
   * el escenario de Mallory de más arriba, sobre el mismo id).
   */
  it('el firmante efectivo del vigente (editedById) cuenta, no createdById a secas', () => {
    rememberAuthorKey('ana', PUB_ANA);
    rememberAuthorKey('mallory', PUB_MALLORY);

    // Beto editó el gasto de Ana (createdById sigue siendo 'ana') y lo firmó
    // él. Acá se usa la clave de Mallory sólo para reusar los fixtures de
    // arriba — lo que importa es que `editedById` ≠ `createdById` y que la
    // firma es real.
    const editado = { ...base, editedById: 'mallory', rev: NOW - 8_000, updatedAt: NOW - 8_000 };
    const vigente = {
      ...editado,
      ...signCore('expense', editado as never, PRIV_MALLORY),
    } as unknown as Expense;

    expect(enDisputa(vigente)).toBe(false);
    expect([...autoresVerificados(vigente)]).toEqual(['mallory']);
  });
});
