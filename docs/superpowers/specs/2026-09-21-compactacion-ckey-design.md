# Compactación por rebanada (ckey) + fotos por referencia — Design

**Estado:** Aprobado por el PO — 2026-09-21
**Implementa:** `docs/ADR-007-el-estado-vive-en-el-buzon.md` (ACEPTADO), con P-11/P-12/P-13 resueltas
**Origen:** T-058 de fondo — el límite de 450 gastos/grupo (ya en `main`) es un parche de producto; este spec es el arreglo estructural del techo de sync.

---

## 1 · Qué resuelve

El buzón (relay Supabase) tiene un tope duro de payload por sobre (~196 KB de JSON, ver ADR-007 §1). Hoy cada publicación manda el **estado completo del grupo** en un sobre — un grupo de 5 personas con ~160-200 gastos lo cruza y **deja de sincronizar para siempre, en silencio**. El límite de 450 gastos/grupo evita que un grupo nuevo se acerque a ese techo, pero no lo elimina: cualquier grupo que llegue al límite necesita traspasarse manualmente.

Este spec implementa ADR-007: partir el estado en **rebanadas** (slices) que cada dispositivo publica por separado, más un **manifiesto** que declara qué rebanadas cubre cada emisor. Con eso, publicar un gasto nuevo ya no reenvía el grupo entero, y el techo de tamaño deja de depender de cuántos gastos tiene el grupo.

Se suma una segunda mejora, aprobada en la misma sesión: las fotos de usuario (`avatarUrl`) dejan de viajar dentro de cada rebanada — se referencian por hash y se piden aparte, bajo demanda.

## 2 · Decisiones heredadas de ADR-007 (no se repiten aquí en detalle — ver el ADR)

- Rebanadas por tipo de entidad primero, después por prefijo de `id`, profundidad elegida por el emisor según tamaño (objetivo ~24 KB, tope duro 96 KB de JSON).
- `ckey = HMAC(GK, tipo ‖ prefijo)` truncada — opaca para el servidor, igual que `topic`.
- Manifiesto: sobre chico con `version` distinta de 1 (los lectores viejos lo ignoran vía el guard existente de `applyDelta`/`useSyncQR.ts:123`), listando `ckey`s cubiertas + digest de cada rebanada.
- Renovación: republicar toda rebanada con más de 20 días desde su última publicación, registro local en MMKV (`ckey → última publicación`). **Aclaración post-implementación (revisión final):** al cierre de este plan sólo está en vivo la MITAD de este mecanismo — el registro (`recordSlicePublished`, en cada publicación real) sí está enganchado en `publishToGroup`. El CHEQUEO periódico de rebanadas vencidas (`staleSliceCkeys`) existe como primitiva pura, probada, pero nada lo invoca todavía en un ciclo automático — no hay timer ni chequeo en el poll de `relayEngine.ts` que dispare una republicación por vencimiento. No leer esta sección como "el auto-sanado a 20 días ya funciona en producción": funciona el registro, no el chequeo automático. Enganchar un scheduler queda diferido a una decisión de producto del PO sobre la cadencia de chequeo (mismo diferimiento que ya documenta el plan, Task 8 paso 5).
- Migración de servidor: 1 sola, `supabase/010_ckey_compaction.sql`, agrega `ckey text` nullable a `envelopes`, cambia el trigger de compactación para incluir `and ckey is not distinct from new.ckey`, reemplaza el índice de compactación. Cero borrado/reescritura de filas existentes. **Se aplica ANTES que el build de la app** (orden obligatorio, ADR-007 §5).
- Compatibilidad: sin flag day. Un emisor viejo (sin `ckey`, sin manifiesto) sigue funcionando exactamente como hoy; un lector viejo mergea las rebanadas nuevas como deltas normales e ignora el manifiesto.

## 3 · Resoluciones de esta sesión

### 3.1 · P-11 — TTL del buzón: estado desconocido, tratar como apagado

El PO no pudo confirmar si `purge_expired_envelopes()` corre en Supabase (no hay cron versionado en el repo). **Mientras no se confirme, la implementación asume que el TTL puede no estar corriendo** — no cambia el diseño (la renovación de §3.4 de ADR-007 sigue siendo obligatoria igual), pero sí la prioridad: no depender del TTL para acotar el crecimiento de filas del buzón como aliviador de emergencia. Acción fuera de este spec: el PO verifica el cron en el panel de Supabase antes o durante el rollout.

### 3.2 · P-12 — Manifiesto incompleto: aviso visible, no bloqueo

Cuando `drainGroup` arma el estado de un grupo y detecta que el manifiesto de algún emisor declara una `ckey` que nunca llegó (o llegó con un digest que no coincide), el grupo se sigue mostrando con los datos que hay, pero:

- Se guarda un flag por grupo (`manifiestoIncompleto: boolean`, o lista de `ckey`s faltantes) en el mismo lugar donde hoy vive el estado de `publishHealth`/`too_large` (T-058).
- La UI muestra un cartel sobre el balance del grupo: **"Faltan datos de un miembro. Los balances pueden estar incompletos."** — mismo componente visual que el aviso de `too_large` ya implementado, para no introducir un patrón nuevo.
- No bloquea gastos nuevos, no bloquea el uso offline. Es aviso, no bloqueo (igual que se decidió para `too_large`).

### 3.3 · P-13 — Prenda de escritura extendida a `ckey`

`supabase/008_owner_tag.sql` ya resuelve el mismo problema para `(topic, sender)`: en vez de que el servidor confíe en un `sender` elegido libremente por el cliente, cada sobre compactable viaja con `owner_proof = sha256(secreto)`, el servidor lo vuelve a hashear con un trigger `before insert` (`stamp_owner_tag()`) y usa `owner_tag = sha256(sha256(secreto))` como clave real de compactación/borrado. El cliente nunca puede fabricar la tag de otro sin conocer su secreto, y el servidor nunca ve ni guarda el secreto en tránsito.

**Extensión para R′:** el secreto de la prenda pasa a derivarse por rebanada, no solo por dispositivo — `secreto_rebanada = HMAC(secreto_dispositivo, ckey)` (o equivalente; el detalle exacto lo fija el task del plan que toque `envelopeSign.ts`/`relaySync.ts`). El `owner_tag` que el servidor calcula queda entonces scoped a `(topic, ckey)` en vez de solo a `(topic)`, y la migración de compactación (§2) borra por `(topic, owner_tag, ckey)` en vez de `(topic, owner_tag)`.

Esto cierra el riesgo 1 de ADR-007 §8 de raíz: nadie puede borrar la rebanada legítima de otro emisor sin conocer el secreto de esa rebanada específica, y el mecanismo es el mismo hash de compromiso ya probado en producción (T-087/ADR-009) — no criptografía del lado del servidor, no reabre ADR-003.

**Costo:** un `sha256` adicional por rebanada publicada, en cliente y servidor. Órdenes de magnitud más barato que `ed25519.verify` (37,57 ms medidos), que sigue siendo el techo real de cuántas rebanadas conviene usar (ADR-007 §3.2). No cambia el presupuesto de tamaño del sobre de forma apreciable (un hash hex son 64 bytes).

### 3.4 · Fotos de usuario por referencia (extensión sobre ADR-007 §3.1)

Hoy `avatarUrl` viaja completo en cada rebanada de `users`, incluso cuando nadie lo tocó (hallazgo menor de T-058, ADR-007 §9 confirma que sacar las fotos solo no alcanza — pero via referencia sí ayuda al costo por edición).

**Diseño:**
- La rebanada de `users` deja de llevar el blob de la foto. Lleva `{userId, avatarHash, avatarVersion}` por miembro — unos pocos bytes.
- El blob de la foto se publica en un **topic separado**, direccionado por `HMAC(GK, 'avatar' ‖ userId ‖ avatarHash)` — mismo mecanismo de derivación opaca que ya usa `ckey`/`topic` (`envelopeCrypto.ts:34-47`), así el relay no correlaciona "quién le cambió la foto a quién" más de lo que ya puede.
- Un dispositivo que ve un `avatarHash` que no tiene localmente en caché lo pide en el próximo ciclo de sync normal (no hace falta un mecanismo de push nuevo — ya hay sync automático al abrir la app, al recuperar internet, y cada 15 min en primer plano, regla #10 de CLAUDE.md).
- Mientras no llegó, se muestra el avatar cacheado anterior (o el placeholder por defecto si nunca hubo uno) — nunca un estado roto.
- **No hace falta un botón de refresh manual** para el camino feliz: el fetch es automático. Se puede agregar un tap-to-retry sobre el avatar como fallback silencioso si el fetch automático falla repetidamente, pero no es parte del criterio de aceptación de este spec — es un nice-to-have que el plan puede omitir sin reabrir esta decisión.

## 4 · Testing

- **Rebanadas y manifiesto:** tests con el arnés de medición ya usado en T-056 (stores sembrados → `buildGroupPayload` → rebanado → `sealEnvelope`), verificando que (a) ningún sobre individual supera el tope duro de 96 KB de JSON declarado en ADR-007 §3.1, (b) la unión de rebanadas de un emisor reconstruye el mismo estado que el `buildGroupPayload` de hoy, (c) un manifiesto con una `ckey` faltante dispara el flag de incompleto, (d) el escenario de 200 gastos / 5 miembros (el que hoy falla con `too_large`) ahora publica sin error.
- **Compatibilidad:** un lector con la versión vieja de la app sigue mergeando rebanadas nuevas como deltas normales (test explícito reproduciendo la tabla de compatibilidad de ADR-007 §5).
- **Prenda por ckey:** test que reproduce el ataque descrito en P-13 — un tercero que conoce el `topic` pero no el secreto de la rebanada intenta insertar un sobre con `ckey`/`sender` ajenos y falla en borrar la rebanada legítima. Test de regresión de que un emisor legítimo republicando su propia rebanada sí compacta correctamente.
- **Manifiesto incompleto → UI:** test de que el cartel aparece cuando falta una `ckey` declarada y desaparece cuando llega.
- **Fotos por referencia:** test de que cambiar el avatar de un usuario no reenvía la rebanada de `expenses`; test de que un dispositivo con un `avatarHash` desconocido lo resuelve en el siguiente ciclo de sync; test de que mientras no llega, se sigue mostrando el avatar cacheado sin roturas visuales.
- **Renovación (§3.4 de ADR-007):** test de la primitiva pura `staleSliceCkeys` (qué ckeys cuentan como vencidas dada una ventana y un `now`) y de que `recordSlicePublished` se engancha en cada publicación real. **No existe** (ni se implementó) un test de "se republica sola en el siguiente ciclo de sync" — ese comportamiento requiere un scheduler que invoque `staleSliceCkeys` periódicamente, y ese scheduler está diferido (ver aclaración en §2 y el punto correspondiente en el plan, Task 8 paso 5).

## 5 · Fuera de alcance de este spec

- Confirmar si el TTL de 30 días está corriendo en Supabase (acción del PO, no de este spec — ver §3.1).
- Rotación de época de grupo (`groupKeyStore.ts` sigue en `epoch: 1` fijo) — ADR-007 §4 ya anota que la obligación de "publicar todas las rebanadas al rotar" solo aplica cuando la rotación exista. No se implementa acá.
- Invertir el orden verificar-firma-antes-que-descifrar en `drainGroup` (riesgo 6 de ADR-007 §8) — requiere medición propia y es una decisión de seguridad separada. Se deja anotada, no se resuelve en este spec.
- Botón de refresh manual sobre el avatar (ver §3.4) — nice-to-have, no criterio de aceptación.
