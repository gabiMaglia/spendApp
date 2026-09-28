/**
 * T-146, ronda 1 del verifier (D2 a/b): dos condiciones de la paginación que
 * sólo pueden pasar en una página POSTERIOR a la primera, y que la suite no
 * ejercitaba — el verifier señaló que un mutante que pusiera `completo = true`
 * antes del `break` de la falla de red pasaría toda la suite igual.
 *
 * El tercer caso que pidió el verifier (D2·c: texto plano que no es un
 * objeto) ya está cubierto — no depende de en qué página cae, así que no se
 * duplica acá: `relaySlicedDrain.test.ts:531-591` ('T-146 · D1: una rebanada
 * cuyo texto plano no es un objeto').
 */
jest.mock('@/src/sync/adaptadores/supabase/relay', () => ({
  isRelayConfigured: () => true,
  subscribeTopic: () => () => {},
  sendEnvelope: jest.fn(),
  fetchSince: jest.fn(),
  deleteMyEnvelopes: async () => ({ ok: true }),
}));
jest.mock('@/src/sync/confianza/authorHealth', () => ({ observeAuthor: jest.fn(async () => 'ok'), RECHAZAR_AUTORES_NO_VERIFICADOS: false }));
jest.mock('@/src/sync/confianza/authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { drainGroup } from '../relaySync';
import { fetchSince } from '@/src/sync/adaptadores/supabase/relay';
import { generateGroupKey } from '@/src/sync/nucleo/envelopeCrypto';
import { toHex } from '@/src/sync/nucleo/hexBytes';

const fetchSinceMock = fetchSince as jest.Mock;

// Sobres que no descifran (payload basura): `verifyEnvelope` los descarta
// (`skipped++`) sin tirar — alcanza para forzar una página llena sin
// depender de armar cripto real, que no es lo que estos dos tests miden.
const paginaLlena = (desde: number, cuantos: number) => ({
  ok: true as const,
  envelopes: Array.from({ length: cuantos }, (_, i) => ({
    seq: desde + i + 1, sender: 'ajeno', payload: 'basura-no-descifra',
  })),
  cursor: desde + cuantos,
});

beforeEach(() => {
  fetchSinceMock.mockReset();
  useAuthStore.setState({ currentUser: { id: 'u1' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
});

it('D2·a: una falla de red en la página ≥2 no marca completo — aplica lo leído y avanza el cursor hasta ahí', async () => {
  fetchSinceMock
    .mockResolvedValueOnce(paginaLlena(0, 2)) // página 0: llena (2 == pageLimit) → sigue
    .mockResolvedValueOnce({ ok: false, reason: 'network' }); // página 1: se cae la red

  const r = await drainGroup('G', 'u1', 'device2', 0, { pageLimit: 2 });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  // Mutante que este test mata: `completo = true` puesto antes del `break`
  // de la falla de red en una página posterior a la 0.
  expect(r.completo).toBe(false);
  expect(r.cursor).toBe(2); // lo que trajo la página 0; la 1 nunca se aplicó
  expect(fetchSinceMock).toHaveBeenCalledTimes(2);
});

it('D2·b: la clave cambia mientras se espera la página ≥2 — se descarta el lote entero de esa vuelta (T-136 · D-1)', async () => {
  fetchSinceMock
    .mockResolvedValueOnce(paginaLlena(0, 2)) // página 0: con la clave todavía vigente
    .mockImplementationOnce(async () => {
      // El usuario elige otra clave para el grupo MIENTRAS este `await`
      // esperaba la red de la segunda página — mismo escenario de T-136 · D-1,
      // acá forzado en la página 1 en vez de en la 0.
      useGroupKeyStore.setState({ keys: [{ groupId: 'G', key: toHex(generateGroupKey()), epoch: 2 }] });
      return paginaLlena(2, 1);
    });

  const r = await drainGroup('G', 'u1', 'device2', 0, { pageLimit: 2 });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.reason).toBe('key_changed');
  expect(fetchSinceMock).toHaveBeenCalledTimes(2);
});
