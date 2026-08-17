import { useAuthStore } from '../authStore';
import { useGroupStore } from '../groupStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { mergeProviderUser } from '@/src/utils/mergeProviderUser';

/**
 * Reproducción del escenario EXACTO del PO en su iPhone.
 *
 * Estado de partida (importante): el teléfono ya tiene DOS cuentas con datos,
 * creadas ANTES de que existiera el índice de identidad. O sea que el índice
 * arranca vacío y hay datos scopeados bajo los ids de proveedor.
 *
 * Y el detalle que lo hace difícil: el PO **ya entró con Apple antes**, así que
 * Apple nunca más le va a mandar el email (lo manda una sola vez por Apple ID y
 * por app, y eso persiste del lado de Apple incluso tras reinstalar).
 */

const GOOGLE_ID = 'google:11887766';
const APPLE_ID  = 'apple:000123.abc';
const MAIL      = 'gab.maglia@gmail.com';

const BUCKETS = ['auth', 'groups', 'expenses', 'payments', 'users', 'personal', 'recurring', 'comments'] as const;

function seedGroups(uid: string, ids: string[]) {
  createSecureStorage('groups').set(
    `data_v1::u:${uid}`,
    JSON.stringify(ids.map(id => ({ id, name: id, updatedAt: 1_000, isDeleted: false }))),
  );
}

function groupsVisibleFor(accountId: string): string[] {
  useAuthStore.setState({ currentUser: { id: accountId } as any });
  useGroupStore.setState({ groups: [] });
  useGroupStore.getState().hydrate();
  return useGroupStore.getState().groups.map(g => g.id).sort();
}

/** Lo que hace `accountIdFor` en app/auth/index.tsx, sin la UI. */
function login(
  providerId: string,
  email: string | null,
  provider: 'google' | 'apple',
  confirmLinkIfAsked: boolean,
): { accountId: string; asked: boolean } {
  const auth = useAuthStore.getState();
  const r = auth.resolveAccount(providerId, email);

  let accountId: string;
  let asked = false;

  if (r.kind === 'confirm') {
    asked = true;
    if (confirmLinkIfAsked) {
      accountId = r.candidates[0]!.accountId;
      auth.confirmAccountLink(providerId, accountId);
    } else {
      accountId = providerId; // "usar cuenta aparte"
    }
  } else {
    accountId = r.accountId;
  }

  auth.setUser(mergeProviderUser(auth.getStoredProfile(accountId), {
    id: accountId, authProvider: provider,
    name: provider === 'google' ? 'Gabriel Maglia' : null,
    email,
  }));
  return { accountId, asked };
}

describe('ESCENARIO DEL PO: Google y Apple con el mismo mail en un teléfono que ya tenía las dos cuentas', () => {
  beforeEach(() => {
    BUCKETS.forEach(b => createSecureStorage(b).clearAll());
    createSecureStorage('groups').set('money_int_v1_done', true);
    useAuthStore.setState({ currentUser: null, isPro: false, isLoading: false });

    // Datos preexistentes de cada cuenta, de antes del índice de identidad.
    seedGroups(GOOGLE_ID, ['grupo-google']);
    seedGroups(APPLE_ID,  ['grupo-apple']);
  });

  it('el 2º login (Apple sin email) PREGUNTA en vez de abrir otra cuenta', () => {
    login(GOOGLE_ID, MAIL, 'google', false);
    useAuthStore.getState().signOut();

    const apple = login(APPLE_ID, null, 'apple', false);

    expect(apple.asked).toBe(true);
  });

  it('si el usuario confirma, las dos cuentas quedan UNIDAS y ve los gastos de ambas', () => {
    login(GOOGLE_ID, MAIL, 'google', false);
    useAuthStore.getState().signOut();

    const apple = login(APPLE_ID, null, 'apple', true);

    expect(groupsVisibleFor(apple.accountId)).toEqual(['grupo-apple', 'grupo-google']);
  });

  it('tras unirlas, volver a entrar con Google cae en la MISMA cuenta', () => {
    login(GOOGLE_ID, MAIL, 'google', false);
    useAuthStore.getState().signOut();
    const apple = login(APPLE_ID, null, 'apple', true);
    useAuthStore.getState().signOut();

    const google2 = login(GOOGLE_ID, MAIL, 'google', false);

    expect(google2.accountId).toBe(apple.accountId);
    expect(google2.asked).toBe(false);
  });

  it('y el nombre no se pierde entre saltos de proveedor', () => {
    login(GOOGLE_ID, MAIL, 'google', false);
    useAuthStore.getState().signOut();
    const apple = login(APPLE_ID, null, 'apple', true);

    expect(useAuthStore.getState().currentUser?.name).toBe('Gabriel Maglia');
    expect(useAuthStore.getState().currentUser?.id).toBe(apple.accountId);
  });

  it('si el usuario dice "usar cuenta aparte", quedan separadas (y es su decisión)', () => {
    login(GOOGLE_ID, MAIL, 'google', false);
    useAuthStore.getState().signOut();

    const apple = login(APPLE_ID, null, 'apple', false);

    expect(apple.accountId).toBe(APPLE_ID);
    expect(groupsVisibleFor(APPLE_ID)).toEqual(['grupo-apple']);
  });

  it('ORDEN INVERSO: si entra primero con Apple (sin mail) y después con Google, también une', () => {
    const apple = login(APPLE_ID, null, 'apple', false);
    expect(apple.asked).toBe(false); // no hay otra cuenta todavía: no molesta
    useAuthStore.getState().signOut();

    // Google trae el mail, pero el índice no tiene ese mail asociado a nadie
    // (Apple nunca lo mandó) ⇒ este es el caso que hay que mirar.
    const google = login(GOOGLE_ID, MAIL, 'google', true);

    expect(groupsVisibleFor(google.accountId)).toEqual(['grupo-apple', 'grupo-google']);
  });
});
