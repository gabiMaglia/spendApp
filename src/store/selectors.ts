import { useMemo } from 'react';
import type { CurrencyCode } from '@/src/constants/currencies';
import type { Expense, Payment } from '@/src/types/models';
import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { directedDebts, type DirectedDebt, type Transferencia } from '@/src/algorithms/directedDebts';
import { simplifyDebts } from '@/src/algorithms/simplifyDebts';
import { deletionRound } from '@/src/algorithms/deletionRound';
import { useGroupStore } from './groupStore';
import { useExpenseStore } from './expenseStore';
import { usePaymentStore } from './paymentStore';
import { useUserStore } from './userStore';

// ── Balance de un grupo específico para un usuario ───────────────────────────

export interface GroupBalanceEntry {
  currency: CurrencyCode;
  amount: number; // positivo = me deben, negativo = debo
}

export function useGroupBalance(groupId: string, userId: string): GroupBalanceEntry[] {
  const group       = useGroupStore(s => s.groups.find(g => g.id === groupId));
  const allExpenses = useExpenseStore(s => s.expenses);
  const allPayments = usePaymentStore(s => s.payments);

  return useMemo(() => {
    if (!group) return [];
    const expenses = allExpenses.filter(e => e.groupId === groupId);
    const payments = allPayments.filter(p => p.groupId === groupId);
    const balances = calculateBalancesByCurrency(expenses, payments, group.memberIds);
    return balances.find(b => b.userId === userId)?.balances ?? [];
  }, [group, allExpenses, allPayments, groupId, userId]);
}

// ── Conteo de gastos activos de un grupo (para subtítulo) ────────────────────

export function useGroupExpenseCount(groupId: string): number {
  return useExpenseStore(s => s.expenses.filter(e => e.groupId === groupId && !e.isDeleted).length);
}

// ── Suma de balances de todos los grupos del usuario (sin simplificar) ───────
// Consistente con lo que muestra cada GroupCard individualmente.

export interface GroupsTotalBalance {
  currency: CurrencyCode;
  owedToYou: number;
  youOwe: number;
}

export function useGroupsTotalBalance(userId: string): GroupsTotalBalance[] {
  const groups   = useGroupStore(s => s.groups);
  const expenses = useExpenseStore(s => s.expenses);
  const payments = usePaymentStore(s => s.payments);

  return useMemo(() => {
    const totals = new Map<CurrencyCode, { owedToYou: number; youOwe: number }>();

    for (const group of groups) {
      if (group.isDeleted) continue;
      const gExpenses = expenses.filter(e => e.groupId === group.id);
      const gPayments = payments.filter(p => p.groupId === group.id);
      const balances  = calculateBalancesByCurrency(gExpenses, gPayments, group.memberIds);
      const entry     = balances.find(b => b.userId === userId);
      if (!entry) continue;

      for (const { currency, amount } of entry.balances) {
        const prev = totals.get(currency) ?? { owedToYou: 0, youOwe: 0 };
        if (amount > 0) totals.set(currency, { ...prev, owedToYou: prev.owedToYou + amount });
        else if (amount < 0) totals.set(currency, { ...prev, youOwe: prev.youOwe + Math.abs(amount) });
      }
    }

    return Array.from(totals.entries()).map(([currency, vals]) => ({ currency, ...vals }));
  }, [groups, expenses, payments, userId]);
}

// ── Balances globales entre el usuario actual y cada otro usuario ────────────
// Aplica simplifyDebts a todos los grupos consolidados y filtra las
// transacciones donde aparece currentUserId.

export interface PersonBalance {
  userId: string;
  currency: CurrencyCode;
  amount: number; // positivo = esa persona me debe, negativo = le debo yo
}

/**
 * Deuda DIRECCIONAL con cada persona (ADR-006).
 *
 * Diferencia clave con `useGlobalPersonBalances`: **simplifica GRUPO POR
 * GRUPO** y recién después agrega. Aquélla consolida todos los grupos en un
 * solo pozo y simplifica una vez, y eso es exactamente lo que netea entre
 * grupos: si en uno le debo 5.000 y en otro me debe 5.000, el pozo dice "cero"
 * y las dos deudas desaparecen. Acá sobreviven las dos, cada una de su lado.
 */
export function useDirectedDebts(currentUserId: string): DirectedDebt[] {
  const groups   = useGroupStore(s => s.groups);
  const expenses = useExpenseStore(s => s.expenses);
  const payments = usePaymentStore(s => s.payments);

  return useMemo(() => {
    const transferencias: Transferencia[] = [];

    for (const group of groups) {
      if (group.isDeleted) continue;
      if (!group.memberIds.includes(currentUserId)) continue;

      const gExpenses = expenses.filter(e => e.groupId === group.id);
      const gPayments = payments.filter(p => p.groupId === group.id);
      const balances  = calculateBalancesByCurrency(gExpenses, gPayments, group.memberIds);

      // Una simplificación POR GRUPO: dentro de un grupo netear es correcto
      // —es una misma cuenta compartida—; entre grupos no.
      const porMoneda = new Map<CurrencyCode, { userId: string; amount: number }[]>();
      for (const { userId, balances: bals } of balances) {
        for (const { currency, amount } of bals) {
          if (!porMoneda.has(currency)) porMoneda.set(currency, []);
          porMoneda.get(currency)!.push({ userId, amount });
        }
      }

      for (const [currency, saldos] of porMoneda) {
        const vivos = saldos.filter(b => Math.abs(b.amount) >= 0.01);
        for (const tx of simplifyDebts(vivos, currency)) {
          transferencias.push({ ...tx, currency });
        }
      }
    }

    return directedDebts(transferencias, currentUserId);
  }, [groups, expenses, payments, currentUserId]);
}

export function useGlobalPersonBalances(currentUserId: string): PersonBalance[] {
  const groups   = useGroupStore(s => s.groups);
  const expenses = useExpenseStore(s => s.expenses);
  const payments = usePaymentStore(s => s.payments);

  return useMemo(() => {
    // Acumula todos los balances globales por (userId, currency) sumando cada grupo
    const globalMap = new Map<string, Map<CurrencyCode, number>>();

    const addToGlobal = (userId: string, currency: CurrencyCode, delta: number) => {
      if (!globalMap.has(userId)) globalMap.set(userId, new Map());
      const m = globalMap.get(userId)!;
      m.set(currency, (m.get(currency) ?? 0) + delta);
    };

    for (const group of groups) {
      // Un grupo borrado NO puede seguir generando deuda: esa plata ya no se
      // puede saldar (no hay pantalla donde hacerlo) y quedaba figurando para
      // siempre en Amigos y en el resumen.
      if (group.isDeleted) continue;
      // Y un grupo del que no soy parte tampoco: sus saldos entrarían al pozo
      // global y cambiarían con QUIÉN me empareja la simplificación.
      if (!group.memberIds.includes(currentUserId)) continue;

      const gExpenses = expenses.filter(e => e.groupId === group.id);
      const gPayments = payments.filter(p => p.groupId === group.id);
      const balances  = calculateBalancesByCurrency(gExpenses, gPayments, group.memberIds);

      for (const { userId, balances: bals } of balances) {
        for (const { currency, amount } of bals) {
          addToGlobal(userId, currency, amount);
        }
      }
    }

    // Por cada moneda, corre simplifyDebts y extrae las transacciones del currentUser
    const currencies = new Set<CurrencyCode>();
    for (const m of globalMap.values()) {
      for (const cur of m.keys()) currencies.add(cur);
    }

    const result: PersonBalance[] = [];

    for (const currency of currencies) {
      const balancesForCurrency = Array.from(globalMap.entries())
        .map(([userId, m]) => ({ userId, amount: m.get(currency) ?? 0 }))
        .filter(b => Math.abs(b.amount) >= 0.01);

      const transactions = simplifyDebts(balancesForCurrency, currency);

      for (const tx of transactions) {
        if (tx.toUserId === currentUserId) {
          // Alguien me debe
          result.push({ userId: tx.fromUserId, currency, amount: tx.amount });
        } else if (tx.fromUserId === currentUserId) {
          // Le debo a alguien
          result.push({ userId: tx.toUserId, currency, amount: -tx.amount });
        }
      }
    }

    // Agrupa por (userId, currency) por si hay múltiples entradas
    const merged = new Map<string, PersonBalance>();
    for (const entry of result) {
      const key = `${entry.userId}:${entry.currency}`;
      const prev = merged.get(key);
      merged.set(key, prev
        ? { ...prev, amount: prev.amount + entry.amount }
        : entry,
      );
    }

    return Array.from(merged.values()).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [groups, expenses, payments, currentUserId]);
}

// ── Feed de actividad derivado de gastos y pagos ────────────────────────────

export type ActivityKind =
  | { kind: 'expense_added';          expense: Expense; groupName: string }
  | { kind: 'expense_delete_request'; expense: Expense; groupName: string; requestedByName: string }
  | { kind: 'payment_made';           payment: Payment; groupName: string }
  /**
   * Un gasto borrado. Aparece para que se pueda RESTAURAR: es la contraparte
   * del modo de borrado libre —cualquiera borra, cualquiera deshace— y sin
   * esto borrar era irreversible. Splitwise hace lo mismo: se deshace en un
   * toque desde el feed de actividad.
   */
  | { kind: 'expense_deleted';        expense: Expense; groupName: string }
  /**
   * Un gasto que estaba borrado y volvió. Tiene evento propio y no se cuenta
   * como una objeción (R-Q2 del PO): son dos cosas distintas y el feed es
   * justamente la mitad «ver» del principio que gobierna T-041 — «prevenir no
   * es la defensa; ver y poder deshacer, sí».
   */
  | { kind: 'expense_restored';       expense: Expense; groupName: string; restoredByName: string };

export function useActivityFeed(currentUserId: string): ActivityKind[] {
  const groups   = useGroupStore(s => s.groups);
  const expenses = useExpenseStore(s => s.expenses);
  const payments = usePaymentStore(s => s.payments);
  const { getUserName } = useUserStore();

  return useMemo(() => {
    // Solo grupos donde participa el usuario
    // OJO: acá NO se filtran los grupos borrados, a diferencia de los saldos.
    // La actividad es un REGISTRO DE LO QUE PASÓ; los saldos son una afirmación
    // sobre el presente. Borrar un grupo tiene que sacar sus deudas (ya no se
    // pueden saldar) pero no puede borrar la historia de lo que hiciste.
    const myGroupIds = new Set(
      groups.filter(g => g.memberIds.includes(currentUserId)).map(g => g.id),
    );

    const groupName = (id: string) => groups.find(g => g.id === id)?.name ?? id;

    const events: (ActivityKind & { _ts: number })[] = [];

    for (const expense of expenses) {
      if (!myGroupIds.has(expense.groupId)) continue;

      // Lo borrado se muestra como tal y NO genera los demás eventos: un gasto
      // que ya no existe no puede seguir figurando como "agregado" ni con una
      // ronda de borrado abierta.
      if (expense.isDeleted) {
        events.push({
          kind: 'expense_deleted',
          expense,
          groupName: groupName(expense.groupId),
          // Por `updatedAt`, no por `date`: lo que se está registrando es
          // CUÁNDO se borró, no cuándo fue el gasto.
          _ts: expense.updatedAt || expense.date,
        });
        continue;
      }

      // Solicitudes de borrado pendientes.
      //
      // Se lee la RONDA y no los votos sueltos: desde el merge por niveles
      // (T-041 · S7) el conjunto se une, así que el pedido sigue ahí al lado de
      // la objeción que lo frenó. Buscar "algún voto de borrado" le avisaría al
      // usuario de un trámite que ya no va a pasar.
      const ronda = deletionRound(expense);
      if (ronda && ronda.status === 'open') {
        events.push({
          kind: 'expense_delete_request',
          expense,
          groupName: groupName(expense.groupId),
          requestedByName: getUserName(ronda.requestedBy),
          _ts: ronda.requestedAt,
        });
      }

      // El gasto está vivo y su ronda terminó en un `restore`: alguien deshizo
      // un borrado. Se fecha por `updatedAt` y no por la fecha del gasto, igual
      // que su hermano `expense_deleted`: lo que se registra es CUÁNDO volvió.
      // Si no, un gasto viejo restaurado hoy quedaría enterrado al fondo del
      // feed y nadie se enteraría de que alguien lo devolvió al libro.
      if (ronda && ronda.status === 'restored' && ronda.stoppedBy) {
        events.push({
          kind: 'expense_restored',
          expense,
          groupName: groupName(expense.groupId),
          restoredByName: getUserName(ronda.stoppedBy),
          _ts: expense.updatedAt || expense.date,
        });
      }

      events.push({
        kind: 'expense_added',
        expense,
        groupName: groupName(expense.groupId),
        _ts: expense.date,
      });
    }

    for (const payment of payments) {
      if (!myGroupIds.has(payment.groupId) || payment.isDeleted) continue;
      events.push({
        kind: 'payment_made',
        payment,
        groupName: groupName(payment.groupId),
        _ts: payment.date,
      });
    }

    return events
      .sort((a, b) => b._ts - a._ts)
      .map(({ _ts: _ignored, ...rest }) => rest as ActivityKind);
  }, [groups, expenses, payments, currentUserId]);
}
