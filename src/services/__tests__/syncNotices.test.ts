import {
  snapshot, noticesFor, esAccionable, nombreDeGrupoEnConflicto, type Notice,
} from '../syncNotices';
import type { Expense, Group, Payment } from '@/src/types/models';

const YO = 'yo';
const OTRO = 'ana';
const AHORA = 1_000_000;

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Pizza', amount: 1000, currency: 'ARS',
  paidById: OTRO, createdById: OTRO, splits: [], date: 0,
  createdAt: 0, updatedAt: 0, isDeleted: false,
} as unknown as Expense);

const conOver = (over: Partial<Expense>): Expense => ({ ...gasto(), ...over });

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: [YO, OTRO], currency: 'ARS',
  createdAt: 0, createdById: YO, updatedAt: 0, isDeleted: false,
  ...over,
} as unknown as Group);

const vacio = { expenseIds: [], paymentIds: [], borrados: [], traspasosConocidos: {} };
const kinds = (n: Notice[]) => n.map(x => x.kind).sort();

describe('gastos nuevos', () => {
  it('avisa lo que llegó de otro', () => {
    const n = noticesFor(vacio, [gasto()], [grupo()], YO, AHORA);
    expect(n).toEqual([{ kind: 'expenses', groupId: 'g1', groupName: 'Viaje', count: 1 }]);
  });

  /**
   * Un gasto que cargué yo vuelve por el sync como cualquier registro.
   * Avisarlo sería notificarle al usuario algo que acaba de hacer él mismo.
   */
  it('lo propio NO se avisa aunque vuelva por el sync', () => {
    const n = noticesFor(vacio, [conOver({ createdById: YO })], [grupo()], YO, AHORA);
    expect(n).toEqual([]);
  });

  it('lo que ya estaba antes no se vuelve a avisar', () => {
    const antes = { expenseIds: ['e1'], paymentIds: [], borrados: [], traspasosConocidos: {} };
    expect(noticesFor(antes, [gasto()], [grupo()], YO, AHORA)).toEqual([]);
  });

  /**
   * Entrar a un grupo con 50 gastos tiene que producir UN aviso, no 50. Es la
   * diferencia entre una app que avisa y una insoportable el primer día.
   */
  it('agrega por grupo en vez de avisar uno por gasto', () => {
    const muchos = [
      conOver({ id: 'a' }), conOver({ id: 'b' }), conOver({ id: 'c' }),
    ];
    const n = noticesFor(vacio, muchos, [grupo()], YO, AHORA);
    expect(n).toEqual([{ kind: 'expenses', groupId: 'g1', groupName: 'Viaje', count: 3 }]);
  });

  it('separa el conteo por grupo', () => {
    const gastos = [
      conOver({ id: 'a', groupId: 'g1' }),
      conOver({ id: 'b', groupId: 'g2' }),
      conOver({ id: 'c', groupId: 'g2' }),
    ];
    const n = noticesFor(vacio, gastos, [grupo(), grupo({ id: 'g2', name: 'Asado' })], YO, AHORA);
    expect(n).toContainEqual({ kind: 'expenses', groupId: 'g2', groupName: 'Asado', count: 2 });
    expect(n).toHaveLength(2);
  });

  it('un gasto borrado no genera aviso', () => {
    expect(noticesFor(vacio, [conOver({ isDeleted: true })], [grupo()], YO, AHORA)).toEqual([]);
  });

  // Puede llegar un gasto de un grupo que ya archivamos o del que salimos.
  it('un gasto de un grupo que no tengo no avisa nada', () => {
    expect(noticesFor(vacio, [conOver({ groupId: 'ajeno' })], [grupo()], YO, AHORA)).toEqual([]);
  });

  it('un grupo borrado tampoco', () => {
    expect(noticesFor(vacio, [gasto()], [grupo({ isDeleted: true })], YO, AHORA)).toEqual([]);
  });

  it('sin nada nuevo no hay avisos', () => {
    expect(noticesFor(vacio, [], [grupo()], YO, AHORA)).toEqual([]);
  });
});

/**
 * La asimetría que se venía arrastrando: te avisaban cuando te borraban un
 * gasto y NO cuando te lo restauraban. Al revés de lo útil — la mala noticia
 * llegaba y la buena no, así que el usuario seguía creyendo borrado algo que
 * volvió a contar en su balance.
 *
 * T-186: sin ronda ni voto, el evento sale de `restoredById` (opción B) — es
 * un aviso **por evento**: se dispara por la transición «lo tenía borrado y
 * volvió», no por el campo en sí (que queda puesto para siempre). Un device
 * que entra tarde y baja el historial completo no anuncia restauraciones de
 * hace meses porque nunca tuvo el gasto como borrado.
 */
describe('restauraciones', () => {
  const OTRO2 = 'beto';

  const restaurado = (restauro: string) => conOver({
    isDeleted: false, restoredById: restauro,
  });

  /** Lo tenía borrado en el device: es la única forma de que «volvió» sea un evento. */
  const loTeniaBorrado = {
    expenseIds: [], paymentIds: [], borrados: ['e1'], traspasosConocidos: {},
  };

  it('avisa cuando otro restaura un gasto que yo tenía borrado', () => {
    const n = noticesFor(loTeniaBorrado, [restaurado(OTRO)], [grupo()], YO, AHORA);
    expect(n).toEqual([{
      kind: 'restored', groupId: 'g1', groupName: 'Viaje', description: 'Pizza',
    }]);
  });

  it('al que restauró no se le avisa su propia restauración', () => {
    const n = noticesFor(loTeniaBorrado, [restaurado(YO)], [grupo()], YO, AHORA);
    expect(n).toEqual([]);
  });

  /**
   * El aviso es por el EVENTO. Volver a correr las reglas sobre el mismo estado
   * —que es lo que pasa en cada bajada por cursor— no puede reavisar: en la
   * foto de ahora el gasto ya está vivo, no borrado.
   */
  it('recalcular NO vuelve a avisar', () => {
    const gastoVivo = restaurado(OTRO);
    const despues = snapshot([gastoVivo], AHORA, [grupo()]);
    expect(noticesFor(despues, [gastoVivo], [grupo()], YO, AHORA)).toEqual([]);
  });

  /**
   * Un device que entra al grupo y baja el estado completo ve el gasto ya
   * restaurado. No lo tenía borrado: no le pasó nada, se está enterando.
   */
  it('un gasto que nunca tuve borrado no avisa restauración aunque traiga restoredById', () => {
    const n = noticesFor(vacio, [restaurado(OTRO2)], [grupo()], YO, AHORA);
    expect(kinds(n)).toEqual(['expenses']);
  });

  /**
   * Un gasto que yo tenía borrado y volvió NO es un gasto nuevo: es el mismo de
   * antes. Sin esto la restauración salía por duplicado —«1 gasto nuevo» + «lo
   * restauraron»— por el mismo evento, que es justo el ruido que se evita.
   */
  it('el gasto restaurado no cuenta además como gasto nuevo', () => {
    const n = noticesFor(loTeniaBorrado, [restaurado(OTRO)], [grupo()], YO, AHORA);
    expect(kinds(n)).toEqual(['restored']);
  });

  it('un gasto de un grupo que no tengo no avisa su restauración', () => {
    const ajeno = { ...restaurado(OTRO), groupId: 'gX' };
    expect(noticesFor(loTeniaBorrado, [ajeno], [grupo()], YO, AHORA)).toEqual([]);
  });

  it('la foto previa marca los gastos que estaban borrados', () => {
    const s = snapshot([gasto(), conOver({ id: 'e2', isDeleted: true })], AHORA, []);
    expect(s.borrados).toEqual(['e2']);
  });
});

describe('snapshot', () => {
  it('sólo cuenta los vivos', () => {
    const s = snapshot([gasto(), conOver({ id: 'e2', isDeleted: true })], AHORA, []);
    expect(s.expenseIds).toEqual(['e1']);
  });
});

/**
 * La guarda de siempre: lógica construida, testeada y que nadie llama ya nos
 * pasó tres veces. Arriba se prueba que las reglas andan; acá, que el sync las
 * usa. Sin esto, T-010 sería un módulo perfecto que no notifica nada.
 */
describe('está enchufado al sync', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs: typeof import('fs') = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path: typeof import('path') = require('path');
  const motor = fs.readFileSync(path.join(__dirname, '../../sync/relayEngine.ts'), 'utf8');

  /**
   * T-158b: la foto ya NO se saca antes de llamar a `drainGroup` — se saca
   * PEREZOSAMENTE, adentro del callback `antesDeAplicar` que `drainGroup`
   * invoca por su cuenta sólo si encontró algo que aplicar (nunca con el
   * buzón vacío). Por eso ahora `drainGroup(` aparece ANTES que `snapshot(`
   * en el texto — es la llamada que lo envuelve — y lo que hay que probar es
   * que `snapshot(` cuelga de `antesDeAplicar`, no de la línea antigua.
   */
  it('drainNow saca la foto previa perezosamente, dentro de antesDeAplicar', () => {
    const fn = motor.slice(motor.indexOf('export async function drainNow'));
    const bajada = fn.indexOf('drainGroup(');
    const callback = fn.indexOf('antesDeAplicar:');
    const foto = fn.indexOf('snapshot(');
    expect(bajada).toBeGreaterThan(-1);
    expect(callback).toBeGreaterThan(-1);
    expect(foto).toBeGreaterThan(-1);
    // `antesDeAplicar` se pasa DENTRO de la llamada a `drainGroup`, y `snapshot`
    // cuelga DENTRO de ese callback — no antes de que exista la llamada.
    expect(bajada).toBeLessThan(callback);
    expect(callback).toBeLessThan(foto);
  });

  it('drainNow avisa de lo que llegó', () => {
    expect(motor).toContain('avisarDeLoNuevo(');
    expect(motor).toContain('noticesFor(');
  });

  // Un aviso que tira no puede llevarse puesto el sync.
  it('el aviso va sin await para no meterse en el camino del sync', () => {
    const linea = motor.split('\n').find(l => l.includes('avisarDeLoNuevo(antes'))!;
    expect(linea).toContain('void ');
  });

  it('entrar a un grupo nuevo también avisa', () => {
    expect(motor).toMatch(/kind: 'joined'/);
  });
});

/**
 * ADR-006, decisión 5: cuando alguien registra un saldo que me involucra, me
 * entero. Antes `syncNotices` sólo miraba gastos: un pago aparecía en el
 * balance sin que nada lo anunciara.
 */
describe('avisos de saldo', () => {
  const pago = (over: Partial<Payment> = {}): Payment => ({
    id: 'p1', groupId: 'g1', fromUserId: 'beto', toUserId: 'yo',
    amount: 500_000, currency: 'ARS', date: 0, createdAt: 0,
    createdById: 'beto', updatedAt: 0, isDeleted: false, ...over,
  } as Payment);

  const grupos = [{ id: 'g1', name: 'Asado', memberIds: ['yo', 'beto'], isDeleted: false } as Group];

  it('me avisa cuando alguien registra que me pagó', () => {
    const antes = snapshot([], 0, []);
    const avisos = noticesFor(antes, [], grupos, 'yo', 0, [pago()]);
    expect(avisos.some(a => a.kind === 'settled')).toBe(true);
  });

  it('NO me avisa de un pago que registré yo', () => {
    // Ya lo sé: lo acabo de hacer.
    const antes = snapshot([], 0, []);
    const avisos = noticesFor(antes, [], grupos, 'yo', 0, [pago({ createdById: 'yo' })]);
    expect(avisos.some(a => a.kind === 'settled')).toBe(false);
  });

  it('NO me avisa de un pago entre otras dos personas', () => {
    const antes = snapshot([], 0, []);
    const avisos = noticesFor(antes, [], grupos, 'yo',
      0, [pago({ fromUserId: 'beto', toUserId: 'caro', createdById: 'beto' })]);
    expect(avisos.some(a => a.kind === 'settled')).toBe(false);
  });

  it('un pago que YA conocía no vuelve a avisar', () => {
    const antes = snapshot([], 0, [], [pago()]);
    const avisos = noticesFor(antes, [], grupos, 'yo', 0, [pago()]);
    expect(avisos.some(a => a.kind === 'settled')).toBe(false);
  });

  it('el aviso dice de quién y cuánto', () => {
    const antes = snapshot([], 0, []);
    const avisos = noticesFor(antes, [], grupos, 'yo', 0, [pago()]);
    const a = avisos.find(x => x.kind === 'settled')!;
    expect(a).toMatchObject({ groupName: 'Asado', amount: 500_000, currency: 'ARS' });
  });

  it('un pago borrado no avisa', () => {
    const antes = snapshot([], 0, []);
    const avisos = noticesFor(antes, [], grupos, 'yo', 0, [pago({ isDeleted: true })]);
    expect(avisos.some(a => a.kind === 'settled')).toBe(false);
  });
});

describe('esAccionable (T-062)', () => {
  it('settlement_pending, sync_down, clock_off y group_key_conflict piden acción; el resto informa', () => {
    // `Record<Notice['kind'], boolean>` en vez de dos ejemplos sueltos: si se
    // agrega un `kind` a `Notice` sin decidir acá, este objeto deja de
    // compilar — la exhaustividad la garantiza el tipo, no el `expect` de abajo.
    const clasificacion: Record<Notice['kind'], boolean> = {
      settlement_pending: esAccionable('settlement_pending'),
      sync_down: esAccionable('sync_down'),
      clock_off: esAccionable('clock_off'),
      group_key_conflict: esAccionable('group_key_conflict'),
      expenses: esAccionable('expenses'),
      settled: esAccionable('settled'),
      restored: esAccionable('restored'),
      joined: esAccionable('joined'),
      group_replaced: esAccionable('group_replaced'),
      group_invite_full: esAccionable('group_invite_full'),
      join_claim_stalled: esAccionable('join_claim_stalled'),
      group_traspaso_recurring_blocked: esAccionable('group_traspaso_recurring_blocked'),
    };
    expect(clasificacion).toEqual({
      // `clock_off` es accionable aunque lo que hay que hacer esté FUERA de la
      // app: clasificarlo como historia dejaría al usuario viendo fechas mal
      // para siempre sin saber por qué.
      settlement_pending: true, sync_down: true, clock_off: true,
      // T-136: leerlo no lo resuelve — hay que elegir una clave.
      group_key_conflict: true,
      // T-172 (ítem 2): mismo criterio que `clock_off` — hay algo que hacer,
      // aunque sea fuera de la app (pedir un link nuevo).
      join_claim_stalled: true,
      // T-058: el traspaso ya se aplicó, no hay nada que aprobar u objetar.
      expenses: false, settled: false, restored: false, joined: false, group_replaced: false,
      // T-150 ronda 2/5: el reclamo ya fue rechazado, no hay nada que resolver.
      group_invite_full: false,
      // T-172 (ítem 3): el traspaso del resto ya se aplicó, no hay nada que aprobar.
      group_traspaso_recurring_blocked: false,
    });
  });
});

describe('nombreDeGrupoEnConflicto (T-136)', () => {
  const t = (key: string, opts?: Record<string, unknown>) => `${key}(${JSON.stringify(opts ?? {})})`;

  it('siempre se marca «sin verificar», aunque el nombre sea el del grupo local (PO 2026-09-14)', () => {
    // Un grupo local en conflicto pudo drenarse con la clave en disputa: su nombre
    // puede haberlo escrito el atacante tanto como el del drop.
    expect(nombreDeGrupoEnConflicto({ groupName: 'Viaje' }, t))
      .toBe('sync.key_conflict.unverified_name({"group":"Viaje"})');
  });
});
