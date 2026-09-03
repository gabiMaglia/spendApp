import { snapshot, noticesFor, esAccionable, msRestanteDeBorrado, type Notice } from '../syncNotices';
import { DELETION_TIMEOUT_MS } from '@/src/sync/SyncEngine';
import type { Expense, Group, Payment } from '@/src/types/models';

const YO = 'yo';
const OTRO = 'ana';
const AHORA = 1_000_000;

const gasto = (over: Partial<Expense> = {}): Expense => ({
  id: 'e1', groupId: 'g1', description: 'Pizza', amount: 1000, currency: 'ARS',
  paidById: OTRO, createdById: OTRO, splits: [], date: 0,
  createdAt: 0, updatedAt: 0, isDeleted: false, deletionVotes: [],
} as unknown as Expense);

const conOver = (over: Partial<Expense>): Expense => ({ ...gasto(), ...over });

const grupo = (over: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Viaje', memberIds: [YO, OTRO], currency: 'ARS',
  createdAt: 0, createdById: YO, deletionVotes: [], updatedAt: 0, isDeleted: false,
  ...over,
} as unknown as Group);

const vacio = { expenseIds: [], conBorradoAbierto: [], paymentIds: [], borrados: [] };
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
    const antes = { expenseIds: ['e1'], conBorradoAbierto: [], paymentIds: [], borrados: [] };
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

describe('pedidos de borrado', () => {
  const pedido = (userId: string, at = AHORA) =>
    conOver({ deletionVotes: [{ userId, votedAt: at, action: 'delete' }] });

  it('avisa cuando otro pide borrar', () => {
    const antes = { expenseIds: ['e1'], conBorradoAbierto: [], paymentIds: [], borrados: [] };
    const n = noticesFor(antes, [pedido(OTRO)], [grupo()], YO, AHORA);
    expect(n).toEqual([{
      kind: 'deletion', groupId: 'g1', groupName: 'Viaje', description: 'Pizza', expenseId: 'e1',
    }]);
  });

  it('al que lo pidió no se le avisa su propio pedido', () => {
    const antes = { expenseIds: ['e1'], conBorradoAbierto: [], paymentIds: [], borrados: [] };
    expect(noticesFor(antes, [pedido(YO)], [grupo()], YO, AHORA)).toEqual([]);
  });

  it('una ronda que ya estaba abierta no se vuelve a avisar', () => {
    const antes = { expenseIds: ['e1'], conBorradoAbierto: ['e1'], paymentIds: [], borrados: [] };
    expect(noticesFor(antes, [pedido(OTRO)], [grupo()], YO, AHORA)).toEqual([]);
  });

  // Ya no hay nada que objetar: avisar sería mandar a una acción imposible.
  it('una ronda vencida no avisa', () => {
    const antes = { expenseIds: ['e1'], conBorradoAbierto: [], paymentIds: [], borrados: [] };
    const viejo = pedido(OTRO, AHORA - DELETION_TIMEOUT_MS - 1);
    expect(noticesFor(antes, [viejo], [grupo()], YO, AHORA)).toEqual([]);
  });

  it('una ronda objetada tampoco', () => {
    const antes = { expenseIds: ['e1'], conBorradoAbierto: [], paymentIds: [], borrados: [] };
    const objetado = conOver({ deletionVotes: [
      { userId: OTRO, votedAt: AHORA, action: 'delete' },
      { userId: YO, votedAt: AHORA, action: 'cancel' },
    ] });
    expect(noticesFor(antes, [objetado], [grupo()], YO, AHORA)).toEqual([]);
  });

  it('un gasto nuevo que además viene con pedido de borrado avisa las dos cosas', () => {
    const n = noticesFor(vacio, [pedido(OTRO)], [grupo()], YO, AHORA);
    expect(kinds(n)).toEqual(['deletion', 'expenses']);
  });
});

/**
 * La asimetría que se venía arrastrando: te avisaban cuando te borraban un
 * gasto y NO cuando te lo restauraban. Al revés de lo útil — la mala noticia
 * llegaba y la buena no, así que el usuario seguía creyendo borrado algo que
 * volvió a contar en su balance.
 *
 * Es un aviso **por evento**: se dispara por la transición «lo tenía borrado y
 * volvió», no por el estado `restored` de la ronda. Recalcular la ronda no
 * puede volver a avisar, y un device que entra tarde y baja el historial
 * completo no anuncia restauraciones de hace meses.
 */
describe('restauraciones', () => {
  const OTRO2 = 'beto';

  /** Ronda pedida por `pidio` y frenada con un `restore` de `restauro`. */
  const restaurado = (pidio: string, restauro: string) => conOver({
    isDeleted: false,
    deletionVotes: [
      { userId: pidio, votedAt: AHORA - 1000, action: 'delete' },
      { userId: restauro, votedAt: AHORA, action: 'cancel', intent: 'restore' },
    ],
  });

  /** Lo tenía borrado en el device: es la única forma de que «volvió» sea un evento. */
  const loTeniaBorrado = {
    expenseIds: [], conBorradoAbierto: [], paymentIds: [], borrados: ['e1'],
  };

  it('avisa cuando otro restaura un gasto que yo tenía borrado', () => {
    const n = noticesFor(loTeniaBorrado, [restaurado(YO, OTRO)], [grupo()], YO, AHORA);
    expect(n).toEqual([{
      kind: 'restored', groupId: 'g1', groupName: 'Viaje', description: 'Pizza',
    }]);
  });

  it('al que restauró no se le avisa su propia restauración', () => {
    const n = noticesFor(loTeniaBorrado, [restaurado(OTRO, YO)], [grupo()], YO, AHORA);
    expect(n).toEqual([]);
  });

  /**
   * El aviso es por el EVENTO. Volver a correr las reglas sobre el mismo estado
   * —que es lo que pasa en cada bajada por cursor— no puede reavisar: en la
   * foto de ahora el gasto ya está vivo, no borrado.
   */
  it('recalcular la ronda NO vuelve a avisar', () => {
    const gastoVivo = restaurado(YO, OTRO);
    const despues = snapshot([gastoVivo], AHORA);
    expect(noticesFor(despues, [gastoVivo], [grupo()], YO, AHORA)).toEqual([]);
  });

  /**
   * Un device que entra al grupo y baja el estado completo ve la ronda ya
   * restaurada. No la tenía borrada: no le pasó nada, se está enterando.
   */
  it('un gasto que nunca tuve borrado no avisa restauración aunque su ronda diga `restored`', () => {
    const n = noticesFor(vacio, [restaurado(OTRO, OTRO2)], [grupo()], YO, AHORA);
    expect(kinds(n)).toEqual(['expenses']);
  });

  /**
   * Un gasto que yo tenía borrado y volvió NO es un gasto nuevo: es el mismo de
   * antes. Sin esto la restauración salía por duplicado —«1 gasto nuevo» + «lo
   * restauraron»— por el mismo evento, que es justo el ruido que se evita.
   */
  it('el gasto restaurado no cuenta además como gasto nuevo', () => {
    const n = noticesFor(loTeniaBorrado, [restaurado(YO, OTRO)], [grupo()], YO, AHORA);
    expect(kinds(n)).toEqual(['restored']);
  });

  /**
   * Frenar un borrado que NUNCA se aplicó en este teléfono no es una
   * restauración: no cambió nada de lo que el usuario veía. Lo que lo hace un
   * evento es haberlo tenido borrado, no el estado de la ronda.
   */
  it('una objeción a un borrado que nunca se aplicó acá no avisa', () => {
    const objetado = conOver({ deletionVotes: [
      { userId: OTRO, votedAt: AHORA - 1000, action: 'delete' },
      { userId: OTRO2, votedAt: AHORA, action: 'cancel' },
    ] });
    const nuncaLoTuveBorrado = {
      expenseIds: ['e1'], conBorradoAbierto: ['e1'], paymentIds: [], borrados: [],
    };
    expect(noticesFor(nuncaLoTuveBorrado, [objetado], [grupo()], YO, AHORA)).toEqual([]);
  });

  /**
   * **T-061.** Un peer manda `isDeleted: false` con un `updatedAt` mayor —LWW
   * puro, sin voto de restauración— y el gasto reaparece sin abrir ninguna
   * ronda. Vuelve a contar en el balance.
   *
   * Antes la condición exigía que la ronda quedara en `restored`, así que este
   * camino era MUDO. Y es el más necesitado de aviso, no el menos: cuando hay
   * voto por lo menos queda quién y por qué; acá no queda nada.
   */
  it('un gasto que vuelve por LWW puro, SIN voto, también avisa', () => {
    const volvioSolo = conOver({ isDeleted: false, deletionVotes: [] });
    expect(noticesFor(loTeniaBorrado, [volvioSolo], [grupo()], YO, AHORA)).toEqual([{
      kind: 'restored', groupId: 'g1', groupName: 'Viaje', description: 'Pizza',
    }]);
  });

  // Volver con una ronda que quedó a medias —pedido y objeción, sin `restore`—
  // sigue siendo el gasto reapareciendo en mi teléfono.
  it('y también si vuelve con una ronda que no terminó en restaurado', () => {
    const objetadoYVivo = conOver({ isDeleted: false, deletionVotes: [
      { userId: OTRO, votedAt: AHORA - 1000, action: 'delete' },
      { userId: OTRO2, votedAt: AHORA, action: 'cancel' },
    ] });
    expect(kinds(noticesFor(loTeniaBorrado, [objetadoYVivo], [grupo()], YO, AHORA)))
      .toEqual(['restored']);
  });

  it('un gasto de un grupo que no tengo no avisa su restauración', () => {
    const ajeno = { ...restaurado(YO, OTRO), groupId: 'gX' };
    expect(noticesFor(loTeniaBorrado, [ajeno], [grupo()], YO, AHORA)).toEqual([]);
  });

  it('la foto previa marca los gastos que estaban borrados', () => {
    const s = snapshot([gasto(), conOver({ id: 'e2', isDeleted: true })], AHORA);
    expect(s.borrados).toEqual(['e2']);
  });
});

describe('snapshot', () => {
  it('sólo cuenta los vivos', () => {
    const s = snapshot([gasto(), conOver({ id: 'e2', isDeleted: true })], AHORA);
    expect(s.expenseIds).toEqual(['e1']);
  });

  it('marca los que tienen una ronda de borrado abierta', () => {
    const abierto = conOver({
      deletionVotes: [{ userId: OTRO, votedAt: AHORA, action: 'delete' }],
    });
    expect(snapshot([abierto], AHORA).conBorradoAbierto).toEqual(['e1']);
  });

  it('una ronda vencida no cuenta como abierta', () => {
    const viejo = conOver({
      deletionVotes: [{ userId: OTRO, votedAt: AHORA - DELETION_TIMEOUT_MS - 1, action: 'delete' }],
    });
    expect(snapshot([viejo], AHORA).conBorradoAbierto).toEqual([]);
  });

  it('sin votos no hay nada abierto', () => {
    expect(snapshot([gasto()], AHORA).conBorradoAbierto).toEqual([]);
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

  it('drainNow saca la foto previa ANTES de bajar', () => {
    const fn = motor.slice(motor.indexOf('export async function drainNow'));
    const foto = fn.indexOf('snapshot(');
    const bajada = fn.indexOf('drainGroup(');
    expect(foto).toBeGreaterThan(-1);
    expect(foto).toBeLessThan(bajada);
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
    const antes = snapshot([], 0, [pago()]);
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
  it('deletion, settlement_pending y sync_down piden acción; el resto sólo informa', () => {
    // `Record<Notice['kind'], boolean>` en vez de dos ejemplos sueltos: si se
    // agrega un `kind` a `Notice` sin decidir acá, este objeto deja de
    // compilar — la exhaustividad la garantiza el tipo, no el `expect` de abajo.
    const clasificacion: Record<Notice['kind'], boolean> = {
      deletion: esAccionable('deletion'),
      settlement_pending: esAccionable('settlement_pending'),
      sync_down: esAccionable('sync_down'),
      expenses: esAccionable('expenses'),
      settled: esAccionable('settled'),
      restored: esAccionable('restored'),
      joined: esAccionable('joined'),
    };
    expect(clasificacion).toEqual({
      deletion: true, settlement_pending: true, sync_down: true,
      expenses: false, settled: false, restored: false, joined: false,
    });
  });
});

describe('msRestanteDeBorrado (T-071)', () => {
  const abierto = (userId: string, at = AHORA) =>
    conOver({ id: 'e1', deletionVotes: [{ userId, votedAt: at, action: 'delete' }] });

  const avisoDeGastos: Notice = { kind: 'expenses', groupId: 'g1', groupName: 'Viaje', count: 1 };
  const avisoDeBorrado: Notice = {
    kind: 'deletion', groupId: 'g1', groupName: 'Viaje', description: 'Pizza', expenseId: 'e1',
  };

  it('un Notice que no es de borrado nunca promete tiempo', () => {
    expect(msRestanteDeBorrado(avisoDeGastos, [abierto(OTRO)], AHORA)).toBeNull();
  });

  it('un aviso viejo sin expenseId no rompe nada: no promete tiempo', () => {
    const viejo: Notice = { kind: 'deletion', groupId: 'g1', groupName: 'Viaje', description: 'Pizza' };
    expect(msRestanteDeBorrado(viejo, [abierto(OTRO)], AHORA)).toBeNull();
  });

  it('un gasto que ya no está en el store no rompe nada', () => {
    expect(msRestanteDeBorrado(avisoDeBorrado, [], AHORA)).toBeNull();
  });

  it('una ronda vencida no promete un plazo que no existe', () => {
    const vencido = abierto(OTRO, AHORA - DELETION_TIMEOUT_MS - 1);
    expect(msRestanteDeBorrado(avisoDeBorrado, [vencido], AHORA)).toBeNull();
  });

  it('una ronda objetada tampoco promete tiempo', () => {
    const objetado = conOver({ id: 'e1', deletionVotes: [
      { userId: OTRO, votedAt: AHORA, action: 'delete' },
      { userId: YO, votedAt: AHORA, action: 'cancel' },
    ] });
    expect(msRestanteDeBorrado(avisoDeBorrado, [objetado], AHORA)).toBeNull();
  });

  it('un gasto que ya se borró (la ronda se aplicó) no promete tiempo', () => {
    const yaBorrado = conOver({ id: 'e1', isDeleted: true, deletionVotes: [
      { userId: OTRO, votedAt: AHORA - DELETION_TIMEOUT_MS - 1, action: 'delete' },
    ] });
    expect(msRestanteDeBorrado(avisoDeBorrado, [yaBorrado], AHORA)).toBeNull();
  });

  it('una ronda abierta y vigente devuelve lo que falta de verdad, no un string fijo', () => {
    const faltaUnDia = DELETION_TIMEOUT_MS - 24 * 3600_000;
    const abiertoHaceRato = abierto(OTRO, AHORA - faltaUnDia);
    expect(msRestanteDeBorrado(avisoDeBorrado, [abiertoHaceRato], AHORA)).toBe(24 * 3600_000);
  });
});
