import { buildGroupPayload } from '../relaySync';
import { MAX_PAYLOAD_BYTES } from '../relay';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useUserStore } from '@/src/store/userStore';
import { useCommentStore } from '@/src/store/commentStore';
import { useRecurringStore } from '@/src/store/recurringStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import type { User } from '@/src/types/models';

/**
 * **Cuánto pesa un sobre de verdad.** T-058.
 *
 * Existe porque la tabla que motivó T-058 la midió un agente en su sesión y no
 * quedó NADA versionado que la rehiciera: el número más importante del ticket
 * era reproducible por una sola persona, una sola vez. Lo levantó el Arquitecto
 * revisando el diseño, y tiene razón — un número que no se puede volver a medir
 * es una anécdota, no una medición.
 *
 * No es un test de "anda o no anda": es un **banco de medición** con asertos
 * sobre lo que NO puede cambiar sin que alguien se entere.
 */
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({ schedulePublish: jest.fn(), deviceId: () => 'dev' }));

const YO = 'u_00000000000000000001';
const meta = { updatedAt: 1_700_000_000_000, isDeleted: false };

/** Avatar realista: 5 KB crudos ⇒ data URI base64. Es el rango que produce `achicarAAvatar`. */
const AVATAR = `data:image/jpeg;base64,${Buffer.alloc(5_000, 7).toString('base64')}`;
/** Firma de T-041: pública 64 hex + firma 128 hex, lo que escribe `signOnWrite`. */
const FIRMA = { k: 'a'.repeat(64), s: 'b'.repeat(128) };

function sembrar(miembros: number, gastos: number, conFotos: boolean) {
  const ids = Array.from({ length: miembros }, (_, i) => `u_${String(i + 1).padStart(20, '0')}`);
  const yo = ids[0]!;

  useAuthStore.setState({ currentUser: { id: yo, name: 'Ana' } as User });
  useUserStore.setState({ users: ids.map((id, i) => ({
    id, name: `Persona ${i}`, email: `p${i}@ejemplo.com`, authProvider: 'google',
    createdAt: 0, ...meta, ...(conFotos ? { avatar: AVATAR } : {}),
  })) as never });

  useGroupStore.setState({ groups: [{
    id: 'G', name: 'Viaje a Bariloche', memberIds: ids, currency: 'ARS',
    createdAt: 0, createdById: yo, deletionVotes: [], ...meta, ...FIRMA, rev: 1,
  }] as never });

  useExpenseStore.setState({ expenses: Array.from({ length: gastos }, (_, i) => ({
    id: `e_${String(i).padStart(20, '0')}`, groupId: 'G',
    description: 'Cena en el centro con todos',
    amount: 123_456, currency: 'ARS', paidById: ids[i % miembros],
    splits: ids.map(uid => ({ userId: uid, amount: Math.round(123_456 / miembros), isPaid: false })),
    splitMode: 'equal', category: 'food', date: 1_700_000_000_000,
    createdAt: 1_700_000_000_000, createdById: ids[i % miembros],
    deletionVotes: [], ...meta, ...FIRMA, rev: 1,
  })) as never });

  usePaymentStore.setState({ payments: [] });
  useCommentStore.setState({ comments: Array.from({ length: Math.floor(gastos * 0.3) }, (_, i) => ({
    id: `c_${String(i).padStart(20, '0')}`, expenseId: `e_${String(i).padStart(20, '0')}`,
    authorId: ids[i % miembros], text: 'Che, esto lo pagué yo',
    createdAt: 1_700_000_000_000, ...meta, ...FIRMA, rev: 1,
  })) as never });
  useRecurringStore.setState({ recurring: [] });
  usePersonalStore.setState({ entries: [] });
  useGroupKeyStore.setState({ keys: [] });

  return yo;
}

/** Bytes del JSON del delta, y bytes que efectivamente viajan (base64 ⇒ ×4/3). */
function medir(miembros: number, gastos: number, conFotos = true) {
  const yo = sembrar(miembros, gastos, conFotos);
  const json = JSON.stringify(buildGroupPayload('G', yo));
  const bytesJson = Buffer.byteLength(json, 'utf8');
  // El sobre se sella (AEAD: +nonce +tag) y se serializa en base64 antes de
  // medirse contra el tope — `sealEnvelope` devuelve base64 y el chequeo corre
  // sobre ESE string. Es el ×4/3 que no estaba documentado en ningún lado.
  const enElCable = Math.ceil((bytesJson + 40) * 4 / 3) + 220;
  return { bytesJson, enElCable, porcentaje: (enElCable / MAX_PAYLOAD_BYTES) * 100 };
}

describe('presupuesto real del sobre', () => {
  it('el tope se mide sobre base64, así que el presupuesto de JSON es ~75% del nominal', () => {
    // Si alguien "arregla" el tope subiendo MAX_PAYLOAD_BYTES sin entender esto,
    // va a creer que tiene 33% más aire del que tiene.
    const presupuestoJson = Math.floor((MAX_PAYLOAD_BYTES - 220) * 3 / 4) - 40;
    expect(presupuestoJson).toBeLessThan(MAX_PAYLOAD_BYTES * 0.76);
    expect(presupuestoJson).toBeGreaterThan(MAX_PAYLOAD_BYTES * 0.74);
  });

  it('un grupo chico entra con aire de sobra', () => {
    expect(medir(5, 30).porcentaje).toBeLessThan(50);
  });

  /**
   * **El hallazgo de T-058, y su desenlace.**
   *
   * Hasta el 2026-09-01 este test exigía lo CONTRARIO —que 5 personas con 200
   * gastos NO entraran, al 122%— y decía por escrito: «si algún día un cambio
   * lo hace entrar, este aserto se cae y obliga a mirar por qué». Pasó
   * exactamente eso: el PO corrió `006_payload_limit.sql` y el tope subió de
   * 256 KB a 1 MB. El mismo grupo ahora va al **30,6%**.
   *
   * Se invierte el aserto en vez de borrarlo: el número que importa sigue
   * siendo éste, y que un grupo ordinario entre con aire es justamente lo que
   * hay que defender de una regresión.
   */
  it('un grupo de 5 personas con 6 meses de uso YA entra, con aire', () => {
    expect(medir(5, 200).porcentaje).toBeLessThan(40);
  });

  it('y entra igual sin ninguna foto: el margen no lo daban los avatares', () => {
    expect(medir(5, 200, false).porcentaje).toBeLessThan(40);
  });

  /**
   * **Dónde está la pared ahora.** Subir el tope compró tiempo, no lo arregló:
   * el sobre sigue creciendo O(gastos) y sigue habiendo un número a partir del
   * cual el grupo deja de sincronizar para siempre. Está acá para que el día
   * que alguien lo cruce, lo cruce sabiendo.
   *
   * 5 personas ≈ 720 gastos · 8 personas ≈ 600. El arreglo de fondo es ADR-007.
   */
  it('la pared se corrió, no desapareció', () => {
    expect(medir(5, 700).porcentaje).toBeLessThan(100);
    expect(medir(8, 700).porcentaje).toBeGreaterThan(100);
  });

  it('el sobre crece con la cantidad de gastos, sin techo', () => {
    const chico = medir(5, 50).bytesJson;
    const grande = medir(5, 200).bytesJson;
    const porGasto = (grande - chico) / 150;
    // La pendiente es lo que hace que subir el tope compre tiempo pero no lo
    // arregle: cada gasto cuesta bytes para siempre.
    expect(porGasto).toBeGreaterThan(500);
  });
});

