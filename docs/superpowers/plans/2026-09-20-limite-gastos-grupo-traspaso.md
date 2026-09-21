# Límite de Gastos por Grupo + Traspaso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit any group to 450 non-deleted expenses (hard block), warn from 350, and let the user (automatically or manually) "traspasar" a group to a fresh one that carries over only the net balance — plus make archived groups read-only, irrevocably so when archived by this limit flow.

**Architecture:** A pure algorithm layer (limit check, carry-over expense construction) feeds an orchestration service (`groupTraspaso.ts`) that creates the new group, writes the carry-over `Expense`(s) via the existing multi-payer mechanism, and archives the old group through an extended `archiveStore` that now tracks *why* a group was archived. UI guards reuse `archiveStore.isArchived` at the three existing write points (new/edit expense, delete expense, add comment, register payment) and a new banner/confirmation flow drives the traspaso itself.

**Tech Stack:** React Native, Zustand, TypeScript, Jest + @testing-library/react-native, i18next.

**Spec:** docs/superpowers/specs/2026-09-20-limite-gastos-grupo-traspaso-design.md

## Global Constraints

- Reuse `calculateBalancesByCurrency` (`src/algorithms/calculateBalances.ts`) and the existing multi-payer mechanism (`Expense.payers`/`splits`, `src/algorithms/payers.ts`) — no new record type for the carry-over.
- Never mix currencies in one `Expense` (business rule #7) — one carry-over `Expense` per currency present in the old group's balances.
- The 450/350 numbers live in one exported constants file, never hardcoded at the point of use.
- Archiving stays local to the account (no sync change to that semantic) — cross-member awareness of a traspaso goes exclusively through the new `group_replaced` notice and the `Group.supersededByGroupId` field.
- A group archived for `reason: 'manual'` keeps today's fully-reversible behavior; only `reason: 'limit'` is irrevocable.
- Any archived group (either reason) rejects new/edited/deleted `Expense`, `Payment`, and `ExpenseComment` — viewing history/balances is unaffected.
- Lint baseline, `tsc --noEmit` clean, and the full Jest suite green at every commit.
- i18n: every new user-facing string goes through `t()`, es/en/pt.

---

### Task 1: Group expense limit — constants and pure check

**Files:**
- Create: `src/constants/groupLimits.ts`
- Create: `src/algorithms/groupExpenseLimit.ts`
- Test: `src/algorithms/__tests__/groupExpenseLimit.test.ts`

**Interfaces:**
- Produces: `LIMITE_GASTOS_GRUPO = 450`, `AVISO_GASTOS_GRUPO = 350` (both exported `number` constants from `src/constants/groupLimits.ts`); `debeAvisar(count: number): boolean` and `estaBloqueado(count: number): boolean` (exported from `src/algorithms/groupExpenseLimit.ts`) — later tasks import these, never inline the numbers.

- [ ] **Step 1: Write the failing test**

Create `src/algorithms/__tests__/groupExpenseLimit.test.ts`:

```ts
import { debeAvisar, estaBloqueado } from '../groupExpenseLimit';
import { LIMITE_GASTOS_GRUPO, AVISO_GASTOS_GRUPO } from '@/src/constants/groupLimits';

describe('límite de gastos por grupo', () => {
  it('las constantes son las acordadas (450 duro / 350 aviso)', () => {
    expect(LIMITE_GASTOS_GRUPO).toBe(450);
    expect(AVISO_GASTOS_GRUPO).toBe(350);
  });

  it('no avisa por debajo del umbral', () => {
    expect(debeAvisar(349)).toBe(false);
  });

  it('avisa desde el umbral', () => {
    expect(debeAvisar(350)).toBe(true);
  });

  it('deja de avisar (porque ya está bloqueado) en el límite duro', () => {
    expect(debeAvisar(450)).toBe(false);
  });

  it('avisa justo antes del límite duro', () => {
    expect(debeAvisar(449)).toBe(true);
  });

  it('no bloquea por debajo del límite duro', () => {
    expect(estaBloqueado(449)).toBe(false);
  });

  it('bloquea en el límite duro', () => {
    expect(estaBloqueado(450)).toBe(true);
  });

  it('sigue bloqueado por encima del límite duro', () => {
    expect(estaBloqueado(451)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --testPathPattern=groupExpenseLimit`
Expected: FAIL — `groupExpenseLimit.ts` and `groupLimits.ts` don't exist yet.

- [ ] **Step 3: Implement**

Create `src/constants/groupLimits.ts`:

```ts
/**
 * Límites de gastos por grupo (PO 2026-09-20, camino alternativo a T-058):
 * en vez de compactar el buzón, se evita que un grupo se acerque al techo de
 * sync (~720 gastos con el tope de 1MB de `006_payload_limit.sql`) limitando
 * el crecimiento y ofreciendo un traspaso a un grupo nuevo.
 */
export const LIMITE_GASTOS_GRUPO = 450;
export const AVISO_GASTOS_GRUPO = 350;
```

Create `src/algorithms/groupExpenseLimit.ts`:

```ts
import { AVISO_GASTOS_GRUPO, LIMITE_GASTOS_GRUPO } from '@/src/constants/groupLimits';

/** ¿Corresponde mostrar el aviso de traspaso? (entre el umbral y el límite duro, sin incluirlo) */
export function debeAvisar(count: number): boolean {
  return count >= AVISO_GASTOS_GRUPO && count < LIMITE_GASTOS_GRUPO;
}

/** ¿El grupo ya alcanzó el límite duro? (no se puede cargar un gasto más) */
export function estaBloqueado(count: number): boolean {
  return count >= LIMITE_GASTOS_GRUPO;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=groupExpenseLimit`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add src/constants/groupLimits.ts src/algorithms/groupExpenseLimit.ts src/algorithms/__tests__/groupExpenseLimit.test.ts
git commit -m "feat(groups): constantes y chequeo puro del límite de gastos por grupo"
```

---

### Task 2: `archiveStore` — track WHY a group was archived

**Files:**
- Modify: `src/store/archiveStore.ts` (full current content below — this file is small, replace it entirely)
- Test: `src/store/__tests__/archiveStore.reason.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `useArchiveStore.getState().setArchived(groupId: string, archived: boolean, reason?: 'manual' | 'limit'): void` (reason defaults to `'manual'` when archiving without a reason — the existing swipe-to-archive call site doesn't need to change); `useArchiveStore.getState().archiveReason(groupId: string): 'manual' | 'limit' | null`; `useArchiveStore.getState().canUnarchive(groupId: string): boolean` (false only when `archiveReason(groupId) === 'limit'`). `archivedIds: string[]` keeps its exact current shape and meaning — no existing consumer (`app/(tabs)/groups.tsx`) needs to change.

**Current full content of `src/store/archiveStore.ts`** (for reference — you're replacing this whole file):

```ts
import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';

const storage = createSecureStorage('groups');
const KEY = 'archived_v1';

interface ArchiveState {
  archivedIds: string[];
  isArchived: (groupId: string) => boolean;
  setArchived: (groupId: string, archived: boolean) => void;
  hydrate: () => void;
}

function persist(ids: string[]) {
  writeScoped(storage, KEY, JSON.stringify(ids));
}

export const useArchiveStore = create<ArchiveState>((set, get) => ({
  archivedIds: [],
  isArchived: (groupId) => get().archivedIds.includes(groupId),
  setArchived: (groupId, archived) => {
    const actual = get().archivedIds;
    if (actual.includes(groupId) === archived) return;
    const ids = archived ? [...actual, groupId] : actual.filter(id => id !== groupId);
    persist(ids);
    set({ archivedIds: ids });
  },
  hydrate: () => {
    const raw = readScoped(storage, KEY);
    let archivedIds: string[] = [];
    try {
      archivedIds = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      archivedIds = [];
    }
    set({ archivedIds });
  },
}));
```

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/archiveStore.reason.test.ts`:

```ts
import { useArchiveStore } from '../archiveStore';
import { createSecureStorage } from '@/src/utils/secureStorage';

beforeEach(() => {
  createSecureStorage('groups').clearAll();
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('archiveStore — por qué se archivó cada grupo', () => {
  it('archivar sin razón explícita cae en "manual" (no rompe al swipe-to-archive existente)', () => {
    useArchiveStore.getState().setArchived('g1', true);
    expect(useArchiveStore.getState().archiveReason('g1')).toBe('manual');
    expect(useArchiveStore.getState().canUnarchive('g1')).toBe(true);
  });

  it('archivar con reason "limit" queda irrevocable', () => {
    useArchiveStore.getState().setArchived('g1', true, 'limit');
    expect(useArchiveStore.getState().archiveReason('g1')).toBe('limit');
    expect(useArchiveStore.getState().canUnarchive('g1')).toBe(false);
  });

  it('desarchivar un "limit" no hace nada — sigue archivado', () => {
    useArchiveStore.getState().setArchived('g1', true, 'limit');
    useArchiveStore.getState().setArchived('g1', false);
    expect(useArchiveStore.getState().isArchived('g1')).toBe(true);
    expect(useArchiveStore.getState().archiveReason('g1')).toBe('limit');
  });

  it('desarchivar un "manual" funciona igual que hoy', () => {
    useArchiveStore.getState().setArchived('g1', true);
    useArchiveStore.getState().setArchived('g1', false);
    expect(useArchiveStore.getState().isArchived('g1')).toBe(false);
    expect(useArchiveStore.getState().archiveReason('g1')).toBeNull();
  });

  it('un grupo nunca archivado no tiene razón', () => {
    expect(useArchiveStore.getState().archiveReason('nunca')).toBeNull();
    expect(useArchiveStore.getState().canUnarchive('nunca')).toBe(true);
  });

  it('hydrate recupera archivedIds Y reasons persistidos', () => {
    useArchiveStore.getState().setArchived('g1', true, 'limit');
    useArchiveStore.getState().setArchived('g2', true);
    useArchiveStore.setState({ archivedIds: [], reasons: {} });

    useArchiveStore.getState().hydrate();

    expect(useArchiveStore.getState().isArchived('g1')).toBe(true);
    expect(useArchiveStore.getState().archiveReason('g1')).toBe('limit');
    expect(useArchiveStore.getState().archiveReason('g2')).toBe('manual');
  });

  it('un storage corrupto de reasons degrada a vacío, no tira (mismo criterio que T-020)', () => {
    createSecureStorage('groups').set('archived_reasons_v1', '{roto');
    expect(() => useArchiveStore.getState().hydrate()).not.toThrow();
    expect(useArchiveStore.getState().archiveReason('cualquiera')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --testPathPattern=archiveStore.reason`
Expected: FAIL — `reasons`, `archiveReason`, `canUnarchive` don't exist on the store yet; `setArchived` doesn't take a third argument.

- [ ] **Step 3: Implement**

Replace the full content of `src/store/archiveStore.ts`:

```ts
import { create } from 'zustand';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from './userScope';

/**
 * Grupos archivados — una preferencia de VISTA local a la cuenta, que
 * además bloquea escritura (PO 2026-09-20 — antes sólo sacaba el grupo de
 * la lista principal, ver commit que agregó este comentario).
 *
 * Archivar NO es borrar: el grupo sigue entero, con sus gastos y sus
 * saldos, visibles. Lo que cambia es que deja de aceptar gastos, pagos y
 * comentarios nuevos mientras esté archivado (ver los guards en
 * `app/expense/new.tsx`, `app/expense/[id].tsx`, `app/settle/new.tsx`).
 *
 * `reason` distingue DOS caminos al archivado:
 * - `'manual'`: el usuario lo archivó a mano (ej. un viaje que terminó) —
 *   reversible, como siempre.
 * - `'limit'`: lo archivó el traspaso por límite de gastos (T-058,
 *   ver `src/services/groupTraspaso.ts`) — **irrevocable**: el punto entero
 *   de esto es que ese grupo no vuelva a crecer y a acercarse al techo de
 *   sync. `setArchived(id, false)` sobre uno de éstos no hace nada.
 */

const storage = createSecureStorage('groups');
const KEY = 'archived_v1';
const REASONS_KEY = 'archived_reasons_v1';

export type ArchiveReason = 'manual' | 'limit';

interface ArchiveState {
  archivedIds: string[];
  reasons: Record<string, ArchiveReason>;
  isArchived: (groupId: string) => boolean;
  archiveReason: (groupId: string) => ArchiveReason | null;
  canUnarchive: (groupId: string) => boolean;
  setArchived: (groupId: string, archived: boolean, reason?: ArchiveReason) => void;
  hydrate: () => void;
}

function persistIds(ids: string[]) {
  writeScoped(storage, KEY, JSON.stringify(ids));
}

function persistReasons(reasons: Record<string, ArchiveReason>) {
  writeScoped(storage, REASONS_KEY, JSON.stringify(reasons));
}

export const useArchiveStore = create<ArchiveState>((set, get) => ({
  archivedIds: [],
  reasons: {},

  isArchived: (groupId) => get().archivedIds.includes(groupId),

  archiveReason: (groupId) => get().reasons[groupId] ?? null,

  canUnarchive: (groupId) => get().reasons[groupId] !== 'limit',

  setArchived: (groupId, archived, reason = 'manual') => {
    const { archivedIds, reasons } = get();
    const yaArchivado = archivedIds.includes(groupId);

    if (!archived) {
      // Idempotente: no estaba archivado, no hay nada que hacer.
      if (!yaArchivado) return;
      // Irrevocable: un archivado por límite no se puede deshacer.
      if (reasons[groupId] === 'limit') return;

      const ids = archivedIds.filter(id => id !== groupId);
      const { [groupId]: _quitado, ...restoReasons } = reasons;
      persistIds(ids);
      persistReasons(restoReasons);
      set({ archivedIds: ids, reasons: restoReasons });
      return;
    }

    // Archivar: idempotente si ya estaba archivado con la MISMA razón.
    if (yaArchivado && reasons[groupId] === reason) return;

    const ids = yaArchivado ? archivedIds : [...archivedIds, groupId];
    const nuevasReasons = { ...reasons, [groupId]: reason };
    persistIds(ids);
    persistReasons(nuevasReasons);
    set({ archivedIds: ids, reasons: nuevasReasons });
  },

  hydrate: () => {
    const rawIds = readScoped(storage, KEY);
    let archivedIds: string[] = [];
    try {
      archivedIds = rawIds ? (JSON.parse(rawIds) as string[]) : [];
    } catch {
      archivedIds = [];
    }

    const rawReasons = readScoped(storage, REASONS_KEY);
    let reasons: Record<string, ArchiveReason> = {};
    try {
      reasons = rawReasons ? (JSON.parse(rawReasons) as Record<string, ArchiveReason>) : {};
    } catch {
      reasons = {};
    }

    // Aditivo: un grupo archivado ANTES de este cambio tiene id pero no
    // reason — cae a 'manual' (el comportamiento que ya tenía: reversible).
    for (const id of archivedIds) {
      if (!(id in reasons)) reasons[id] = 'manual';
    }

    set({ archivedIds, reasons });
  },
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=archiveStore.reason`
Expected: PASS, 7/7.

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS — no existing consumer of `archiveStore` reads/writes `reasons` directly, and `archivedIds`/`isArchived`/`setArchived(id, bool)` (2-arg form) keep working exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/store/archiveStore.ts src/store/__tests__/archiveStore.reason.test.ts
git commit -m "feat(groups): archiveStore trackea por qué se archivó cada grupo (manual vs límite)"
```

---

### Task 3: Archived groups are read-only — write guards

**Files:**
- Modify: `app/expense/new.tsx` (guard covers both create AND edit, since editing an expense routes through this same screen)
- Modify: `app/expense/[id].tsx:192` (`handleRequestDelete`) and the comment-submit handler (`handleAddComment`, line 143)
- Modify: `app/settle/new.tsx` (guard on `canSave`, line 209)
- Test: `src/screens/__tests__/grupoArchivadoSoloLectura.test.tsx` (new)

**Interfaces:**
- Consumes: `useArchiveStore.getState().isArchived(groupId)` / the hook form `useArchiveStore(s => s.isArchived)`.
- Produces: nothing new for later tasks — this is a leaf task.

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/grupoArchivadoSoloLectura.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import NewExpenseScreen from '@/app/expense/new';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import type { User, Group } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ groupId: 'g1' }),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

function grupo(id: string): Group {
  return {
    id, name: id, memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: 'ana', deletionVotes: [],
  };
}

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA, { id: 'beto', name: 'Beto' } as User] });
  useGroupStore.setState({ groups: [grupo('g1')] });
  useExpenseStore.setState({ expenses: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('un grupo archivado no acepta gastos nuevos', () => {
  it('con el grupo archivado, el botón de guardar queda deshabilitado', () => {
    useArchiveStore.getState().setArchived('g1', true);

    const r = render(<NewExpenseScreen />);
    fireEvent.changeText(r.getByPlaceholderText('expense.description_placeholder'), 'Cena');

    const guardar = r.getByTestId('expense-save-btn');
    expect(guardar.props.accessibilityState?.disabled ?? guardar.props.disabled).toBe(true);
  });

  it('sin archivar, el botón de guardar se habilita normalmente con datos válidos', () => {
    const r = render(<NewExpenseScreen />);
    fireEvent.changeText(r.getByPlaceholderText('expense.description_placeholder'), 'Cena');

    const guardar = r.getByTestId('expense-save-btn');
    expect(guardar.props.accessibilityState?.disabled ?? guardar.props.disabled).toBeFalsy();
  });
});
```

Before writing the implementation, **read** `app/expense/new.tsx:200-230` (around the `canSave` definition and the description/amount inputs) and `app/expense/new.tsx:770-780` (the save `Pressable`) to find the exact current JSX for the description `TextInput` placeholder key and the save button, since this test needs `getByPlaceholderText('expense.description_placeholder')` and `getByTestId('expense-save-btn')` to match what's actually there — add the `testID="expense-save-btn"` to the save `Pressable` if it doesn't already have one (grep the file for `testID` near the save button first; if a different testID already exists there, use that one instead and adjust the test).

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --testPathPattern=grupoArchivadoSoloLectura`
Expected: FAIL — `canSave` doesn't yet account for the archived group, so the button stays enabled either way (and/or the `expense-save-btn` testID doesn't exist yet — add it as part of Step 3 if missing).

- [ ] **Step 3: Implement**

In `app/expense/new.tsx`:

1. Import the store: add `import { useArchiveStore } from '@/src/store/archiveStore';` next to the other store imports.
2. Right after the existing `const hasGroup = groupId !== '';` line (around line 218), add:

```tsx
  // PO 2026-09-20: un grupo archivado (cualquier razón) es de solo lectura —
  // no acepta gastos nuevos ni ediciones.
  const isArchivedFn  = useArchiveStore(s => s.isArchived);
  const grupoArchivado = hasGroup && isArchivedFn(groupId);
```

3. Extend the existing `canSave` line (around line 222) — change:

```tsx
  const canSave      = description.trim().length > 0 && amount > 0 && !percentError && (!hasGroup || members.length > 0) && payersOk;
```

to:

```tsx
  const canSave      = description.trim().length > 0 && amount > 0 && !percentError && (!hasGroup || members.length > 0) && payersOk && !grupoArchivado;
```

4. In `handleSave` (around line 306), right after `if (!canSave || !currentUser) return;`, this already covers it — no further change needed there, since `canSave` now folds in the archived check.
5. Ensure the save `Pressable` (around line 773) has `testID="expense-save-btn"` — add it if the grep in Step 1 showed none.
6. Add a small inline hint text near the save button when `grupoArchivado` is true, so the disabled state isn't silent — right before the save `Pressable`, add:

```tsx
{grupoArchivado && (
  <Text style={[Typography.caption, { color: c.semantic.negative, textAlign: 'center', marginBottom: 8 }]}>
    {t('groups.archived_readonly_hint')}
  </Text>
)}
```

Add the i18n key to `src/i18n/locales/es.json`, `en.json`, `pt.json` under `groups`:
- es: `"archived_readonly_hint": "Este grupo está archivado — no se pueden cargar gastos"`
- en: `"archived_readonly_hint": "This group is archived — you can't add expenses"`
- pt: `"archived_readonly_hint": "Este grupo está arquivado — não é possível adicionar despesas"`

In `app/expense/[id].tsx`:

1. Import `useArchiveStore`.
2. Right after `const grupoDelGasto = groups.find(g => g.id === expense.groupId);` (line 134), add:

```tsx
  const isArchivedFn = useArchiveStore(s => s.isArchived);
  const grupoArchivado = grupoDelGasto ? isArchivedFn(grupoDelGasto.id) : false;
```

3. In `handleRequestDelete` (line 192), add a guard as the FIRST line inside the function:

```tsx
  function handleRequestDelete() {
    if (grupoArchivado) {
      Alert.alert(t('groups.archived_readonly_title'), t('groups.archived_readonly_hint'));
      return;
    }
    if (!currentUser || !expense) return;
    // ...resto sin cambios
```

4. In `handleAddComment` (line 143), add the same guard as the first line:

```tsx
  function handleAddComment(text: string) {
    if (grupoArchivado) return;
    if (!currentUser || !id) return;
    // ...resto sin cambios
```

Add `groups.archived_readonly_title` to the three locale files under `groups`:
- es: `"archived_readonly_title": "Grupo archivado"`
- en: `"archived_readonly_title": "Archived group"`
- pt: `"archived_readonly_title": "Grupo arquivado"`

In `app/settle/new.tsx`:

1. Import `useArchiveStore`.
2. Right after `const group = groups.find(g => g.id === groupId);` (line 129), add:

```tsx
  const isArchivedFn = useArchiveStore(s => s.isArchived);
  const grupoArchivado = group ? isArchivedFn(group.id) : false;
```

3. Extend the existing `canSave` line (line 209) — change:

```tsx
  const canSave     = amount > 0 && !exceedsMax && fromId.length > 0 && toId.length > 0 && fromId !== toId && groupId.length > 0;
```

to:

```tsx
  const canSave     = amount > 0 && !exceedsMax && fromId.length > 0 && toId.length > 0 && fromId !== toId && groupId.length > 0 && !grupoArchivado;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=grupoArchivadoSoloLectura`
Expected: PASS, 2/2. If the `testID`/placeholder assumptions in Step 1's test don't match what you found reading the actual file, adjust the test's queries to match the real testID/placeholder — the behavior under test (button disabled when archived) is what matters, not the exact query mechanism.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions — every existing test renders with `archivedIds: []` by default (no group ever archived in existing fixtures), so `grupoArchivado` is `false` everywhere else and `canSave`'s new `&& !grupoArchivado` term is a no-op.

- [ ] **Step 6: Commit**

```bash
git add app/expense/new.tsx app/expense/\[id\].tsx app/settle/new.tsx src/screens/__tests__/grupoArchivadoSoloLectura.test.tsx src/i18n/locales/es.json src/i18n/locales/en.json src/i18n/locales/pt.json
git commit -m "feat(groups): un grupo archivado no acepta gastos, pagos ni comentarios nuevos"
```

---

### Task 4: `buildCarryOverExpenses` — the carry-over as ordinary multi-payer Expenses

**Files:**
- Create: `src/algorithms/groupCarryOver.ts`
- Test: `src/algorithms/__tests__/groupCarryOver.test.ts`

**Interfaces:**
- Consumes: `BalanceByCurrency` (`src/types/models.ts:398`, `{ userId: string; balances: { currency: CurrencyCode; amount: number }[] }`).
- Produces: `buildCarryOverExpenses(balancesByCurrency: BalanceByCurrency[], groupId: string, description: string, createdById: string): Expense[]` — Task 6 calls this directly.

- [ ] **Step 1: Write the failing test**

Create `src/algorithms/__tests__/groupCarryOver.test.ts`:

```ts
import { buildCarryOverExpenses } from '../groupCarryOver';
import type { BalanceByCurrency } from '@/src/types/models';

describe('buildCarryOverExpenses', () => {
  it('una sola moneda: un Expense con acreedores como payers y deudores como splits', () => {
    const balances: BalanceByCurrency[] = [
      { userId: 'ana',  balances: [{ currency: 'ARS', amount: 10_000 }] },
      { userId: 'beto', balances: [{ currency: 'ARS', amount: -10_000 }] },
    ];

    const result = buildCarryOverExpenses(balances, 'g-nuevo', 'Saldo trasladado', 'ana');

    expect(result).toHaveLength(1);
    const [e] = result;
    expect(e.groupId).toBe('g-nuevo');
    expect(e.currency).toBe('ARS');
    expect(e.amount).toBe(10_000);
    expect(e.payers).toEqual([{ userId: 'ana', amount: 10_000 }]);
    expect(e.splits).toEqual([{ userId: 'beto', amount: 10_000, isPaid: false }]);
    expect(e.description).toBe('Saldo trasladado');
    expect(e.createdById).toBe('ana');
    expect(e.isDeleted).toBe(false);
  });

  it('múltiples monedas: un Expense POR MONEDA, nunca mezcladas', () => {
    const balances: BalanceByCurrency[] = [
      { userId: 'ana',  balances: [{ currency: 'ARS', amount: 5_000 }, { currency: 'USD', amount: -2_000 }] },
      { userId: 'beto', balances: [{ currency: 'ARS', amount: -5_000 }, { currency: 'USD', amount: 2_000 }] },
    ];

    const result = buildCarryOverExpenses(balances, 'g-nuevo', 'Saldo trasladado', 'ana');

    expect(result).toHaveLength(2);
    const porMoneda = Object.fromEntries(result.map(e => [e.currency, e]));
    expect(porMoneda.ARS.payers).toEqual([{ userId: 'ana', amount: 5_000 }]);
    expect(porMoneda.USD.payers).toEqual([{ userId: 'beto', amount: 2_000 }]);
  });

  it('una moneda ya saldada en cero no genera Expense', () => {
    const balances: BalanceByCurrency[] = [
      { userId: 'ana',  balances: [{ currency: 'ARS', amount: 0 }] },
      { userId: 'beto', balances: [{ currency: 'ARS', amount: 0 }] },
    ];

    expect(buildCarryOverExpenses(balances, 'g-nuevo', 'Saldo trasladado', 'ana')).toHaveLength(0);
  });

  it('varios acreedores y varios deudores en la misma moneda', () => {
    const balances: BalanceByCurrency[] = [
      { userId: 'ana',   balances: [{ currency: 'ARS', amount: 6_000 }] },
      { userId: 'beto',  balances: [{ currency: 'ARS', amount: 4_000 }] },
      { userId: 'carla', balances: [{ currency: 'ARS', amount: -10_000 }] },
    ];

    const [e] = buildCarryOverExpenses(balances, 'g-nuevo', 'Saldo trasladado', 'ana');

    expect(e.amount).toBe(10_000);
    expect(e.payers).toEqual(expect.arrayContaining([
      { userId: 'ana', amount: 6_000 },
      { userId: 'beto', amount: 4_000 },
    ]));
    expect(e.splits).toEqual([{ userId: 'carla', amount: 10_000, isPaid: false }]);
  });

  it('invariante: si una moneda no tiene acreedores O no tiene deudores, se ignora (no debería pasar viniendo de calculateBalancesByCurrency, pero no debe crashear)', () => {
    const balances: BalanceByCurrency[] = [
      { userId: 'ana', balances: [{ currency: 'ARS', amount: 500 }] },
    ];

    expect(buildCarryOverExpenses(balances, 'g-nuevo', 'Saldo trasladado', 'ana')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --testPathPattern=groupCarryOver`
Expected: FAIL — `groupCarryOver.ts` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/algorithms/groupCarryOver.ts`:

```ts
import { v4 as uuidv4 } from 'uuid';
import type { BalanceByCurrency, Expense, Payer, Split } from '@/src/types/models';
import type { CurrencyCode } from '@/src/constants/currencies';
import { syncedNow } from '@/src/utils/syncedClock';

/**
 * El traspaso de un grupo (T-058, PO 2026-09-20) no copia sus gastos — arma
 * UN `Expense` por moneda presente en el balance final del grupo viejo,
 * usando el mecanismo de pagadores múltiples que ya existe (T-025): quien
 * tenía saldo a favor queda como pagador de su crédito, quien debía queda en
 * `splits` por su deuda. Es la salida de `calculateBalancesByCurrency`
 * convertida en un registro, no un cálculo nuevo.
 *
 * Nunca mezcla monedas en un mismo `Expense` (regla de negocio #7): si el
 * grupo tenía saldos abiertos en ARS y USD, salen dos `Expense` distintos.
 * Una moneda ya saldada en 0 no genera ningún registro — no hay nada que
 * trasladar.
 */
export function buildCarryOverExpenses(
  balancesByCurrency: BalanceByCurrency[],
  groupId: string,
  description: string,
  createdById: string,
): Expense[] {
  const porMoneda = new Map<CurrencyCode, { userId: string; amount: number }[]>();

  for (const b of balancesByCurrency) {
    for (const { currency, amount } of b.balances) {
      if (amount === 0) continue;
      const lista = porMoneda.get(currency) ?? [];
      lista.push({ userId: b.userId, amount });
      porMoneda.set(currency, lista);
    }
  }

  const ahora = syncedNow();
  const expenses: Expense[] = [];

  for (const [currency, entradas] of porMoneda) {
    const acreedores = entradas.filter(e => e.amount > 0);
    const deudores = entradas.filter(e => e.amount < 0);
    if (acreedores.length === 0 || deudores.length === 0) continue;

    const payers: Payer[] = acreedores.map(a => ({ userId: a.userId, amount: a.amount }));
    const splits: Split[] = deudores.map(d => ({ userId: d.userId, amount: -d.amount, isPaid: false }));
    const total = payers.reduce((s, p) => s + p.amount, 0);

    expenses.push({
      id: uuidv4(),
      groupId,
      description,
      amount: total,
      currency,
      paidById: payers[0].userId,
      payers,
      splits,
      splitMode: 'custom',
      category: 'other',
      date: ahora,
      createdAt: ahora,
      createdById,
      updatedAt: ahora,
      isDeleted: false,
      deletionVotes: [],
    });
  }

  return expenses;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=groupCarryOver`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/algorithms/groupCarryOver.ts src/algorithms/__tests__/groupCarryOver.test.ts
git commit -m "feat(groups): construir los Expense de traspaso a partir del balance por moneda"
```

---

### Task 5: `Group.supersededByGroupId` + `group_replaced` notice

**Files:**
- Modify: `src/types/models.ts:237-267` (the `Group` interface)
- Modify: `src/services/syncNotices.ts` (the `Snapshot` type + `snapshot()` + `noticesFor()`)
- Modify: `src/sync/relayEngine.ts:227` (the one production call site of `snapshot()`)
- Test: `src/services/__tests__/syncNotices.groupReplaced.test.ts` (new)

**Interfaces:**
- Produces: `Group.supersededByGroupId?: string` (new optional field); `Notice` gains `{ kind: 'group_replaced'; groupId: string; groupName: string; newGroupId: string; newGroupName: string }`; `esAccionable('group_replaced')` returns `false`; `snapshot()` gains a required 4th parameter `groups: Group[]` (breaking change to its own signature, with exactly one production caller to update, done in this same task); `Snapshot` gains `traspasosConocidos: Record<string, string>`.

**Important correction versus the design spec's phrasing:** `noticesFor` and `snapshot` do **not** diff `Group[]` before/after today — `Snapshot` only tracks expense/payment ids, and `noticesFor` receives the CURRENT `groups` list just to look up names. There is no existing "before/after group" mechanism to piggyback on like the spec's write-up implied by analogy to `'joined'`. This task adds that missing piece directly (extending `Snapshot`), rather than reusing something that turns out not to exist.

Also: `supersededByGroupId` has no "author" field the way `Expense.createdById` does, so the existing "regla 1: lo propio no se avisa" mechanism (comparing `createdById`/`requestedBy` against `currentUserId`) has nothing to compare against here. This task does **not** attempt to suppress the notice for the acting device's *other* sessions — the device that performs the traspaso never calls `snapshot()`/`noticesFor()` for its own local write in the first place (those only run around a sync drain, see `relayEngine.ts:220-266`), so the common case (a groupmate's device syncing down the change) is naturally the only case that fires this notice.

- [ ] **Step 1: Add the field to the `Group` type**

In `src/types/models.ts`, inside the `Group` interface (right after `leaveRequest?: LeaveRequest;`, before the closing brace at line 267), add:

```ts
  /**
   * Este grupo se traspasó a otro por el límite de gastos (T-058, PO
   * 2026-09-20) — apunta al id del grupo nuevo. Optativo y aditivo: un
   * grupo sin este campo simplemente no fue traspasado. Dispara el aviso
   * `group_replaced` (`src/services/syncNotices.ts`) para los demás
   * miembros cuando aparece en una bajada de sync.
   */
  supersededByGroupId?: string;
```

- [ ] **Step 2: Write the failing test**

Create `src/services/__tests__/syncNotices.groupReplaced.test.ts`:

```ts
import { snapshot, noticesFor, esAccionable } from '../syncNotices';
import type { Group, Expense } from '@/src/types/models';

function grupo(over: Partial<Group> = {}): Group {
  return {
    id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: 'ana', deletionVotes: [],
    ...over,
  };
}

describe('aviso "group_replaced"', () => {
  it('se dispara cuando un grupo aparece con supersededByGroupId nuevo en esta bajada', () => {
    const antes = snapshot([], 1_000, [grupo()], []);
    const gruposDespues = [
      grupo({ supersededByGroupId: 'g2' }),
      grupo({ id: 'g2', name: 'Viaje (2)' }),
    ];

    const avisos = noticesFor(antes, [], gruposDespues, 'beto', 2_000, []);

    expect(avisos).toContainEqual({
      kind: 'group_replaced',
      groupId: 'g1',
      groupName: 'Viaje',
      newGroupId: 'g2',
      newGroupName: 'Viaje (2)',
    });
  });

  it('NO se dispara si supersededByGroupId ya estaba en la foto de antes (regla 3: sólo lo nuevo de esta bajada)', () => {
    const grupoYaTraspasado = grupo({ supersededByGroupId: 'g2' });
    const antes = snapshot([], 1_000, [grupoYaTraspasado, grupo({ id: 'g2', name: 'Viaje (2)' })], []);

    const avisos = noticesFor(antes, [], [grupoYaTraspasado, grupo({ id: 'g2', name: 'Viaje (2)' })], 'beto', 2_000, []);

    expect(avisos.filter(a => a.kind === 'group_replaced')).toHaveLength(0);
  });

  it('NO se dispara para un grupo borrado', () => {
    const antes = snapshot([], 1_000, [grupo()], []);
    const gruposDespues = [grupo({ supersededByGroupId: 'g2', isDeleted: true })];

    const avisos = noticesFor(antes, [], gruposDespues, 'beto', 2_000, []);

    expect(avisos.filter(a => a.kind === 'group_replaced')).toHaveLength(0);
  });

  it('esAccionable("group_replaced") es false — es informativo', () => {
    expect(esAccionable('group_replaced')).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test -- --testPathPattern=syncNotices.groupReplaced`
Expected: FAIL — `snapshot()` doesn't accept a `groups` parameter yet, `'group_replaced'` isn't a `Notice` kind, TypeScript errors on the test file itself.

- [ ] **Step 4: Implement**

In `src/services/syncNotices.ts`:

1. Add the new variant to the `Notice` union (anywhere in the union, next to `'joined'` is a reasonable spot since both are informational):

```ts
  /**
   * Un grupo del que soy miembro se traspasó a uno nuevo por el límite de
   * gastos (T-058, PO 2026-09-20) — el viejo queda archivado, de solo
   * lectura. Informativo: el traspaso ya se aplicó, no hay nada que
   * aprobar u objetar.
   */
  | { kind: 'group_replaced'; groupId: string; groupName: string; newGroupId: string; newGroupName: string }
```

2. Add `case 'group_replaced': return false;` to the `esAccionable` switch (next to `case 'joined':`).

3. Extend the `Snapshot` type (right after the `borrados: string[];` field) and its closing `};`:

```ts
  /**
   * Ids de grupo → id del grupo que lo reemplaza, tal como estaban en la
   * FOTO DE ANTES (T-058, PO 2026-09-20). Es lo que distingue "esto se
   * traspasó recién" de "ya lo sabía" para el aviso `group_replaced`.
   */
  traspasosConocidos: Record<string, string>;
```

4. Update `snapshot()`'s signature and body to take `groups` and populate the new field:

```ts
export function snapshot(
  expenses: Expense[],
  now: number,
  groups: Group[],
  payments: Payment[] = [],
): Snapshot {
  const vivos = expenses.filter(e => !e.isDeleted);
  const traspasosConocidos: Record<string, string> = {};
  for (const g of groups) {
    if (g.supersededByGroupId) traspasosConocidos[g.id] = g.supersededByGroupId;
  }
  return {
    expenseIds: vivos.map(e => e.id),
    conBorradoAbierto: vivos.filter(e => borradoPendiente(e, now)).map(e => e.id),
    paymentIds: payments.filter(p => !p.isDeleted).map(p => p.id),
    borrados: expenses.filter(e => e.isDeleted).map(e => e.id),
    traspasosConocidos,
  };
}
```

(Note the parameter ORDER change: `groups` is inserted before `payments`, which already has a default — callers that pass payments positionally must update. There is exactly one, handled in Step 6 below.)

5. In `noticesFor`, after the existing group-independent setup (near where `mios`/`nombre` are computed), add the detection and fold its output into the returned array:

```ts
  const traspasos: Notice[] = [];
  for (const g of groups) {
    if (g.isDeleted || !g.supersededByGroupId) continue;
    const yaLoSabia = before.traspasosConocidos[g.id] === g.supersededByGroupId;
    if (yaLoSabia) continue;

    const nuevo = groups.find(x => x.id === g.supersededByGroupId);
    traspasos.push({
      kind: 'group_replaced',
      groupId: g.id,
      groupName: g.name,
      newGroupId: g.supersededByGroupId,
      newGroupName: nuevo?.name ?? '',
    });
  }
```

Find the function's final line, `return [...porGastos, ...pedidosDeBorrado, ...restauraciones, ...saldos];`, and change it to:

```ts
  return [...porGastos, ...pedidosDeBorrado, ...restauraciones, ...saldos, ...traspasos];
```

- [ ] **Step 5: Run the new test**

Run: `npm test -- --testPathPattern=syncNotices.groupReplaced`
Expected: PASS, 4/4.

- [ ] **Step 6: Update the one production call site**

In `src/sync/relayEngine.ts:227`, change:

```ts
  const antes = snapshot(useExpenseStore.getState().expenses, syncedNow(), usePaymentStore.getState().payments);
```

to:

```ts
  const antes = snapshot(
    useExpenseStore.getState().expenses,
    syncedNow(),
    useGroupStore.getState().groups,
    usePaymentStore.getState().payments,
  );
```

(`useGroupStore` is already imported in this file — check the top of `relayEngine.ts` to confirm, it's used elsewhere in the same `drainNow` function for `useGroupKeyStore`/other group state.)

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — every other call to `snapshot()` lives only in this task's new test file and in `relayEngine.ts` (verified in this task's Files section); `supersededByGroupId` is optional and additive, no existing `Group` fixture breaks.

- [ ] **Step 8: Commit**

```bash
git add src/types/models.ts src/services/syncNotices.ts src/sync/relayEngine.ts src/services/__tests__/syncNotices.groupReplaced.test.ts
git commit -m "feat(groups): campo supersededByGroupId + aviso group_replaced para los demás miembros"
```

---

### Task 6: `traspasarGrupo` — the orchestration service

**Files:**
- Create: `src/services/groupTraspaso.ts`
- Test: `src/services/__tests__/groupTraspaso.test.ts`

**Interfaces:**
- Consumes: `calculateBalancesByCurrency` (Task 4's dependency, already existing), `buildCarryOverExpenses` (Task 4), `useArchiveStore.getState().setArchived(id, true, 'limit')` (Task 2), `useGroupStore.getState().addGroup`/`updateGroup`, `useExpenseStore.getState().addExpense`.
- Produces: `traspasarGrupo(grupoViejo: Group, description: string, createdById: string): Group` — Task 7's UI calls this directly; returns the newly created `Group`.

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/groupTraspaso.test.ts`:

```ts
import { traspasarGrupo } from '../groupTraspaso';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { Group, Expense } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));

function grupo(over: Partial<Group> = {}): Group {
  return {
    id: 'g-viejo', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: 'ana', deletionVotes: [],
    ...over,
  };
}

function gasto(over: Partial<Expense> = {}): Expense {
  return {
    id: `e-${Math.random()}`, groupId: 'g-viejo', description: 'x', amount: 20_000, currency: 'ARS',
    paidById: 'ana', splits: [{ userId: 'beto', amount: 10_000, isPaid: false }, { userId: 'ana', amount: 10_000, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 1_000, createdAt: 1_000, updatedAt: 1_000,
    createdById: 'ana', isDeleted: false, deletionVotes: [],
    ...over,
  } as Expense;
}

beforeEach(() => {
  ['groups', 'expenses', 'payments'].forEach(b => createSecureStorage(b).clearAll());
  useGroupStore.setState({ groups: [grupo()] });
  useExpenseStore.setState({
    // Ana pagó 20.000, se dividió mitad y mitad → Beto le debe 10.000 a Ana.
    expenses: [gasto({ splits: [{ userId: 'beto', amount: 20_000, isPaid: false }] })],
  });
  usePaymentStore.setState({ payments: [] });
  useArchiveStore.setState({ archivedIds: [], reasons: {} });
});

describe('traspasarGrupo', () => {
  it('crea un grupo nuevo con los mismos miembros y moneda', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(nuevo.memberIds).toEqual(viejo.memberIds);
    expect(nuevo.currency).toBe(viejo.currency);
    expect(nuevo.id).not.toBe(viejo.id);
    expect(useGroupStore.getState().groups.some(g => g.id === nuevo.id)).toBe(true);
  });

  it('crea exactamente un Expense de traspaso en el grupo nuevo, con el balance correcto', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    const delNuevo = useExpenseStore.getState().expenses.filter(e => e.groupId === nuevo.id);
    expect(delNuevo).toHaveLength(1);
    expect(delNuevo[0].payers).toEqual([{ userId: 'ana', amount: 20_000 }]);
    expect(delNuevo[0].splits).toEqual([{ userId: 'beto', amount: 20_000, isPaid: false }]);
  });

  it('archiva el grupo viejo con reason "limit" (irrevocable)', () => {
    const viejo = useGroupStore.getState().groups[0];
    traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(useArchiveStore.getState().isArchived(viejo.id)).toBe(true);
    expect(useArchiveStore.getState().canUnarchive(viejo.id)).toBe(false);
  });

  it('marca el grupo viejo con supersededByGroupId apuntando al nuevo', () => {
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    const viejoActualizado = useGroupStore.getState().groups.find(g => g.id === viejo.id);
    expect(viejoActualizado?.supersededByGroupId).toBe(nuevo.id);
  });

  it('un grupo ya saldado (balance cero) traspasa sin crear ningún Expense', () => {
    useExpenseStore.setState({ expenses: [] });
    const viejo = useGroupStore.getState().groups[0];
    const nuevo = traspasarGrupo(viejo, 'Saldo trasladado de Viaje', 'ana');

    expect(useExpenseStore.getState().expenses.filter(e => e.groupId === nuevo.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --testPathPattern=groupTraspaso`
Expected: FAIL — `groupTraspaso.ts` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/services/groupTraspaso.ts`:

```ts
import { v4 as uuidv4 } from 'uuid';
import type { Group } from '@/src/types/models';
import { calculateBalancesByCurrency } from '@/src/algorithms/calculateBalances';
import { buildCarryOverExpenses } from '@/src/algorithms/groupCarryOver';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { useArchiveStore } from '@/src/store/archiveStore';
import { syncedNow } from '@/src/utils/syncedClock';

/**
 * Traspasa un grupo a uno nuevo (T-058, PO 2026-09-20): no copia los gastos
 * viejos — cierra el balance del grupo viejo en uno o más `Expense` de
 * traspaso (uno por moneda, `buildCarryOverExpenses`) dentro del grupo
 * nuevo, y archiva el viejo de forma irrevocable (`reason: 'limit'`).
 *
 * `description` ya viene resuelta (con `t()`) desde la UI — este servicio no
 * depende de i18n, sigue el mismo criterio de pureza que el resto de
 * `src/algorithms`.
 */
export function traspasarGrupo(grupoViejo: Group, description: string, createdById: string): Group {
  const { expenses } = useExpenseStore.getState();
  const { payments } = usePaymentStore.getState();
  const gastosDelGrupo = expenses.filter(e => e.groupId === grupoViejo.id);
  const pagosDelGrupo = payments.filter(p => p.groupId === grupoViejo.id);

  const balances = calculateBalancesByCurrency(gastosDelGrupo, pagosDelGrupo, grupoViejo.memberIds);

  const ahora = syncedNow();
  const grupoNuevo: Group = {
    id: uuidv4(),
    name: `${grupoViejo.name} (2)`,
    memberIds: grupoViejo.memberIds,
    currency: grupoViejo.currency,
    createdAt: ahora,
    updatedAt: ahora,
    isDeleted: false,
    createdById,
    deletionVotes: [],
    deletionMode: grupoViejo.deletionMode,
  };

  const carryOvers = buildCarryOverExpenses(balances, grupoNuevo.id, description, createdById);

  useGroupStore.getState().addGroup(grupoNuevo);
  for (const gasto of carryOvers) {
    useExpenseStore.getState().addExpense(gasto);
  }

  useGroupStore.getState().updateGroup(grupoViejo.id, { supersededByGroupId: grupoNuevo.id });
  useArchiveStore.getState().setArchived(grupoViejo.id, true, 'limit');

  return grupoNuevo;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=groupTraspaso`
Expected: PASS, 5/5.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/groupTraspaso.ts src/services/__tests__/groupTraspaso.test.ts
git commit -m "feat(groups): traspasarGrupo — orquesta grupo nuevo + traspaso + archivado irrevocable"
```

---

### Task 7: UI — aviso/bloqueo en el detalle del grupo y al cargar un gasto, botón manual de traspaso

**Files:**
- Modify: `app/groups/[id].tsx` (banner + manual button + confirmation)
- Modify: `app/expense/new.tsx` (hard block at 450, reusing the same confirmation)
- Test: `src/screens/__tests__/traspasoGrupoUI.test.tsx` (new)

**Interfaces:**
- Consumes: `useGroupExpenseCount` (`src/store/selectors.ts:43`, already existing), `debeAvisar`/`estaBloqueado` (Task 1), `traspasarGrupo` (Task 6).
- Produces: nothing new for later tasks.

**Read first:** `app/groups/[id].tsx` in full (you haven't seen it yet in this plan) to find where other group-level actions live (e.g. "Salir del grupo") and match that pattern/placement for the new "Traspasar a grupo nuevo" action and the warning banner.

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/traspasoGrupoUI.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import GroupDetailScreen from '@/app/groups/[id]';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useUserStore } from '@/src/store/userStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import type { User, Group, Expense } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const ANA = { id: 'ana', name: 'Ana' } as User;

function grupo(): Group {
  return {
    id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: 'ana', deletionVotes: [],
  };
}

function gastos(n: number): Expense[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e${i}`, groupId: 'g1', description: `g${i}`, amount: 1_000, currency: 'ARS',
    paidById: 'ana', splits: [{ userId: 'beto', amount: 1_000, isPaid: false }],
    splitMode: 'equal', category: 'other', date: 1_000, createdAt: 1_000, updatedAt: 1_000,
    createdById: 'ana', isDeleted: false, deletionVotes: [],
  }));
}

beforeEach(() => {
  useAuthStore.setState({ currentUser: ANA });
  useUserStore.setState({ users: [ANA, { id: 'beto', name: 'Beto' } as User] });
  useGroupStore.setState({ groups: [grupo()] });
  usePaymentStore.setState({ payments: [] });
});

describe('aviso y botón de traspaso en el detalle del grupo', () => {
  it('con menos de 350 gastos, no muestra el aviso', () => {
    useExpenseStore.setState({ expenses: gastos(349) });
    const r = render(<GroupDetailScreen />);
    expect(r.queryByTestId('traspaso-banner')).toBeNull();
  });

  it('con 350 gastos o más, muestra el aviso de traspaso', () => {
    useExpenseStore.setState({ expenses: gastos(350) });
    const r = render(<GroupDetailScreen />);
    expect(r.getByTestId('traspaso-banner')).toBeTruthy();
  });

  it('el botón "Traspasar a grupo nuevo" está siempre disponible, aunque haya pocos gastos', () => {
    useExpenseStore.setState({ expenses: gastos(2) });
    const r = render(<GroupDetailScreen />);
    expect(r.getByTestId('traspaso-manual-btn')).toBeTruthy();
  });

  it('tocar el botón manual y confirmar crea el grupo nuevo y archiva el viejo', () => {
    useExpenseStore.setState({ expenses: gastos(2) });
    const r = render(<GroupDetailScreen />);

    fireEvent.press(r.getByTestId('traspaso-manual-btn'));
    fireEvent.press(r.getByTestId('traspaso-confirmar-btn'));

    const grupos = useGroupStore.getState().groups;
    expect(grupos).toHaveLength(2);
    expect(grupos.find(g => g.id === 'g1')?.supersededByGroupId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --testPathPattern=traspasoGrupoUI`
Expected: FAIL — none of `traspaso-banner`/`traspaso-manual-btn`/`traspaso-confirmar-btn` exist yet.

- [ ] **Step 3: Implement**

In `app/groups/[id].tsx`:

1. Import `useGroupExpenseCount` from `@/src/store/selectors` (if not already imported — check first), `debeAvisar`/`estaBloqueado` from `@/src/algorithms/groupExpenseLimit`, `traspasarGrupo` from `@/src/services/groupTraspaso`, and add local state:

```tsx
const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false);
const cantidadGastos = useGroupExpenseCount(group.id); // usa la misma variable que ya tenga el grupo cargado en este archivo
```

2. Add the warning banner, placed near the top of the group's action area (match the visual pattern of `UnconvertedNotice` or the closest existing "banner with two buttons" in this file):

```tsx
{debeAvisar(cantidadGastos) && (
  <View testID="traspaso-banner" style={styles.avisoTraspaso}>
    <Text style={[Typography.bodyM, { color: c.text }]}>
      {t('groups.limit_warning_body', { count: cantidadGastos })}
    </Text>
    <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
      <Pressable onPress={() => setMostrarConfirmacion(true)} style={[styles.avisoBtn, { backgroundColor: c.brand.primary }]}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>{t('groups.limit_warning_action')}</Text>
      </Pressable>
    </View>
  </View>
)}
```

3. Add the manual button, always rendered (find the section with other secondary actions, e.g. "Salir del grupo", and add this alongside it):

```tsx
<Pressable testID="traspaso-manual-btn" onPress={() => setMostrarConfirmacion(true)} style={styles.accionSecundaria}>
  <Text style={{ color: c.brand.primary, fontWeight: '600' }}>{t('groups.traspaso_manual_action')}</Text>
</Pressable>
```

4. Add the confirmation (reuse `BottomSheet` from `@/src/components/Sheet`, already used elsewhere in this codebase — check its exact import in `app/(tabs)/index.tsx` for the pattern):

```tsx
<BottomSheet visible={mostrarConfirmacion} onClose={() => setMostrarConfirmacion(false)}>
  <Text style={[Typography.h3, { color: c.text, marginBottom: 8 }]}>{t('groups.traspaso_confirm_title')}</Text>
  <Text style={[Typography.bodyM, { color: c.textSecondary, marginBottom: 20 }]}>
    {t('groups.traspaso_confirm_body', { count: cantidadGastos })}
  </Text>
  <Pressable
    testID="traspaso-confirmar-btn"
    onPress={() => {
      const nuevo = traspasarGrupo(group, t('groups.carryover_description', { name: group.name }), currentUser?.id ?? '');
      setMostrarConfirmacion(false);
      router.replace(`/groups/${nuevo.id}` as any);
    }}
    style={[styles.saveBtn, { backgroundColor: c.brand.primary }]}
  >
    <Text style={{ color: '#fff', fontWeight: '700' }}>{t('groups.traspaso_confirm_action')}</Text>
  </Pressable>
</BottomSheet>
```

Add the styles used above (`avisoTraspaso`, `avisoBtn`, `accionSecundaria`) to this file's `StyleSheet.create` block, following the visual conventions already used elsewhere in the same file (padding via `Spacing.screenPad`, `Radius.md`, etc. — check what's already imported and used for consistency instead of inventing new values).

In `app/expense/new.tsx`, extend the archived-group work from Task 3 to also block at the hard limit — right after the `grupoArchivado` computation added in Task 3, add:

```tsx
const cantidadGastosDelGrupo = useGroupExpenseCount(hasGroup ? groupId : '');
const grupoBloqueadoPorLimite = hasGroup && !isEditMode && estaBloqueado(cantidadGastosDelGrupo);
```

(import `useGroupExpenseCount` from `@/src/store/selectors` and `estaBloqueado` from `@/src/algorithms/groupExpenseLimit`), and fold it into `canSave`:

```tsx
const canSave = description.trim().length > 0 && amount > 0 && !percentError && (!hasGroup || members.length > 0) && payersOk && !grupoArchivado && !grupoBloqueadoPorLimite;
```

`!isEditMode` in the `grupoBloqueadoPorLimite` check matters: editing one of the existing 450 expenses must stay possible (it doesn't grow the count), only adding a NEW one (#451) is blocked. Add the same kind of inline hint text as Task 3's `grupoArchivado` hint, using a new key `groups.limit_blocked_hint` pointing the user at the group detail screen to do the traspaso.

Add all new i18n keys to `src/i18n/locales/es.json`/`en.json`/`pt.json` under `groups`:
- `limit_warning_body`: es `"Este grupo tiene {{count}} gastos — se recomienda traspasarlo a uno nuevo antes de llegar a 450"`, en `"This group has {{count}} expenses — we recommend moving it to a new one before reaching 450"`, pt `"Este grupo tem {{count}} despesas — recomendamos transferi-lo para um novo antes de chegar a 450"`.
- `limit_warning_action`: es `"Crear grupo nuevo"`, en `"Create new group"`, pt `"Criar novo grupo"`.
- `limit_blocked_hint`: es `"Este grupo llegó al límite de 450 gastos — traspasalo a uno nuevo desde su pantalla de detalle"`, en `"This group reached the 450-expense limit — transfer it to a new one from its detail screen"`, pt `"Este grupo atingiu o limite de 450 despesas — transfira-o para um novo na tela de detalhes"`.
- `traspaso_manual_action`: es `"Traspasar a grupo nuevo"`, en `"Transfer to a new group"`, pt `"Transferir para um novo grupo"`.
- `traspaso_confirm_title`: es `"¿Traspasar este grupo?"`, en `"Transfer this group?"`, pt `"Transferir este grupo?"`.
- `traspaso_confirm_body`: es `"Se crea un grupo nuevo con los mismos miembros. Este grupo ({{count}} gastos) queda archivado y de solo lectura para siempre."`, en `"A new group is created with the same members. This group ({{count}} expenses) becomes permanently read-only."`, pt `"Um novo grupo é criado com os mesmos membros. Este grupo ({{count}} despesas) fica arquivado e somente leitura para sempre."`.
- `traspaso_confirm_action`: es `"Sí, traspasar"`, en `"Yes, transfer"`, pt `"Sim, transferir"`.
- `carryover_description`: es `"Saldo trasladado de {{name}}"`, en `"Balance transferred from {{name}}"`, pt `"Saldo transferido de {{name}}"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=traspasoGrupoUI`
Expected: PASS, 4/4.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/groups/\[id\].tsx app/expense/new.tsx src/screens/__tests__/traspasoGrupoUI.test.tsx src/i18n/locales/es.json src/i18n/locales/en.json src/i18n/locales/pt.json
git commit -m "feat(groups): aviso/bloqueo de límite + botón manual de traspaso en el detalle del grupo"
```

---

### Task 8: Archived tab — hide "desarchivar" for `reason: 'limit'`

**Files:**
- Modify: `src/components/SwipeToArchive.tsx`
- Modify: `app/(tabs)/groups.tsx:144-155`
- Test: `src/components/__tests__/SwipeToArchive.disabled.test.tsx` (new)

**Interfaces:**
- Consumes: `useArchiveStore.getState().canUnarchive(groupId)` (Task 2).
- Produces: `SwipeToArchive` gains an optional `disabled?: boolean` prop — no other consumer of this component exists to break.

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/SwipeToArchive.disabled.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { SwipeToArchive } from '../SwipeToArchive';
import { Text } from 'react-native';

describe('SwipeToArchive con disabled', () => {
  it('sin disabled, el gesto de swipe está habilitado', () => {
    const r = render(
      <SwipeToArchive archived onAction={() => {}}>
        <Text>fila</Text>
      </SwipeToArchive>,
    );
    const swipeable = r.UNSAFE_root.findByProps({ testID: undefined, friction: 2 });
    expect(swipeable.props.enabled).not.toBe(false);
  });

  it('con disabled, el Swipeable queda deshabilitado', () => {
    const r = render(
      <SwipeToArchive archived disabled onAction={() => {}}>
        <Text>fila</Text>
      </SwipeToArchive>,
    );
    const swipeable = r.UNSAFE_root.findByProps({ friction: 2 });
    expect(swipeable.props.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --testPathPattern=SwipeToArchive.disabled`
Expected: FAIL — `disabled` prop doesn't exist yet, `Swipeable` never receives `enabled={false}`.

- [ ] **Step 3: Implement**

In `src/components/SwipeToArchive.tsx`, update the props destructure and the `<Swipeable>` element:

```tsx
export function SwipeToArchive({
  onAction, archived = false, disabled = false, children,
}: {
  onAction: () => void;
  archived?: boolean;
  /** Cuando es `true`, el gesto no hace nada — usado para un grupo archivado
      por límite (T-058), que no se puede desarchivar (PO 2026-09-20). */
  disabled?: boolean;
  children: React.ReactNode;
}) {
```

Read the rest of the file (`friction={2}` etc. block) and add `enabled={!disabled}` as a prop on the `<Swipeable ...>` element, alongside the existing `friction`/`rightThreshold`/`overshootRight` props.

In `app/(tabs)/groups.tsx`, import `useArchiveStore`'s `canUnarchive` (it's already imported for `archivedIds`/`setArchived` at line 16 — add `canUnarchive` to the same selector destructure or a separate `useArchiveStore(s => s.canUnarchive)` call), and pass it through at the `SwipeToArchive` call site (around line 144-148):

```tsx
<SwipeToArchive
  key={g.id}
  archived={tabActual === 'archivados'}
  disabled={tabActual === 'archivados' && !canUnarchive(g.id)}
  onAction={() => setArchived(g.id, tabActual === 'activos')}
>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=SwipeToArchive.disabled`
Expected: PASS, 2/2.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — `disabled` defaults to `false`, so the "Activos" tab (where `disabled` is always `false`) and every existing test render exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/components/SwipeToArchive.tsx "app/(tabs)/groups.tsx" src/components/__tests__/SwipeToArchive.disabled.test.tsx
git commit -m "feat(groups): la pestaña Archivados no deja desarchivar un grupo traspasado por límite"
```

---

### Task 9: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: no new warnings/errors beyond whatever the baseline is at the start of this plan (check it before Task 1 and compare).

- [ ] **Step 2: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full Jest suite**

Run: `npm test`
Expected: all suites pass, including all new test files from Tasks 1-8.

- [ ] **Step 4: Manual read-through against the spec**

Read `docs/superpowers/specs/2026-09-20-limite-gastos-grupo-traspaso-design.md` top to bottom and confirm every section has a corresponding task: números (Task 1), traspaso/carry-over (Tasks 4, 6), grupo viejo archivado + aviso a otros miembros (Tasks 2, 5, 6), solo lectura para archivados (Tasks 2, 3, 8), botón manual (Task 7).

- [ ] **Step 5: Commit if Step 1 required a fix**

Only if a new lint warning appeared and you fixed it:

```bash
git add -A
git commit -m "fix(lint): mantener baseline tras el límite de gastos por grupo"
```
