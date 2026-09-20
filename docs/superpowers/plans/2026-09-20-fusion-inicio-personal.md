# Fusión de "Inicio" en "Personal" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "Inicio" tab, turn "Personal" into the tab group's index screen (keeping the tab label "Personal"), and migrate Inicio's header and two of its content blocks ("Te deben/Debes" and "Grupos · Balance") into the merged screen.

**Architecture:** `app/(tabs)/index.tsx` (Inicio) is deleted outright; `app/(tabs)/personal.tsx` is renamed to `app/(tabs)/index.tsx` and becomes the sole entry screen, still exporting a component called `PersonalScreen`. `app/(tabs)/_layout.tsx`'s tab registration for the route named `index` switches from Inicio's label/icon to Personal's. Two JSX blocks are inserted into the renamed file at specific positions; nothing else about Personal's existing logic, selectors, or store usage changes.

**Tech Stack:** Expo Router v6, React Native, Zustand, react-i18next, Jest + @testing-library/react-native.

**Spec:** docs/superpowers/specs/2026-09-20-fusion-inicio-personal-design.md

## Global Constraints

- Lint baseline (124/0), `tsc --noEmit` clean, and the full Jest suite green must hold at every commit — the rename must not introduce new warnings or break tests that are still valid.
- No store, selector (`useDirectedDebts`, `useGlobalPersonBalances`), or algorithm changes — this is a screen-composition change only.
- No new dependencies.
- The "Te deben/Debes" block and the "Grupos · Balance" row reuse the existing `owedToMe`/`youOwe` values already derived from `useDirectedDebts` in `personal.tsx` — no duplicate selector call, no second data source.
- **Ruling (spec ambiguity, ADR not required — screen composition only):** the spec's Testing/Content section says to carry over Inicio's `pending`/`pendingLabel` props on the migrated "Te deben/Debes" `SplitStat`. Inicio computed those from `useGlobalPersonBalances` + `sumConverted` (which produces a `pending` flag for in-flight FX conversion). The spec elsewhere is explicit that the migrated block must reuse Personal's `owedToMe`/`youOwe` from `useDirectedDebts` instead, and `totalOwedToMe`/`totalIOwe` (in `src/algorithms/directedDebts.ts`) return plain numbers with no `pending` concept — mirroring how Personal's own pre-existing debt `SplitStat` (the one that stays put, unchanged) already omits `pending`/`id`/`minor` entirely. Since the dedup requirement is explicit and load-bearing while the `pending` carryover is an artifact of a data source we were explicitly told not to reuse, Task 4 below **omits** `pending`/`pendingLabel`/`id`/`minor` from the migrated block, matching the plain `{ label, value, color }` shape Personal's existing debt `SplitStat` already uses.

---

### Task 1: Rename the route — Personal becomes `index.tsx`, Inicio is deleted, tab bar updated

**Files:**
- Delete: `app/(tabs)/index.tsx` (old Inicio screen)
- Rename (git mv): `app/(tabs)/personal.tsx` → `app/(tabs)/index.tsx`
- Modify: `app/(tabs)/_layout.tsx:92-93`
- Modify: `src/__tests__/tabHomeCuentas.test.ts`

**Interfaces:**
- Consumes: nothing new — this task only moves an existing file and its already-working component (`PersonalScreen`, unchanged).
- Produces: `app/(tabs)/index.tsx` now serves `PersonalScreen`'s content at the route `/(tabs)`. `router.replace('/(tabs)')` (in `app/_layout.tsx:85` and `app/groups/join.tsx:91`) needs no change — it keeps resolving to `index.tsx`, which is now Personal.

- [ ] **Step 1: Delete the old Inicio screen**

```bash
git rm "app/(tabs)/index.tsx"
```

- [ ] **Step 2: Rename Personal to take its place**

```bash
git mv "app/(tabs)/personal.tsx" "app/(tabs)/index.tsx"
```

- [ ] **Step 3: Update the tab bar registration**

In `app/(tabs)/_layout.tsx`, replace lines 92-93:

```tsx
      {screen('index',     t('tabs.home'),     'home-outline')}
      {screen('personal',  t('tabs.personal'), 'analytics-outline')}
```

with:

```tsx
      {screen('index',     t('tabs.personal'), 'analytics-outline')}
```

- [ ] **Step 4: Update `tabHomeCuentas.test.ts` to match the new tab registration**

This test currently asserts the `index` route uses `tabs.home`/`home-outline` — that's no longer true, it now uses `tabs.personal`/`analytics-outline`. It also asserts `app/(tabs)/index.tsx` contains `t('dashboard.title')` — that assertion becomes false too, because `index.tsx` now IS the old `personal.tsx` content (which never had `dashboard.title` before Task 4 adds it below). Replace the whole file:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-121 — fusión de Inicio en Personal: la pestaña `index` pasa a mostrar
 * Personal (mismo label que tenía la pestaña vieja `personal`), y el título
 * "Tus cuentas" (antes exclusivo de Inicio) migra al header de esa pantalla.
 */

const RAIZ = join(__dirname, '..', '..');
const leer = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

describe('T-121 — pestaña index fusionada (Personal)', () => {
  it('la pestaña index usa la clave i18n tabs.personal con ícono analytics-outline', () => {
    const src = leer('app/(tabs)/_layout.tsx');
    const lineaIndex = src.split('\n').find(l => l.includes("screen('index'"));
    expect(lineaIndex).toBeDefined();
    expect(lineaIndex).toMatch(/t\('tabs\.personal'\)/);
    expect(lineaIndex).toMatch(/'analytics-outline'/);
  });

  it('ya no hay una pestaña separada registrada como personal', () => {
    const src = leer('app/(tabs)/_layout.tsx');
    const lineaPersonal = src.split('\n').find(l => l.includes("screen('personal'"));
    expect(lineaPersonal).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run the affected tests to see the expected state**

Run: `npm test -- --testPathPattern=tabHomeCuentas`
Expected: PASS (the file's own assertions now match the renamed file's actual content from Steps 1-3).

- [ ] **Step 6: Commit**

```bash
git add app/\(tabs\)/index.tsx app/\(tabs\)/_layout.tsx src/__tests__/tabHomeCuentas.test.ts
git commit -m "feat(tabs): fusionar Inicio en Personal — index.tsx pasa a ser Personal"
```

---

### Task 2: Fix `personalResumen.test.tsx`'s import path

**Files:**
- Modify: `src/screens/__tests__/personalResumen.test.tsx:3`

**Interfaces:**
- Consumes: `PersonalScreen` default export from `app/(tabs)/index.tsx` (produced by Task 1 — same component, new file location).
- Produces: nothing new.

- [ ] **Step 1: Update the import**

Replace line 3:

```tsx
import PersonalScreen from '@/app/(tabs)/personal';
```

with:

```tsx
import PersonalScreen from '@/app/(tabs)/index';
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --testPathPattern=personalResumen`
Expected: PASS (the component and its behavior are unchanged — only its file moved).

- [ ] **Step 3: Commit**

```bash
git add src/screens/__tests__/personalResumen.test.tsx
git commit -m "test: actualizar import de PersonalScreen tras el rename a index.tsx"
```

---

### Task 3: Fix `campanaEnTodasLasTabs.test.tsx` — remove the now-nonexistent "Personal" screen row

**Files:**
- Modify: `src/screens/__tests__/campanaEnTodasLasTabs.test.tsx:51-58`

**Interfaces:**
- Consumes: `app/(tabs)/index.tsx` default export (now Personal's content, per Task 1).
- Produces: nothing new.

**Context:** This test's `TABS` array (lines 51-58) treats "Cuenta" (`@/app/(tabs)/index`) and "Personal" (`@/app/(tabs)/personal`) as two different screens under test. After Task 1, `@/app/(tabs)/personal` no longer exists — that `require` would throw a module-not-found error. The three direct `require('@/app/(tabs)/index').default` calls at lines 87, 96, and 107 (used to test that two mounted tabs share the same notice-badge count) need no change: they already point at the right file, and the badge-sharing behavior they test doesn't depend on Personal's content.

- [ ] **Step 1: Remove the "Personal" row from `TABS`**

Replace lines 51-58:

```tsx
  const TABS: [string, () => React.ComponentType][] = [
    ['Cuenta',    () => require('@/app/(tabs)/index').default],
    ['Personal',  () => require('@/app/(tabs)/personal').default],
    ['Amigos',    () => require('@/app/(tabs)/friends').default],
    ['Grupos',    () => require('@/app/(tabs)/groups').default],
    ['Actividad', () => require('@/app/(tabs)/activity').default],
    ['Yo',        () => require('@/app/(tabs)/user').default],
  ];
```

with:

```tsx
  const TABS: [string, () => React.ComponentType][] = [
    ['Cuenta',    () => require('@/app/(tabs)/index').default],
    ['Amigos',    () => require('@/app/(tabs)/friends').default],
    ['Grupos',    () => require('@/app/(tabs)/groups').default],
    ['Actividad', () => require('@/app/(tabs)/activity').default],
    ['Yo',        () => require('@/app/(tabs)/user').default],
  ];
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --testPathPattern=campanaEnTodasLasTabs`
Expected: PASS, with 5 cases in the `it.each(TABS)` block instead of 6.

- [ ] **Step 3: Commit**

```bash
git add src/screens/__tests__/campanaEnTodasLasTabs.test.tsx
git commit -m "test: sacar la fila Personal del recorrido de tabs tras la fusión"
```

---

### Task 4: Migrate the header and the "Te deben/Debes" block to the top of the merged screen

**Files:**
- Modify: `app/(tabs)/index.tsx` (the renamed former `personal.tsx`)
- Test: `src/screens/__tests__/fusionHeaderYDeudas.test.tsx` (new file)

**Interfaces:**
- Consumes: `owedToMe`, `youOwe` (already computed in this file via `useDirectedDebts` — see the existing lines that compute them from `deudas`); `currentUser` from `useAuthStore` (already imported); `formatMoney`, `Colors`, `SplitStat`, `TabHeader`, `useHeaderPadding` (all already imported).
- Produces: `firstName` (`string`, derived once per render) — not consumed elsewhere in this plan, but available to any later work in this file.

**Step-by-step:**

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/fusionHeaderYDeudas.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import PersonalScreen from '@/app/(tabs)/index';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import type { User } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

const GABRIEL = { id: 'gabriel', name: 'Gabriel Maglia' } as User;

beforeEach(() => {
  useAuthStore.setState({ currentUser: GABRIEL });
  useUserStore.setState({ users: [GABRIEL] });
  useGroupStore.setState({ groups: [] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  usePersonalStore.setState({ entries: [], budget: usePersonalStore.getState().budget });
});

/**
 * T-121 — el header fusionado usa el saludo de Inicio ("Tus cuentas" / "Hola,
 * {nombre}"), y el bloque "Te deben/Debes" (antes exclusivo de Inicio) es lo
 * primero que aparece en el contenido de la pantalla.
 */
describe('fusión Inicio→Personal: header y bloque de deuda arriba de todo', () => {
  it('el header muestra "Tus cuentas" y el saludo con el primer nombre', () => {
    const r = render(<PersonalScreen />);

    expect(r.getByText('Tus cuentas')).toBeTruthy();
    expect(r.getByText('Hola, Gabriel')).toBeTruthy();
  });

  it('sin nombre de usuario, el saludo cae a "vos"', () => {
    useAuthStore.setState({ currentUser: { id: 'gabriel', name: undefined } as unknown as User });

    const r = render(<PersonalScreen />);

    expect(r.getByText('Hola, vos')).toBeTruthy();
  });

  it('el bloque "Te deben" aparece antes que la fila de ajustes', () => {
    const r = render(<PersonalScreen />);

    // getByTestId/getByText no dan posición, pero el árbol serializado sí
    // conserva el orden real de renderizado: comparar índices de strings
    // únicas en ese JSON es una forma simple y determinística de verificar
    // orden sin depender de una API de traversal más frágil.
    const arbol = JSON.stringify(r.toJSON());
    const indiceDeuda    = arbol.indexOf('Te deben');
    const indiceAjustes  = arbol.indexOf('personal-settings-btn');

    expect(indiceDeuda).toBeGreaterThanOrEqual(0);
    expect(indiceAjustes).toBeGreaterThan(indiceDeuda);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --testPathPattern=fusionHeaderYDeudas`
Expected: FAIL — `Tus cuentas` and `Hola, Gabriel` don't exist yet in the rendered output (the header still says Personal's own title, and there's no debt block above the settings row); `personal-settings-btn` testID doesn't exist yet either.

- [ ] **Step 3: Implement — header change**

In `app/(tabs)/index.tsx`, change the `useHeaderPadding` call:

```tsx
  const headerPad = useHeaderPadding();
```

to:

```tsx
  // T-121: sin aire entre el header y el bloque de deuda migrado (mismo
  // criterio que tenía Inicio, T-130).
  const headerPad = useHeaderPadding(0);
```

Add `firstName` right after the `currentUser` destructure (near the top of the component, where `const { currentUser } = useAuthStore();` lives):

```tsx
  const { currentUser } = useAuthStore();
  const firstName = currentUser?.name?.split(' ')[0] ?? 'vos';
```

Change the `<TabHeader .../>` call near the bottom of the component:

```tsx
      <TabHeader title={t('personal.title')} progress={progress} />
```

to:

```tsx
      <TabHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.greeting', { name: firstName })}
        progress={progress}
      />
```

- [ ] **Step 4: Implement — add the "Te deben/Debes" block above everything else**

Add a `testID` to the settings icon button so the order test can anchor on it. Change:

```tsx
        <View style={styles.titleRow}>
          <Pressable
            onPress={() => { hapticLight(); setShowBudgetSheet(true); }}
            style={[styles.iconBtn, { backgroundColor: c.bgGrouped }]}
          >
            <Ionicons name="settings-outline" size={17} color={c.textSecondary} />
          </Pressable>
        </View>
```

to:

```tsx
        {/* T-121: migrado de Inicio — reusa owedToMe/youOwe, ya derivados
            más abajo de useDirectedDebts (no se duplica el cálculo). Sin
            pending: a diferencia de la vieja Inicio (que salía de
            useGlobalPersonBalances + sumConverted), esta fuente no tiene
            noción de "conversión en vuelo" — igual que el SplitStat de
            deuda de Personal que ya convive en este archivo, más abajo. */}
        <SplitStat
          items={[
            { label: t('friends.owed_to_you'), value: formatMoney(owedToMe, cur), color: c.semantic.positive },
            { label: t('friends.you_owe'),     value: formatMoney(youOwe, cur),   color: c.textSecondary },
          ]}
        />

        <View style={styles.titleRow}>
          <Pressable
            testID="personal-settings-btn"
            onPress={() => { hapticLight(); setShowBudgetSheet(true); }}
            style={[styles.iconBtn, { backgroundColor: c.bgGrouped }]}
          >
            <Ionicons name="settings-outline" size={17} color={c.textSecondary} />
          </Pressable>
        </View>
```

This block must be placed AFTER the `owedToMe`/`youOwe` `useMemo` declarations (they're already defined earlier in the component, before the `return`) — no new computation is added, only new JSX consuming values that already exist in scope.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- --testPathPattern=fusionHeaderYDeudas`
Expected: PASS.

- [ ] **Step 6: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS, no new failures. (`personalResumen.test.tsx` renders the same screen and doesn't assert on header text or exact block order, so it should be unaffected — but confirm.)

- [ ] **Step 7: Commit**

```bash
git add app/\(tabs\)/index.tsx src/screens/__tests__/fusionHeaderYDeudas.test.tsx
git commit -m "feat(personal): header de Inicio + bloque Te deben/Debes migrado arriba de todo"
```

---

### Task 5: Add the "Grupos · Balance" row below the income/expense summary

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Test: `src/screens/__tests__/fusionGruposBalance.test.tsx` (new file)

**Interfaces:**
- Consumes: `owedToMe`, `youOwe` (same values as Task 4 — no new computation); `router` (already imported from `expo-router`); `hapticLight` (already imported); `Band`, `MoneyText` need to be added to this file's imports (see Step 3); `esYo` from `@/src/store/identityAlias` (new import); `useGroupStore` from `@/src/store/groupStore` (new import).
- Produces: nothing consumed by later tasks — this is the last content task.

**Step-by-step:**

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/fusionGruposBalance.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import PersonalScreen from '@/app/(tabs)/index';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { usePaymentStore } from '@/src/store/paymentStore';
import { usePersonalStore } from '@/src/store/personalStore';
import { useUserStore } from '@/src/store/userStore';
import { router } from 'expo-router';
import type { User, Group } from '@/src/types/models';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', startRelay: jest.fn(),
  announceGroupToContacts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}),
}));

const GABRIEL = { id: 'gabriel', name: 'Gabriel Maglia' } as User;

function grupo(id: string, memberIds: string[]): Group {
  return {
    id, name: id, memberIds, currency: 'ARS',
    createdAt: 1_000, updatedAt: 1_000, isDeleted: false,
    createdById: memberIds[0], deletionVotes: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ currentUser: GABRIEL });
  useUserStore.setState({ users: [GABRIEL] });
  useGroupStore.setState({ groups: [grupo('asado', ['gabriel', 'ana'])] });
  useExpenseStore.setState({ expenses: [] });
  usePaymentStore.setState({ payments: [] });
  usePersonalStore.setState({ entries: [], budget: usePersonalStore.getState().budget });
});

/**
 * T-121 — la fila "Grupos · Balance" (antes exclusiva de Inicio) vive ahora
 * debajo del resumen ingreso/gasto de Personal, y sigue llevando a Grupos.
 */
describe('fusión Inicio→Personal: fila Grupos · Balance', () => {
  it('muestra la fila y navega a Grupos al tocarla', () => {
    const r = render(<PersonalScreen />);

    const fila = r.getByTestId('groups-balance-row');
    expect(fila).toBeTruthy();

    fireEvent.press(fila);
    expect(router.push).toHaveBeenCalledWith('/(tabs)/groups');
  });

  it('cuenta sólo los grupos donde el usuario es miembro', () => {
    useGroupStore.setState({
      groups: [grupo('asado', ['gabriel', 'ana']), grupo('viaje', ['ana', 'juan'])],
    });

    const r = render(<PersonalScreen />);

    expect(r.getByText(/1 grupo/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- --testPathPattern=fusionGruposBalance`
Expected: FAIL — `groups-balance-row` testID doesn't exist yet.

- [ ] **Step 3: Implement**

Add the two new imports to `app/(tabs)/index.tsx`:

```tsx
import {
  Band, BandRow, Meter, SectionLabel, SplitStat, StatLead,
} from '@/src/components/Band';
```

becomes:

```tsx
import {
  Band, BandRow, Meter, SectionLabel, SplitStat, StatLead,
} from '@/src/components/Band';
```

(no change needed here — `Band` is already imported in `personal.tsx`) and separately add:

```tsx
import { useGroupStore } from '@/src/store/groupStore';
import { esYo } from '@/src/store/identityAlias';
```

next to the other store imports (near `import { useAuthStore } from '@/src/store/authStore';`).

Add the groups-count derivation next to the other `useMemo`s (after the `deudas`/`owedToMe`/`youOwe` block):

```tsx
  const groups = useGroupStore(st => st.groups);
  const misGrupos = useMemo(
    () => groups.filter(g => !g.isDeleted && !!currentUser && g.memberIds.some(esYo)),
    [groups, currentUser],
  );
```

Insert the new row right after the `<StatLead .../>` block (the "point of reference" — income lead + personal/groups summary) and before the personal debt `<SplitStat>` (the one gated by `youOwe > 0 ? ... : owedToMe > 0 ? ... : null`):

```tsx
        <StatLead
          sunken
          lead={{
            label: t('personal.summary_income'),
            value: `+${formatMoney(totalIncome, cur)}`,
            color: c.semantic.positive,
          }}
          items={[
            { label: t('personal.summary_personal'), value: formatMoney(totalExpense, cur) },
            { label: t('personal.summary_groups'),   value: formatMoney(totalGroup, cur) },
          ]}
        />

        {/* T-121: migrado de Inicio — mismo owedToMe/youOwe del bloque de
            arriba, sin recalcular con otro selector. */}
        <Band sunken>
          <Pressable
            accessibilityRole="button"
            testID="groups-balance-row"
            onPress={() => { hapticLight(); router.push('/(tabs)/groups' as any); }}
            style={styles.groupsBalanceRow}
          >
            <Text style={[Typography.caption, { color: c.textSecondary, flex: 1 }]}>
              {t('dashboard.groups_balance')} ·{' '}
              {misGrupos.length === 1
                ? t('dashboard.groups_count_one')
                : t('dashboard.groups_count', { count: misGrupos.length })}
            </Text>
            <MoneyText
              minor={owedToMe - youOwe}
              code={cur}
              prefix={owedToMe - youOwe > 0 ? '+' : ''}
              rollId="personal.groupsNet"
              style={[Typography.amountS, {
                color: owedToMe - youOwe > 0 ? c.semantic.positive
                  : owedToMe - youOwe < 0 ? c.semantic.negative : c.text,
              }]}
            />
          </Pressable>
        </Band>
```

Add the `groupsBalanceRow` style to the `StyleSheet.create` block at the bottom of the file, next to `netRow`-equivalents already there (`titleRow`, `monthNav`, etc.):

```tsx
  groupsBalanceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: Spacing.screenPad, paddingVertical: 11,
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --testPathPattern=fusionGruposBalance`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add app/\(tabs\)/index.tsx src/screens/__tests__/fusionGruposBalance.test.tsx
git commit -m "feat(personal): fila Grupos · Balance migrada debajo del resumen ingreso/gasto"
```

---

### Task 6: Final verification — lint, typecheck, full suite

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: exactly the pre-existing baseline (124 warnings, 0 errors) — no new warnings introduced by this branch. If the count differs, find and fix the new warning(s) before continuing.

- [ ] **Step 2: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full Jest suite**

Run: `npm test`
Expected: all suites pass, including the three migrated test files (Tasks 1-3) and the two new ones (Tasks 4-5).

- [ ] **Step 4: Manual sanity check of the merged screen's content order**

Read the final `app/(tabs)/index.tsx` top-to-bottom and confirm it matches the spec's 11-point order (section "Contenido de la pantalla fusionada"): header → Te deben/Debes → settings row → month nav → budget band → StatLead → Grupos·Balance → personal debt SplitStat → debts note → UnconvertedNotice → movements section.

- [ ] **Step 5: Commit if Step 1 required a fix**

Only if Step 1 found a new lint warning and you fixed it:

```bash
git add -A
git commit -m "fix(lint): mantener baseline 124/0 tras la fusión Inicio/Personal"
```
