import { signOnCreate, signOnEdit } from '../signOnWrite';
import { generateIdentity } from '../groupInvite';
import * as recordSign from '../recordSign';
import { useAuthStore } from '@/src/store/authStore';
import type { Expense, User } from '@/src/types/models';

/**
 * T-152 · D2 (fix round 2, decisión del PO 2026-09-26): «bloquear y avisar».
 *
 * El verificador reprodujo el escenario: `firmar()` cae a `sinFirma(record)`
 * cuando `privadaDelAparato()` da `null` o `signCore` tira, pero `rev` sube
 * igual. Con la regla de T-152 (núcleo sin firma nunca pisa uno firmado) esa
 * misma edición legítima, sin firma y con `rev` nuevo, pierde contra la
 * republicación de la versión vieja firmada — el usuario ve volver el valor
 * anterior sin ningún aviso (20000 → 10000 en el PoC del verificador).
 *
 * La decisión: si el núcleo YA estaba firmado y la re-firma de la edición
 * propia falla, la edición NO se guarda (`signOnEdit` devuelve `null`) — la
 * pierde el intento, no el usuario en silencio después.
 */
jest.mock('../devicePrivateKey', () => ({ privadaDelAparato: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { privadaDelAparato } = require('../devicePrivateKey') as { privadaDelAparato: jest.Mock };

const AUTOR = { id: 'ana' } as User;
const CLAVE = generateIdentity().privateKey;

function base(): Expense {
  return {
    id: 'e1', groupId: 'g1', description: 'Cena', amount: 10_000, currency: 'ARS',
    paidById: 'ana', createdById: 'ana', splits: [], splitMode: 'equal', category: 'food',
    date: 1_000, createdAt: 1_000, updatedAt: 1_000, isDeleted: false, deletionVotes: [],
  } as Expense;
}

describe('signOnEdit · D2, bloquear y avisar', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: AUTOR });
    privadaDelAparato.mockReset();
  });

  it('un núcleo YA FIRMADO cuya re-firma propia falla queda BLOQUEADO (null), nunca sin firma con rev nuevo', () => {
    privadaDelAparato.mockReturnValue(CLAVE);
    const creado = signOnCreate('expense', base());
    expect(creado.k).toBeDefined();
    expect(creado.s).toBeDefined();

    privadaDelAparato.mockReturnValue(null); // falla justo al editar (storage que no abrió, etc.)
    const editado = signOnEdit('expense', creado, { ...creado, amount: 20_000 });

    expect(editado).toBeNull();
  });

  it('también bloquea cuando `signCore` tira en vez de faltar la clave', () => {
    privadaDelAparato.mockReturnValue(CLAVE);
    const creado = signOnCreate('expense', base());

    jest.spyOn(recordSign, 'signCore').mockImplementation(() => { throw new Error('firma que no cierra'); });
    const editado = signOnEdit('expense', creado, { ...creado, amount: 20_000 });
    jest.restoreAllMocks();

    expect(editado).toBeNull();
  });

  it('un núcleo que NUNCA estuvo firmado (pre-T-041) no se bloquea: se guarda igual, sin firma', () => {
    privadaDelAparato.mockReturnValue(null);
    const previo = base(); // sin k/s: nunca estuvo firmado
    const editado = signOnEdit('expense', previo, { ...previo, amount: 20_000 });

    expect(editado).not.toBeNull();
    expect(editado?.amount).toBe(20_000);
    expect(editado?.k).toBeUndefined();
  });

  it('si la firma SÍ cierra, la edición se guarda firmada, normal', () => {
    privadaDelAparato.mockReturnValue(CLAVE);
    const creado = signOnCreate('expense', base());
    const editado = signOnEdit('expense', creado, { ...creado, amount: 20_000 });

    expect(editado).not.toBeNull();
    expect(editado?.amount).toBe(20_000);
    expect(editado?.k).toBeDefined();
  });

  it('una edición que no toca el núcleo nunca intenta firmar ni bloquea, aunque no haya clave', () => {
    privadaDelAparato.mockReturnValue(CLAVE);
    const creado = signOnCreate('expense', base());

    privadaDelAparato.mockReturnValue(null);
    const editado = signOnEdit('expense', creado, { ...creado, updatedAt: 5_000 });

    expect(editado).not.toBeNull();
    expect(editado?.updatedAt).toBe(5_000);
  });

  it('editar un registro ajeno nunca bloquea: no soy el autor, no intento firmar', () => {
    privadaDelAparato.mockReturnValue(null);
    useAuthStore.setState({ currentUser: { id: 'otro' } as User });
    const ajenoFirmado = { ...base(), k: 'aa'.repeat(32), s: 'bb'.repeat(64) };

    const editado = signOnEdit('expense', ajenoFirmado, { ...ajenoFirmado, note: 'nota' });

    expect(editado).not.toBeNull();
  });
});
