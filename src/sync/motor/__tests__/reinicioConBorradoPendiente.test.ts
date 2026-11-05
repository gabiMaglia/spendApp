/**
 * T-269 · El logout de un borrado de cuenta que no llegó al servidor conserva
 * la sesión del buzón: el reintento al arrancar (`resumePendingDeletion`) la
 * necesita para `delete_my_account`, que identifica por `auth.uid()`.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/sesion/relaySession', () => ({
  ensureRelaySession: jest.fn(async () => 'anonymous'),
  bindAuthRefreshToAppState: jest.fn(() => jest.fn()),
  haySesionEnCurso: jest.fn(() => false),
  reabrirSesionAnonima: jest.fn(async () => {}),
}));
jest.mock('@/src/sync/adaptadores/supabase/relay', () => ({
  isRelayConfigured: () => true,
  subscribeTopic: jest.fn(() => () => {}),
  getRelayClient: () => null,
  esFuncionAusente: () => false,
}));

import { reiniciarSyncPorCambioDeCuenta } from '../relayEngine';
import { reabrirSesionAnonima } from '@/src/sync/sesion/relaySession';
import { clearJournal, writeJournal, type DeleteJournal } from '@/src/store/deleteJournal';

const mockReabrir = reabrirSesionAnonima as jest.Mock;

function diario(cuentaEnServidor?: DeleteJournal['cuentaEnServidor']): DeleteJournal {
  return { accountId: 'ua', pendientes: [], purgados: 0, ultimaCuenta: true, startedAt: 1, cuentaEnServidor };
}

beforeEach(() => {
  clearJournal();
  mockReabrir.mockClear();
});

describe('T-269 · reinicio por cambio de cuenta con borrado pendiente', () => {
  it('sin borrado en curso cierra la sesión del buzón, como siempre', () => {
    reiniciarSyncPorCambioDeCuenta();
    expect(mockReabrir).toHaveBeenCalledTimes(1);
  });

  it('con la cuenta pendiente en el servidor NO cierra la sesión', () => {
    writeJournal(diario('pendiente'));
    reiniciarSyncPorCambioDeCuenta();
    expect(mockReabrir).not.toHaveBeenCalled();
  });

  it.each(['borrada', 'abandonada', undefined] as const)(
    'con la cuenta %s en el servidor la cierra: ya no hay reintento que la use',
    (estado) => {
      writeJournal(diario(estado));
      reiniciarSyncPorCambioDeCuenta();
      expect(mockReabrir).toHaveBeenCalledTimes(1);
    },
  );
});
