/**
 * T-191 — caracterización del bug reportado por el PO en `main` (build
 * instalada): al invitar a alguien a un grupo, el invitado ve
 * `sync.manifest_gap_*` aunque no falte nada; desaparece cuando llega un
 * gasto.
 *
 * Diagnóstico del orquestador: carrera entre publicación y drenaje. El
 * emisor manda las rebanadas una por una y el manifiesto AL FINAL; el
 * receptor (Realtime) puede drenar justo en el medio y recibir las
 * rebanadas SIN el manifiesto (que todavía no es visible en el buzón); el
 * drenaje siguiente recibe SÓLO el manifiesto. En `main`, el chequeo del
 * manifiesto compara contra `recibidasPorRemitente` de ESE drenaje puntual
 * (`relaySync.ts` ~708-733) — como esa vuelta no vio ninguna rebanada, todo
 * queda "faltante" y dispara `recordManifestCheck` con faltantes falsos.
 *
 * En esta rama, `appliedSlices.entradaCumplida` (T-191) recuerda las
 * rebanadas que YA se aplicaron en drenajes anteriores, así que el segundo
 * drenaje (sólo con el manifiesto) las encuentra igual y el gap no aparece.
 *
 * Mismo arnés de buzón simulado que `receptorIncremental.test.ts`, con un
 * agregado: `__retenerCkey`/`__soltarRetenido` para simular que el sobre
 * del manifiesto llega al buzón DESPUÉS de que el primer drenaje ya pasó
 * por ahí (la condición de carrera real).
 */
jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  let ckeyARetener: string | null = null;
  let retenido: { topic: string; entry: { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string } } | null = null;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; ckeyARetener = null; retenido = null; },
    // Marca la ckey cuyo PRÓXIMO envío se retiene en vez de entrar al buzón
    // (simula el sobre en vuelo que todavía no es visible para un `fetchSince`).
    __retenerCkey: (ckey: string) => { ckeyARetener = ckey; },
    // Suelta el sobre retenido (si hay uno) al buzón, como si recién ahora
    // aterrizara.
    __soltarRetenido: () => {
      if (!retenido) return;
      const { topic, entry } = retenido;
      const lista = buzones.get(topic) ?? [];
      lista.push(entry);
      buzones.set(topic, lista);
      retenido = null;
    },
    // Descarta el sobre retenido sin publicarlo — para el escenario de
    // control, donde lo que "aterriza" después no es el manifiesto real
    // retenido sino uno fabricado a mano con una ckey fantasma.
    __descartarRetenido: () => { retenido = null; },
    // Empuja un sobre ya sellado/firmado directamente al buzón (mismo patrón
    // que `receptorIncremental.test.ts`), para fabricar a mano el manifiesto
    // de control.
    __push: (topic: string, payload: string, sender: string, ckey?: string) => {
      const lista = (buzones.get(topic) ?? []).filter(e => !(e.sender === sender && e.ckey === ckey));
      lista.push({ seq: ++seq, topic, payload, sender, compactable: true, ckey });
      buzones.set(topic, lista);
      return lista[lista.length - 1]!.seq;
    },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      const s = ++seq;
      const entry = { seq: s, topic, payload, sender, compactable, ckey };
      if (ckeyARetener && ckey === ckeyARetener) {
        retenido = { topic, entry };
        ckeyARetener = null; // sólo la primera vez que se manda esa ckey
        return { ok: true, seq: s };
      }
      const lista = (buzones.get(topic) ?? []).filter(e => !(compactable && ckey && e.sender === sender && e.ckey === ckey));
      lista.push(entry);
      buzones.set(topic, lista);
      return { ok: true, seq: s };
    },
    fetchSince: async (topic: string, since: number, excludeSender?: string, limit = 200) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since && e.sender !== excludeSender).slice(0, limit);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1]!.seq : since, more: lista.length === limit };
    },
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});
jest.mock('../authorHealth', () => ({ observeAuthor: jest.fn(async () => 'ok'), RECHAZAR_AUTORES_NO_VERIFICADOS: false }));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));
jest.mock('../relayEngine', () => ({ olvidarCursor: jest.fn() }), { virtual: true });

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { publishToGroup, drainGroup } from '../relaySync';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
import { deriveCkey } from '../slices';
import { deriveTopic, sealEnvelope } from '../envelopeCrypto';
import { signEnvelope } from '../envelopeSign';
import { buildManifest } from '../manifest';
import { ensureIdentity } from '@/src/store/identityStore';
import type { Group } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __reset: () => void;
  __retenerCkey: (ckey: string) => void;
  __soltarRetenido: () => void;
  __descartarRetenido: () => void;
  __push: (topic: string, payload: string, sender: string, ckey?: string) => number;
};

async function topicDe(): Promise<string> {
  const record = useGroupKeyStore.getState().getKey('G')!;
  return deriveTopic(groupKeyBytes('G')!, record.epoch);
}

const grupo = (): Group => ({
  id: 'G', name: 'Grupo', memberIds: ['u1', 'u2'], currency: 'USD', createdAt: 1, createdById: 'u1',
  miembros: { u1: { estado: 'in', at: 1 }, u2: { estado: 'in', at: 1 } }, updatedAt: 1_000, isDeleted: false,
} as Group);

beforeEach(() => {
  relayMock.__reset();
  clearManifestGaps();
  useAuthStore.setState({ currentUser: { id: 'u1' } } as never);
  useGroupKeyStore.setState({ keys: [] });
  useGroupKeyStore.getState().ensureKey('G');
  useGroupStore.setState({ groups: [grupo()] } as never);
  useExpenseStore.setState({ expenses: [] } as never);
  useCommentStore.setState({ comments: [] } as never);
});

describe('T-191: el manifiesto que llega en un drenaje posterior a sus rebanadas no marca falta', () => {
  it('carrera Realtime — el receptor drena las rebanadas antes de que el manifiesto sea visible, y el gap no aparece', async () => {
    const key = groupKeyBytes('G')!;
    const ckeyManifiesto = await deriveCkey(key, 'manifest', 'unica');
    // Retiene el PRÓXIMO envío con la ckey del manifiesto: llega a
    // `sendEnvelope` (el emisor lo manda), pero no entra al buzón todavía —
    // como si el drenaje del receptor corriera justo antes de que ese sobre
    // fuera visible.
    relayMock.__retenerCkey(ckeyManifiesto);

    await publishToGroup('G', 'u1', 'device1');

    // Primer drenaje: sólo ve las rebanadas, el manifiesto sigue retenido.
    const primero = await drainGroup('G', 'u2', 'deviceB', 0);
    expect(primero.ok).toBe(true);
    if (!primero.ok) throw new Error('unreachable');

    // Recién ahora "aterriza" el manifiesto en el buzón.
    relayMock.__soltarRetenido();

    // Segundo drenaje, desde el cursor del primero: sólo trae el manifiesto.
    const segundo = await drainGroup('G', 'u2', 'deviceB', primero.cursor);
    expect(segundo.ok).toBe(true);
    if (!segundo.ok) throw new Error('unreachable');

    expect(segundo.completo).toBe(true);
    // El bug del PO: sin recordar lo ya aplicado en el drenaje anterior,
    // este segundo drenaje (que sólo vio el manifiesto) marca TODO como
    // faltante. El fix (T-191) hace que siga sin faltar nada.
    expect(manifestGapFor('G')).toBeNull();
  });

  it('control: una ckey que el manifiesto declara pero que en verdad nunca se publicó SÍ sigue marcando falta', async () => {
    const key = groupKeyBytes('G')!;
    const ckeyManifiesto = await deriveCkey(key, 'manifest', 'unica');
    // Misma carrera: retiene el manifiesto REAL (el que de verdad describe
    // lo publicado) para que el primer drenaje sólo vea las rebanadas.
    relayMock.__retenerCkey(ckeyManifiesto);

    await publishToGroup('G', 'u1', 'device1');

    const primero = await drainGroup('G', 'u2', 'deviceB', 0);
    expect(primero.ok).toBe(true);
    if (!primero.ok) throw new Error('unreachable');

    // Pero lo que "aterriza" después no es el manifiesto real retenido —
    // se descarta y en su lugar se fabrica uno que declara una ckey que
    // nunca viajó de verdad (sobre perdido / TTL vencido).
    relayMock.__descartarRetenido();
    const topic = await topicDe();
    const manifiestoFalso = await buildManifest([{ ckey: 'ckey-fantasma-nunca-publicada', json: JSON.stringify({ nunca: 'llegó' }) }]);
    const sealed = sealEnvelope(key, JSON.stringify(manifiestoFalso));
    const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
    relayMock.__push(topic, firmado, 'device1', ckeyManifiesto);

    const segundo = await drainGroup('G', 'u2', 'deviceB', primero.cursor);
    expect(segundo.ok).toBe(true);
    if (!segundo.ok) throw new Error('unreachable');

    // A pesar de que el fix hace que lo YA aplicado se recuerde entre
    // drenajes, el medidor sigue funcionando para una falta REAL: nada de
    // lo que el receptor recuerda "cumple" una ckey que nunca llegó.
    const gap = manifestGapFor('G');
    expect(gap).not.toBeNull();
    expect(gap!.missingCkeys).toContain('ckey-fantasma-nunca-publicada');
  });
});
