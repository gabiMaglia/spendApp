jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, compactable, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    fetchSince: async (topic: string, since: number) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1].seq : since };
    },
    deleteMyEnvelopes: async () => ({ ok: true }),
  };
});

// Sin esto, drainGroup dispara consultas de red reales al directorio de
// autores (authorHealth/authorKeys) — diagnóstico fuera de banda, no
// relevante para lo que este test verifica.
jest.mock('../authorHealth', () => ({ observeAuthor: jest.fn() }));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { publishToGroup, drainGroup } from '../relaySync';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
import * as avatarTopic from '../avatarTopic';
import { sealEnvelope, deriveTopic, openEnvelope } from '../envelopeCrypto';
import { signEnvelope, verifyEnvelope } from '../envelopeSign';
import { ensureIdentity } from '@/src/store/identityStore';
import { sendEnvelope } from '../relay';
import type { Group, Expense, User } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __buzones: Map<string, { ckey?: string; compactable?: boolean; payload: string }[]>;
  __reset: () => void;
};

function grupo(): Group {
  return {
    id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD',
    createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

function gasto(id: string): Expense {
  return {
    id, groupId: 'G', description: 'x'.repeat(2_000), amount: 10, currency: 'USD',
    paidById: 'u1', splits: [{ userId: 'u1', amount: 10, isPaid: false }], splitMode: 'equal',
    category: 'other', date: 1, createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Expense;
}

describe('drainGroup aplica rebanadas y detecta manifiestos incompletos', () => {
  beforeEach(() => {
    relayMock.__reset();
    clearManifestGaps();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('G');
  });

  it('reconstruye el estado completo leyendo todas las rebanadas', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    const gastos = Array.from({ length: 200 }, (_, i) => gasto(`e${i}`));
    useExpenseStore.setState({ expenses: gastos } as never);
    await publishToGroup('G', 'u1', 'device1');

    // Un segundo "dispositivo" (mismo store en este test, cursor en 0) drena.
    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true);
    expect(useExpenseStore.getState().expenses.length).toBe(200);
    expect(manifestGapFor('G')).toBeNull();
  });

  it('si falta una rebanada declarada por el manifiesto, marca el gap y NO rompe el resto', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)!;
    sobres.splice(0, 1); // se "pierde" la primera rebanada de datos

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true); // el drenaje en sí no falla
    expect(manifestGapFor('G')).not.toBeNull();
    expect(manifestGapFor('G')!.missingCkeys.length).toBeGreaterThan(0);
  });

  /**
   * Revisión de Task 6, hallazgo #2: el chequeo pooleaba ckeys de TODOS los
   * remitentes. `ckey` se deriva de `(clave del grupo, campo, primer id de la
   * rebanada)` — nada del remitente entra en la fórmula — así que dos
   * dispositivos que publican el MISMO estado (plausible: ambos ya
   * sincronizados republicando) producen ckeys IDÉNTICAS. Si a uno de los dos
   * le falta esa rebanada en el buzón, el chequeo pooleado la daba por
   * recibida igual porque el otro remitente sí la mandó — un gap real quedaba
   * enmascarado.
   */
  it('el gap del manifiesto de un remitente NO se enmascara con la ckey (colisionada) de otro remitente', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);

    // Dos "dispositivos" publican el MISMO estado de grupo: mismas entidades,
    // mismo orden → mismas ckeys (la fórmula no depende del remitente).
    await publishToGroup('G', 'u1', 'deviceA');
    await publishToGroup('G', 'u1', 'deviceB');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)! as unknown as { sender: string; ckey?: string }[];

    // Se pierde la rebanada de `expenses` de deviceA (no el manifiesto).
    const idxDataA = sobres.findIndex(s => s.sender === 'deviceA' && s.ckey && !esManifiesto(sobres, s));
    expect(idxDataA).toBeGreaterThanOrEqual(0);
    const ckeyPerdida = sobres[idxDataA]!.ckey!;
    sobres.splice(idxDataA, 1);

    // deviceB SÍ mandó una rebanada con esa misma ckey (colisión de contenido
    // idéntico) — bajo el chequeo pooleado viejo, esto tapaba el gap de A.
    expect(sobres.some(s => s.sender === 'deviceB' && s.ckey === ckeyPerdida)).toBe(true);

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'deviceC', 0);
    expect(result.ok).toBe(true);
    expect(manifestGapFor('G')).not.toBeNull();
    expect(manifestGapFor('G')!.missingCkeys).toContain(ckeyPerdida);
  });

  /**
   * Revisión de Task 6, hallazgo #2 (segunda mitad): el gap real de un
   * remitente incompleto no debe "contaminar" al remitente completo — cada
   * manifiesto se mide contra las rebanadas DE SU PROPIO remitente.
   */
  it('un remitente completo no aparece falsamente afectado por el gap real de otro remitente', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);

    // deviceA publica su propio estado completo (e1, e2).
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'deviceA');

    // deviceB publica un estado DISTINTO (e3, e4) → ckeys distintas de las de A.
    useExpenseStore.setState({ expenses: [gasto('e3'), gasto('e4')] } as never);
    await publishToGroup('G', 'u1', 'deviceB');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)! as unknown as { sender: string; ckey?: string }[];

    // A deviceB se le pierde su rebanada de EXPENSES (no la de `groups`: esa
    // es idéntica a la de deviceA por contenido y perderla no impediría que
    // e3/e4 se apliquen). `SLICED_FIELDS` manda `groups` antes que `expenses`,
    // así que es la SEGUNDA rebanada de datos de deviceB en orden de envío.
    const dataDeB = sobres.filter(s => s.sender === 'deviceB' && s.ckey && !esManifiesto(sobres, s));
    expect(dataDeB.length).toBeGreaterThanOrEqual(2);
    const ckeyPerdidaDeB = dataDeB[1]!.ckey!;
    const idxDataB = sobres.indexOf(dataDeB[1]!);
    sobres.splice(idxDataB, 1);

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'deviceC', 0);
    expect(result.ok).toBe(true);
    expect(useExpenseStore.getState().expenses.map(e => e.id).sort()).toEqual(['e1', 'e2']);

    const gap = manifestGapFor('G');
    expect(gap).not.toBeNull();
    // El único faltante es el de deviceB — deviceA (completo) no aporta nada.
    expect(gap!.missingCkeys).toEqual([ckeyPerdidaDeB]);
  });

  /**
   * Revisión de Task 6, hallazgo #3: si `fetchSince` devuelve exactamente el
   * límite del drenaje, puede haber más sobres esperando en el servidor —el
   * manifiesto o sus rebanadas podrían estar en la página siguiente— y
   * calcular un gap acá sería un falso positivo sin mitigación posible. El
   * chequeo debe saltearse entero para esta vuelta.
   */
  it('con la página llena al límite del drenaje, NO se registra ningún gap aunque falte una rebanada', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)! as unknown as { seq: number; topic: string; payload: string; sender: string; ckey?: string }[];

    // Se pierde una rebanada de datos: sin el chequeo #3, esto generaría un gap.
    const idxData = sobres.findIndex(s => s.ckey && !esManifiesto(sobres, s));
    sobres.splice(idxData, 1);

    // Se rellena el buzón con sobres basura hasta llegar EXACTO al límite de
    // `fetchSince` (200) que usa `drainGroup` — simula que hay más allá de lo
    // que esta página trajo.
    let seq = Math.max(...sobres.map(s => s.seq), 0);
    while (sobres.length < 200) {
      sobres.push({ seq: ++seq, topic, payload: 'basura-no-descifra', sender: 'ajeno' });
    }
    expect(sobres.length).toBe(200);

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true);
    expect(manifestGapFor('G')).toBeNull();
  });

  /**
   * Revisión de Task 9, hallazgo #1 (Critical): el guard viejo de
   * `fetchAvatarIfMissing` comparaba el `avatarDigest` entrante contra
   * `local.avatarDigest` — pero para cuando esa función corre, la rebanada
   * `users` YA se mergeó (`mergeUsersLWW`), así que `local.avatarDigest` YA es
   * el digest NUEVO mientras `local.avatar` sigue con los bytes VIEJOS. El
   * guard viejo daba un empate trivial y la foto nueva nunca se pedía. Este
   * test publica una foto, la drena, después CAMBIA la foto (mismo usuario,
   * nuevo digest) y verifica que la segunda vuelta sí trae los bytes nuevos.
   */
  it('si la foto de un usuario ya conocido CAMBIA, el siguiente drenaje trae y adopta los bytes nuevos', async () => {
    useGroupStore.setState({ groups: [{ ...grupo(), memberIds: ['u1', 'u2'] }] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);

    const fotoVieja = 'foto-vieja-'.repeat(200);
    const fotoNueva = 'foto-nueva-'.repeat(200);

    // Ronda 1: u2 publica su foto vieja.
    useUserStore.setState({ users: [
      { id: 'u2', name: 'Dos', email: '', authProvider: 'google', createdAt: 1, avatar: fotoVieja, updatedAt: 1, isDeleted: false } as unknown as User,
    ] });
    await publishToGroup('G', 'u2', 'deviceU2');

    let result = await drainGroup('G', 'u1', 'deviceU1', 0);
    expect(result.ok).toBe(true);
    expect(useUserStore.getState().getUserById('u2')?.avatar).toBe(fotoVieja);

    // Ronda 2: u2 cambia de foto y vuelve a publicar (mismo usuario, digest
    // distinto — NO es un usuario nuevo).
    useUserStore.setState({ users: [
      { id: 'u2', name: 'Dos', email: '', authProvider: 'google', createdAt: 1, avatar: fotoNueva, updatedAt: 2, isDeleted: false } as unknown as User,
    ] });
    await publishToGroup('G', 'u2', 'deviceU2');

    result = await drainGroup('G', 'u1', 'deviceU1', 0);
    expect(result.ok).toBe(true);

    const u2Final = useUserStore.getState().getUserById('u2');
    // Con el bug viejo, esto se quedaba pegado en `fotoVieja` para siempre.
    expect(u2Final?.avatar).toBe(fotoNueva);
    expect(u2Final?.avatarDigest).toBeTruthy();
  });

  /**
   * Revisión de Task 9, hallazgo #2 (Critical, clase T-132/S3-A1): el loop de
   * fetch de avatares en `drainGroup` iteraba `delta.users` CRUDO en vez de la
   * salida de `acotarDeltaAlGrupo`, así que un miembro de un grupo podía
   * declarar un `avatarDigest` para un contacto que la víctima conoce de OTRO
   * grupo (no miembro de ESTE), y el código lo adoptaba igual — aunque el
   * merge normal de `users` ya lo descarta.
   *
   * El envío se arma A MANO (mismos primitivos que usa `relaySync.ts`:
   * `sealEnvelope`/`signEnvelope`/`deriveTopic`) en vez de usar
   * `publishToGroup`, a propósito: `buildGroupPayload` YA filtra `users` por
   * la membresía que declara el propio remitente (`delGrupo[0]?.memberIds`),
   * así que un envío honesto por esa vía jamás incluiría a un no-miembro. El
   * ataque real (S3-A1) es justamente que un miembro del grupo NO está atado
   * a mandar sólo lo que la app arma — puede escribir cualquier sobre válido
   * (firmado con su clave, sellado con la clave del grupo) directo al buzón.
   */
  it('un avatarDigest declarado para un contacto que NO es miembro de este grupo no se fetch-ea ni se adopta', async () => {
    const fetchSpy = jest.spyOn(avatarTopic, 'fetchAvatarIfMissing').mockResolvedValue(undefined);

    useGroupStore.setState({ groups: [{ ...grupo(), memberIds: ['u1', 'uAtt'] }] } as never);
    useExpenseStore.setState({ expenses: [] } as never);

    // La víctima YA conoce a 'u3' (de otro grupo), con su foto real cacheada.
    // Esto es lo que hace que `acotarDeltaAlGrupo` lo trate como "conocido,
    // pero no miembro de G" y lo descarte, en vez de como "perfil nuevo".
    useUserStore.setState({ users: [
      { id: 'u3', name: 'Contacto ajeno', email: '', authProvider: 'google', createdAt: 1, avatar: 'foto-contacto-real', updatedAt: 1, isDeleted: false } as unknown as User,
    ] });

    // El atacante ('uAtt', miembro legítimo de G) arma a mano un sobre que
    // declara un `avatarDigest` malicioso para 'u3' — sin pasar por
    // `publishToGroup`/`buildGroupPayload`, que jamás lo dejaría salir así.
    const key = groupKeyBytes('G')!;
    const record = useGroupKeyStore.getState().getKey('G')!;
    const topic = await deriveTopic(key, record.epoch);
    const deltaMalicioso = {
      version: 1, featureVersion: 2, fromUserId: 'uAtt', timestamp: Date.now(),
      groups: [], expenses: [], payments: [], recurring: [], comments: [],
      users: [{ id: 'u3', name: 'Contacto ajeno', email: '', authProvider: 'google', createdAt: 1, avatarDigest: 'digest-malicioso', updatedAt: 999, isDeleted: false }],
    };
    const sealed = sealEnvelope(key, JSON.stringify(deltaMalicioso));
    const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
    await sendEnvelope(topic, firmado, 'deviceAttacker', false);

    const result = await drainGroup('G', 'u1', 'deviceVictima', 0);
    expect(result.ok).toBe(true);

    // Con el bug viejo (iterando `delta.users` crudo), esto se llamaba igual.
    expect(fetchSpy).not.toHaveBeenCalledWith('G', 'u3', expect.anything());
    expect(useUserStore.getState().getUserById('u3')?.avatar).toBe('foto-contacto-real');
    expect(useUserStore.getState().getUserById('u3')?.avatarDigest).toBeUndefined();

    fetchSpy.mockRestore();
  });

  /**
   * Revisión final, Fix 2 (crítico), verificado del lado del DRENAJE: un
   * dispositivo que republica el grupo sin ser el dueño de una foto no debe
   * reafirmar frescura sobre ella. Este test confirma el efecto observable
   * desde `drainGroup`: si `uB` (no dueño) tiene localmente una copia STALE
   * de la foto de `uA` sin `avatarDigest` propio guardado, y republica el
   * grupo, un tercero que drena esa publicación NO debe pedir ni adoptar
   * nada para `uA` — con el bug viejo, `uB` declaraba un digest "fresco"
   * calculado de sus bytes stale, y el tercero lo tomaba como una foto nueva.
   */
  it('Fix 2: un remitente que no es dueño de una foto no dispara su re-fetch en quien drena', async () => {
    const fetchSpy = jest.spyOn(avatarTopic, 'fetchAvatarIfMissing').mockResolvedValue(undefined);

    useGroupStore.setState({ groups: [{ ...grupo(), memberIds: ['u1', 'uA', 'uB'] }] } as never);
    useExpenseStore.setState({ expenses: [] } as never);

    const fotoStaleDeA = 'foto-stale-de-A-cacheada-por-B'.repeat(30);
    useUserStore.setState({ users: [
      { id: 'uA', name: 'A', email: '', authProvider: 'google', createdAt: 1, avatar: fotoStaleDeA, updatedAt: 1, isDeleted: false } as unknown as User,
      { id: 'uB', name: 'B', email: '', authProvider: 'google', createdAt: 1, updatedAt: 1, isDeleted: false } as unknown as User,
    ] });

    // uB republica el grupo (motivo cualquiera, no relacionado a fotos).
    await publishToGroup('G', 'uB', 'deviceB');

    useUserStore.setState({ users: [] });
    const result = await drainGroup('G', 'u1', 'deviceC', 0);
    expect(result.ok).toBe(true);

    expect(fetchSpy).not.toHaveBeenCalledWith('G', 'uA', expect.anything());
    expect(useUserStore.getState().getUserById('uA')?.avatarDigest).toBeUndefined();

    fetchSpy.mockRestore();
  });

  /**
   * Residual de Fix 2, hallado en la revisión final y parqueado como ticket:
   * el fetch de fotos leía `acotado.users` (el delta entrante) en vez del
   * store YA MERGEADO. Si `uB` republica con una copia de `uA` más VIEJA
   * (`updatedAt` menor) que la que `uC` ya tiene, el merge por LWW descarta
   * correctamente el registro de `uB` — pero el loop de fotos, al leer el
   * digest del delta descartado en vez del store, igual pedía y adoptaba la
   * foto vieja. Arreglo: leer el digest del store post-merge.
   */
  it('un remitente con una copia MÁS VIEJA (LWW) no hace bajar de versión la foto ya correcta', async () => {
    const fetchSpy = jest.spyOn(avatarTopic, 'fetchAvatarIfMissing').mockResolvedValue(undefined);

    useGroupStore.setState({ groups: [{ ...grupo(), memberIds: ['u1', 'uA', 'uB'] }] } as never);
    useExpenseStore.setState({ expenses: [] } as never);

    // uC (el que drena, 'u1' en este arnés) ya tiene la foto NUEVA de uA.
    useUserStore.setState({ users: [
      { id: 'uA', name: 'A', email: '', authProvider: 'google', createdAt: 1, avatar: 'foto-nueva', avatarDigest: 'digest-nuevo', updatedAt: 2_000, isDeleted: false } as unknown as User,
    ] });

    // uB republica con su copia VIEJA de uA (updatedAt menor).
    useUserStore.setState({ users: [
      { id: 'uA', name: 'A', email: '', authProvider: 'google', createdAt: 1, avatarDigest: 'digest-viejo', updatedAt: 1_000, isDeleted: false } as unknown as User,
      { id: 'uB', name: 'B', email: '', authProvider: 'google', createdAt: 1, updatedAt: 1, isDeleted: false } as unknown as User,
    ] });
    await publishToGroup('G', 'uB', 'deviceB');

    // uC vuelve a tener su copia correcta (nueva) antes de drenar.
    useUserStore.setState({ users: [
      { id: 'uA', name: 'A', email: '', authProvider: 'google', createdAt: 1, avatar: 'foto-nueva', avatarDigest: 'digest-nuevo', updatedAt: 2_000, isDeleted: false } as unknown as User,
    ] });
    const result = await drainGroup('G', 'u1', 'deviceC', 0);
    expect(result.ok).toBe(true);

    expect(fetchSpy).not.toHaveBeenCalledWith('G', 'uA', 'digest-viejo');
    expect(useUserStore.getState().getUserById('uA')?.avatarDigest).toBe('digest-nuevo');

    fetchSpy.mockRestore();
  });

  /**
   * Revisión final, Fix 4 (importante): el manifiesto declara `{ckey, digest}`
   * pero antes el chequeo de gaps sólo miraba si la `ckey` había LLEGADO,
   * nunca si su contenido coincidía con el digest declarado. Este test
   * reemplaza una rebanada legítima por otra con la MISMA ckey pero
   * contenido DISTINTO (simula corrupción, o una versión vieja/equivocada
   * que terminó bajo esa ckey) y confirma que el chequeo la trata como
   * faltante — sin por eso dejar de aplicar el resto del drenaje.
   */
  it('Fix 4: una rebanada cuyo contenido no coincide con el digest declarado se reporta como faltante', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)! as unknown as
      { seq: number; topic: string; payload: string; sender: string; ckey?: string; compactable?: boolean }[];

    const idxData = sobres.findIndex(s => s.ckey && !esManifiesto(sobres, s));
    expect(idxData).toBeGreaterThanOrEqual(0);
    const original = sobres[idxData]!;

    const key = groupKeyBytes('G')!;
    // Confirma que el sobre original en efecto abre y trae contenido válido,
    // para no reemplazar por error algo que ya estaba roto.
    const abiertoOriginal = verifyEnvelope(original.payload);
    expect(abiertoOriginal).not.toBeNull();
    expect(openEnvelope(key, abiertoOriginal!.sealed)).not.toBeNull();

    // Mismo `ckey`, mismo remitente, contenido DISTINTO al que el manifiesto
    // declaró (digest no va a coincidir).
    const contenidoDistinto = JSON.stringify({
      version: 1, featureVersion: 2, fromUserId: 'u1', timestamp: Date.now(),
      groups: [], expenses: [{ ...gasto('e1'), description: 'CONTENIDO CORROMPIDO/DISTINTO' }],
      payments: [], users: [],
    });
    const sealed = sealEnvelope(key, contenidoDistinto);
    const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
    sobres[idxData] = { ...original, payload: firmado };

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'deviceC', 0);
    expect(result.ok).toBe(true); // el drenaje en sí no falla ni se bloquea

    const gap = manifestGapFor('G');
    expect(gap).not.toBeNull();
    expect(gap!.missingCkeys).toContain(original.ckey);
  });
});

/** El sobre de manifiesto es el único, por remitente, sin `ckey` de dato real —
 * en este mock alcanza con buscar el payload más largo o, más simple, marcar
 * por posición: `publishToGroup` manda el manifiesto SIEMPRE al final de los
 * suyos. Para no depender de eso, se identifica desencriptando... pero eso
 * duplicaría el motor de cripto acá. Más simple y robusto: el manifiesto es
 * el ÚNICO sobre de ese remitente cuya `ckey` NO coincide con ninguna de las
 * ckeys de datos — pero como no tenemos esa lista a mano en el helper, se usa
 * la heurística de que es el ÚLTIMO sobre de ese remitente en el array (orden
 * de inserción == orden de envío, y el manifiesto siempre se manda último).
 */
function esManifiesto(
  todos: { sender: string }[],
  sobre: { sender: string },
): boolean {
  const delMismoRemitente = todos.filter(s => s.sender === sobre.sender);
  return delMismoRemitente[delMismoRemitente.length - 1] === sobre;
}
