import { deleteAccount, resumePendingDeletion } from '../deleteAccount';
import { readJournal, writeJournal, clearJournal } from '@/src/store/deleteJournal';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { ensureIdentity, ensureOwnerPledge } from '@/src/store/identityStore';
import type { User } from '@/src/types/models';

/**
 * T-074 · El borrado de cuenta. **Lo que se testea acá es el ORDEN**, que es lo
 * único que no se puede equivocar:
 *
 *  1. los topics se derivan y se anotan ANTES de borrar, porque salen de claves
 *     que el borrado destruye;
 *  2. **la prenda del buzón se destruye DESPUÉS de purgar, nunca antes.** Al
 *     revés no hay vuelta atrás: sin prenda esos sobres sólo los levanta el TTL
 *     de 30 días (ADR-009 §4·A);
 *  3. sin red, el borrado local **procede igual**. Un borrado que se cuelga
 *     esperando internet no es un borrado, y las tiendas tampoco lo aceptan.
 */

const mockLlamadas: string[] = [];
let mockRespuesta: (topic: string) => unknown = () => ({ ok: true, deleted: 1 });

jest.mock('@/src/sync/relay', () => ({
  // `signOut` cierra la sesión del directorio de claves y eso pasa por acá: sin
  // este stub, el mock del módulo deja a `directoryAuth` sin cliente y la
  // promesa suelta que dispara tumba al worker de Jest.
  getRelayClient: () => null,
  isRelayConfigured: () => false,
  deleteMyEnvelopes: jest.fn(async (topic: string) => {
    mockLlamadas.push(`delete:${topic}`);
    return mockRespuesta(topic);
  }),
}));

jest.mock('@/src/sync/relayEngine', () => ({
  deviceId: () => 'dev',
  schedulePublish: jest.fn(),
  olvidarCursor: jest.fn(),
  publishNow: jest.fn(async (groupId: string) => { mockLlamadas.push(`publish:${groupId}`); }),
}));

jest.mock('../deleteTopics', () => ({
  topicsDeLaCuenta: jest.fn(async () => ['t_grupo', 't_contacto', 't_invite']),
}));

const YO: User = {
  id: 'u1', name: 'Gabriel', email: 'g@x.com', authProvider: 'google',
  createdAt: 1, updatedAt: 1, isDeleted: false,
};

const groupkeys = createSecureStorage('groupkeys');
const auth = createSecureStorage('auth');

function sesion(): void {
  useAuthStore.setState({ currentUser: YO });
  useUserStore.setState({ users: [YO] });
}

/** Deja `known` con las cuentas que se le pasen, como haría el índice real. */
function cuentasConocidas(...ids: string[]): void {
  auth.set('acct::known', JSON.stringify(ids.map(id => ({ accountId: id, label: id }))));
}

beforeEach(() => {
  mockLlamadas.length = 0;
  mockRespuesta = () => ({ ok: true, deleted: 1 });
  groupkeys.clearAll();
  auth.clearAll();
  clearJournal();
  sesion();
  cuentasConocidas('u1');
  ensureIdentity();
  ensureOwnerPledge();
});

describe('el orden, que es lo que no se puede equivocar', () => {
  it('el aviso a los grupos sale ANTES de purgar el buzón', async () => {
    // Al revés, publicar volvería a llenar el buzón recién vaciado.
    useUserStore.setState({ users: [YO] });
    await deleteAccount({ timeoutMs: 200 });

    const primerBorrado = mockLlamadas.findIndex(l => l.startsWith('delete:'));
    const publicaciones = mockLlamadas.filter(l => l.startsWith('publish:')).length;
    if (publicaciones > 0) {
      expect(mockLlamadas.findIndex(l => l.startsWith('publish:'))).toBeLessThan(primerBorrado);
    }
    expect(primerBorrado).toBeGreaterThanOrEqual(0);
  });

  it('el diario se escribe ANTES de la primera llamada al buzón', async () => {
    // Si la app muere en el medio, esto es lo único que puede terminar la purga.
    let diarioAlPrimerBorrado: ReturnType<typeof readJournal> = null;
    mockRespuesta = () => {
      diarioAlPrimerBorrado ??= readJournal();
      return { ok: true, deleted: 1 };
    };

    await deleteAccount({ timeoutMs: 200 });

    expect(diarioAlPrimerBorrado).not.toBeNull();
    expect(diarioAlPrimerBorrado!.accountId).toBe('u1');
  });

  it('LA REGLA DURA: con purga pendiente, la prenda SOBREVIVE', async () => {
    mockRespuesta = () => ({ ok: false, reason: 'network' });

    const r = await deleteAccount({ timeoutMs: 200 });

    expect(r.topicsPendientes).toBe(3);
    expect(r.prendaDestruida).toBe(false);
    expect(groupkeys.getString('owner_secret_v1')).toBeTruthy();
    expect(readJournal()!.pendientes).toHaveLength(3);
  });

  it('con la purga completa y siendo la última cuenta, se destruye todo', async () => {
    const r = await deleteAccount({ timeoutMs: 200 });

    expect(r.topicsPurgados).toBe(3);
    expect(r.prendaDestruida).toBe(true);
    expect(groupkeys.getString('owner_secret_v1')).toBeFalsy();
    expect(groupkeys.getString('identity_v1')).toBeFalsy();
    expect(readJournal()).toBeNull();
  });

  it('con OTRA cuenta viva, la identidad del aparato NO se toca', async () => {
    // Borrarla dejaría a la otra cuenta sin firmar y sin poder purgar SUS
    // sobres nunca más. Es el criterio de aceptación 3.
    cuentasConocidas('u1', 'u2');
    const prendaAntes = groupkeys.getString('owner_secret_v1');

    const r = await deleteAccount({ timeoutMs: 200 });

    expect(r.prendaDestruida).toBe(false);
    expect(groupkeys.getString('owner_secret_v1')).toBe(prendaAntes);
    expect(groupkeys.getString('identity_v1')).toBeTruthy();
    expect(readJournal()).toBeNull();   // pero el diario se cierra igual
  });
});

describe('qué hace con cada respuesta del buzón', () => {
  it('`network` deja el topic pendiente para reintentarlo', async () => {
    mockRespuesta = (t) => (t === 't_contacto' ? { ok: false, reason: 'network' } : { ok: true, deleted: 1 });

    const r = await deleteAccount({ timeoutMs: 200 });

    expect(r.topicsPendientes).toBe(1);
    expect(readJournal()!.pendientes).toEqual(['t_contacto']);
  });

  it('`no_pledge` SACA el topic: reintentarlo no lo va a arreglar nunca', async () => {
    // Es el caso del reinstall: este aparato no tiene con qué probar que lo
    // escribió. Lo levanta el TTL de 30 días y nada más.
    mockRespuesta = (t) => (t === 't_invite' ? { ok: false, reason: 'no_pledge' } : { ok: true, deleted: 1 });

    const r = await deleteAccount({ timeoutMs: 200 });

    expect(r.topicsPendientes).toBe(0);
    expect(r.topicsPurgados).toBe(2);   // el tercero no cuenta como purgado
  });

  it('`not_configured` corta la fase y deja TODO pendiente', async () => {
    // Sin relay no hay nada que purgar; reintentar cada topic es ruido.
    mockRespuesta = () => ({ ok: false, reason: 'not_configured' });

    const r = await deleteAccount({ timeoutMs: 200 });

    expect(r.topicsPendientes).toBe(3);
    expect(mockLlamadas.filter(l => l.startsWith('delete:'))).toHaveLength(1);
  });

  it('una excepción del transporte no frena el borrado', async () => {
    mockRespuesta = () => { throw new Error('boom'); };
    await expect(deleteAccount({ timeoutMs: 200 })).resolves.toMatchObject({ ok: true });
  });
});

describe('sin red', () => {
  it('no se cuelga: termina y deja lo pendiente anotado', async () => {
    // El mock nunca resuelve. El presupuesto de tiempo tiene que ganar.
    const relay = jest.requireMock('@/src/sync/relay') as { deleteMyEnvelopes: jest.Mock };
    relay.deleteMyEnvelopes.mockImplementationOnce(() => new Promise(() => {}));

    const r = await deleteAccount({ timeoutMs: 60 });

    expect(r.ok).toBe(true);
    expect(r.topicsPendientes).toBeGreaterThan(0);
    expect(groupkeys.getString('owner_secret_v1')).toBeTruthy();
  });

  it('lo local se borra igual aunque el buzón no se haya podido tocar', async () => {
    mockRespuesta = () => ({ ok: false, reason: 'network' });
    await deleteAccount({ timeoutMs: 200 });

    expect(useAuthStore.getState().currentUser).toBeNull();
    expect(auth.getString('current_user')).toBeFalsy();
  });
});

describe('retomar un borrado interrumpido', () => {
  it('sin diario no hace nada y NO toca la red', async () => {
    expect(await resumePendingDeletion()).toBeNull();
    expect(mockLlamadas).toHaveLength(0);
  });

  it('termina la purga y recién ahí destruye la prenda', async () => {
    mockRespuesta = () => ({ ok: false, reason: 'network' });
    await deleteAccount({ timeoutMs: 200 });
    expect(groupkeys.getString('owner_secret_v1')).toBeTruthy();

    mockRespuesta = () => ({ ok: true, deleted: 1 });
    const r = await resumePendingDeletion();

    expect(r!.topicsPendientes).toBe(0);
    expect(r!.prendaDestruida).toBe(true);
    expect(groupkeys.getString('owner_secret_v1')).toBeFalsy();
    expect(readJournal()).toBeNull();
  });

  it('es idempotente: correrla dos veces no cambia nada', async () => {
    mockRespuesta = () => ({ ok: true, deleted: 1 });
    await deleteAccount({ timeoutMs: 200 });

    const a = await resumePendingDeletion();
    const b = await resumePendingDeletion();
    expect(a).toBeNull();
    expect(b).toBeNull();
  });

  it('un diario corrupto se descarta en vez de trabar el arranque', async () => {
    createSecureStorage('auth').set('acct::delete_pending', '{roto');
    expect(await resumePendingDeletion()).toBeNull();
  });
});

describe('sin sesión', () => {
  it('no hay nada que borrar y no se escribe diario', async () => {
    useAuthStore.setState({ currentUser: null });
    const r = await deleteAccount({ timeoutMs: 200 });

    expect(r).toMatchObject({ topicsPurgados: 0, topicsPendientes: 0 });
    expect(readJournal()).toBeNull();
    expect(mockLlamadas).toHaveLength(0);
  });
});

describe('el diario', () => {
  it('se actualiza topic por topic, no al final', async () => {
    // Si sólo se escribiera al final, una app que muere en el medio repetiría
    // todo lo hecho.
    const vistos: number[] = [];
    mockRespuesta = () => {
      vistos.push(readJournal()?.pendientes.length ?? -1);
      return { ok: true, deleted: 1 };
    };

    await deleteAccount({ timeoutMs: 500 });

    expect(vistos).toEqual([3, 2, 1]);
  });

  it('sobrevive al barrido del scope: vive sin scope a propósito', async () => {
    mockRespuesta = () => ({ ok: false, reason: 'network' });
    await deleteAccount({ timeoutMs: 200 });
    // El barrido ya corrió (fase 3) y el diario sigue.
    expect(readJournal()).not.toBeNull();
  });
});

describe('lo que el barrido por sufijo NO alcanza', () => {
  it('borra el contador diario del tier, que lleva el id en el medio', async () => {
    const tier = require('@/src/utils/createStorage').createStorage('tier') as { set: (k: string, v: string) => void; getString: (k: string) => string | undefined };
    tier.set('expense_count_u1_2026-09-05', '3');
    tier.set('expense_count_u2_2026-09-05', '7');

    await deleteAccount({ timeoutMs: 200 });

    expect(tier.getString('expense_count_u1_2026-09-05')).toBeFalsy();
    expect(tier.getString('expense_count_u2_2026-09-05')).toBe('7');   // la otra cuenta no
  });

  it('saca la cuenta del índice de identidad, o revive con el mismo id', async () => {
    auth.set('acct::p:google:123', 'u1');
    auth.set('acct::e:g@x.com', 'u1');
    auth.set('acct::p:apple:999', 'u2');

    await deleteAccount({ timeoutMs: 200 });

    expect(auth.getString('acct::p:google:123')).toBeFalsy();
    expect(auth.getString('acct::e:g@x.com')).toBeFalsy();
    expect(auth.getString('acct::p:apple:999')).toBe('u2');   // la de la otra cuenta queda
  });
});
