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
jest.mock('../authorHealth', () => ({
  observeAuthor: jest.fn(async () => 'ok'),
  RECHAZAR_AUTORES_NO_VERIFICADOS: false,
}));
jest.mock('../authorKeys', () => ({ refreshPendingAuthors: jest.fn(async () => {}) }));

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore, groupKeyBytes } from '@/src/store/groupKeyStore';
import { useUserStore } from '@/src/store/userStore';
import { publishToGroup, drainGroup } from '../relaySync';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
import * as avatarTopic from '../avatarTopic';
// `jest.requireMock`, no `import * as`: un import de namespace por ESM/Babel
// copia el objeto mockeado (interop de CJS), y mutar esa copia no se vería
// desde `relaySync.ts`, que resuelve el `require()` original.
const authorHealth = jest.requireMock('../authorHealth') as {
  observeAuthor: jest.Mock;
  RECHAZAR_AUTORES_NO_VERIFICADOS: boolean;
};
import { sealEnvelope, deriveTopic, openEnvelope } from '../envelopeCrypto';
import { signEnvelope, verifyEnvelope } from '../envelopeSign';
import { ensureIdentity } from '@/src/store/identityStore';
import { sendEnvelope } from '../relay';
import { olvidarFallosDeAplicacion, DRAIN_MAX_REINTENTOS } from '../drainFailures';
import { listErrors, clearErrors } from '@/src/services/errorLog';
import type { Group, Expense, User } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __buzones: Map<string, { ckey?: string; compactable?: boolean; payload: string }[]>;
  __reset: () => void;
};

function grupo(memberIds: string[] = ['u1']): Group {
  return {
    id: 'G', name: 'Grupo', memberIds, currency: 'USD',
    // T-182: `miembros` es la fuente de verdad de `memberIds` (derivado) —
    // sin esto, `mergeGroups` (que corre adentro de drain/publish) recalcula
    // memberIds desde un roster vacío y borra a todos los miembros.
    miembros: Object.fromEntries(memberIds.map((uid, i) => [uid, { estado: 'in' as const, at: i }])),
    createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

// El relleno de 2.000 chars fuerza el slicing en varias rebanadas (no cabe
// entero en TARGET_SLICE_BYTES junto con 200 gastos). Va en un campo propio
// (`relleno`), no en `description`: T-150 (SEC-07 + TEC-14) capea `description`
// a MAX_TEXTO_CORTO, y este relleno es artificio de test, no un dato real.
function gasto(id: string): Expense {
  return {
    id, groupId: 'G', description: 'Cena', relleno: 'x'.repeat(2_000), amount: 10, currency: 'USD',
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
    authorHealth.observeAuthor.mockReset();
    authorHealth.observeAuthor.mockResolvedValue('ok');
    authorHealth.RECHAZAR_AUTORES_NO_VERIFICADOS = false;
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

  it('T-033: con el rechazo APAGADO (default), un autor no verificado se aplica igual', async () => {
    authorHealth.observeAuthor.mockResolvedValue('clave_desconocida');
    authorHealth.RECHAZAR_AUTORES_NO_VERIFICADOS = false;

    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true);
    expect(useExpenseStore.getState().expenses).toHaveLength(1);
  });

  it('T-033: con el rechazo PRENDIDO, una clave_desconocida se descarta sin romper el drenaje', async () => {
    authorHealth.observeAuthor.mockResolvedValue('clave_desconocida');
    authorHealth.RECHAZAR_AUTORES_NO_VERIFICADOS = true;

    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true);
    expect(useExpenseStore.getState().expenses).toHaveLength(0);

    authorHealth.RECHAZAR_AUTORES_NO_VERIFICADOS = false;
  });

  it('T-033: con el rechazo PRENDIDO, "sin_directorio" (no se pudo consultar) NUNCA se descarta', async () => {
    authorHealth.observeAuthor.mockResolvedValue('sin_directorio');
    authorHealth.RECHAZAR_AUTORES_NO_VERIFICADOS = true;

    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true);
    expect(useExpenseStore.getState().expenses).toHaveLength(1);

    authorHealth.RECHAZAR_AUTORES_NO_VERIFICADOS = false;
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
   * Revisión de Task 6, hallazgo #3 (histórico) + **T-146**: cuando `fetchSince`
   * devolvía exactamente el límite del drenaje, el drenaje de UNA sola página no
   * podía saber si había más sobres esperando —el manifiesto o sus rebanadas
   * podrían estar en la página siguiente—, así que el chequeo de gap se
   * salteaba entero para esa vuelta.
   *
   * Con la paginación de T-146 (TEC-02) esa ambigüedad se resuelve pidiendo la
   * página siguiente en vez de rendirse: si no queda nada más, `drainGroup`
   * termina con `completo: true` y RECIÉN AHÍ corre el chequeo de manifiesto
   * (`if (completo && manifiestos.length > 0)`), así que ahora SÍ detecta la
   * rebanada faltante — ya no hay "sin mitigación posible", la mitigación es
   * pedir la próxima página.
   */
  it('con la primera página llena al límite pero sin más por delante, sí se detecta el gap tras paginar', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)! as unknown as { seq: number; topic: string; payload: string; sender: string; ckey?: string }[];

    // Se pierde una rebanada de datos: esto genera un gap real.
    const idxData = sobres.findIndex(s => s.ckey && !esManifiesto(sobres, s));
    const ckeyPerdida = sobres[idxData]!.ckey!;
    sobres.splice(idxData, 1);

    // Se rellena el buzón con sobres basura hasta llegar EXACTO al límite de
    // `fetchSince` (200) que usa `drainGroup` en su primera página — simula que
    // la primera página vino llena, sin decir todavía si hay más detrás.
    let seq = Math.max(...sobres.map(s => s.seq), 0);
    while (sobres.length < 200) {
      sobres.push({ seq: ++seq, topic, payload: 'basura-no-descifra', sender: 'ajeno' });
    }
    expect(sobres.length).toBe(200);

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // La segunda página (vacía, porque no hay más allá del sobre 200) confirma
    // `completo: true`, y sólo entonces se corre el chequeo de manifiesto.
    expect(result.completo).toBe(true);
    expect(manifestGapFor('G')?.missingCkeys).toEqual([ckeyPerdida]);
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
    useGroupStore.setState({ groups: [grupo(['u1', 'u2'])] } as never);
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

    useGroupStore.setState({ groups: [grupo(['u1', 'uAtt'])] } as never);
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

    useGroupStore.setState({ groups: [grupo(['u1', 'uA', 'uB'])] } as never);
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

    useGroupStore.setState({ groups: [grupo(['u1', 'uA', 'uB'])] } as never);
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

/**
 * T-146, ronda 1 del verifier (defecto D1). `relaySlicedDrain.test.ts` ya
 * arma sobres a mano con `sealEnvelope`/`signEnvelope` para simular a un
 * miembro legítimo del grupo mandando algo que `publishToGroup` nunca
 * mandaría — acá el "algo" es un sobre cuyo texto plano, tras `JSON.parse`,
 * es `null` en vez de un objeto: un sobre firmado y sellado con la clave del
 * grupo (así que pasa firma y cifrado) no tiene por qué contener un objeto.
 */
describe('T-146 · D1: una rebanada cuyo texto plano no es un objeto', () => {
  beforeEach(() => {
    relayMock.__reset();
    clearManifestGaps();
    olvidarFallosDeAplicacion();
    clearErrors();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('G');
    authorHealth.observeAuthor.mockReset();
    authorHealth.observeAuthor.mockResolvedValue('ok');
    authorHealth.RECHAZAR_AUTORES_NO_VERIFICADOS = false;
  });

  it('no tira sin atajar: se anota, se reintenta y a los DRAIN_MAX_REINTENTOS se saltea con rastro, sin trabar el resto', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    // Se agrega, a mano, un sobre extra cuyo plaintext es literalmente `null`.
    // `JSON.parse('null')` da `null`; `isManifest(null)` es `false`
    // (`manifest.ts`), así que entra al camino de "rebanada de datos" con
    // `delta: null` — y `delta.fromUserId` (en `observeAuthor`) tira.
    const key = groupKeyBytes('G')!;
    const record = useGroupKeyStore.getState().getKey('G')!;
    const topic = await deriveTopic(key, record.epoch);
    const sealed = sealEnvelope(key, 'null');
    const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
    await sendEnvelope(topic, firmado, 'deviceAttacker', false);

    useExpenseStore.setState({ expenses: [] } as never);

    let r = await drainGroup('G', 'u1', 'deviceVictima', 0);
    // Mientras quede presupuesto, no se da por leída: no truena, y el
    // resto del lote (e1, e2) todavía no se aplicó porque la rebanada rota
    // vino ANTES en `seq` (se publicó después del grupo/gastos... en este
    // mock el orden de sends es: rebanadas de G, luego el sobre roto, así
    // que el roto es el ÚLTIMO — no bloquea a e1/e2, que ya se aplicaron).
    for (let i = 1; i < DRAIN_MAX_REINTENTOS; i++) {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      r = await drainGroup('G', 'u1', 'deviceVictima', r.cursor);
    }
    // Se agotó el presupuesto: la rebanada rota se deja atrás CON RASTRO, y
    // el drenaje termina completo — nunca un throw crudo que tumbe `drainNow`.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.completo).toBe(true);
    expect(r.skipped).toBeGreaterThanOrEqual(1);
    expect(useExpenseStore.getState().expenses.map(e => e.id).sort()).toEqual(['e1', 'e2']);
    expect(listErrors().some(e => e.message.includes('sync.apply_failed'))).toBe(true);
  });
});

/**
 * T-146, ronda 2 del verifier (defecto D3). `isManifest` (`manifest.ts:22-26`)
 * sólo pide `version === 2` y `entries` array — nunca valida los ELEMENTOS.
 * Un sobre firmado y sellado con la clave del grupo cuyo texto plano sea
 * `{"version":2,"entries":[null]}` pasa como manifiesto válido, y el chequeo
 * final (`for (const entry of manifest.entries) { ...entry.ckey... }`) corre
 * DESPUÉS del loop de rebanadas, fuera de cualquier `try` — `entry.ckey` tira
 * un TypeError que `drainGroup` nunca ataja: `drainNow` cae en su `catch`
 * crudo sin escribir cursor ni limpiar la marca de T-089, y el grupo no
 * vuelve a publicar hasta el TTL de 30 días. `errorLog` queda vacío.
 */
describe('T-146 · D3 (ronda 2): un manifiesto con forma reconocible pero entradas inválidas', () => {
  beforeEach(() => {
    relayMock.__reset();
    clearManifestGaps();
    olvidarFallosDeAplicacion();
    clearErrors();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('G');
    authorHealth.observeAuthor.mockReset();
    authorHealth.observeAuthor.mockResolvedValue('ok');
    authorHealth.RECHAZAR_AUTORES_NO_VERIFICADOS = false;
  });

  async function enviarManifiestoRoto(entries: unknown[]) {
    const key = groupKeyBytes('G')!;
    const record = useGroupKeyStore.getState().getKey('G')!;
    const topic = await deriveTopic(key, record.epoch);
    const sealed = sealEnvelope(key, JSON.stringify({ version: 2, entries }));
    const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
    await sendEnvelope(topic, firmado, 'deviceAttacker', false);
  }

  it.each([
    ['entrada null', [null]],
    ['entrada string', ['no-soy-un-objeto']],
    ['ckey numérica', [{ ckey: 123, digest: 'd' }]],
  ])('%s: no trunca el drenaje, deja rastro y no se cuela como manifiesto', async (_label, entries) => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    await enviarManifiestoRoto(entries);

    useExpenseStore.setState({ expenses: [] } as never);
    const r = await drainGroup('G', 'u1', 'deviceVictima', 0);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.completo).toBe(true);
    expect(useExpenseStore.getState().expenses.map(e => e.id).sort()).toEqual(['e1', 'e2']);
    // No se cuela como manifiesto válido: ningún gap se registra a partir de
    // entradas que nunca deberían haberse aceptado como manifiesto.
    expect(manifestGapFor('G')).toBeNull();
    expect(listErrors().some(e => e.message.includes('sync.') && e.message.includes('manifest'))).toBe(true);
  });
});
