import { elegirClaveDeGrupo } from '../elegirClaveDeGrupo';
import * as groupKeyOffersModule from '@/src/sync/groupKeyOffers';
import * as pendingDrainModule from '@/src/sync/pendingDrain';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useGroupStore } from '@/src/store/groupStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

type KeyOffer = groupKeyOffersModule.KeyOffer;

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}), drainNow: jest.fn(async () => 0), startRelay: jest.fn(async () => {}),
}));

/**
 * T-136 · ADR-013. Elegir es la ÚNICA forma de sustituir una clave de grupo que
 * ya está en uso, y sólo sobre una que vino de contacto. Primero se purga lo
 * local del grupo: nada del grupo falso puede terminar publicado con la real.
 */

const relayEngine = jest.requireMock('@/src/sync/relayEngine') as {
  drainNow: jest.Mock; publishNow: jest.Mock;
};

const YO = { id: 'ana', name: 'Ana' } as User;
const FALSA = 'ab'.repeat(32);
const REAL = 'cd'.repeat(32);
const OTRA = 'ee'.repeat(32);
const meta = { updatedAt: 1, isDeleted: false };

const grupo = (id: string) => ({
  id, name: 'Viaje', memberIds: ['ana', 'u-mallory'], currency: 'ARS',
  createdAt: 0, createdById: 'u-mallory', deletionVotes: [], ...meta,
}) as never;
const gasto = (id: string, groupId: string) => ({
  id, groupId, description: id, amount: 1, currency: 'ARS', paidById: 'ana', splitMode: 'equal',
  splits: [], category: 'other', date: 0, createdAt: 0, createdById: 'ana', deletionVotes: [], ...meta,
}) as never;

const oferta = (fromUserId: string, key: string, epoch: number): KeyOffer => ({
  groupId: 'g1', fromUserId, key, epoch, origen: 'contact', receivedAt: 0, adoptada: false,
});

beforeEach(() => {
  for (const b of ['groups', 'expenses', 'payments', 'recurring', 'comments', 'groupkeys'] as const) {
    createSecureStorage(b).clearAll();
  }
  jest.clearAllMocks();
  useAuthStore.setState({ currentUser: YO });
  useGroupStore.setState({ groups: [grupo('g1'), grupo('g2')] });
  useExpenseStore.setState({ expenses: [gasto('e-falso', 'g1'), gasto('e-otro', 'g2')] });
  useGroupKeyStore.setState({ keys: [] });
});

/** Tras el ataque en dos lotes: K' de Mallory adoptada por contacto y la oferta de Beto en disputa. */
function trasElAtaque(): void {
  useGroupKeyStore.setState({ keys: [
    { groupId: 'g1', key: FALSA, epoch: 1e9 },
    { groupId: 'g2', key: OTRA, epoch: 1 },
  ] });
  groupKeyOffersModule.registrarOferta(oferta('u-mallory', FALSA, 1e9));
  groupKeyOffersModule.marcarAdoptada('g1', 'u-mallory');
  groupKeyOffersModule.registrarOferta(oferta('u-beto', REAL, 3));
}

const idsDeGastos = () => useExpenseStore.getState().expenses.map(e => e.id);
const idsDeGrupos = () => useGroupStore.getState().groups.map(g => g.id);

describe('elegir la clave de un remitente', () => {
  it('purga lo local del grupo, adopta la elegida con SU época y deja el grupo pendiente de drenaje', async () => {
    trasElAtaque();

    expect(await elegirClaveDeGrupo('g1', 'u-beto')).toBe(true);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual({ groupId: 'g1', key: REAL, epoch: 3 });
    expect(idsDeGastos()).toEqual(['e-otro']);
    expect(idsDeGrupos()).toEqual(['g2']);
    expect(pendingDrainModule.estaPendienteDeDrenaje('g1')).toBe(true);
    expect(relayEngine.drainNow).toHaveBeenCalledWith('g1');
  });

  it('queda sólo la oferta elegida, adoptada: la nueva clave local vino de contacto', async () => {
    trasElAtaque();
    await elegirClaveDeGrupo('g1', 'u-beto');

    expect(groupKeyOffersModule.ofertasDe('g1')).toEqual(
      [expect.objectContaining({ fromUserId: 'u-beto', adoptada: true })]);
    expect(groupKeyOffersModule.claveLocalVinoDeContacto('g1')).toBe(true);
  });

  it('no toca la clave de otros grupos', async () => {
    trasElAtaque();
    await elegirClaveDeGrupo('g1', 'u-beto');
    expect(useGroupKeyStore.getState().getKey('g2')).toEqual({ groupId: 'g2', key: OTRA, epoch: 1 });
  });

  // No llama a `salirDelGrupo`: publicar la salida iría al topic del atacante.
  it('no publica nada', async () => {
    trasElAtaque();
    await elegirClaveDeGrupo('g1', 'u-beto');
    expect(relayEngine.publishNow).not.toHaveBeenCalled();
  });

  it('criterio 2 · sin clave local y con ofertas en conflicto (mismo lote) se puede elegir', async () => {
    groupKeyOffersModule.registrarOferta(oferta('u-mallory', FALSA, 1e9));
    groupKeyOffersModule.registrarOferta(oferta('u-beto', REAL, 3));

    expect(await elegirClaveDeGrupo('g1', 'u-beto')).toBe(true);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(REAL);
  });
});

describe('cuándo NO se puede elegir (S3-A1)', () => {
  it('un remitente sin oferta → false sin efectos', async () => {
    trasElAtaque();

    expect(await elegirClaveDeGrupo('g1', 'u-nadie')).toBe(false);

    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);
    expect(idsDeGastos()).toContain('e-falso');
    expect(relayEngine.drainNow).not.toHaveBeenCalled();
  });

  it('una clave local de ensureKey/QR/invitación (sin oferta adoptada) → false aunque haya ofertas', async () => {
    // Conflicto en el mismo lote (no se adoptó nada) y después el QR trajo otra clave.
    groupKeyOffersModule.registrarOferta(oferta('u-mallory', FALSA, 1e9));
    groupKeyOffersModule.registrarOferta(oferta('u-beto', REAL, 3));
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: 'ff'.repeat(32), epoch: 2 }] });

    expect(await elegirClaveDeGrupo('g1', 'u-beto')).toBe(false);

    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe('ff'.repeat(32));
    expect(idsDeGastos()).toContain('e-falso');
    expect(relayEngine.drainNow).not.toHaveBeenCalled();
  });

  it('conflicto FORZADO (tope lleno tapó una clave distinta) → false sin efectos, aunque haya oferta del remitente', async () => {
    // La disidencia real de Beto nunca entró a la tabla porque un tope estaba
    // lleno, pero `marcarConflictoForzado` la deja registrada igual: elegir acá
    // sería inventar que la real está entre las ofertas cuando puede no estarlo.
    trasElAtaque();
    groupKeyOffersModule.marcarConflictoForzado('g1');

    expect(await elegirClaveDeGrupo('g1', 'u-beto')).toBe(false);

    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);
    expect(idsDeGastos()).toContain('e-falso');
    expect(relayEngine.drainNow).not.toHaveBeenCalled();
  });
});

describe('T-136 fix round 1 · orden interno', () => {
  /**
   * `adoptKeys` guarda la clave con un `set()` síncrono, pero la marca de
   * pendiente-de-drenaje que dispara internamente (`marcarConTopic`) es
   * `void` — no se espera. Hay una ventana real entre que la clave real queda
   * puesta y esa marca aparece: un `schedulePublish` con debounce que haya
   * quedado vivo de cuando el grupo tenía la clave falsa podría disparar
   * justo ahí, y `publishNow` sellaría el payload recién purgado —casi
   * vacío— con la clave REAL como si fuera el estado real del grupo.
   *
   * Por eso `elegirClaveDeGrupo` tiene que marcar pendiente de drenaje, y
   * registrar la oferta elegida como adoptada, ANTES de llamar a
   * `adoptKeys` — no después.
   *
   * ⚠️ Ojo con CÓMO se prueba esto: espiar `useGroupKeyStore.getState().adoptKeys`
   * directamente (una acción del store) CONTAMINA los tests siguientes. El
   * store hace `Object.assign({}, estadoActual, parcial)` en cada `set()`
   * interno (p.ej. el `forgetKey` de la purga, que corre ANTES de llegar acá),
   * así que copia la referencia mutada hacia el objeto de estado siguiente —
   * y `mockRestore()` sólo repara el objeto viejo sobre el que se espió, no el
   * nuevo que ya quedó circulando. Por eso acá se espía la función de MÓDULO
   * (`marcarPendienteDeDrenaje` / `registrarOferta`, exports planos, no
   * acciones del store) y se mira el estado de la clave en el momento en que
   * cada una corre — sin tocar nunca una acción del store.
   */
  it('marca pendiente de drenaje ANTES de que la clave real quede adoptada', async () => {
    trasElAtaque();

    let claveYaEraLaRealAlMarcar: boolean | null = null;
    const real = jest.requireActual<typeof import('@/src/sync/pendingDrain')>('@/src/sync/pendingDrain')
      .marcarPendienteDeDrenaje;
    const spy = jest.spyOn(pendingDrainModule, 'marcarPendienteDeDrenaje')
      .mockImplementation((groupId: string, topic?: string) => {
        claveYaEraLaRealAlMarcar = useGroupKeyStore.getState().getKey('g1')?.key === REAL;
        real(groupId, topic);
      });

    try {
      expect(await elegirClaveDeGrupo('g1', 'u-beto')).toBe(true);
    } finally {
      spy.mockRestore();
    }

    expect(claveYaEraLaRealAlMarcar).toBe(false);
    expect(pendingDrainModule.estaPendienteDeDrenaje('g1')).toBe(true);
  });

  it('registra la oferta elegida como adoptada ANTES de que adoptKeys cambie la clave', async () => {
    trasElAtaque();

    let claveYaEraLaRealAlRegistrar: boolean | null = null;
    const real = jest.requireActual<typeof import('@/src/sync/groupKeyOffers')>('@/src/sync/groupKeyOffers')
      .registrarOferta;
    const spy = jest.spyOn(groupKeyOffersModule, 'registrarOferta')
      .mockImplementation((o: KeyOffer) => {
        claveYaEraLaRealAlRegistrar = useGroupKeyStore.getState().getKey('g1')?.key === REAL;
        return real(o);
      });

    try {
      expect(await elegirClaveDeGrupo('g1', 'u-beto')).toBe(true);
    } finally {
      spy.mockRestore();
    }

    expect(claveYaEraLaRealAlRegistrar).toBe(false);
    expect(groupKeyOffersModule.ofertasDe('g1')).toEqual(
      [expect.objectContaining({ fromUserId: 'u-beto', adoptada: true })]);
  });
});

describe('T-136 revisión final (D-2) · ofertas de invitación', () => {
  /**
   * Una oferta de invitación (`invite:<huella>`) elegida a mano adopta su
   * clave pero NO queda registrada como adoptada: el grupo se queda sin
   * ofertas, así que la clave cuenta como recibida por invitación y no puede
   * disputarla un contacto (S3-A1). Este test afirmaba lo contrario —la dejaba
   * adoptada y disputable— por un ruling de la Task 4 que la revisión final
   * revirtió para alinearse con el spec; no es un test debilitado.
   */
  it('elegir una oferta de invitación adopta su clave y no deja oferta adoptada', async () => {
    const fromUserId = groupKeyOffersModule.idDeOfertaDeInvitacion('huella-1');
    trasElAtaque();
    groupKeyOffersModule.registrarOferta({
      groupId: 'g1', fromUserId, key: REAL, epoch: 5, origen: 'invite', receivedAt: 0, adoptada: false,
    });

    expect(await elegirClaveDeGrupo('g1', fromUserId)).toBe(true);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual({ groupId: 'g1', key: REAL, epoch: 5 });
    expect(groupKeyOffersModule.ofertasDe('g1')).toEqual([]);
    expect(groupKeyOffersModule.conflictoForzado('g1')).toBe(false);
    expect(groupKeyOffersModule.claveLocalVinoDeContacto('g1')).toBe(false);
    expect(pendingDrainModule.estaPendienteDeDrenaje('g1')).toBe(true);
  });
});
