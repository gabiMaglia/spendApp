import { deleteAccount } from '../deleteAccount';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { bucketsAbiertos } from '@/src/utils/createStorage';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { createStorage } from '@/src/utils/createStorage';
import type { User } from '@/src/types/models';

jest.mock('@/src/sync/relay', () => ({
  getRelayClient: () => null,
  isRelayConfigured: () => false,
  deleteMyEnvelopes: jest.fn(async () => ({ ok: true, deleted: 0 })),
}));
jest.mock('@/src/sync/relayEngine', () => ({
  deviceId: () => 'dev', schedulePublish: jest.fn(), olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}),
}));

/**
 * **El criterio de aceptación 2, automatizado.**
 *
 * «Después de borrar, ninguna clave de ningún bucket contiene el id de la
 * cuenta borrada» — verificado **recorriendo los buckets**, no una lista de
 * claves conocidas, y no mirando la pantalla.
 *
 * Es el test que atrapó el contador diario del tier (su clave lleva el id en el
 * medio, no como sufijo) y es el que va a atrapar la próxima clave con una forma
 * distinta. La misma clase de bug ya apareció tres veces en este repo —T-055,
 * T-057, T-060— y las tres veces era una lista que alguien tenía que acordarse
 * de actualizar.
 */
const BORRADA = 'u_borrada';
const QUEDA = 'u_queda';

function usuario(id: string): User {
  return {
    id, name: id, email: `${id}@x.com`, authProvider: 'google',
    createdAt: 1, updatedAt: 1, isDeleted: false,
  };
}

beforeEach(() => {
  for (const b of bucketsAbiertos().values()) b.clearAll();

  useAuthStore.setState({ currentUser: usuario(BORRADA) });
  useUserStore.setState({ users: [usuario(BORRADA), usuario(QUEDA)] });
  useGroupKeyStore.setState({ keys: [] });

  const auth = createSecureStorage('auth');
  auth.set('acct::known', JSON.stringify([
    { accountId: BORRADA, label: BORRADA },
    { accountId: QUEDA, label: QUEDA },
  ]));
  auth.set(`acct::p:google:111`, BORRADA);
  auth.set(`acct::e:${BORRADA}@x.com`, BORRADA);
  auth.set(`acct::p:apple:222`, QUEDA);
});

/** Siembra datos de las dos cuentas por todos los caminos que existen hoy. */
function sembrar(): void {
  useGroupKeyStore.getState().ensureKey('g1');           // clave de grupo (scoped)
  useExpenseStore.getState().addExpense({
    id: 'e1', groupId: 'g1', description: 'cena', amount: 1000, currency: 'ARS',
    paidBy: BORRADA, splits: [{ userId: BORRADA, amount: 1000 }], date: 1,
    createdBy: BORRADA, createdAt: 1, updatedAt: 1, isDeleted: false,
  } as never);   // el molde real de `Expense` no importa acá: lo que se mide es la CLAVE

  const tier = createStorage('tier');
  tier.set(`expense_count_${BORRADA}_2026-09-05`, '3');
  tier.set(`expense_count_${QUEDA}_2026-09-05`, '5');

  const settings = createStorage('settings');
  settings.set(`display_currency::u:${BORRADA}`, 'ARS');
  settings.set(`display_currency::u:${QUEDA}`, 'USD');
}

describe('después de borrar la cuenta', () => {
  it('NINGUNA clave de NINGÚN bucket menciona a la cuenta borrada', async () => {
    sembrar();

    await deleteAccount({ timeoutMs: 200 });

    const rastro: string[] = [];
    for (const [nombre, bucket] of bucketsAbiertos()) {
      for (const key of bucket.getAllKeys()) {
        if (key.includes(BORRADA)) rastro.push(`${nombre}/${key}`);
      }
    }
    expect(rastro).toEqual([]);
  });

  it('lo de la OTRA cuenta queda intacto', async () => {
    sembrar();

    await deleteAccount({ timeoutMs: 200 });

    expect(createStorage('tier').getString(`expense_count_${QUEDA}_2026-09-05`)).toBe('5');
    expect(createStorage('settings').getString(`display_currency::u:${QUEDA}`)).toBe('USD');
    expect(createSecureStorage('auth').getString('acct::p:apple:222')).toBe(QUEDA);
  });

  it('la sesión queda cerrada', async () => {
    sembrar();
    await deleteAccount({ timeoutMs: 200 });
    expect(useAuthStore.getState().currentUser).toBeNull();
  });
});
