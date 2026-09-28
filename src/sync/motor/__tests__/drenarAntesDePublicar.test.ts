import { createSecureStorage } from '@/src/utils/secureStorage';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import {
  marcarPendienteDeDrenaje, estaPendienteDeDrenaje, limpiarPendienteDeDrenaje,
  gruposPendientesDeDrenaje,
} from '../pendingDrain';
import { readCursor, writeCursor } from '../relayEngine';
import type { User } from '@/src/types/models';

/**
 * T-089 · **No se publica un grupo hasta haberlo drenado.**
 *
 * `mergeByIdLWW` es una unión y nunca una resta, así que el teléfono de alguien
 * que reingresa y publica antes de drenar **resucita lo que el grupo borró
 * mientras no estaba**, en el aparato de todos.
 *
 * Lo que se fija acá es la marca y su ciclo de vida. El caso de plata
 * —la resurrección misma— está en `reingresoNoResucita.test.ts`.
 */
const YO: User = { id: 'u1', name: 'Yo' } as User;

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: YO });
  useGroupKeyStore.setState({ keys: [] });
});

describe('la marca', () => {
  it('empieza sin nada pendiente', () => {
    expect(estaPendienteDeDrenaje('G')).toBe(false);
    expect(gruposPendientesDeDrenaje()).toEqual([]);
  });

  it('marca y limpia', () => {
    marcarPendienteDeDrenaje('G');
    expect(estaPendienteDeDrenaje('G')).toBe(true);

    limpiarPendienteDeDrenaje('G');
    expect(estaPendienteDeDrenaje('G')).toBe(false);
  });

  it('marcar un grupo no marca los otros', () => {
    marcarPendienteDeDrenaje('G');
    expect(estaPendienteDeDrenaje('H')).toBe(false);
  });

  it('vive en STORAGE y no en memoria: sobrevive a cerrar la app', () => {
    // Si viviera en memoria, cerrar la app limpiaría la guarda y el primer
    // arranque después de reingresar publicaría el estado viejo.
    //
    // Se comprueba contra la clave persistida y NO con `jest.resetModules()`:
    // resetear el registro crea una SEGUNDA instancia del storage y de
    // `relayEngine`, y a partir de ahí el resto del archivo mide contra
    // instancias distintas. (Lo aprendí acá: contaminaba el test del cursor.)
    marcarPendienteDeDrenaje('G');
    const crudo = createSecureStorage('groupkeys').getString('pending_drain_v1::u:u1');
    expect(crudo && JSON.parse(crudo)).toEqual(['G']);
  });

  it('es POR CUENTA: la de al lado no hereda la marca', () => {
    marcarPendienteDeDrenaje('G');
    useAuthStore.setState({ currentUser: { id: 'u2', name: 'Otro' } as User });
    expect(estaPendienteDeDrenaje('G')).toBe(false);
  });

  it('con el dato corrupto se degrada a «ninguno», no a «todos trabados»', () => {
    // Al revés sería peor que el defecto: un grupo que no publica nunca por una
    // clave rota, sin nada que lo destrabe.
    createSecureStorage('groupkeys').set('pending_drain_v1::u:u1', '{no es json');
    expect(estaPendienteDeDrenaje('G')).toBe(false);
  });
});

describe('el cursor — la mitad sin la que la guarda es de adorno', () => {
  it('marcar con topic OLVIDA el cursor', () => {
    /**
     * **Es la mutación más importante del ticket.** El cursor sobrevive a la
     * salida del grupo: si no se olvida, al reingresar `drainNow` pide
     * `seq > cursor_viejo`, puede volver con CERO sobres, la marca se limpia sin
     * haber aprendido nada, y el teléfono publica su estado viejo igual.
     */
    writeCursor('topic_G', 42);
    expect(readCursor('topic_G')).toBe(42);

    marcarPendienteDeDrenaje('G', 'topic_G');

    expect(readCursor('topic_G')).toBe(0);
  });

  it('sin topic no toca ningún cursor ajeno', () => {
    writeCursor('topic_H', 7);
    marcarPendienteDeDrenaje('G');
    expect(readCursor('topic_H')).toBe(7);
  });
});
