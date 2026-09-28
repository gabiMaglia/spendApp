import { sinCamposLocales, sinAvatarUrl, preservarRecibo } from '../soloLocal';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useUserStore } from '@/src/store/userStore';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import * as adaptador from '../adaptadorHushSplit';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Expense } from '@/src/types/models';

jest.mock('@/src/sync/motor/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const base = {
  id: 'e1', groupId: 'g1', description: 'Cena', amount: 1000, currency: 'ARS',
  paidById: 'a', splits: [], splitMode: 'equal', category: 'food',
  date: 1, createdAt: 1, createdById: 'a',
  updatedAt: 1_000, isDeleted: false,
} as unknown as Expense;

describe('lo que NO sale al cable', () => {
  it('el recibo no viaja: es un path del aparato del emisor', () => {
    const [salida] = sinCamposLocales([{ ...base, receiptImageUri: 'file:///a/b.jpg' }]);
    expect('receiptImageUri' in salida!).toBe(false);
    // Y no se pierde nada más por el camino.
    expect(salida!.amount).toBe(1000);
  });

  it('`avatarUrl` no viaja: nadie la lee para dibujar nada', () => {
    const [salida] = sinAvatarUrl([{ id: 'u1', name: 'Ana', avatarUrl: 'https://cdn/x.jpg', avatar: 'data:x' }]);
    expect('avatarUrl' in salida!).toBe(false);
    // La foto SÍ viaja: son los bytes propios, que es lo que se dibuja.
    expect(salida!.avatar).toBe('data:x');
  });

  it('sin el campo, devuelve el mismo objeto (no clona por gusto)', () => {
    const uno = { ...base };
    expect(sinCamposLocales([uno])[0]).toBe(uno);
  });
});

describe('preservarRecibo — la contraparte obligatoria', () => {
  /**
   * Sacar el recibo del sobre SIN esto destruiría recibos: vive en el nivel
   * "resto" del merge, que es LWW, así que un entrante sin el campo y con
   * `updatedAt` mayor se lo lleva puesto. Es el mismo bug que la foto de perfil.
   */
  it('un entrante sin recibo NO borra el local', () => {
    const local = { ...base, receiptImageUri: 'file:///mio.jpg' };
    const entrante = { ...base, updatedAt: 9_999 };
    expect(preservarRecibo(entrante, local).receiptImageUri).toBe('file:///mio.jpg');
  });

  it('un entrante CON recibo gana: no es un candado, es un piso', () => {
    const local = { ...base, receiptImageUri: 'file:///viejo.jpg' };
    const entrante = { ...base, receiptImageUri: 'file:///nuevo.jpg', updatedAt: 9_999 };
    expect(preservarRecibo(entrante, local).receiptImageUri).toBe('file:///nuevo.jpg');
  });

  it('sin local previo no inventa nada', () => {
    expect(preservarRecibo({ ...base }, undefined).receiptImageUri).toBeUndefined();
  });
});

describe('de punta a punta por el store', () => {
  beforeEach(() => {
    createSecureStorage('expenses').clearAll();
    useExpenseStore.setState({ expenses: [], isLoading: false });
  });

  it('sincronizar con un peer que ya no manda el recibo no te lo borra', () => {
    useExpenseStore.setState({ expenses: [{ ...base, receiptImageUri: 'file:///mio.jpg' }] });

    // Lo que llegaría hoy de un teléfono actualizado: el gasto editado, sin recibo.
    useExpenseStore.getState().mergeExpenses([
      { ...base, description: 'Cena editada', updatedAt: 9_999 },
    ]);

    const e = useExpenseStore.getState().expenses.find(x => x.id === 'e1')!;
    expect(e.description).toBe('Cena editada');
    expect(e.receiptImageUri).toBe('file:///mio.jpg');
  });
});


describe('el sobre REAL no los lleva (hueco que encontró la mutación M2)', () => {
  /**
   * Los tests de arriba probaban las funciones puras, pero **ninguno miraba el
   * payload que sale de verdad**: volver a poner el recibo en el armado del
   * documento dejaba las 7 pruebas en verde. Un filtro que nadie verifica que
   * esté conectado no filtra nada.
   *
   * T-206-A (D1/D2): antes se armaba con `buildDelta` (el delta completo del
   * pairing QR, `useSyncQR.ts`, borrado en T-193). El único camino real que
   * queda es el del relay — `adaptador.armar` + `adaptador.antesDePublicar`,
   * lo mismo que arma `publishToGroup` (`motor/publicar.ts`) — así que se
   * migra a eso. Es scopeado por grupo (`armar` filtra por `groupId` y por
   * `memberIds`), de ahí el grupo `g1` sembrado abajo con `a` como único
   * miembro.
   */
  beforeEach(() => {
    createSecureStorage('expenses').clearAll();
    createSecureStorage('users').clearAll();
    useAuthStore.setState({ currentUser: { id: 'a' } as never });
    useGroupStore.setState({ groups: [
      { id: 'g1', name: 'G', memberIds: ['a'], currency: 'ARS',
        createdAt: 0, createdById: 'a', updatedAt: 1, isDeleted: false } as never,
    ]});
    useExpenseStore.setState({
      expenses: [{ ...base, receiptImageUri: 'file:///private/var/mobile/recibo.jpg' }],
      isLoading: false,
    });
    useUserStore.setState({
      users: [{ id: 'a', name: 'Ana', email: '', authProvider: 'google',
                createdAt: 0, updatedAt: 1, isDeleted: false,
                avatarUrl: 'https://lh3.googleusercontent.com/x', avatar: 'data:image/jpeg;base64,AA' }],
    } as never);
  });

  /** Documento real de `g1`, tal como lo arma `publishToGroup` antes de envolverlo. */
  async function docReal() {
    return adaptador.antesDePublicar(
      adaptador.armar('g1', 'a'),
      { groupId: 'g1', deviceId: 'dev', fromUserId: 'a' },
    );
  }

  it('no hay ni un `receiptImageUri` en el documento real', async () => {
    expect(JSON.stringify(await docReal())).not.toContain('receiptImageUri');
  });

  it('tampoco se filtra el path del filesystem por otro lado', async () => {
    // El aserto anterior mira la CLAVE; éste mira el VALOR, por si algún día
    // el path se cuela dentro de otro campo.
    expect(JSON.stringify(await docReal())).not.toContain('/private/var/mobile');
  });

  /**
   * Antes de esta migración (buildDelta/QR) la foto propia viajaba en bytes
   * crudos: era el pairing por presencia física, sin fotos por referencia.
   * El único camino que queda (relay) NUNCA manda los bytes en el sobre del
   * grupo — viajan una vez a su propio topic (`avatarTopic.ts`, Task 9) y acá
   * sólo queda la referencia (`avatarDigest`). Ver ese archivo para el porqué.
   */
  it('no hay ni un `avatarUrl` ni los bytes de la foto propia — sólo su digest', async () => {
    const json = JSON.stringify(await docReal());
    expect(json).not.toContain('avatarUrl');
    expect(json).not.toContain('googleusercontent');
    expect(json).not.toContain('data:image/jpeg;base64,AA');
    expect(json).toContain('avatarDigest');
  });
});
