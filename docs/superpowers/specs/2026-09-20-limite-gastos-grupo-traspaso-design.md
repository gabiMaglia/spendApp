# Límite de gastos por grupo + traspaso a grupo nuevo — Diseño

**Fecha:** 2026-09-20
**Disparador:** T-058 (el sobre de sync se acerca/pasa el techo de tamaño en grupos con mucho historial) sigue en backlog sin arreglo de fondo (la compactación por `ckey` de ADR-007 nunca se implementó). El PO propuso un camino alternativo, más simple: evitar que un grupo crezca lo suficiente como para acercarse al techo, en vez de arreglar el sobre para que aguante más.

## Contexto

T-058 midió, con el tope viejo de 256KB, que un grupo de 5 personas con 200 gastos ya superaba el límite en 22% y dejaba de sincronizar **en silencio, para siempre**. El PO subió el tope de fila a 1MB el 2026-09-01 (`006_payload_limit.sql`), lo que corrió la pared técnica de ~160 a **~720 gastos por grupo**. El arreglo estructural recomendado entonces (compactar el buzón por clave de registro, ADR-007 §3.5) **nunca se construyó** — sólo se subió el tope de tamaño.

Este diseño no reemplaza esa deuda técnica ni la resuelve para grupos que no sigan este flujo; es un límite de producto que evita que un grupo **nuevo** se acerque al techo, dejando margen de sobra sobre el techo real actual.

## Objetivo

- Un grupo no puede tener más de **450 gastos** (límite duro, bloqueante).
- Desde el gasto **350**, se avisa que conviene trasladar el grupo a uno nuevo.
- El traspaso: crea un grupo nuevo con los mismos miembros y moneda(s), liquida el historial del viejo en **un registro de traspaso por moneda** (no se copian los 450 gastos), y archiva el grupo viejo — localmente para quien hace el traspaso, con un aviso a los demás miembros para que hagan lo mismo.
- La función de traspaso es accesible en cualquier momento desde el detalle del grupo, no sólo al tocar el umbral.

## Números elegidos

| | Valor | Por qué |
|---|---|---|
| Límite duro | 450 gastos | Deja ~270 gastos de margen bajo el techo técnico real (~720) — el mismo colchón proporcional (2/3) que la primera propuesta del PO (150 duro / 100 aviso), pero calibrado contra el techo actual, no el de la medición original de T-058 (que corría con el tope viejo de 256KB). |
| Umbral de aviso | 350 gastos | Dos meses de margen aproximado de aviso antes del bloqueo, mismo criterio proporcional. |

Ambos números viven como constantes exportadas (p. ej. `src/constants/groupLimits.ts`), no hardcodeados en el punto de uso — si el techo técnico vuelve a moverse (otro cambio de `006_payload_limit.sql`), se ajustan en un solo lugar.

## Mecánica del límite

**Conteo:** gastos no borrados (`!isDeleted`) del grupo — el mismo filtro que ya usa `useGroupExpenseCount` (`src/store/selectors.ts`, usado en `HomeGroupRow`/`GroupCard`). Se reutiliza esa cuenta, no una nueva.

**Aviso (≥350, <450):** un banner no bloqueante en el detalle del grupo (`app/groups/[id].tsx`) — mismo lenguaje visual que otros avisos de la app (`UnconvertedNotice` es el precedente de "banda de aviso con acción"), con dos botones: **"Crear grupo nuevo"** (dispara el flujo de traspaso, ver abajo) y **"Ahora no"** (lo descarta para esta sesión de la pantalla; vuelve a aparecer la próxima vez que se entre al grupo, no se silencia permanentemente — silenciarlo escondería el problema real, que sigue ahí hasta que se resuelva).

**Bloqueo duro (=450):** al intentar guardar el gasto 451 (`app/expense/new.tsx`, el mismo punto donde ya vive el gate de ads de 4 gastos/día), la validación de guardado falla con un mensaje explícito que ofrece el mismo botón de traspaso en vez de dejar guardar. No es un `Alert` genérico: reusa el mismo componente/copy del banner de aviso, en su variante bloqueante. **Aplica sólo cuando el gasto tiene `groupId` seteado** (un gasto de grupo) — el límite es por grupo (por el tamaño de SU sobre de sync), así que nunca bloquea cargar un `PersonalEntry` sin grupo.

## El traspaso

Dado un grupo origen `G`:

1. **Balances de origen**, con la función que YA existe y ya maneja multi-moneda correctamente: `calculateBalancesByCurrency(expenses, payments, memberIds)` (`src/algorithms/calculateBalances.ts`) → `BalanceByCurrency[]` (por usuario, por moneda, neto en entero de la menor unidad).

2. **Grupo nuevo** `G'`: mismos `memberIds` y misma `currency` "default" que `G` (el campo `Group.currency`, usado para mostrar el balance principal); nombre `"<nombre de G> (2)"` (si ya existe un `"(2)"`, sigue con `"(3)"`, etc. — mismo criterio que evitar colisiones de nombre en cualquier flujo de creación, a definir el detalle exacto en el plan). Se crea con `useGroupStore.addGroup`, igual que `app/groups/new.tsx`.

3. **Un `Expense` de traspaso POR CADA MONEDA** presente en los balances de `G` (nunca se mezclan monedas — regla de negocio #7 del proyecto). Para cada moneda con al menos un balance no nulo:
   - `payers`: los usuarios con balance positivo en esa moneda, cada uno con `amount` = su crédito. Usa el mecanismo de **pagadores múltiples que ya existe** (T-025, `Expense.payers?: Payer[]`, `src/algorithms/payers.ts`) — no hace falta ningún campo ni tipo nuevo.
   - `splits`: los usuarios con balance negativo, cada uno con `amount` = su deuda (`isPaid: false`).
   - `amount`: suma total (debe cerrar exacto: Σ créditos == Σ deudas, porque viene de balances ya calculados sobre datos consistentes).
   - `description`: algo como `"Saldo trasladado de <nombre de G>"` (clave i18n, no texto fijo).
   - `category`: una categoría neutra existente (a definir en el plan — revisar `ExpenseCategory` para la más adecuada, o agregar una si hace falta).
   - Este `Expense` se crea en `G'`, no en `G`.
   - Si TODOS los balances de una moneda dan exactamente cero (grupo ya saldado en esa moneda), no se crea `Expense` para esa moneda — no hay nada que trasladar.

4. **Archivado del grupo viejo:** `useArchiveStore.setArchived(G.id, true)` — pero esto es **local a la cuenta que hace el traspaso** (`archiveStore.ts` lo documenta explícito: "sin salir del teléfono"). No archiva el grupo para nadie más.

5. **Aviso a los demás miembros:** un nuevo `Notice.kind: 'group_replaced'` (agregado a `src/services/syncNotices.ts`, siguiendo el mismo patrón que `'joined'` — comparación antes/después de una bajada de sync, pura, testeada) con `{ groupId: G.id, groupName: G.name, newGroupId: G'.id, newGroupName: G'.name }`. Se dispara cuando el sync trae un `Group` con un campo nuevo `supersededByGroupId` que antes no tenía (mismo mecanismo de detección que usa `'joined'` para "antes no estaba en mis grupos, ahora sí"). Ese campo (`Group.supersededByGroupId?: string`) se agrega a `G` como parte del paso 4 y viaja por el sync normal (es un campo más del registro, LWW). Tocar la notificación navega a `G'`.

## Botón manual (siempre disponible)

En `app/groups/[id].tsx`, una acción más (junto a "Salir del grupo" o donde viva el resto de acciones secundarias del grupo) — "Traspasar a grupo nuevo" — dispara el mismo flujo del punto anterior completo, sin importar cuántos gastos tenga el grupo. Con confirmación previa (es una acción con consecuencias: crea un grupo, archiva el actual localmente), mostrando cuántos gastos tiene hoy y el balance que se va a trasladar.

## Testing

- `calculateBalancesByCurrency` ya está testeado (no se toca) — la nueva lógica sólo lo CONSUME.
- Nueva función pura (p. ej. `buildCarryOverExpenses(balancesByCurrency, groupName): Expense[]`) con tests: una moneda, múltiples monedas, una moneda ya saldada en cero (no genera Expense), balances que no cierran exacto (no debería poder pasar viniendo de `calculateBalancesByCurrency`, pero un test de invariante no está de más).
- Test del límite: exactamente 449 gastos permite cargar el 450; exactamente 450 bloquea el 451; 349 no muestra aviso, 350 sí.
- Test de `syncNotices.ts`: `'group_replaced'` se dispara sólo cuando `supersededByGroupId` aparece en ESTA bajada (mismo criterio "regla 3" que ya rige `'joined'`/`'expenses'`), nunca para el propio traspaso hecho por el usuario (regla 1, "lo propio no se avisa").
- Test de integración del flujo completo de traspaso: grupo con gastos en 2 monedas, algunos miembros en positivo/negativo en cada una → el grupo nuevo tiene exactamente 2 Expenses (uno por moneda), los balances de `G'` recién creado coinciden con los balances finales de `G`.

## Global Constraints

- Reutilizar `calculateBalancesByCurrency` y el mecanismo de `payers[]`/`splits[]` ya existentes — no se toca su lógica ni se agrega un tipo de registro nuevo para representar el traspaso.
- Nunca mezclar monedas en un mismo `Expense` (regla de negocio #7).
- Los números de límite/aviso viven en una constante exportada, no hardcodeados.
- El archivado sigue siendo local (no se cambia esa semántica) — la sincronización del traspaso pasa exclusivamente por el aviso `group_replaced` y el campo `supersededByGroupId`.
- Lint baseline, `tsc --noEmit` limpio y la suite de Jest completa en verde se mantienen.
- i18n: todo texto nuevo (banner, botón, notice, confirmación) pasa por `t()`, es/en/pt.
