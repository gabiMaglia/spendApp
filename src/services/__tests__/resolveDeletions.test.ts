import { ed25519 } from '@noble/curves/ed25519.js';
import { resolvePendingDeletions } from '../resolveDeletions';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { DELETION_TIMEOUT_MS } from '@/src/sync/SyncEngine';
import { recordServerTime, clearClockOffset } from '@/src/utils/syncedClock';
import { emitirVoto } from '@/src/services/deletionVotes';
import { ensureIdentity } from '@/src/store/identityStore';
import { rememberAuthorKey, forgetAuthorKeys } from '@/src/sync/authorKeys';
import { signVote } from '@/src/sync/voteSign';
import { signCore } from '@/src/sync/recordSign';
import { toHex } from '@/src/sync/hexBytes';
import type { DeletionVote, Expense, ExpenseComment } from '@/src/types/models';

jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const AHORA = Date.UTC(2026, 7, 17, 12);
const VENCIDO = AHORA + DELETION_TIMEOUT_MS + 1000;

const gasto = (id: string, votes: DeletionVote[], over: Partial<Expense> = {}): Expense => ({
  id, groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'ana', splitMode: 'equal', splits: [], memberIds: ['ana', 'beto'],
  category: 'food', date: 0, createdAt: 0, createdById: 'ana',
  deletionVotes: votes, updatedAt: 0, isDeleted: false, ...over,
} as Expense);

const pide   = (u: string): DeletionVote => ({ userId: u, votedAt: AHORA, action: 'delete' });
const objeta = (u: string): DeletionVote => ({ userId: u, votedAt: AHORA, action: 'cancel' });

beforeEach(() => {
  useExpenseStore.setState({ expenses: [] });
  useCommentStore.setState({ comments: [] });
});

/**
 * Esto faltaba entero: `resolveDeletionVotes` existía y estaba testeado, pero
 * NO LO LLAMABA NADIE. El plazo de 72hs no vencía nunca y "si nadie objeta se
 * borra" era una promesa que no se cumplía jamás.
 */
describe('vencimiento de las solicitudes de borrado', () => {
  it('pasadas las 72hs sin objeción, se borra', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [pide('beto')])] });

    expect(resolvePendingDeletions(VENCIDO)).toBe(1);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(true);
  });

  it('antes de las 72hs NO se borra', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [pide('beto')])] });

    expect(resolvePendingDeletions(AHORA + 71 * 3600_000)).toBe(0);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
  });

  // Objetar es lo que le da sentido a la ventana: si el plazo venciera igual,
  // objetar no serviría de nada.
  it('una objeción lo salva aunque el plazo haya vencido', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [pide('beto'), objeta('ana')])] });

    expect(resolvePendingDeletions(VENCIDO)).toBe(0);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
  });

  /**
   * T-143 (SEC-01): un `forced` a nombre del creador SIN firma que cierre ya
   * no borra al instante — es la misma protección que `forcedSinFirma.test.ts`
   * ejerce sobre `resolveDeletionVotes`, vista desde el camino de producción.
   */
  it('un forced sin firma NO borra al instante: abre ronda de 72 h', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [
      { userId: 'ana', votedAt: AHORA, action: 'delete', forced: true },
    ])] });

    expect(resolvePendingDeletions(AHORA)).toBe(0);
    expect(resolvePendingDeletions(VENCIDO)).toBe(1);
  });

  it('los gastos sin solicitud no se tocan', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [])] });

    expect(resolvePendingDeletions(VENCIDO)).toBe(0);
  });

  it('un gasto ya borrado no se vuelve a procesar', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [pide('beto')], { isDeleted: true })] });

    expect(resolvePendingDeletions(VENCIDO)).toBe(0);
  });

  // Sin la cascada quedan apuntando a un gasto inexistente y viajan en cada sync.
  it('los comentarios se tombstonean en cascada', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [pide('beto')])] });
    useCommentStore.setState({ comments: [
      { id: 'c1', expenseId: 'e1', authorId: 'beto', text: 'x',
        createdAt: 0, updatedAt: 0, isDeleted: false } as ExpenseComment,
    ]});

    resolvePendingDeletions(VENCIDO);

    expect(useCommentStore.getState().comments[0]!.isDeleted).toBe(true);
  });

  it('procesa varios de una', () => {
    useExpenseStore.setState({ expenses: [
      gasto('e1', [pide('beto')]),
      gasto('e2', [pide('beto')]),
      gasto('e3', []),
    ]});

    expect(resolvePendingDeletions(VENCIDO)).toBe(2);
  });
});

/**
 * **El vencimiento se decide con el reloj corregido, no con el del teléfono**
 * (T-059 · ADR-005).
 *
 * Este es el único lugar donde el reloj llega a borrar un gasto: `resolvePendingDeletions`
 * corre sola en cada arranque y después de cada sync, con el `now` que ella
 * misma se busca. Si ese `now` sale de `Date.now()`, un teléfono con la hora
 * mal puesta borra antes de tiempo o no borra nunca — y nadie ve un error.
 */
describe('el plazo se cuenta contra el reloj corregido', () => {
  afterEach(clearClockOffset);

  it('una hora atrasada no le regala tiempo extra a la solicitud', () => {
    // El teléfono está 2hs atrasado respecto del relay.
    const local = Date.now();
    recordServerTime(new Date(local + 2 * 3_600_000).toISOString(), local);

    // Para el teléfono el pedido tiene 71hs: no vencería. Para la hora real
    // tiene 73hs, y es la que vale.
    useExpenseStore.setState({ expenses: [gasto('e1', [
      { userId: 'beto', votedAt: local - (DELETION_TIMEOUT_MS - 3_600_000), action: 'delete' },
    ])] });

    expect(resolvePendingDeletions()).toBe(1);
  });

  it('y sin referencia del relay sigue funcionando como siempre', () => {
    useExpenseStore.setState({ expenses: [gasto('e1', [
      { userId: 'beto', votedAt: Date.now() - (DELETION_TIMEOUT_MS - 3_600_000), action: 'delete' },
    ])] });

    expect(resolvePendingDeletions()).toBe(0);
  });
});

/**
 * T-143 (SEC-01), de punta a punta: el servicio que corre solo al arrancar y
 * tras cada drenaje tiene que distinguir el override REAL del creador (firmado
 * con una clave que sabemos suya) de uno que un tercero escribió a su nombre.
 */
describe('T-143 · el override del creador exige firma que cierre', () => {
  afterEach(() => forgetAuthorKeys());

  it('un forced firmado por una clave conocida del creador borra ya', () => {
    const { publicKey } = ensureIdentity();
    rememberAuthorKey('ana', publicKey);          // sabemos que esta clave es de Ana
    const e = gasto('e1', []);
    const votos = emitirVoto(e, 'ana', 'force', AHORA); // firma con la privada del aparato
    useExpenseStore.setState({ expenses: [{ ...e, deletionVotes: votos }] });

    expect(resolvePendingDeletions(AHORA + 1)).toBe(1);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(true);
  });

  it('un forced SIN firma a nombre del creador no borra hasta las 72 h', () => {
    const forjado: DeletionVote = { userId: 'ana', votedAt: AHORA, action: 'delete', forced: true };
    useExpenseStore.setState({ expenses: [gasto('e1', [forjado])] });

    expect(resolvePendingDeletions(AHORA + 1)).toBe(0);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
    expect(resolvePendingDeletions(VENCIDO)).toBe(1);
  });

  it('un forced con firma de OTRA clave (no del creador) tampoco es inmediato', () => {
    const { publicKey } = ensureIdentity();
    rememberAuthorKey('ana', 'cc'.repeat(32));     // la clave de Ana es otra
    const voto: DeletionVote = { userId: 'ana', votedAt: AHORA, action: 'delete', forced: true };
    const firmadoPorMallory = { ...voto, ...signVote('e1', voto, ensureIdentity().privateKey) };
    expect(firmadoPorMallory.k).toBe(publicKey);
    useExpenseStore.setState({ expenses: [gasto('e1', [firmadoPorMallory])] });

    expect(resolvePendingDeletions(AHORA + 1)).toBe(0);
  });
});

/**
 * T-170 · D-1 (regresión del verificador ciego, `T-170-verifier.md` D1): con
 * el fix de D-2 sin consumidor, Mallory re-estampaba el núcleo con su id,
 * emitía un `forced` firmado CON SU PROPIA CLAVE (la firma cierra: es de
 * ella) y `resolvePendingDeletions` la honraba de inmediato.
 *
 * El predicado único (`src/sync/forcedTrust.ts`, `esForcedConfiable`) corta
 * esto exigiendo `!enDisputa(e)` ADEMÁS de la firma que cierra. Acá se prueba
 * con crypto real: dos claves conocidas, dos núcleos que verifican — la
 * disputa es ATRIBUIBLE, no un id suelto.
 */
describe('T-170 · D-1: un forced no es confiable con autoría en disputa', () => {
  afterEach(() => forgetAuthorKeys());

  const PRIV_ANA = toHex(new Uint8Array(32).fill(9));
  const PUB_ANA = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(9)));

  const nucleoBase = {
    id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
    paidById: 'ana', splits: [], splitMode: 'equal', category: 'food',
    date: 0, createdAt: 0, createdById: 'ana', rev: 1,
  };
  const nucleoAna = { ...nucleoBase, ...signCore('expense', nucleoBase as never, PRIV_ANA) };

  it('Mallory re-estampa el núcleo, lo firma con su clave y emite un forced firmado: NO borra al instante', () => {
    const { publicKey, privateKey } = ensureIdentity();
    rememberAuthorKey('mallory', publicKey);
    rememberAuthorKey('ana', PUB_ANA);

    const nucleoVigente = { ...nucleoBase, createdById: 'mallory', amount: 1, rev: 2 };
    const firmadoPorMallory = { ...nucleoVigente, ...signCore('expense', nucleoVigente as never, privateKey) };

    const e = gasto('e1', [], {
      ...firmadoPorMallory,
      autoriaDisputada: [nucleoAna as never],
    } as Partial<Expense>);
    const votos = emitirVoto(e, 'mallory', 'force', AHORA);
    useExpenseStore.setState({ expenses: [{ ...e, deletionVotes: votos }] });

    // No es inmediato: la disputa degrada a los DOS lados al camino seguro.
    expect(resolvePendingDeletions(AHORA + 1)).toBe(0);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(false);
    // Pero tampoco queda bloqueado para siempre: sin objeción, vence igual a las 72h.
    expect(resolvePendingDeletions(VENCIDO)).toBe(1);
  });

  it('baseline: el MISMO forced, sin disputa registrada, sigue borrando al instante (no regresiona)', () => {
    const { publicKey, privateKey } = ensureIdentity();
    rememberAuthorKey('mallory', publicKey);

    const nucleoVigente = { ...nucleoBase, createdById: 'mallory', amount: 1, rev: 2 };
    const firmadoPorMallory = { ...nucleoVigente, ...signCore('expense', nucleoVigente as never, privateKey) };

    const e = gasto('e1', [], { ...firmadoPorMallory } as Partial<Expense>);
    const votos = emitirVoto(e, 'mallory', 'force', AHORA);
    useExpenseStore.setState({ expenses: [{ ...e, deletionVotes: votos }] });

    expect(resolvePendingDeletions(AHORA + 1)).toBe(1);
    expect(useExpenseStore.getState().expenses[0]!.isDeleted).toBe(true);
  });

  it('con la disputa registrada pero SIN la clave de Ana conocida: no es atribuible — sigue borrando ya (fail-safe hacia el lado de antes, no una acusación gratis)', () => {
    const { publicKey, privateKey } = ensureIdentity();
    rememberAuthorKey('mallory', publicKey);
    // Ojo: NO se llama rememberAuthorKey('ana', ...) — su clave es desconocida.

    const nucleoVigente = { ...nucleoBase, createdById: 'mallory', amount: 1, rev: 2 };
    const firmadoPorMallory = { ...nucleoVigente, ...signCore('expense', nucleoVigente as never, privateKey) };

    const e = gasto('e1', [], {
      ...firmadoPorMallory,
      autoriaDisputada: [nucleoAna as never],
    } as Partial<Expense>);
    const votos = emitirVoto(e, 'mallory', 'force', AHORA);
    useExpenseStore.setState({ expenses: [{ ...e, deletionVotes: votos }] });

    expect(resolvePendingDeletions(AHORA + 1)).toBe(1);
  });
});
