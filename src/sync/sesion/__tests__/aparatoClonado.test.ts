// Mock stateful del llavero: `mockLlavero` es «lo que hay en ESTE aparato».
const mockLlavero = new Map<string, string>();
let mockLecturaTira = false;
let mockEscrituraTira = false;
const mockOpcionesEscritura: unknown[] = [];

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afut',
  getItemAsync: jest.fn(async (k: string) => {
    if (mockLecturaTira) throw new Error('llavero bloqueado');
    return mockLlavero.get(k) ?? null;
  }),
  setItemAsync: jest.fn(async (k: string, v: string, o: unknown) => {
    if (mockEscrituraTira) throw new Error('llavero no escribe');
    mockOpcionesEscritura.push(o);
    mockLlavero.set(k, v);
  }),
}));

const mockRegister = jest.fn(async () => ({ ok: true, alreadyThere: false }));
jest.mock('@/src/sync/confianza/deviceKeys', () => ({
  registerDeviceKey: () => mockRegister(),
  verifyMyKeyRegistered: jest.fn(),
}));

import { createSecureStorage } from '@/src/utils/secureStorage';
import { createStorage } from '@/src/utils/createStorage';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { ensureIdentity, ensureOwnerPledge, ensureWrapKeypair } from '@/src/store/identityStore';
import { deviceId, readCursor, writeCursor } from '@/src/sync/motor/cursor';
import { almacen } from '@/src/sync/adaptadores/hushsplit/almacen';
import { estaPendienteDeDrenaje, limpiarPendienteDeDrenaje } from '@/src/sync/motor/pendingDrain';
import { verificarAparato, aplicarReinicioPendienteDeCuenta } from '../aparatoClonado';
import type { User } from '@/src/types/models';

const storage = createSecureStorage('groupkeys');
const YO = { id: 'yo', name: 'Yo', email: '', authProvider: 'google', createdAt: 0, updatedAt: 0, isDeleted: false } as User;

/** Un aparato «con vida»: identidad, device_id, cursor, ledger y un dato de la cuenta. */
function poblarAparato() {
  const id = deviceId();
  const ident = ensureIdentity().publicKey;
  const wrap = ensureWrapKeypair().publicKey;
  const prenda = ensureOwnerPledge().secret;
  writeCursor('topic-1', 42);
  almacen.set('ledger::topic-1', 'cubo');
  storage.set('data_v1::u:yo', 'datos-de-usuario'); // dato de la cuenta: se conserva
  return { id, ident, wrap, prenda };
}

beforeEach(() => {
  mockLlavero.clear();
  mockLecturaTira = false;
  mockEscrituraTira = false;
  mockOpcionesEscritura.length = 0;
  mockRegister.mockClear();
  storage.clearAll();
  createStorage('sync-relay-core').clearAll();
  useAuthStore.setState({ currentUser: YO } as never);
  useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: 'aa', epoch: 1 }] } as never);
  limpiarPendienteDeDrenaje('g1');
});

describe('verificarAparato (T-250)', () => {
  it('instalación nueva: crea centinela y marca, no regenera nada', async () => {
    expect(await verificarAparato()).toBe('instalacion_nueva');
    expect(mockLlavero.size).toBe(1);
    expect([...mockLlavero.values()][0]).toBe(deviceId());
    expect(mockOpcionesEscritura[0]).toEqual({ keychainAccessible: 'afut' });
    expect(await verificarAparato()).toBe('normal');
  });

  it('actualización desde 1.0.x (datos, sin marca, sin centinela): NO es clon, conserva todo', async () => {
    const antes = poblarAparato();
    expect(await verificarAparato()).toBe('actualizacion');
    expect(deviceId()).toBe(antes.id);
    expect(ensureIdentity().publicKey).toBe(antes.ident);
    expect(ensureOwnerPledge().secret).toBe(antes.prenda);
    expect(readCursor('topic-1')).toBe(42);
    expect(almacen.get('ledger::topic-1')).toBe('cubo');
    expect([...mockLlavero.values()]).toEqual([antes.id]);
    expect(await verificarAparato()).toBe('normal');
  });

  it('mismo aparato, arranque normal: no toca nada', async () => {
    const antes = poblarAparato();
    await verificarAparato();
    expect(await verificarAparato()).toBe('normal');
    expect(deviceId()).toBe(antes.id);
    expect(readCursor('topic-1')).toBe(42);
    expect(estaPendienteDeDrenaje('g1')).toBe(false);
  });

  it('restaurado en otro aparato (marca viaja, llavero vacío): regenera lo del aparato y conserva lo de la cuenta', async () => {
    const antes = poblarAparato();
    await verificarAparato();
    mockLlavero.clear(); // el llavero THIS_DEVICE_ONLY no viajó

    expect(await verificarAparato()).toBe('restaurado');

    expect(deviceId()).not.toBe(antes.id);
    expect(ensureIdentity().publicKey).not.toBe(antes.ident);
    expect(ensureWrapKeypair().publicKey).not.toBe(antes.wrap);
    expect(ensureOwnerPledge().secret).not.toBe(antes.prenda);
    expect(readCursor('topic-1')).toBe(0);
    expect(almacen.get('ledger::topic-1')).toBeUndefined();
    expect(storage.getString('data_v1::u:yo')).toBe('datos-de-usuario');
    // El centinela nuevo refleja el device_id nuevo: el próximo arranque es normal.
    expect([...mockLlavero.values()]).toEqual([deviceId()]);
    expect(await verificarAparato()).toBe('normal');
  });

  it('clon con el original vivo (el destino tiene OTRO centinela): se regenera el clon', async () => {
    const antes = poblarAparato();
    await verificarAparato();
    mockLlavero.set([...mockLlavero.keys()][0], 'd_otro_aparato'); // el iPad ya tenía el suyo

    expect(await verificarAparato()).toBe('restaurado');
    expect(deviceId()).not.toBe(antes.id);
    expect(deviceId()).not.toBe('d_otro_aparato');
  });

  it('llavero que tira al leer: indeterminado, NO se toma por aparato nuevo', async () => {
    const antes = poblarAparato();
    await verificarAparato();
    mockLecturaTira = true;

    expect(await verificarAparato()).toBe('indeterminado');
    expect(deviceId()).toBe(antes.id);
    expect(ensureIdentity().publicKey).toBe(antes.ident);
    expect(readCursor('topic-1')).toBe(42);
  });

  it('llavero que tira al escribir el centinela: no deja la marca (el próximo arranque sigue siendo actualización)', async () => {
    const antes = poblarAparato();
    mockEscrituraTira = true;
    expect(await verificarAparato()).toBe('indeterminado');
    mockEscrituraTira = false;
    expect(await verificarAparato()).toBe('actualizacion');
    expect(deviceId()).toBe(antes.id);
  });

  it('reinstalación en el mismo aparato (centinela viejo en el llavero, MMKV vacío): crea el centinela de nuevo', async () => {
    mockLlavero.set('hushsplit_device_sentinel_v1', 'd_de_la_instalacion_anterior');
    expect(await verificarAparato()).toBe('instalacion_nueva');
    expect([...mockLlavero.values()]).toEqual([deviceId()]);
  });
});

describe('aplicarReinicioPendienteDeCuenta (T-250)', () => {
  async function restaurar() {
    poblarAparato();
    await verificarAparato();
    mockLlavero.clear();
    await verificarAparato();
  }

  it('marca los grupos de la cuenta activa como pendientes de drenaje, registra la clave nueva y no se repite', async () => {
    await restaurar();
    expect(estaPendienteDeDrenaje('g1')).toBe(false);

    aplicarReinicioPendienteDeCuenta();
    expect(estaPendienteDeDrenaje('g1')).toBe(true);
    expect(mockRegister).toHaveBeenCalledTimes(1);

    limpiarPendienteDeDrenaje('g1');
    aplicarReinicioPendienteDeCuenta();
    expect(estaPendienteDeDrenaje('g1')).toBe(false);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('una segunda cuenta que entra después también recibe su reinicio', async () => {
    await restaurar();
    aplicarReinicioPendienteDeCuenta();
    useAuthStore.setState({ currentUser: { ...YO, id: 'otra' } } as never);
    useGroupKeyStore.setState({ keys: [{ groupId: 'g2', key: 'bb', epoch: 1 }] } as never);
    aplicarReinicioPendienteDeCuenta();
    expect(estaPendienteDeDrenaje('g2')).toBe(true);
  });

  it('sin regeneración previa no hace nada', async () => {
    poblarAparato();
    await verificarAparato();
    aplicarReinicioPendienteDeCuenta();
    expect(estaPendienteDeDrenaje('g1')).toBe(false);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('sin cuenta activa espera: no consume el reinicio', async () => {
    await restaurar();
    useAuthStore.setState({ currentUser: null } as never);
    aplicarReinicioPendienteDeCuenta();
    useAuthStore.setState({ currentUser: YO } as never);
    aplicarReinicioPendienteDeCuenta();
    expect(estaPendienteDeDrenaje('g1')).toBe(true);
  });
});
