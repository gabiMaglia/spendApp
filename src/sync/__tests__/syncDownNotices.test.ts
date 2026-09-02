import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, User } from '@/src/types/models';
import type { Notice } from '@/src/services/syncNotices';
import type { PublishResult } from '../relaySync';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

/** El publish real sale de acá; lo controlamos resultado por resultado. */
const mockPublish = jest.fn(async (): Promise<PublishResult> => ({ ok: true, seq: 1 }));
jest.mock('../relaySync', () => ({
  ...jest.requireActual('../relaySync'),
  publishToGroup: () => mockPublish(),
}));

/** Los avisos que salieron, sin tocar el nativo de notificaciones. */
const anunciados: Notice[] = [];
jest.mock('@/src/services/notifications', () => ({
  ...jest.requireActual('@/src/services/notifications'),
  announce: async (notices: Notice[]) => { anunciados.push(...notices); return notices.length; },
}));

import { noticeDeCaida, olvidarCaida } from '../syncDownNotices';
import { publishNow } from '../relayEngine';

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Asado', memberIds: ['u1'], currency: 'ARS',
  createdAt: 0, createdById: 'u1', updatedAt: 0, isDeleted: false,
  ...over,
} as unknown as Group);

beforeEach(() => {
  createSecureStorage('notices').clearAll();
  useAuthStore.setState({ currentUser: { id: 'u1' } as User });
  useGroupStore.setState({ groups: [grupo()] } as never);
  anunciados.length = 0;
  mockPublish.mockClear();
  mockPublish.mockImplementation(async () => ({ ok: true, seq: 1 }));
});

const caido = (reason: 'too_large' | 'no_key' | 'network'): PublishResult =>
  ({ ok: false, reason });

/**
 * `publishHealth` vive en memoria y se re-evalúa en CADA publicación, que corre
 * cada pocos segundos. Un aviso por intento fallido no es informar: es entrenar
 * al usuario a ignorar el aviso, y el que se ignora después es el que importa.
 */
describe('un grupo caído avisa una vez, no una por intento', () => {
  it('la primera caída bloqueante avisa', () => {
    expect(noticeDeCaida('g1', 'Asado', caido('too_large'))).toEqual({
      kind: 'sync_down', groupId: 'g1', groupName: 'Asado', reason: 'too_large',
    });
  });

  it('el segundo intento fallido NO vuelve a avisar', () => {
    noticeDeCaida('g1', 'Asado', caido('too_large'));
    expect(noticeDeCaida('g1', 'Asado', caido('too_large'))).toBeNull();
  });

  it('veinte intentos seguidos producen UN aviso', () => {
    const avisos = Array.from({ length: 20 })
      .map(() => noticeDeCaida('g1', 'Asado', caido('too_large')))
      .filter(a => a !== null);
    expect(avisos).toHaveLength(1);
  });

  /** Si el grupo se recupera y vuelve a caer, eso es una caída NUEVA. */
  it('recuperarse y volver a caer avisa de nuevo', () => {
    noticeDeCaida('g1', 'Asado', caido('too_large'));
    noticeDeCaida('g1', 'Asado', { ok: true, seq: 7 });
    expect(noticeDeCaida('g1', 'Asado', caido('too_large'))).not.toBeNull();
  });

  /**
   * Una publicación exitosa borra el fallo (`recordPublish`) y también la marca
   * de "ya avisé". Sin esto, un grupo que se arregla y se rompe otra vez se
   * queda mudo para siempre.
   */
  it('una publicación exitosa por sí sola no avisa nada', () => {
    expect(noticeDeCaida('g1', 'Asado', { ok: true, seq: 1 })).toBeNull();
  });

  it('un corte de red NO avisa: se reintenta solo', () => {
    expect(noticeDeCaida('g1', 'Asado', caido('network'))).toBeNull();
  });

  /**
   * Y tampoco puede hacer de "recuperación": si un `network` entre dos
   * `too_large` limpiara la marca, el aviso volvería a salir en cada
   * alternancia — que es el mismo ruido por otra puerta.
   */
  it('un corte de red entre dos caídas no reabre el aviso', () => {
    noticeDeCaida('g1', 'Asado', caido('too_large'));
    noticeDeCaida('g1', 'Asado', caido('network'));
    expect(noticeDeCaida('g1', 'Asado', caido('too_large'))).toBeNull();
  });

  /** Otro problema es otra caída: el texto que hay que leer es distinto. */
  it('la misma caída con OTRA razón sí avisa', () => {
    noticeDeCaida('g1', 'Asado', caido('too_large'));
    expect(noticeDeCaida('g1', 'Asado', caido('no_key'))).not.toBeNull();
  });

  it('la marca es POR GRUPO: uno caído no calla a otro', () => {
    noticeDeCaida('g1', 'Asado', caido('too_large'));
    expect(noticeDeCaida('g2', 'Viaje', caido('too_large'))).not.toBeNull();
  });

  it('olvidar la caída deja avisar de nuevo', () => {
    noticeDeCaida('g1', 'Asado', caido('too_large'));
    olvidarCaida('g1');
    expect(noticeDeCaida('g1', 'Asado', caido('too_large'))).not.toBeNull();
  });

  /**
   * La marca sobrevive al reinicio a propósito. Si viviera en memoria como el
   * fallo, cada apertura de la app volvería a avisar de lo mismo — y T-058 dice
   * que `too_large` no se arregla solo, así que serían avisos todos los días
   * por algo que el usuario ya sabe y no puede arreglar.
   *
   * Se prueba por las dos puntas: que la marca SALE al disco y que se LEE del
   * disco. Las dos juntas son lo que hace que sobreviva a un arranque; una sola
   * pasaría igual con una copia en memoria.
   */
  it('la marca sale al disco, scopeada por cuenta', () => {
    noticeDeCaida('g1', 'Asado', caido('too_large'));
    const crudo = createSecureStorage('notices').getString('sync_down_v1::u:u1');
    expect(JSON.parse(crudo ?? '{}')).toEqual({ g1: 'too_large' });
  });

  it('la marca se lee del disco, no de una copia en memoria', () => {
    // Nadie llamó a `noticeDeCaida` en esta corrida: si igual calla, es porque
    // la respuesta salió de lo persistido y no de un caché del módulo.
    createSecureStorage('notices').set('sync_down_v1::u:u1', JSON.stringify({ g1: 'too_large' }));
    expect(noticeDeCaida('g1', 'Asado', caido('too_large'))).toBeNull();
  });

  it('una marca corrupta avisa de más, nunca de menos', () => {
    createSecureStorage('notices').set('sync_down_v1::u:u1', 'no es json');
    expect(noticeDeCaida('g1', 'Asado', caido('too_large'))).not.toBeNull();
  });

});

/**
 * La guarda de siempre: reglas construidas y testeadas que nadie llama. El
 * banner de T-058 sólo se ve entrando al grupo; esto es lo que hace que el
 * usuario se entere SIN entrar.
 */
describe('está enchufado a la publicación', () => {
  it('publicar y fallar bloqueante deja el aviso en la bandeja', async () => {
    mockPublish.mockImplementation(async () => caido('too_large'));
    await publishNow('g1');
    expect(anunciados).toEqual([{
      kind: 'sync_down', groupId: 'g1', groupName: 'Asado', reason: 'too_large',
    }]);
  });

  it('publicar bien no avisa nada', async () => {
    await publishNow('g1');
    expect(anunciados).toEqual([]);
  });

  it('un corte de red al publicar no avisa', async () => {
    mockPublish.mockImplementation(async () => { throw new Error('sin red'); });
    await publishNow('g1');
    expect(anunciados).toEqual([]);
  });

  it('dos publicaciones fallidas seguidas dejan UN solo aviso', async () => {
    mockPublish.mockImplementation(async () => caido('too_large'));
    await publishNow('g1');
    await publishNow('g1');
    expect(anunciados).toHaveLength(1);
  });
});
