# Motor de sync reutilizable — diseño (segunda opinión, orquestador)

**Fecha:** 2026-09-28 · **Estado:** borrador para el PO, sin commitear · **Ticket:** T-206
**Complementa:** la auditoría del arquitecto (`2026-09-28-sync-extraible-design.md`). Donde difieran, se cruzan y decide el PO.

## Decisiones del PO (brainstorming 2026-09-28)

| # | Pregunta | Decisión |
|---|---|---|
| D1 | ¿Para qué otras apps? | Apps propias con datos por grupo, offline-first, servidor tonto. **No** hay migración a Jazz: se mejora este motor (T-190 cancelado; Jazz sigue como referencia de diseño). |
| D2 | ¿Cifrado opcional? | **Siempre puesto.** El tema, la ckey y la firma del sobre nacen de la clave del grupo. No existe modo sin cifrar. |
| D3 | ¿Modelo de datos? | **Documento genérico**: `Record<campo, {id}[]>` con orden de dependencia declarado por la app. El **merge es de la app** (HushSplit conserva `mergeLevels`, firmas por registro y LWW). |
| D4 | ¿Alcance del motor? | **Sólo sobres y cubos**: publicar, drenar, manifiesto, ledger, receptor con memoria, relectura, cola por topic. Contactos, invitaciones y confianza de autoría quedan como capas de HushSplit, en carpetas propias. |

## 1. Qué es el motor (en una frase)

Un cliente que publica el **estado completo** de un documento cifrado en un buzón tonto, cortado en **cubos estables por id**, mandando **sólo lo que cambió**, y que del otro lado **recuerda qué aplicó** para no perder nada ni releer de más.

## 2. Frontera: motor vs. app

```
┌──────────────────────── app (HushSplit) ────────────────────────┐
│ stores · merge por niveles · contactos · invitaciones · confianza │
│ avisos · i18n · pantallas · Supabase · MMKV · identidad           │
│                                                                   │
│   implementa los PUERTOS ──────────────┐                          │
└────────────────────────────────────────┼──────────────────────────┘
                                         ▼
┌──────────────────────── motor (paquete) ────────────────────────┐
│ puertos: Transporte · Almacen · Identidad · ClavesDeGrupo ·       │
│          Documento · Reloj · Log · Avisos                         │
│ núcleo:  sobre (cifrar+firmar) · cubos · digest · manifiesto ·    │
│          ledger · rebanadas aplicadas · relecturas · cierre       │
│ motor:   publicar (cola por topic, timeout+abort) · drenar        │
│          (páginas, retenidas, cupo) · relectura · cursor ·        │
│          pendiente de drenaje · fallos de aplicación              │
└───────────────────────────────────────────────────────────────────┘
```

**Regla única:** nada bajo `motor/` importa `@/src/store`, `@/src/types/models`, `@/src/services`, `expo-*`, `@supabase/*`, `react`, `react-native` ni i18n. Guard: `relayFrontera.guard.test.ts` pasa de lista cerrada a **barrido del directorio `motor/`** (todo lo que esté ahí cumple).

## 3. Puertos (lo que la app entrega)

```ts
// Transporte: el buzón tonto. Hoy: Supabase (relayClient/relaySend/fetchSince/subscribeTopic).
interface Transporte {
  publicar(topic: string, sobre: SobreFirmado, ownerTag: string, ckey: string, signal?: AbortSignal): Promise<ResultadoEnvio>;
  leerDesde(topic: string, cursor: number, limite: number): Promise<ResultadoLectura>; // sobres con seq > cursor
  borrarMios(topic: string): Promise<ResultadoBorrado>;
  suscribir(topic: string, alLlegarNovedad: () => void, alCambiarEstado?: (ok: boolean) => void): () => void;
}

// Almacén local con scope por cuenta. Hoy: MMKV vía userScope.
interface Almacen { get(k: string): string | undefined; set(k: string, v: string): void; delete(k: string): void; }

// Identidad del dispositivo (firma de sobres). Hoy: identityStore.
interface Identidad { deviceId(): string; ownerTag(): string; clavePrivadaFirma(): Uint8Array; clavePublicaFirma(): string; }

// Claves de grupo por epoch. Hoy: groupKeyStore.
interface ClavesDeGrupo { actual(groupId: string): { key: Uint8Array; epoch: number } | null; }

// Documento: lo que la app sabe de sus datos. Hoy: adaptadorHushSplit.
interface Documento<Delta> {
  campos: readonly string[];                                  // en orden de dependencia
  armar(groupId: string): Record<string, { id: string }[]>;   // estado completo local del grupo
  envolver(campo: string, registros: { id: string }[]): Delta; // JSON determinista lo hace el motor
  acotar(delta: Delta, groupId: string): { delta: Delta; descartes: { porTope: number; porDependencia: number } };
  aplicar(delta: Delta): void;                                // merge de la app
  antesDePublicar?(doc: Record<string, { id: string }[]>, ctx: { groupId: string; deviceId: string }): Promise<Record<string, { id: string }[]>>;
}

// Utilidades inyectadas.
interface Reloj { ahora(): number; }
interface Log { error(mensaje: string, detalle?: unknown): void; }
interface Avisos { manifiestoIncompleto(groupId: string, faltantes: string[]): void; publicacionFallida?(groupId: string, motivo: string): void; }
```

Lo que el motor devuelve a la app: `publishToGroup(groupId)`, `drainGroup(groupId, sinceSeq, opts)`, `deleteMyGroupEnvelopes(groupId)`, `olvidarGrupo(groupId)` (ledger + aplicadas + cursor), y los tipos de resultado.

## 4. Carpetas propuestas (para una persona)

```
src/sync/
  motor/                 ← candidato a paquete. Nada de acá importa la app.
    puertos.ts           ← las interfaces de §3
    sobre/               envelopeCrypto, envelopeSign, hexBytes, topes
    cubos/               cubos, manifest, sliceLedger, appliedSlices, publicarCubos
    drenaje/             drenar, drenarTypes, abrirSobre, chequeoManifiesto, cierreDeDrenaje,
                         relectura, relecturas, drainFailures, pendingDrain, cursor
    publicacion/         publicar (cola por topic, timeout+abort), relayNetworkTimeout
    README.md            ← §7 de este doc
  adaptadores/           ← implementaciones de los puertos para HushSplit
    supabase/            relayClient, relaySend, relayErrors, relay (fachada), relaySession, relaySessionStorage, sessionStatus
    almacen/             (userScope vive en store; acá el puente `almacen`)
    documento/           adaptadorHushSplit, applyDelta, acotarDeltaAlGrupo, aplicarAcotado, soloLocal, derivedRecords, claveVigente
    identidad/           deviceKeys, devicePrivateKey, ownerPledge
  motorApp/              ← ciclo de vida de HushSplit sobre el motor
    relayEngine (fachada), relay/poll, relay/drain, relay/publish, relayQueue, cederHilo, avatarTopic, sliceRenewal (fotos)
  contactos/             contactChannel, contactPeers, contactGroupKeyDrop, contactTopic, contactInvite, contactInviteEngine, relay/contactos, groupKeyOffers, keyConflictNotice
  invitaciones/          groupInvite, groupKeyWrap, inviteEngine, inviteAdmit, relay/invitaciones, leaveApprovalCore, leaveApprovalSign
  confianza/             recordCore, recordSign, signOnWrite, trustCheck, autoriaTrust, authorHealth, authorKeys*, verdictCache, recordHealth*, ratchet
  entrada/               accountEntry, directoryAuth, captchaBridge, turnstileHtml   (¿es auth, no sync? decidir con el arquitecto)
  avisos/                syncDownNotices, clockNotice, publishHealth, manifestHealth, useManifestGap, useSyncFailure
```

**Mudanza sin romper:** un script `git mv` + `sed` de rutas en imports y `jest.mock`, suite completa, un solo commit por carpeta. Sin fachadas de compatibilidad: no hay consumidores externos y las fachadas son deuda. Los guards (`relayModulos`, `relayFrontera`, `inventarioDeAvisos`, `accountCoverage`) se actualizan a rutas nuevas en el mismo commit.

## 5. Qué le falta hoy al motor para vivir solo (violaciones de frontera conocidas)

| Módulo | Importa de la app | Puerto que lo reemplaza | Costo |
|---|---|---|---|
| `relay/publicar.ts` | `groupKeyStore`, `identityStore`, `errorLog`, `adaptadorHushSplit` | ClavesDeGrupo, Identidad, Log, Documento | medio |
| `relay/drenar.ts` | `authStore` (sesión al arrancar), `groupKeyStore`, `authorHealth`/`authorKeys` (confianza), `errorLog` | ClavesDeGrupo, Log; la confianza sale del drenaje y pasa a `Documento.acotar` | medio |
| `relay/aplicarAcotado.ts` | `userStore` (avatares), `avatarTopic` | hook `Documento.despuesDeAplicar?` | chico |
| `relay/cursor.ts`, `pendingDrain.ts`, `sliceLedger`, `appliedSlices` | `userScope`/MMKV | Almacen | chico (ya inyectado en ledger/aplicadas) |
| `drainFailures.ts` | `errorLog` | Log | chico |
| `relay/relectura.ts` | `fetchSince`, `verifyEnvelope` directo | Transporte | chico |

Los dos «medio» son el trabajo real de la etapa B. Todo lo demás es mecánico.

## 6. Hoja de ruta

| Etapa | Qué | Cambio de comportamiento | Costo | Cuándo |
|---|---|---|---|---|
| A | Carpetas de §4 + segunda poda + README en `motor/` | ninguno | 1 día de agente | ahora |
| B | Puertos de §3; `motor/` deja de importar la app; guard por directorio | ninguno (mismos tests) | 2-3 días | ahora, después de A |
| C | `packages/relay-sync` en el mismo repo, la app lo consume por alias `@hushsplit/relay-sync`; tests del motor con adaptadores en memoria | ninguno | 1-2 días | cuando exista la segunda app |
| D | Publicar en npm | — | — | no por ahora (D1: apps propias) |

## 7. README del motor (borrador completo)

---

# @hushsplit/relay-sync

Sincronización cifrada de extremo a extremo, offline-first, con un servidor que no puede leer lo que guarda.

## Qué resuelve

Tenés una app donde varias personas comparten datos por «grupo» (una lista, un presupuesto, un inventario) y no querés un backend que entienda esos datos. Este motor publica el estado de cada grupo, cifrado y firmado, en un buzón tonto, y lo trae de vuelta a cada dispositivo sin perder registros aunque la red se corte, el buzón compacte o los sobres lleguen en cualquier orden.

## Modelo de amenaza

- El servidor guarda sobres opacos por `(topic, owner, ckey)`. No conoce la clave del grupo ni puede vincular un topic con un grupo.
- Quien tiene la clave del grupo es miembro. **No hay protección contra miembros maliciosos**: un miembro puede escribir cualquier registro de su grupo. Si tu app necesita eso, lo agrega encima (ver «qué no incluye»).
- Cada sobre va firmado por el dispositivo que lo publica; un sobre con firma inválida se descarta.

## Cómo funciona, en cinco líneas

1. El documento del grupo se parte en **cubos** por prefijo del id de cada registro. Un registro siempre cae en el mismo cubo.
2. Cada cubo se serializa de forma **determinista** y se firma con un hash. Se publica sólo el cubo cuyo hash cambió, más un **manifiesto** con todos los hashes.
3. El buzón **compacta**: por cada `(topic, owner, ckey)` queda el último sobre. Así el buzón siempre contiene el estado completo del grupo.
4. El receptor aplica lo que llega y **recuerda** qué cubos aplicó con qué hash. Un manifiesto que declara algo que no tiene dispara **una** relectura del buzón, no un bucle.
5. Un registro que depende de otro que aún no llegó (un comentario sin su gasto) se **retiene** y el cursor no lo pasa hasta que se resuelve o agota su cupo.

## Garantías

- **Ningún registro se pierde** por orden de llegada, paginación, corte de red a mitad de publicación ni publicaciones concurrentes del mismo dispositivo (cola por topic, cancelación real por timeout).
- **Quien entra tarde ve todo**: el buzón contiene el estado completo, no un delta.
- **El buzón no crece sin límite**: un cubo que se vacía se publica como `[]` y se compacta.
- **Idempotencia**: aplicar dos veces el mismo cubo da el mismo resultado (el merge lo garantiza la app).

## Límites conocidos

- Un dispositivo que deja de publicar más de 30 días pierde sus sobres por TTL; los demás siguen teniendo su copia local, pero quien entre nuevo verá una «falta» hasta que ese dispositivo vuelva a publicar. (Renovación automática a los 20 días de cada cubo sin cambios.)
- Una dependencia que nunca se resuelve retiene el cursor 3 drenajes por sesión y después se descarta con rastro.
- Dos cuentas en el mismo dispositivo y el mismo grupo comparten ranura en el buzón.
- Un servidor que tarda más de 15 s en confirmar y comete después de una publicación más nueva puede dejar un cubo viejo hasta que cambie o se renueve.

## Lo que tu app tiene que implementar (los puertos)

| Puerto | Qué es | Ejemplo |
|---|---|---|
| `Transporte` | publicar / leer desde un cursor / borrar los míos / suscribir | Supabase con 3 RPC y Realtime; también sirve cualquier tabla append-only con `seq` |
| `Almacen` | get/set/delete de strings, con scope por cuenta | MMKV, AsyncStorage, localStorage |
| `Identidad` | id de dispositivo, etiqueta de dueño, par Ed25519 | generado al primer arranque, guardado en keychain |
| `ClavesDeGrupo` | clave XChaCha20 + epoch por grupo | tu propio reparto de claves (QR, link, canal de contactos) |
| `Documento` | campos en orden de dependencia, armar, envolver, acotar, aplicar | tus stores y tu merge |
| `Reloj`, `Log`, `Avisos` | utilidades | `Date.now`, tu logger, tu bandeja de avisos |

### Ejemplo mínimo

```ts
import { crearMotor } from '@hushsplit/relay-sync';

const motor = crearMotor({
  transporte: transporteSupabase(supabase),
  almacen: almacenMMKV(cuentaActual),
  identidad: identidadDelDispositivo(),
  clavesDeGrupo: { actual: (g) => misClaves.get(g) },
  documento: {
    campos: ['items', 'notas'],                    // notas depende de items
    armar: (g) => ({ items: itemsDe(g), notas: notasDe(g) }),
    envolver: (campo, registros) => ({ v: 1, campo, registros }),
    acotar: (delta, g) => ({ delta: soloDelGrupo(delta, g), descartes: contarHuerfanos(delta) }),
    aplicar: (delta) => mergeLWW(delta),
  },
  reloj: { ahora: Date.now },
  log: console,
  avisos: { manifiestoIncompleto: (g, faltan) => marcarIncompleto(g, faltan) },
});

await motor.publishToGroup('grupo-1');               // 2 sobres si cambió un cubo
const r = await motor.drainGroup('grupo-1', cursor); // r.cursor, r.completo, r.applied
```

## Lo que NO incluye (y cómo lo hace HushSplit)

- **Reparto de claves de grupo**: cómo llega la clave a un miembro nuevo. HushSplit usa invitación por link o QR con la clave envuelta, y un canal de contactos cifrado para reenviarla.
- **Roster y membresía**: quién está en el grupo. HushSplit lo guarda como un campo más del documento (`miembros` por LWW) y deriva el roster.
- **Confianza por registro**: firmar cada registro con la clave de su autor y rechazar reescrituras ajenas. HushSplit lo hace en su `acotar`.
- **Merge**: LWW, CRDT, niveles. Es tuyo, en `aplicar`.
- **UI y avisos**: el motor sólo reporta; qué mostrar es de la app.

## Qué podés construir con esto (ideas)

- Lista de compras o tareas compartida entre pocas personas, sin cuenta en un servidor propio.
- Diario o álbum privado de pareja o familia: fotos por referencia con hash (como los avatares de HushSplit).
- Inventario de un club, un grupo scout, una banda: quién tiene qué prestado.
- Presupuesto compartido de un viaje, con el mismo esquema de gastos y pagos.
- Notas de reunión de un equipo chico que no quiere Notion.
- Registro de mantenimiento de algo compartido (un auto, un departamento alquilado).
- Cualquier «documento por grupo» de menos de unos miles de registros donde la privacidad importe y el backend no.

## Sugerencias al integrar

- Diseñá el documento con **ids estables y únicos** (UUID v4) desde el primer día: son la base de los cubos.
- Declarar bien el **orden de dependencia** entre campos evita retenciones: primero lo que otros referencian.
- `acotar` es tu lugar para **validar**: tamaño, pertenencia al grupo, autoría. El motor no juzga contenido.
- Empezá con **un transporte en memoria** para tests: el motor no sabe si es Supabase o un array.
- Si la app tiene fotos, mandalas **por referencia** (hash en el registro, blob en otro topic), no dentro del cubo.
- Publicá desde una **cola con debounce** por grupo (HushSplit usa 1,5 s) para no mandar un sobre por tecla.

## Versionado

- Formato del sobre y `MANIFEST_VERSION` son el contrato. Cambiarlos rompe a todos los dispositivos con sobres viejos en el buzón; por eso se versionan y el receptor descarta lo que no entiende con rastro.
- Semver: mayor = cambio de formato; menor = puertos nuevos opcionales; parche = todo lo demás.

---

## 8. Riesgos y qué decide el PO

- **Etapa A ahora** mueve ~85 archivos: un día de agente, cero comportamiento, pero conviene hacerla con la app estable (después de las builds de tienda o antes: decidir).
- **Etapa B** toca el drenaje y la publicación, las dos zonas donde vivieron los 9 defectos de T-191. Va con verifier.
- **La confianza de autoría dentro del drenaje** (`observeAuthor` en `drenar.ts`) es la decisión de diseño más grande: sacarla al `acotar` de la app es lo correcto para el motor, y HushSplit no pierde nada.
