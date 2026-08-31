# ADR-006 · Qué es una deuda, qué es un gasto y qué significa saldar

**Estado:** ACEPTADO — decisiones del PO, 2026-08-30
**Reemplaza:** el modelo de saldo neteado que regía hasta hoy
**Origen:** bug con repro real (T-051) + especificación del PO

---

## Contexto

Hasta hoy el saldo entre dos personas era un **neto**: si en el grupo A yo le debía 5.000
y en el B él me debía 5.000, el modelo decía "cero". `simplifyDebts` consolidaba todos los
grupos y devolvía una sola cifra por par de personas.

Eso produjo un bug real: saldando desde Contactos, el monto ofrecido era el neto global
—de todos los grupos— mientras que el pago se registraba contra **un solo grupo**
(`app/settle/new.tsx:89-90`, `friends.tsx:161`). Un pago que cubría deudas de dos grupos
entraba entero en uno: globalmente cerraba y los dos grupos quedaban con saldos que nadie
había generado.

El bug se frenó acotando el techo del saldo a la deuda del grupo (commit `e0e792b`). Este
ADR define el modelo que reemplaza al neteo.

---

## Decisión 1 · Saldar es DIRECCIONAL

> Que yo salde mis cuentas con alguien significa que **yo no le debo más**. Lo que esa
> persona me debe **queda intacto** hasta que ella salde lo suyo.

Una deuda mía y una deuda suya son dos hechos distintos, no dos signos de un mismo número.
Compensarlas automáticamente decide por los dos que están de acuerdo en cancelarse —y
puede que uno haya pagado y el otro no.

**Consecuencia:** el neteo deja de ser el modelo de deuda. `simplifyDebts` sigue siendo
útil como **sugerencia** de cómo cerrar un grupo con menos transferencias, pero no puede
seguir siendo lo que define cuánto debe alguien.

## Decisión 2 · Se salda A UNA PERSONA, y por el total

> Se rinde a una persona. En un grupo, si rendís, tenés que rendir el total sí o sí. Si hay
> más de un involucrado y el usuario no puede cubrir el máximo, elige cuánto le da a cada
> uno: puede ser todo por igual, o lo que quiera a quien quiera.

- El saldo tiene **destinatario**: no se "salda un grupo" en abstracto.
- Con **un solo acreedor**, se salda el total. No hay pago parcial encubierto.
- Con **varios acreedores** y sin plata para todos, el usuario **reparte explícitamente**.
  La app puede ofrecer "todo por igual" como atajo, pero **no elige por él**: repartir plata
  entre acreedores es una decisión de la persona, no una regla de negocio.

**Consecuencia:** el reparto automático entre grupos que se había planteado **queda
descartado**. La app nunca decide sola a quién se le paga.

## Decisión 3 · Qué cuenta como gasto propio

> Saldar suma a lo gastado. Si uno realizó el gasto y lo divide, lo está haciendo uno. Si
> otro hizo el gasto y yo lo debo, yo lo hago cuando saldo mi deuda.

El gasto propio es **la plata que salió de mi bolsillo**, no mi porción teórica de una
compra ajena:

| Hecho | Efecto en MI «gastado» |
|---|---|
| Pago un gasto de 1.000 y lo divido | **+1.000** — la plata la puse yo, entera |
| Otro paga y me toca una porción de 500 | **nada todavía** — no salió plata mía |
| Saldo esos 500 | **+500** — recién ahora gasté |
| Alguien me salda 300 | **ingreso de 300**, no un gasto negativo |

Las cuentas cierran: en una compra de 1.000 dividida entre dos, el que pagó registra 1.000
y recupera 500 como ingreso (neto 500), y el otro registra 500 al saldar. Total gastado
entre los dos: 1.000. Exacto.

**Consecuencia grande:** `group_replicated` hoy replica **mi porción** de un gasto de grupo
como movimiento personal. Bajo esta regla eso está mal en los dos sentidos —cuenta plata
que no salió si pagó otro, y cuenta de menos si pagué yo—. Hay que replicar **lo que
realmente pagué**, y que la deuda entre a «gastado» recién al saldarse.

## Decisión 4 · Qué es editable

> Un movimiento personal que provenga de una acción del usuario, no del efecto de otra
> acción, debe poder ser editable.

Cada movimiento personal declara su **origen**:

- `manual` — lo cargó la persona. **Editable.**
- derivado (la réplica de un gasto de grupo, un saldo registrado) — **no editable**.

Editar un derivado lo desincronizaría de su origen sin forma de reconciliarlos: quedaría un
movimiento que dice una cosa y un gasto de grupo que dice otra, sin nadie que pueda decidir
cuál vale. Se corrige el origen, y el derivado sigue.

## Decisión 5 · Todo saldo se registra y se avisa

- Todo saldo de deuda queda **registrado como movimiento**.
- Al deudor le llega **notificación** cuando le registran un saldo. Hoy `syncNotices` no
  contempla pagos: hay que agregar el tipo.

---

## Lo que hay que cambiar

1. `calculateBalances` / `useGlobalPersonBalances` / `useGroupsTotalBalance`: dejar de netear
   como definición de deuda; exponer **lo que debo** y **lo que me deben** por separado.
2. `app/settle/new.tsx`: destinatario obligatorio, total por persona, reparto explícito con
   varios acreedores.
3. `personalStore`: campo de **origen** en cada movimiento + regla de editabilidad.
4. `group_replicated`: replicar lo pagado, no la porción.
5. Personal: indicador de **cuánto me deben / cuánto debo**, separado de «lo gastado».
6. `syncNotices`: aviso de saldo al deudor.

## Riesgo asumido

El punto 4 cambia el significado de movimientos personales **que ya existen** en los
dispositivos del PO. Los datos viejos se calcularon con la regla anterior. Migrarlos o
dejarlos como están es una decisión pendiente y **no debe resolverse en silencio**.

---

decidido por · PO · 2026-08-30
