import { cargarDatosDeDemo, GRUPO_DEMO_ID } from '../datosDeDemo';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore, toMonthKey } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useAuthStore } from '@/src/store/authStore';
import { deudasDelGrupo, totalesDeUsuario } from '@/src/algorithms/deudasDelGrupo';

jest.mock('@/src/sync/motor/relayEngine', () => ({
  deviceId: () => 'dev', schedulePublish: jest.fn(), olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}),
}));

/**
 * Datos de demo para las capturas de las tiendas (sólo en desarrollo): un
 * grupo con dos personas ficticias, gastos, un pago y el mes personal.
 */
const YO = 'u_yo';
const AHORA = new Date(2026, 9, 1, 12, 0).getTime();

function limpiar() {
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  usePersonalStore.setState({ entries: [], budget: { currency: 'ARS', monthlyAmount: 0, includeOwedToMe: false } });
  useUserStore.setState({ users: [] });
}

describe('cargarDatosDeDemo', () => {
  beforeEach(limpiar);

  it('crea el grupo de demo conmigo y dos personas más, en ARS', () => {
    expect(cargarDatosDeDemo(YO, AHORA, true)).toBe(true);
    const g = useGroupStore.getState().groups.find(x => x.id === GRUPO_DEMO_ID)!;
    expect(g.currency).toBe('ARS');
    expect(g.memberIds).toHaveLength(3);
    expect(g.memberIds).toContain(YO);
    const otros = g.memberIds.filter(id => id !== YO);
    for (const id of otros) expect(useUserStore.getState().getUserById(id)?.name).toBeTruthy();
  });

  it('la cuenta activa pasa a llamarse Lucía (el saludo no dice «Invitado»)', () => {
    useAuthStore.setState({ currentUser: { id: YO, name: 'Invitado', email: '', authProvider: 'guest', createdAt: 1, updatedAt: 1, isDeleted: false } });
    cargarDatosDeDemo(YO, AHORA, true);
    expect(useAuthStore.getState().currentUser?.name).toBe('Lucía');
    expect(useUserStore.getState().getUserById(YO)?.name).toBe('Lucía');
  });

  it('cada gasto se reparte en partes iguales exactas, sin centavos', () => {
    cargarDatosDeDemo(YO, AHORA, true);
    for (const e of useExpenseStore.getState().getByGroupId(GRUPO_DEMO_ID)) {
      expect(new Set(e.splits.map(x => x.amount)).size).toBe(1);
      for (const x of e.splits) expect(x.amount % 100).toBe(0);
    }
  });

  it('el grupo de demo tiene su clave, como un alta normal (sin aviso de «falta la clave»)', () => {
    cargarDatosDeDemo(YO, AHORA, true);
    expect(useGroupKeyStore.getState().getKey(GRUPO_DEMO_ID)).toBeDefined();
  });

  it('los gastos reparten exacto y me dejan deuda en las dos direcciones', () => {
    cargarDatosDeDemo(YO, AHORA, true);
    const g = useGroupStore.getState().groups.find(x => x.id === GRUPO_DEMO_ID)!;
    const gastos = useExpenseStore.getState().getByGroupId(GRUPO_DEMO_ID);
    expect(gastos.length).toBeGreaterThanOrEqual(4);
    for (const e of gastos) expect(e.splits.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
    const pagos = usePaymentStore.getState().payments.filter(p => p.groupId === GRUPO_DEMO_ID);
    expect(pagos).toHaveLength(1);
    const [tot] = totalesDeUsuario(deudasDelGrupo(gastos, pagos, g.memberIds), YO);
    expect(tot.owedToYou).toBeGreaterThan(0);
    expect(tot.youOwe).toBeGreaterThan(0);
  });

  it('deja presupuesto, gastos personales e ingreso en el mes actual', () => {
    cargarDatosDeDemo(YO, AHORA, true);
    const { budget, entries } = usePersonalStore.getState();
    expect(budget.monthlyAmount).toBeGreaterThan(0);
    const delMes = entries.filter(e => toMonthKey(e.date) === toMonthKey(AHORA));
    expect(delMes.some(e => e.kind === 'expense')).toBe(true);
    expect(delMes.some(e => e.kind === 'income')).toBe(true);
  });

  it('cargarlo dos veces no duplica nada', () => {
    cargarDatosDeDemo(YO, AHORA, true);
    cargarDatosDeDemo(YO, AHORA, true);
    expect(useGroupStore.getState().groups).toHaveLength(1);
    expect(usePaymentStore.getState().payments).toHaveLength(1);
    const ids = useExpenseStore.getState().expenses.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pids = usePersonalStore.getState().entries.map(e => e.id);
    expect(new Set(pids).size).toBe(pids.length);
  });

  it('fuera de desarrollo no carga nada', () => {
    expect(cargarDatosDeDemo(YO, AHORA, false)).toBe(false);
    expect(useGroupStore.getState().groups).toHaveLength(0);
    expect(useExpenseStore.getState().expenses).toHaveLength(0);
    expect(usePersonalStore.getState().entries).toHaveLength(0);
  });
});
