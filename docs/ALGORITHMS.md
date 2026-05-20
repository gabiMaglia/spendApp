# Algoritmos: Balance y Simplificación de Deudas

## 0. Multi-moneda: balances separados por divisa

**DECISIÓN**: Los balances se calculan y muestran separados por currency code. No se mezclan divisas en la suma. Al liquidar una deuda, el pagador puede elegir en qué moneda paga (Free: ingresa el tipo de cambio manualmente; Pro: se obtiene automáticamente).

```typescript
// El balance por usuario se agrupa por currency
interface BalanceByCurrency {
  userId: string;
  balances: { currency: string; amount: number }[];
}

export function calculateBalancesByCurrency(
  expenses: (Expense | Payment)[],
  memberIds: string[]
): BalanceByCurrency[] {
  // mapa: userId → currency → net amount
  const totals = new Map<string, Map<string, number>>();
  for (const id of memberIds) totals.set(id, new Map());

  for (const expense of expenses) {
    if (expense.isDeleted) continue;

    const currency = expense.currency;

    // Suma al pagador
    const payerMap = totals.get(expense.paidById)!;
    payerMap.set(currency, (payerMap.get(currency) ?? 0) + expense.amount);

    // Resta a cada split
    for (const split of (expense as Expense).splits ?? []) {
      const splitMap = totals.get(split.userId)!;
      splitMap.set(currency, (splitMap.get(currency) ?? 0) - split.amount);
    }
  }

  return Array.from(totals.entries()).map(([userId, currencyMap]) => ({
    userId,
    balances: Array.from(currencyMap.entries())
      .map(([currency, amount]) => ({
        currency,
        amount: Math.round(amount * 100) / 100,
      }))
      .filter(b => Math.abs(b.amount) >= 0.01), // ignorar centavos fantasma
  }));
}
```

---

## 1. Cálculo de balances netos

### Concepto

Dado un grupo con N gastos y M miembros, el balance de cada persona es:

```
balance(usuario) = Σ(gastos que pagó) − Σ(su parte en cada gasto)
```

- Balance positivo → le deben dinero (acreedor / Receiver).
- Balance negativo → debe dinero (deudor / Giver).
- Balance en 0 → está al día.

### Implementación

```typescript
// src/algorithms/calculateBalances.ts

interface Balance {
  userId: string;
  amount: number; // positivo = acreedor, negativo = deudor
}

export function calculateBalances(
  expenses: Expense[],
  memberIds: string[]
): Balance[] {
  const totals = new Map<string, number>(memberIds.map(id => [id, 0]));

  for (const expense of expenses) {
    if (expense.isDeleted) continue;

    // Quien pagó suma el total al balance
    const current = totals.get(expense.paidById) ?? 0;
    totals.set(expense.paidById, current + expense.amount);

    // Cada split resta su parte
    for (const split of expense.splits) {
      const splitCurrent = totals.get(split.userId) ?? 0;
      totals.set(split.userId, splitCurrent - split.amount);
    }
  }

  return Array.from(totals.entries()).map(([userId, amount]) => ({
    userId,
    amount: Math.round(amount * 100) / 100, // evitar errores de punto flotante
  }));
}
```

---

## 2. Simplificación de deudas (Algoritmo Greedy)

### El problema

Sin simplificación, 8 personas en un viaje pueden generar 15+ transferencias cruzadas. El objetivo es reducirlas al mínimo: idealmente N−1 transferencias para N personas.

### Por qué es NP-duro en el caso general

Encontrar el mínimo absoluto de transacciones respetando restricciones adicionales (ej: solo transferir entre personas que se conocen) es NP-duro. Splitwise usa una variante Greedy que no garantiza el óptimo global pero es práctica y rápida para grupos pequeños/medianos.

### El algoritmo

```
1. Calcular balance neto de cada persona.
2. Separar en dos listas:
   - Givers (balance < 0): deben dinero, ordenados de mayor deuda a menor.
   - Receivers (balance > 0): les deben, ordenados de mayor crédito a menor.
3. Iterar:
   a. Tomar el mayor Giver (debe más) y el mayor Receiver (le deben más).
   b. La transferencia es min(|deuda de Giver|, crédito de Receiver).
   c. Registrar la transacción.
   d. Ajustar los balances de ambos.
   e. Eliminar de la lista al que quede en 0.
   f. Repetir hasta que ambas listas estén vacías.
```

### Implementación

```typescript
// src/algorithms/simplifyDebts.ts

interface Transaction {
  fromUserId: string;   // quien paga
  toUserId: string;     // quien recibe
  amount: number;
}

export function simplifyDebts(balances: Balance[]): Transaction[] {
  const transactions: Transaction[] = [];

  // Separar y ordenar
  const givers = balances
    .filter(b => b.amount < 0)
    .map(b => ({ userId: b.userId, amount: Math.abs(b.amount) }))
    .sort((a, b) => b.amount - a.amount); // mayor deuda primero

  const receivers = balances
    .filter(b => b.amount > 0)
    .map(b => ({ userId: b.userId, amount: b.amount }))
    .sort((a, b) => b.amount - a.amount); // mayor crédito primero

  let g = 0; // puntero Givers
  let r = 0; // puntero Receivers

  while (g < givers.length && r < receivers.length) {
    const giver = givers[g];
    const receiver = receivers[r];

    const transferAmount = Math.min(giver.amount, receiver.amount);
    const rounded = Math.round(transferAmount * 100) / 100;

    if (rounded > 0) {
      transactions.push({
        fromUserId: giver.userId,
        toUserId: receiver.userId,
        amount: rounded,
      });
    }

    giver.amount -= transferAmount;
    receiver.amount -= transferAmount;

    if (giver.amount < 0.001) g++;
    if (receiver.amount < 0.001) r++;
  }

  return transactions;
}
```

### Ejemplo

Grupo de 4 personas, balances:
- Ana: +$100 (le deben)
- Bob: +$50 (le deben)
- Carlos: −$80 (debe)
- Diana: −$70 (debe)

Resultado esperado (3 transacciones en lugar de potenciales 6):
1. Carlos → Ana: $80
2. Diana → Ana: $20
3. Diana → Bob: $50

---

## 3. División de un gasto

### Modos de split

```typescript
type SplitMode =
  | 'equal'       // cada miembro paga lo mismo
  | 'exact'       // montos exactos por persona
  | 'percentage'  // porcentajes que sumen 100%
  | 'shares'      // partes proporcionales (ej: 2 partes vs 1 parte)

export function buildSplits(
  totalAmount: number,
  memberIds: string[],
  mode: SplitMode,
  values?: number[] // montos / porcentajes / partes por miembro
): Split[] {
  switch (mode) {
    case 'equal': {
      const share = Math.round((totalAmount / memberIds.length) * 100) / 100;
      // Ajustar centavos en el último miembro para evitar redondeo
      const splits = memberIds.map((userId, i) => ({
        userId,
        amount: i < memberIds.length - 1 ? share : totalAmount - share * (memberIds.length - 1),
        isPaid: false,
      }));
      return splits;
    }
    case 'exact': {
      return memberIds.map((userId, i) => ({
        userId,
        amount: values![i],
        isPaid: false,
      }));
    }
    case 'percentage': {
      return memberIds.map((userId, i) => ({
        userId,
        amount: Math.round((totalAmount * values![i] / 100) * 100) / 100,
        isPaid: false,
      }));
    }
    case 'shares': {
      const totalShares = values!.reduce((a, b) => a + b, 0);
      return memberIds.map((userId, i) => ({
        userId,
        amount: Math.round((totalAmount * values![i] / totalShares) * 100) / 100,
        isPaid: false,
      }));
    }
  }
}
```

---

## 4. Balance global entre dos usuarios (cross-group)

Para el dashboard principal que muestra "en total, cuánto te debe cada persona" sumando todos los grupos:

```typescript
export function calculateGlobalBalances(
  allGroups: Group[],
  allExpenses: Expense[],
  currentUserId: string
): Map<string, number> {
  // mapa: otroUserId → cuánto le debo (negativo) o me debe (positivo)
  const netByUser = new Map<string, number>();

  for (const group of allGroups) {
    if (group.isDeleted) continue;
    const groupExpenses = allExpenses.filter(e => e.groupId === group.id);
    const balances = calculateBalances(groupExpenses, group.memberIds);
    const transactions = simplifyDebts(balances);

    for (const tx of transactions) {
      if (tx.fromUserId === currentUserId) {
        // Le debo a tx.toUserId
        const prev = netByUser.get(tx.toUserId) ?? 0;
        netByUser.set(tx.toUserId, prev - tx.amount);
      } else if (tx.toUserId === currentUserId) {
        // tx.fromUserId me debe a mí
        const prev = netByUser.get(tx.fromUserId) ?? 0;
        netByUser.set(tx.fromUserId, prev + tx.amount);
      }
    }
  }

  return netByUser;
}
```
