# Fusión de "Inicio" en "Personal" — Diseño

**Fecha:** 2026-09-20
**Disparador:** el PO pidió sacar el tab "Inicio" del tab bar y que la cuenta arranque directo en "Personal", migrando ahí el saludo y ciertos bloques de Inicio.

## Contexto

Hoy el tab bar tiene 5 pestañas: Inicio (`app/(tabs)/index.tsx`), Personal (`app/(tabs)/personal.tsx`), Amigos, Grupos, Actividad. Inicio es un resumen (saludo + deuda direccional simple + balance de grupos + preview de presupuesto personal + lista de tarjetas de grupo). Personal es el detalle de gastos/ingresos personales del mes (medidor de presupuesto, deuda direccional con nota ADR-006, movimientos del mes).

El PO decidió que esta duplicación de "resumen" (Inicio) + "detalle" (Personal) no vale la pena: quiere UNA sola pantalla de entrada, con el saludo de Inicio arriba y algunos de sus bloques insertados en Personal, y Personal ocupando el lugar de Inicio en el tab bar (sin renombrar el tab).

## Objetivo

Personal se convierte en la pantalla índice del tab group. Su header pasa a ser el de Inicio (título "Tus cuentas" + saludo "Hola, {nombre}"). Dos bloques de Inicio (deuda simple, balance de grupos) migran a posiciones puntuales dentro de Personal. Todo lo demás de Inicio que sea redundante con otro tab (lista de grupos, preview de presupuesto) se elimina. `index.tsx` se borra.

## Mecánica de ruteo (por qué se renombra el archivo, no solo el tab)

Expo Router resuelve `/(tabs)` (usado por `router.replace('/(tabs)')` en `app/_layout.tsx:85` tras login, y en `app/groups/join.tsx:91`) al archivo `index.tsx` del grupo de rutas. Si se borra `index.tsx` sin reemplazo, esas dos llamadas quedan sin destino.

**Solución:** el contenido de `personal.tsx` pasa a vivir en un archivo nuevo `app/(tabs)/index.tsx` (se borra el `personal.tsx` viejo). El componente se sigue llamando `PersonalScreen`. En `app/(tabs)/_layout.tsx`, la línea `screen('personal', t('tabs.personal'), 'analytics-outline')` se reemplaza por `screen('index', t('tabs.personal'), 'analytics-outline')` — mismo label, mismo ícono, nuevo nombre de archivo interno. `router.replace('/(tabs)')` y `router.replace('/(tabs)')` en `join.tsx` no necesitan tocarse: siguen resolviendo al mismo lugar, que ahora es Personal.

Ningún otro archivo del repo referencia `/(tabs)/personal` ni `/(tabs)/index` salvo el propio `index.tsx` viejo (que se borra) — verificado con grep antes de escribir este spec.

## Archivos afectados

- **Crear** `app/(tabs)/index.tsx` — contenido nuevo (ver "Contenido de la pantalla fusionada" abajo), a partir del `personal.tsx` actual.
- **Borrar** `app/(tabs)/personal.tsx` (viejo).
- **Borrar** `app/(tabs)/index.tsx` (viejo, Inicio).
- **Modificar** `app/(tabs)/_layout.tsx` — la entrada del tab bar (`screen('personal', …)` → `screen('index', …)`, mismo label `t('tabs.personal')`).
- **Modificar** `src/screens/__tests__/groupsScreen.test.tsx` — no se toca (no depende de Inicio/Personal).
- **Revisar** cualquier test existente de Inicio o Personal (`src/screens/__tests__/personalResumen.test.tsx` si existe, o los que importen `@/app/(tabs)/index` o `@/app/(tabs)/personal`) — el plan de implementación debe listarlos explícitamente y actualizar sus imports/expectativas.

## Contenido de la pantalla fusionada (de arriba abajo)

1. **Header fijo** (`TabHeader`): `title={t('dashboard.title')}` ("Tus cuentas"), `subtitle={t('dashboard.greeting', { name: firstName })}` ("Hola, {nombre}"). `firstName` se deriva de `currentUser.name` igual que en Inicio (`currentUser?.name?.split(' ')[0] ?? 'vos'`).
2. **`useHeaderPadding(0)`** en vez del `useHeaderPadding()` (aire por defecto) que usa Personal hoy — el bloque de deuda que pasa a ser el primer elemento queda pegado al header, igual que estaba pegado en Inicio (T-130).
3. **Bloque "Te deben / Debes"** (`SplitStat`, migrado de Inicio tal cual — sin el tercer número, sin la nota ADR-006): usa las claves `friends.owed_to_you` / `friends.you_owe`, calculado con `owedToYou`/`youOwe` que Personal ya deriva de `useDirectedDebts` (mismo dato, ya existe en el archivo, no se duplica el cálculo). Incluye el `pending`/`pendingLabel` igual que en Inicio.
4. **Fila de ajustes** (ícono de settings) — igual que Personal hoy, sin cambios.
5. **Navegador de mes** — igual que Personal hoy, sin cambios.
6. **Banda del medidor de presupuesto** (`hasBudget` / vacío) — igual que Personal hoy, sin cambios.
7. **`StatLead`** (Ingreso arriba, Gasto personal / Gasto en grupos abajo) — igual que Personal hoy, sin cambios, **punto de referencia** para el punto 8.
8. **Fila "Grupos · Balance"** (`Band sunken` + `Pressable` a `/(tabs)/groups`, migrada de Inicio): texto `t('dashboard.groups_balance')` + conteo de grupos, monto = `owedToYou - youOwe` (mismos valores del punto 3, reutilizados — no se recalcula con otro selector). El conteo de grupos (`{N} grupos`) requiere agregar a este archivo: `useGroupStore(st => st.groups)` + el mismo filtro que usaba Inicio (`groups.filter(g => !g.isDeleted && !!currentUser && g.memberIds.some(esYo))`), más el import de `esYo` desde `@/src/store/identityAlias`.
9. **Bloque de deuda de Personal** (`SplitStat` con `owed_to_me`/`i_owe`/`available_after_debts` + nota ADR-006) — **se mantiene, sin tocar, en su posición actual** (decisión explícita del PO: no se deduplica con el punto 3, aunque ambos muestren deuda direccional).
10. **`UnconvertedNotice`** de Personal — sin tocar (sigue cubriendo sólo los `pendientes` de gasto personal, no los de la fila 3/8 migradas; Inicio tenía su propio aviso para `pendientesFav`, que se descarta junto con el resto de Inicio no migrado).
11. **Sección de movimientos del mes** — igual que Personal hoy, sin cambios.

## Se elimina (no migra)

- La lista de tarjetas de grupos al final de Inicio (`misGrupos.map(HomeGroupRow)`) y su `SectionLabel` con el link "Nuevo grupo" — redundante con el tab Grupos completo.
- La banda-preview de presupuesto de Inicio (el `Band` con `Pressable` que mostraba `totalSpent`/medidor y navegaba a `/(tabs)/personal`) — redundante: esa navegación ya no tiene sentido, es la misma pantalla.
- El `SectionLabel` "Personal · {mes} · Ver mes →" de Inicio — era chrome para linkear a Personal desde Inicio; sin sentido en la pantalla fusionada.
- El componente `HomeGroupRow` de `index.tsx` (queda sin uso tras lo anterior).

## FAB

Sin cambios: la pantalla fusionada usa el `FabRow` de Personal tal cual (ingreso + gasto), que ya es más completo que el FAB único de Inicio ("Agregar gasto"). El FAB de Inicio no migra — desaparece con el resto del archivo.

## Testing

Tres archivos existentes referencian `@/app/(tabs)/index` o `@/app/(tabs)/personal` y quedan rotos por el rename (verificado con `grep -rln "app/(tabs)/index\|app/(tabs)/personal" src app --include="*.test.tsx" --include="*.test.ts"`). El plan de implementación debe actualizar cada uno puntualmente:

- **`src/screens/__tests__/personalResumen.test.tsx`** (línea 3): `import PersonalScreen from '@/app/(tabs)/personal'` pasa a `import PersonalScreen from '@/app/(tabs)/index'`. Es un cambio de import únicamente — el componente sigue llamándose `PersonalScreen` y su comportamiento no cambia (mock de `expo-router` y setup de stores quedan iguales).
- **`src/__tests__/tabHomeCuentas.test.ts`** (líneas 15-41): lee el código fuente de `app/(tabs)/_layout.tsx` y de `app/(tabs)/index.tsx` como texto plano para verificar la etiqueta de la tab (`tabs.home`, ícono `home-outline`) y el título de la pantalla (`dashboard.title`). Tras la fusión, `screen('index', …)` usa `t('tabs.personal')` en vez de `t('tabs.home')` (spec, sección "Mecánica de ruteo"), así que las aserciones sobre `tabs.home`/`home-outline` en la línea de `_layout.tsx` dejan de ser válidas y deben reescribirse para esperar `t('tabs.personal')` + el ícono `'analytics-outline'`. La aserción sobre `dashboard.title` en `index.tsx` (línea 38, ahora el contenido fusionado) sigue siendo correcta tal cual — el header migra wholesale e incluye ese `t('dashboard.title')`.
- **`src/screens/__tests__/campanaEnTodasLasTabs.test.tsx`** — este es el caso no trivial: trata a Inicio y Personal como DOS pantallas separadas bajo test. El array `TABS` (líneas 51-58) tiene una fila `['Cuenta', () => require('@/app/(tabs)/index').default]` y otra `['Personal', () => require('@/app/(tabs)/personal').default]`; tras el rename, el segundo `require` no existe más. Además hay tres `require('@/app/(tabs)/index').default` sueltos (líneas 87, 96, 107) usados junto con `Actividad` para probar que dos tabs montadas a la vez comparten el mismo contador de avisos. **Ajuste requerido:** eliminar la fila `['Personal', …]` del array `TABS` (ya no hay una pantalla separada que cargar en esa ruta — es la misma que `Cuenta`/`index`), dejando `TABS` con 5 entradas en vez de 6. Los tres `require('@/app/(tabs)/index').default` sueltos no cambian: siguen apuntando al archivo correcto, que ahora contiene el contenido fusionado, y el comportamiento que prueban (badge de avisos compartido entre `Cuenta` y `Actividad`) no depende de qué haya dentro de Personal.

Cobertura nueva a agregar (en el plan de implementación, sobre el archivo fusionado): el header muestra "Tus cuentas"/"Hola, {nombre}"; la fila "Te deben/Debes" aparece arriba de todo; la fila "Grupos · Balance" aparece después del `StatLead` y antes del bloque de deuda de Personal; navegar desde esa fila lleva a `/(tabs)/groups`.

## Global Constraints

- Lint baseline (124/0), `tsc --noEmit` limpio y la suite de Jest completa en verde se mantienen — el rename no puede introducir warnings nuevos ni romper tests que sigan siendo válidos.
- No se toca el store, los selectores (`useDirectedDebts`, `useGlobalPersonBalances`), ni ningún algoritmo — es un cambio de composición de pantalla, no de lógica de negocio.
- No se agregan dependencias nuevas.
