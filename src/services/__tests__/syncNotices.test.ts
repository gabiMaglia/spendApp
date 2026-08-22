import { snapshot, noticesFor, type Notice } from '../syncNotices';
import { DELETION_TIMEOUT_MS } from '@/src/sync/SyncEngine';
import type { Expense, Group } from '@/src/types/models';

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

const vacio = { expenseIds: [], conBorradoAbierto: [] };
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
    const antes = { expenseIds: ['e1'], conBorradoAbierto: [] };
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
    const antes = { expenseIds: ['e1'], conBorradoAbierto: [] };
    const n = noticesFor(antes, [pedido(OTRO)], [grupo()], YO, AHORA);
    expect(n).toEqual([{
      kind: 'deletion', groupId: 'g1', groupName: 'Viaje', description: 'Pizza',
    }]);
  });

  it('al que lo pidió no se le avisa su propio pedido', () => {
    const antes = { expenseIds: ['e1'], conBorradoAbierto: [] };
    expect(noticesFor(antes, [pedido(YO)], [grupo()], YO, AHORA)).toEqual([]);
  });

  it('una ronda que ya estaba abierta no se vuelve a avisar', () => {
    const antes = { expenseIds: ['e1'], conBorradoAbierto: ['e1'] };
    expect(noticesFor(antes, [pedido(OTRO)], [grupo()], YO, AHORA)).toEqual([]);
  });

  // Ya no hay nada que objetar: avisar sería mandar a una acción imposible.
  it('una ronda vencida no avisa', () => {
    const antes = { expenseIds: ['e1'], conBorradoAbierto: [] };
    const viejo = pedido(OTRO, AHORA - DELETION_TIMEOUT_MS - 1);
    expect(noticesFor(antes, [viejo], [grupo()], YO, AHORA)).toEqual([]);
  });

  it('una ronda objetada tampoco', () => {
    const antes = { expenseIds: ['e1'], conBorradoAbierto: [] };
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
