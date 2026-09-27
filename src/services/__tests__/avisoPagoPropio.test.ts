import { noticesFor, snapshot } from '../syncNotices';
import { signCore } from '@/src/sync/recordSign';
import { forgetAuthorKeys } from '@/src/sync/authorKeys';
import { clearVerdictCache } from '@/src/sync/verdictCache';
import { useAuthStore } from '@/src/store/authStore';
import { ensureIdentity } from '@/src/store/identityStore';
import type { Group, Payment, User } from '@/src/types/models';

/**
 * T-170 · D-2 (dictamen del verificador, ronda de retorno 2). Sin este fix,
 * un pago legítimo del acreedor —él lo registró Y lo firmó— quedaba
 * `pendiente` en el propio aparato del acreedor mientras el directorio no
 * conteste (o nunca, borde ADR-004), y le mandaba `settlement_pending` a él
 * mismo por un pago que acaba de cargar.
 *
 * checkRecord es el REAL acá (sin mock): lo que se prueba es que
 * `resolveAuthorKeys` conoce la pública propia sin ninguna fuente externa.
 */

const NOW = 1_800_000_000_000;
const g: Group = {
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
  deletionMode: 'consensus', createdAt: 0, createdById: 'ana', deletionVotes: [],
  updatedAt: 0, isDeleted: false,
};

afterEach(() => {
  forgetAuthorKeys();
  clearVerdictCache();
  useAuthStore.setState({ currentUser: null });
});

it('el acreedor registra y firma su propio pago, sin directorio: no recibe settlement_pending', () => {
  useAuthStore.setState({ currentUser: { id: 'beto' } as User });
  const { privateKey } = ensureIdentity();
  const base = {
    id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto', createdById: 'beto',
    amount: 500, currency: 'ARS', date: 1, createdAt: 1, rev: 1, updatedAt: 1, isDeleted: false,
  } as Payment;
  const firmado = { ...base, ...signCore('payment', base as never, privateKey) } as Payment;

  const antes = snapshot([], NOW, [g], []);
  const avisos = noticesFor(antes, [], [g], 'beto', NOW, [firmado]);

  expect(avisos.map(a => a.kind)).not.toContain('settlement_pending');
});

it('mutante guard: sin la firma propia (o firmado por otra clave), el mismo pago SÍ pide acuse', () => {
  useAuthStore.setState({ currentUser: { id: 'beto' } as User });
  const sinFirmar = {
    id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto', createdById: 'beto',
    amount: 500, currency: 'ARS', date: 1, createdAt: 1, rev: 1, updatedAt: 1, isDeleted: false,
  } as Payment;

  const antes = snapshot([], NOW, [g], []);
  const avisos = noticesFor(antes, [], [g], 'beto', NOW, [sinFirmar]);

  expect(avisos.map(a => a.kind)).toContain('settlement_pending');
});
