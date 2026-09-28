# Sync extraíble: carpetas, puertos, poda y paquete

**Fecha:** 2026-09-28 · **Autor:** nerv-arquitecto (auditoría de sólo lectura) · **Base:** `main @ 3b78457` (T-191 publicación incremental + T-192/T-193 modularización) · **Estado:** borrador para revisión del orquestador con el PO. No hay nada commiteado.

**Pregunta del PO:** «¿Qué hace falta para modularizar el sync y usarlo en otras aplicaciones, y que en esta app ya quede con esquema modularizado? Dividí por carpetas los archivos del sync, que le sirva a un ser humano para entender qué hay y qué es. Auditá de nuevo el sync, buscá código muerto y seguí limpiando. Y si tuvieras que subirlo a npm como paquete, ¿cómo lo documentarías?»

**Método.** `madge` no está en `node_modules`, así que el grafo sale de un `grep` de `import`/`export … from`/`require(` sobre los 88 archivos de producción de `src/sync/**`, 11.776 líneas en total. Los importadores y los `jest.mock` salen de un script que resuelve cada especificador, alias `@/` o relativo, a su archivo. Los usos de cada export salen de `grep -rlw`, separando producción de `__tests__`. Todo número de línea citado es de `main @ 3b78457`.

---

## 1 · Grafo real de dependencias y clasificación

> **Resumen.** De los 88 módulos, 12 son **núcleo** (puros; tres de ellos sólo arrastran `expo-crypto` para SHA-256 y bytes aleatorios) y 16 son **casi núcleo**: se extraen con inyecciones chicas o medianas.
> Hay 17 **adaptadores**: Supabase, sesión, documento HushSplit y almacenamiento. Los otros 43 son **producto**: confianza por registro, contactos, invitaciones, avisos, captcha y el pegamento de `relayEngine`.
> Ningún módulo de `src/sync` importa i18n ni `react`. React Native entra por `relay/poll.ts:1` y `relaySession.ts:1`, y los hooks de React por `useLiveValue` (`useManifestGap.ts:1`, `useSyncFailure.ts:1`).

**Leyenda.** **N** = núcleo (sin imports de la app). **CN** = casi núcleo (1 a 4 inyecciones). **A** = adaptador (implementa un puerto para HushSplit). **P** = producto (lógica de HushSplit). En la columna de dependencias, `arch:línea` es la línea del import. «store/x» = `@/src/store/x`, «svc/x» = `@/src/services/x`, «utils/x» = `@/src/utils/x`. Un `(*)` marca un módulo de núcleo que usa `expo-crypto`: es nativo y hay que cambiarlo antes de publicar (§2, V5).

### 1.1 · Tabla completa (88 módulos)

| Módulo | Dependencias de app (import → línea) | Clase |
|---|---|---|
| `hexBytes.ts` | ninguna («no importa NADA a propósito», `hexBytes.ts:8`) | N |
| `envelopeSign.ts` | `@noble/curves` :1 | N |
| `envelopeCrypto.ts` | `@noble/ciphers` :1, `expo-crypto` :2 (random :31,:55; SHA-256 :43) | N (*) |
| `manifest.ts` | `expo-crypto` :1 (:9) | N (*) |
| `slices.ts` | `expo-crypto` :1 (:24) | N (*) |
| `cederHilo.ts` | ninguna | N |
| `manifestHealth.ts` | ninguna (usa `Date.now` en :23) | N |
| `relay/sliceLedger.ts` | ninguna | N |
| `relay/appliedSlices.ts` | ninguna | N |
| `relay/relecturas.ts` | ninguna | N |
| `relay/cierreDeDrenaje.ts` | ninguna | N |
| `relay/drenarTypes.ts` | ninguna | N |
| `relay/cubos.ts` | `expo-crypto` :1 (:39), utils/linkCompacto :2 (`RE_UUID`, :55) | CN |
| `relay/publicarCubos.ts` | `../sliceRenewal` :4, que carga utils/createStorage (`sliceRenewal.ts:1,14`); `../topes` :5 | CN |
| `topes.ts` | ninguna, pero aplica una regla de HushSplit: `memberIds` ≤ 100 (`topes.ts:20-23,43`) | CN |
| `drainFailures.ts` | svc/errorLog :1 | CN |
| `relay/abrirSobre.ts` | `type SyncDelta` :1 (el modelo de HushSplit), `drainFailures` :5, `type Envelope` :6 | CN |
| `relaySync.ts` | ninguna (fachada de re-export, :16-31) | CN |
| `relay/publicar.ts` | store/groupKeyStore :4, store/identityStore :5, svc/errorLog :7, `adaptadorHushSplit` :9 | CN |
| `relay/drenar.ts` | store/groupKeyStore :4, store/authStore :5, `authorHealth` :6, `authorKeys` :7, `adaptadorHushSplit` :11 | CN |
| `relay/relectura.ts` | `fetchSince` :3, `adaptadorHushSplit` :7, `aplicarAcotado` :9 | CN |
| `relay/chequeoManifiesto.ts` | svc/errorLog :4, `adaptadorHushSplit` :5 | CN |
| `relay/claveVigente.ts` | store/groupKeyStore :1 | CN |
| `relay/poll.ts` | `react-native` :1 (AppState), `../relaySession` :2 | CN |
| `relay/cursor.ts` | utils/secureStorage :1; `Math.random` en :38 | CN |
| `relayQueue.ts` | svc/errorLog :62 | CN |
| `pendingDrain.ts` | utils/secureStorage :1, store/userScope :2, store/accountLink :3; `require` perezosos de store/groupKeyStore :118, `./relayEngine` :132 y `adaptadorHushSplit` :156 | CN |
| `publishHealth.ts` | `type PublishResult` de `relaySync` :1 | CN |
| `relay.ts` | `ownerPledge` :1, `relayClient` :3 (Supabase, indirecto) | A |
| `relayClient.ts` | `@supabase/supabase-js` :1, `process.env` :9-10, `require('./relaySession')` :81 | A |
| `relaySend.ts` | utils/syncedClock :1 | A |
| `relayErrors.ts` | ninguna (clasifica errores de PostgREST) | A |
| `ownerPledge.ts` | `require` de store/identityStore :21 | A |
| `relay/adaptadorHushSplit.ts` | store/{group,expense,payment,user,recurring,comment}Store :5-10, utils/createStorage :11, store/userScope :12 | A |
| `relay/aplicarAcotado.ts` | store/userStore :2, `avatarTopic` :3, svc/errorLog :4 | A |
| `applyDelta.ts` | 8 stores :1-8, store/identityAlias :11 | A |
| `acotarDeltaAlGrupo.ts` | 6 stores :3-8 | A |
| `soloLocal.ts` | `@/src/types/models` :1 | A |
| `sliceRenewal.ts` | utils/createStorage :1 | A |
| `relaySession.ts` | `react-native` :1, store/authStore :4, utils/withTimeout :5 | A |
| `relaySessionStorage.ts` | utils/secureStorage :1, utils/serialQueue :2, store/authStore :3 | A |
| `sessionStatus.ts` | ninguna (sólo el tipo de `relaySession`) | A |
| `relayNetworkTimeout.ts` | `captchaBridge` :1 | A |
| `directoryAuth.ts` | utils/withTimeout :2; `require('./relaySession')` en :68, :102, :124, :194 | A |
| `devicePrivateKey.ts` | `require` de store/identityStore :24 | A |
| `relayEngine.ts` | store/groupKeyStore :1, store/authStore :2, utils/withTimeout :11; orquesta `inviteEngine` :8, `contactInviteEngine` :9, `deviceKeys` :10 | P |
| `relay/publish.ts` | store/authStore :1, store/groupStore :2, store/groupKeyStore :3, store/identityAlias :4, svc/notifications :5 | P |
| `relay/drain.ts` | 6 stores :1-6, utils/syncedClock :7, svc/syncNotices :8, svc/notifications :9, svc/applyLeave :10 | P |
| `avatarTopic.ts` | `expo-crypto` :1, store/identityStore :6, store/groupKeyStore :7, store/userStore :8 | P |
| `accountEntry.ts` | `@react-native-google-signin` :1, `expo-apple-authentication` :2, store/identityAlias :3, store/authStore :4 | P |
| `captchaBridge.ts` | `process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY` :36 | P |
| `turnstileHtml.ts` | ninguna (HTML para el WebView) | P |
| `recordCore.ts` | store/lww :1, types/models :4 | P |
| `recordSign.ts` | `@noble/curves` :1 | P |
| `recordHealth.ts` | `@noble/curves` :1 | P |
| `recordHealthStore.ts` | utils/secureStorage :3, store/userScope :4 | P |
| `verdictCache.ts` | `@noble/hashes` :1, utils/secureStorage :5, store/userScope :6 | P |
| `ratchet.ts` | utils/secureStorage :1, store/userScope :2 | P |
| `signOnWrite.ts` | store/userScope :4, store/identityAlias :5, utils/syncedClock :6, store/relojDelMerge :7 | P |
| `derivedRecords.ts` | ninguna | P |
| `trustCheck.ts` | algorithms/derivedRecurring :7, types/models :8 | P |
| `autoriaTrust.ts` | types/models :3 | P |
| `authorHealth.ts` | utils/secureStorage :2, store/userScope :3 | P |
| `authorKeys.ts` | ninguna (fachada, :13-25) | P |
| `authorKeysCache.ts` | utils/secureStorage :1, store/userScope :2 | P |
| `authorKeysResolve.ts` | `require('./contactChannel')` :61, `require('./deviceKeys')` :73 | P |
| `authorKeysRefresh.ts` | `require` de store/identityAlias :21 y store/identityStore :32 | P |
| `leaveApprovalCore.ts` | store/lww :1, types/models :2 | P |
| `leaveApprovalSign.ts` | `@noble/curves` :1, types/models :5 | P |
| `deviceKeys.ts` | store/identityStore :2, store/authStore :3 | P |
| `contactChannel.ts` | `expo-crypto` :1, utils/secureStorage :2, store/userScope :3, svc/avatarSize :4, store/authStore :5, store/userStore :6, store/identityStore :9, store/groupKeyStore :10, utils/syncedClock :11 | P |
| `contactPeers.ts` | utils/secureStorage :1, store/userScope :2 | P |
| `contactTopic.ts` | `expo-crypto` :1 | P |
| `contactGroupKeyDrop.ts` | `@noble/curves` :1, store/identityStore :4, store/authStore :5, store/groupKeyStore :6 | P |
| `contactInvite.ts` | `@noble/curves` :1, `expo-crypto` :2, utils/appLink :6, utils/linkCompacto :7, utils/nombreSeguro :8 | P |
| `contactInviteEngine.ts` | store/authStore :1, store/identityStore :6, utils/withTimeout :15 | P |
| `relay/contactos.ts` | store/authStore :1, store/groupStore :2, utils/secureStorage :3, utils/withTimeout :4, svc/notifications :5 | P |
| `groupInvite.ts` | `@noble/curves` :1, `expo-crypto` :2, utils/appLink :3, utils/idDeCuenta :4, utils/linkCompacto :5, utils/nombreSeguro :6, svc/errorLog :7 | P |
| `groupKeyWrap.ts` | `@noble/curves` y `@noble/hashes` :1-3, `expo-crypto` :4 | P |
| `inviteEngine.ts` | store/authStore :1, store/groupKeyStore :2, store/identityStore :7, utils/withTimeout :14, svc/notifications :15 | P |
| `inviteAdmit.ts` | store/{user,group,groupKey,identity}Store :1-4, utils/syncedClock :9, svc/errorLog :10, svc/notifications :11, algorithms/roster :13 | P |
| `relay/invitaciones.ts` | ninguna directa (usa `relay` :1, `groupInvite` :2, `inviteEngine` :3, `contactChannel` :4) | P |
| `groupKeyOffers.ts` | utils/secureStorage :1, store/userScope :2, store/groupKeyStore :3 | P |
| `keyConflictNotice.ts` | store/groupStore :1, svc/notifications :2, svc/syncNotices :3 | P |
| `clockNotice.ts` | utils/secureStorage :1, utils/syncedClock :2, svc/syncNotices :3 | P |
| `syncDownNotices.ts` | utils/secureStorage :1, store/userScope :2, svc/syncNotices :4 | P |
| `useManifestGap.ts` | hooks/useLiveValue :1 (hook de React) | P |
| `useSyncFailure.ts` | hooks/useLiveValue :1 (hook de React) | P |

**Conteo:** 12 N · 16 CN · 17 A · 43 P = 88.

### 1.2 · Quién depende del sync desde afuera

- **127 archivos fuera de `src/sync/`** importan `@/src/sync/…`: 46 de producción y 81 tests.
- Hay **329 aristas de import de producción** hacia un módulo de sync, contando las internas, y **587 aristas desde tests**.
- Hay **234 `jest.mock`/`jest.doMock`** que apuntan a un módulo de sync, más ~44 `jest.requireActual`.
- **`relayEngine.ts`** es el módulo con más dependientes: 17 importadores de producción, 16 de ellos fuera de sync; 83 archivos de test lo importan y hay 68 `jest.mock` sobre él. Le sigue **`relay.ts`**: 21 importadores de producción, 47 archivos de test y 39 mocks.
- **Los stores también dependen del sync.** `src/store/session.ts` importa `authorHealth`, `authorKeysCache`, `authorKeysRefresh`, `drainFailures`, `ratchet`, `recordHealthStore`, `relaySession` y `verdictCache`. Los 5 stores de entidades importan `signOnWrite`. `src/store/identityStore.ts:6` saca `generateIdentity` y `generateWrapKeypair` de `groupInvite`, o sea que la identidad del aparato vive en el módulo de invitaciones.

---

## 2 · Puertos que necesita el núcleo

> **Resumen.** Para vivir en un paquete, el núcleo necesita 8 puertos: transporte, almacén con scope, identidad y claves por época, documento, cripto, reloj, log y avisos. Casi todos ya existen de hecho en una función de la app; lo que falta es inyectarlos.
> Hoy la frontera P15 (`relayFrontera.guard.test.ts`) protege 7 archivos y sólo mira dos patrones directos. No detecta el MMKV transitivo, `expo-crypto`, el modelo `SyncDelta` ni el adaptador importado como singleton.
> Las 5 violaciones que más pesan: el adaptador singleton (medio), claves y sesión leídas de los stores (medio), MMKV transitivo por `RENEWAL_WINDOW_MS` (chico), `SyncDelta` en el camino del núcleo (chico–medio) y `expo-crypto` (chico).

### 2.1 · Puertos (firma TypeScript e implementación actual)

```ts
// 1 · Transporte — el buzón tonto
export interface Transporte {
  publicar(topic: string, payload: string, o: { ckey?: string; compactable: boolean; signal?: AbortSignal }):
    Promise<{ ok: true; seq: number } | { ok: false; reason: 'not_configured' | 'too_large' | 'network' | 'rate_limited'; detail?: string }>;
  leerDesde(topic: string, cursor: number, o?: { excluirEmisor?: string; limite?: number }):
    Promise<{ ok: true; sobres: Sobre[]; cursor: number; hayMas?: boolean } | { ok: false; reason: 'not_configured' | 'network'; detail?: string }>;
  borrarMios(topic: string): Promise<{ ok: true; borrados: number } | { ok: false; reason: string; detail?: string }>;
  suscribir(topic: string, alAviso: () => void, alEstado?: (sano: boolean) => void): () => void;
  readonly maxPayloadBytes: number;
}
export type Sobre = { seq: number; payload: string; sender: string; ckey?: string };
```
**Hoy:** `sendEnvelope` (`relaySend.ts:73`), `fetchSince` (`relay.ts:104`), `deleteMyEnvelopes` (`relay.ts:67`), `subscribeTopic` (`relay.ts:197`) y `MAX_PAYLOAD_BYTES` (`relayClient.ts:48`). La prenda de ADR-009 (`ownerPledge.ts:17`) queda **dentro** del adaptador de Supabase, porque es un detalle de ese servidor.

```ts
// 2 · Almacén — clave/valor síncrono, YA scopeado por cuenta
export interface Almacen { get(k: string): string | undefined; set(k: string, v: string): void; delete(k: string): void }
```
**Hoy:** está declarado **dos veces**, en `relay/sliceLedger.ts:29-33` y en `relay/appliedSlices.ts:23-27`. Lo implementa `adaptador.almacen` (`relay/adaptadorHushSplit.ts:211-223`, MMKV `sync-relay-core` + `userScope`). El cursor (`relay/cursor.ts:12`) y la marca T-089 (`pendingDrain.ts:40`) usan otros buckets directos. En el paquete, los tres pasan por este puerto.

```ts
// 3 · Identidad y claves de grupo por época
export interface Identidad {
  emisor(): string;                                   // id estable del aparato
  firmar(sellado: string): string;                    // Ed25519 por fuera del cifrado
  claveDelGrupo(grupoId: string): { clave: Uint8Array; epoch: number } | null;
  sesion(): string | null;                            // «¿la sesión sigue siendo la misma?»
  verificarEmisor?(grupoId: string, autor: string, clavePublica: string): Promise<'ok' | 'descartar'>;
}
```
**Hoy:** `deviceId()` (`relay/cursor.ts:35-40`); `signEnvelope(…, ensureIdentity().privateKey)` (`relay/publicar.ts:159`); `groupKeyBytes` + `getKey().epoch` (`relay/publicar.ts:147-151`, `relay/drenar.ts:53-57`); `useAuthStore…currentUser?.id` (`relay/drenar.ts:51,123`); `observeAuthor` (`relay/drenar.ts:143-147`). La comparación de clave y época (`relay/claveVigente.ts:14-17`) se vuelve una función pura sobre dos lecturas de `claveDelGrupo`.

```ts
// 4 · Documento — lo que la app sincroniza
export interface Documento {
  campos: readonly string[];                                             // orden de DEPENDENCIA
  armar(grupoId: string, ctx: { emisor: string }): Promise<Record<string, { id: string }[]>>;
  aplicar(grupoId: string, campo: string, registros: unknown[]): Promise<{ porTope: number; porDependencia: number }>;
  excede?(registro: unknown): string | null;                             // tope por registro
  codec?: { envolver(campo: string, regs: { id: string }[]): unknown; desenvolver(x: unknown): { campo: string; registros: unknown[] }[] };
}
```
**Hoy:** `campos` (`relay/adaptadorHushSplit.ts:52`), `armar` + `antesDePublicar` (:71, :179), `acotar` + `aplicar` (:152, :128, combinados en `relay/aplicarAcotado.ts:16-46`), `excesoDe` (`topes.ts:77`) y `envolver` (:108-117). El `codec` existe para que HushSplit conserve el formato de cable actual (`SyncDelta` `version: 1`, `applyDelta.ts:125-126`). La **digest** no forma parte del documento: la calcula el núcleo sobre el JSON exacto (`relay/publicarCubos.ts:80-81`).

```ts
// 5 · Cripto — SHA-256 y bytes aleatorios (lo único nativo que queda)
export interface Cripto { sha256Hex(s: string): Promise<string>; aleatorio(n: number): Uint8Array }
```
**Hoy:** `Crypto.digestStringAsync` (`manifest.ts:9`, `slices.ts:24`, `relay/cubos.ts:39`, `envelopeCrypto.ts:43`) y `Crypto.getRandomBytes` (`envelopeCrypto.ts:31,55`).

**Default del paquete:**
- `sha256Hex`: `sha256` de `@noble/hashes`, que ya es dependencia (`package.json:55`).
- `aleatorio`: **no hay default en React Native.** Hay que inyectarlo con `expo-crypto`. El repo ya lo prohíbe por escrito: `groupInvite.ts:36-41` dice que `getRandomValues` «React Native no provee de forma confiable» y que, en vez de fallar, «genera claves con entropía degradada EN SILENCIO». En Node y en web el default es `globalThis.crypto.getRandomValues`, que ahí es nativo.

Antes de cambiar la implementación hay que fijar vectores hex: `deriveTopic`, `deriveCkey` y `digestOfJson` determinan el topic y las ckeys del buzón.

```ts
// 6 · Reloj   · 7 · Log   · 8 · Avisos (salidas de diagnóstico)
export interface Reloj { ahora(): number; ceder(): Promise<void>; alVolverAPrimerPlano?(fn: () => void): () => void }
export interface Log { error(mensaje: string, e?: unknown): void }
export interface Avisos {
  publicacion?(grupoId: string, r: ResultadoPublicacion): void;
  manifiesto?(grupoId: string, ckeysFaltantes: string[]): void;
  aplicado?(grupoId: string, n: number): void;
}
```
**Hoy:**
- Reloj: `Date.now()` (`relay/publicar.ts:220`, `manifestHealth.ts:23`), `cederHilo` (`cederHilo.ts:12`), `AppState` (`relay/poll.ts:111`).
- Log: `recordError` (`drainFailures.ts:36`, `relay/chequeoManifiesto.ts:59`, `relay/aplicarAcotado.ts:26`, `relay/publicar.ts:193`).
- Avisos: `recordPublish` (`publishHealth.ts:71`, llamado desde `relay/publish.ts:97`), `recordManifestCheck` (`manifestHealth.ts:18`, llamado desde `relay/chequeoManifiesto.ts:57`) y `avisarDeLoNuevo` (`relay/drain.ts:69,77`).

La API que el paquete expone por encima de los puertos es un solo `crearMotor(puertos)` que devuelve `{ publicar, drenar, escuchar, detener, olvidarGrupo }`. Hoy esas funciones son `publishToGroup` (`relay/publicar.ts:142`), `drainGroup` (`relay/drenar.ts:38`), el `subscribeTopic` + `scheduleDrain` de `relayEngine.ts:94-97`, `stopRelay` (`relayEngine.ts:147`) y `deleteMyGroupEnvelopes` + `olvidarTopic` (`relay/publicar.ts:244-255`).

### 2.2 · Violaciones de frontera y costo de corregirlas

| # | Violación | Dónde | Costo | Motivo del costo |
|---|---|---|---|---|
| V1 | El adaptador entra como **módulo singleton** (`import * as adaptador`), no como inyección | `relay/drenar.ts:11`, `relay/publicar.ts:9`, `relay/relectura.ts:7`, `relay/chequeoManifiesto.ts:5`, `relay/aplicarAcotado.ts:5`, `pendingDrain.ts:156` | **medio** | Obliga a crear `crearMotor(puertos)` y a pasar el contexto por 6 archivos. `mergeGate.test.ts:118,137-141` lee esos archivos por ruta y busca `adaptador.aplicar(` literal, así que el guard se reescribe. |
| V2 | **Claves y sesión** se leen directo de los stores | `relay/drenar.ts:4-5` (uso :51, :53, :56, :123), `relay/publicar.ts:4-5` (:147-151, :159), `relay/claveVigente.ts:1,15` | **medio** | Es el camino caliente de publicar y drenar. Unos 20 tests mockean `groupKeyStore`/`authStore` para ejercitarlo. Hace falta el puerto Identidad y el test de caracterización (`relayEngineCaracterizacion.test.ts`) tiene que seguir verde. |
| V3 | **MMKV transitivo** en el núcleo: `publicarCubos` importa `RENEWAL_WINDOW_MS` de `sliceRenewal`, que al cargar abre `createStorage('slice-renewal')` | `relay/publicarCubos.ts:4` → `sliceRenewal.ts:1,14,17` | **chico** | Se mueve la constante a un módulo hoja del núcleo. El guard no lo ve porque sólo mira imports directos de `@/src/store/` y `types/models` (`relayFrontera.guard.test.ts:50,62-65`). |
| V4 | El modelo **`SyncDelta`** de HushSplit está en el camino del núcleo | `relay/abrirSobre.ts:1,10,59`, `relay/drenar.ts:1,25`, `relay/relectura.ts:1,82`, `relay/aplicarAcotado.ts:1`; `version` y `featureVersion` quedan fijos en `relay/adaptadorHushSplit.ts:108-116` | **chico–medio** | El núcleo pasa a manejar `unknown` y el `codec` del documento decide. Hay que cuidar que el JSON del cubo siga siendo byte a byte el mismo (P18, spec §8 C1), porque si no se republica todo. |
| V5 | **`expo-crypto` y `utils/linkCompacto`** en el núcleo | `manifest.ts:1,9`, `slices.ts:1,24`, `relay/cubos.ts:1-2,39,55`, `envelopeCrypto.ts:2,31,43,55` | **chico** | El SHA-256 pasa a `@noble/hashes` y se copia `RE_UUID`. Lo aleatorio queda **inyectado** por el puerto Cripto: en RN sigue siendo `expo-crypto` (`groupInvite.ts:36-41`). Hacen falta vectores de prueba: si el hex cambia, cambian topics y ckeys, y todo el buzón queda «nuevo». |
| V6 | El transporte concreto se importa por nombre | `relay/drenar.ts:3`, `relay/relectura.ts:3`, `relay/publicar.ts:3`, `relay/abrirSobre.ts:6` | chico | Son 4 sitios. Los tests ya mockean `../relay` (39 mocks), así que se reescriben a un transporte falso. |
| V7 | `errorLog`, `Date.now()` y `setTimeout` directos | `drainFailures.ts:1,36`, `relay/chequeoManifiesto.ts:4,59`, `relay/aplicarAcotado.ts:4,26`, `relay/publicar.ts:7,171,193,220`, `relayQueue.ts:62`, `manifestHealth.ts:23` | chico | Son mecánicos: puertos Log y Reloj. |
| V8 | Una **regla de producto** (`memberIds` ≤ 100) se aplica en el filtro de publicación del núcleo | `relay/publicarCubos.ts:5,64` → `topes.ts:20-23,43,77` | chico | Se reemplaza por `documento.excede?`, que por defecto sólo mide bytes. |
| V9 | La **autoría** (producto) vive dentro del loop de drenaje | `relay/drenar.ts:6-7,143-147,166,222` | chico | Queda como hook opcional `verificarEmisor`. `refreshPendingAuthors` sale al adaptador. |
| V10 | El motor depende de **React Native y de la sesión Supabase** | `relay/poll.ts:1-2,111,118` | chico | Se usa `reloj.alVolverAPrimerPlano`. El refresco de token (`bindAuthRefreshToAppState`) es asunto del adaptador de Supabase. |
| V11 | Un `require` perezoso **hacia arriba**: `pendingDrain` pide la fachada `relayEngine` sólo para `olvidarCursor` | `pendingDrain.ts:129-138`; la función vive en `relay/cursor.ts:30`, que no importa nada del sync | chico | Se importa directo de `relay/cursor`. Ojo: 4 tests mockean `'../relayEngine'` con `{ virtual: true }` por este `require` (§4, D15). |

**El guard P15, tal como está, no alcanza para un paquete.** Tiene tres problemas:
1. La lista cerrada `NUCLEO` (`relayFrontera.guard.test.ts:38-47`) nombra un `documento.ts` que no existe (:43). No incluye `manifest.ts`, `slices.ts`, `envelopeCrypto.ts` ni `envelopeSign.ts`, que son núcleo real y viven fuera de `relay/`.
2. Sólo prohíbe dos patrones y sólo en imports directos (:50).
3. No sigue imports transitivos (V3).

**Propuesta:** reemplazarlo por un **guard por carpeta** después de la mudanza (§3). Nada bajo `nucleo/**` puede importar `@/src/**`, `expo-*`, `react*` ni `@supabase/*`, y la regla se verifica **transitivamente** recorriendo los imports relativos. El barrido por carpeta rompía el pegamento que hoy vive en `relay/` (T-189, `relayFrontera.guard.test.ts:12-24`). Deja de ser un problema porque la carpeta pasa a nombrar lo que es cada cosa.

---

## 3 · Carpetas dentro de `src/sync/`

> **Resumen.** Propongo 9 carpetas: `nucleo/`, `puertos/` (nueva), `motor/`, `adaptadores/supabase/`, `adaptadores/hushsplit/`, `sesion/`, `confianza/`, `contactos/`, `invitaciones/` y `avisos/`. Los 88 archivos están asignados y no sobra ni falta ninguno (la verificación está abajo).
> La mudanza toca unas 329 aristas de producción, 587 de tests, 234 `jest.mock`, ~44 `requireActual` y ~10 tests que leen archivos por ruta.
> Recomiendo **mover todo de una vez con un script** y correr la suite entera, **sin** fachadas en las rutas viejas. Una fachada con `jest.mock` sobre la ruta vieja deja de mockear en silencio a los módulos que importan la ruta nueva.

### 3.1 · Asignación completa

La carpeta dice **dónde vive** el archivo; la clase de §1 dice **qué tan extraíble** es. Por ejemplo, `relayEngine.ts` vive en `motor/` pero es producto: es la raíz de composición de HushSplit.

| Carpeta | Archivos | Líneas |
|---|---|---|
| `nucleo/` | `hexBytes`, `envelopeCrypto`, `envelopeSign`, `manifest`, `slices`, `cubos`, `sliceLedger`, `appliedSlices`, `publicarCubos`, `relecturas`, `cierreDeDrenaje`, `drenarTypes`, `cederHilo`, `manifestHealth`, `drainFailures`, `topes`, `abrirSobre` (17) | 1.369 |
| `puertos/` | nueva: `puertos.ts` con las firmas de §2.1. Al principio sólo tiene tipos y `Almacen` deja de estar duplicado | — |
| `motor/` | `relayEngine`, `relaySync`, `publicar`, `drenar`, `relectura`, `chequeoManifiesto`, `claveVigente`, `publish`, `drain`, `poll`, `cursor`, `relayQueue`, `pendingDrain`, `publishHealth` (14) | 1.862 |
| `adaptadores/supabase/` | `relay`, `relayClient`, `relaySend`, `relayErrors`, `ownerPledge` (5) | 579 |
| `adaptadores/hushsplit/` | `adaptadorHushSplit`, `aplicarAcotado`, `applyDelta`, `acotarDeltaAlGrupo`, `soloLocal`, `avatarTopic`, `sliceRenewal` (7) | 900 |
| `sesion/` | `relaySession`, `relaySessionStorage`, `sessionStatus`, `relayNetworkTimeout`, `directoryAuth`, `accountEntry`, `captchaBridge`, `turnstileHtml` (8) | 1.100 |
| `confianza/` | `recordCore`, `recordSign`, `recordHealth`, `recordHealthStore`, `verdictCache`, `ratchet`, `signOnWrite`, `derivedRecords`, `trustCheck`, `autoriaTrust`, `authorHealth`, `authorKeys`, `authorKeysCache`, `authorKeysResolve`, `authorKeysRefresh`, `leaveApprovalCore`, `leaveApprovalSign`, `deviceKeys`, `devicePrivateKey` (19) | 2.922 |
| `contactos/` | `contactChannel`, `contactPeers`, `contactTopic`, `contactGroupKeyDrop`, `contactInvite`, `contactInviteEngine`, `relay/contactos` → `contactos/motorDeContactos` (7) | 1.544 |
| `invitaciones/` | `groupInvite`, `groupKeyWrap`, `inviteEngine`, `inviteAdmit`, `relay/invitaciones` → `invitaciones/suscripciones`, `groupKeyOffers`, `keyConflictNotice` (7) | 1.298 |
| `avisos/` | `clockNotice`, `syncDownNotices`, `useManifestGap`, `useSyncFailure` (4; los dos hooks se van a `src/hooks/` en la poda, D14) | 202 |
| **Total** | **88** | **11.776** |

**Verificación.** Un script cruzó la asignación contra `find src/sync -name '*.ts' -not -path '*__tests__*'`: 88 asignados, 88 reales, ninguno de más ni de menos.

**Renombres opcionales en el mismo paso** (sin ellos, los pares confunden a una persona):
- `motor/publish.ts` ↔ `motor/publicar.ts` y `motor/drain.ts` ↔ `motor/drenar.ts`: propongo `agendaDePublicacion.ts` (debounce + guarda T-089 + avisos) y `agendaDeDrenaje.ts` (debounce + cursor + avisos). `publicar.ts`/`drenar.ts` quedan para UNA publicación y UN drenaje.
- `slices.ts` → `nucleo/ckey.ts`: hoy sólo le queda `deriveCkey` vivo (D3).

**Tests.** Cada test va a la carpeta `__tests__` del módulo que importa primero. Los de integración entre motor y núcleo (`publicacionIncremental*.test.ts`, `receptorIncremental.test.ts`, `retenidasCursor.test.ts`, `relayEngine*.test.ts`) van a `motor/__tests__/`. `integration/relayRls.int.test.ts` va a `adaptadores/supabase/__tests__/integration/`. El `testMatch` de `jest.integration.config.js:11` (`src/**/__tests__/integration/**`) ya lo cubre.

### 3.2 · README de cada carpeta (15 líneas)

**`nucleo/README.md`**
```
# nucleo — el protocolo, sin la app
Formato y algoritmos del sync por ESTADO sobre un buzón tonto. No importa nada
de @/src/**, expo-*, react* ni @supabase/* (guard por carpeta).
- Sobre: XChaCha20-Poly1305 (envelopeCrypto) + firma Ed25519 por fuera (envelopeSign).
- Topic = SHA256(clave‖época); ckey = SHA256(clave:ckey:campo:prefijo) (slices/ckey).
- Cubos estables por prefijo de id (cubos) + profundidad con histéresis.
- Ledger de lo que YO publiqué (sliceLedger) y de lo que YA apliqué (appliedSlices).
- Manifiesto por emisor (manifest) → detecta rebanadas faltantes; relectura acotada (relecturas).
- Cierre de drenaje puro: el cursor nunca pasa una retenida (cierreDeDrenaje).
- Presupuesto de reintentos por (topic, seq) (drainFailures).
- Todo lo de afuera entra por puertos/ (Almacen, Cripto, Log, Reloj).
Leer: docs/ADR-007, spec 2026-09-28-publicacion-incremental §2-§8.
Regla: si necesitás un store acá, lo que falta es un puerto, no un import.
Tests: nucleo/__tests__, sin mocks de stores.
```

**`puertos/README.md`**
```
# puertos — lo que el núcleo pide y la app provee
Sólo tipos. Cada puerto tiene UNA implementación en adaptadores/ para HushSplit.
- Transporte: publicar / leerDesde(cursor) / borrarMios / suscribir.
- Almacen: get/set/delete síncrono, YA scopeado por cuenta.
- Identidad: emisor, firmar, claveDelGrupo(epoch), sesion.
- Documento: campos (orden de dependencia), armar, aplicar, excede, codec.
- Cripto: sha256Hex, aleatorio.  Reloj: ahora, ceder, alVolverAPrimerPlano.
- Log: error.  Avisos: publicacion, manifiesto, aplicado.
Un puerto nuevo requiere ADR: cada puerto es superficie pública del paquete.
Los tipos acá son la API de @hushsplit/relay-sync (ver §5 de la spec).
No hay lógica en esta carpeta; si aparece, va a nucleo/ o motor/.
Compatibilidad: cambiar una firma = versión mayor del paquete.
Tests: tipos verificados por tsc; los dobles de prueba viven en test-utils.
```

**`motor/README.md`**
```
# motor — cuándo y en qué orden se sincroniza un grupo
Ciclo de vida: arrancar/parar (relayEngine), poll adaptativo 90 s/20 s (poll),
debounce de publicación y drenaje (agendaDe*), cursor por topic (cursor),
cola con ritmo bajo la cuota (relayQueue), guarda «drenar antes de publicar»
(pendingDrain, T-089) y diagnóstico de publicación (publishHealth).
publicar.ts = UNA publicación (cola por topic, timeout, cubos + manifiesto).
drenar.ts = UN drenaje (páginas, abrir, aplicar, retenidas, manifiesto).
relectura/chequeoManifiesto/claveVigente = piezas del drenaje.
relaySync.ts = ruta pública de publicar/drenar (fachada).
relayEngine.ts orquesta TAMBIÉN invitaciones y contactos: es la raíz de
composición de HushSplit, no parte del paquete.
Regla de dirección: fachada → contactos → drain → publish → poll/cursor (T-189).
Leer: ADR-007 §3-§4, spec 2026-09-28 §8 (C2 regla del cursor).
Tests: motor/__tests__ (caracterización del motor + integración con núcleo).
```

**`adaptadores/supabase/README.md`**
```
# adaptadores/supabase — el buzón concreto
Implementa el puerto Transporte sobre Supabase (tabla envelopes + RPCs).
- relay.ts: fetchSince/deleteMyEnvelopes/subscribeTopic (+ fachada).
- relaySend.ts: sendEnvelope (compactable por ckey, AbortSignal).
- relayClient.ts: cliente, MAX_PAYLOAD_BYTES = 1 MB (006_payload_limit.sql).
- relayErrors.ts: clasifica errores PostgREST (función ausente, cuota).
- ownerPledge.ts: prenda de escritura para borrar lo propio (ADR-009).
Invariantes: el push realtime es un AVISO, la verdad se lee por cursor;
los sobres llevan ESTADO (TTL 30 días sin pérdida si hay renovación).
Degradados por sesión si falta una migración (011a, 010).
Migraciones: supabase/001…011b. El PO las aplica a mano.
Otro servidor = otro adaptador que cumpla el mismo puerto.
Tests: adaptadores/supabase/__tests__ (+ integration/, contra Supabase local).
```

**`adaptadores/hushsplit/README.md`**
```
# adaptadores/hushsplit — el documento de HushSplit
Implementa el puerto Documento: qué es un grupo en esta app.
- adaptadorHushSplit.ts: campos (orden de dependencia), armar, envolver,
  acotar, aplicar, antesDePublicar, almacen (MMKV scopeado por cuenta).
- acotarDeltaAlGrupo.ts: el receptor desconfía (robo de id, dependencias).
- applyDelta.ts: merge LWW/por niveles en los stores de Zustand.
- soloLocal.ts: campos que no viajan (receiptImageUri, avatarUrl).
- aplicarAcotado.ts: acotar + aplicar + pedir fotos por referencia.
- avatarTopic.ts + sliceRenewal.ts: la foto viaja por su propio topic.
Regla: lo único que puede tocar stores del lado del sync es esta carpeta.
Nunca adopta claves de grupo (los campos groupKeys/personal van vacíos).
Leer: spec 2026-09-28 §2.4 (frontera), ADR-003 §1.
Tests: adaptadores/hushsplit/__tests__ (relayScope, mergeGate, acotar*).
```

**`sesion/README.md`**
```
# sesion — con qué credencial se habla con el buzón
Sesión de Supabase del buzón (anónima o de cuenta) y su persistencia cifrada.
- relaySession.ts: ensureRelaySession, refresco atado a primer plano.
- relaySessionStorage.ts: storage cifrado, marcador de dueño, cola FIFO.
- directoryAuth.ts: sesión de CUENTA (Google/Apple → Supabase Auth).
- accountEntry.ts: reconexión de cuenta (T-147-b).
- captchaBridge.ts + turnstileHtml.ts: Turnstile para signInAnonymously.
- relayNetworkTimeout.ts: timeout de red que se pausa con el captcha.
- sessionStatus.ts: «no hay sesión de sync» para la UI.
No es parte del paquete: otro servidor autentica distinto.
El motor sólo necesita saber si hay sesión (puerto Identidad.sesion).
Leer: T-147 (engram/plans), 011b_relay_rls_corte.sql.
Tests: sesion/__tests__ (relaySession*, estadosDeSesion*, directoryAuth*).
```

**`confianza/README.md`**
```
# confianza — quién escribió cada registro
Firma por REGISTRO (T-041) y medición en modo aviso (R1: ver, no bloquear).
- recordCore: qué campos se firman · recordSign: firmar/verificar.
- signOnWrite: firmar al escribir en los stores · devicePrivateKey.
- verdictCache, ratchet, recordHealth(+Store): medir sin re-verificar.
- authorKeys*: públicas por autor (caché, resolución, refresco).
- deviceKeys: directorio de claves por cuenta (ADR-004).
- authorHealth: autoría del SOBRE (fase B, aviso).
- trustCheck, autoriaTrust, derivedRecords: veredicto para la UI.
- leaveApproval*: aprobación firmada de salida de un grupo (T-065).
Producto: depende del modelo de gastos (types/models). No va al paquete.
Leer: ADR-004, T-041, T-170. Tests: confianza/__tests__.
```

**`contactos/README.md`**
```
# contactos — el buzón personal de cada persona
Canal por contacto: tarjeta propia, reenvío de claves de grupo, avisos.
- contactChannel: tarjeta, anuncio, drenaje del buzón de contactos.
- contactPeers: registro local de contactos · contactTopic: topic y clave.
- contactGroupKeyDrop: entrega de la clave de un grupo a un contacto (ADR-013).
- contactInvite + contactInviteEngine: link de contacto de un solo uso (ADR-015).
- motorDeContactos (ex relay/contactos): orquestación con ritmo (relayQueue).
Usa el MISMO transporte y el mismo sobre que el núcleo, con otra clave.
Producto: no va al paquete (podría ser un segundo paquete algún día).
Leer: ADR-013, ADR-015, T-096, T-136.
Tests: contactos/__tests__.
```

**`invitaciones/README.md`**
```
# invitaciones — cómo entra alguien a un grupo
Invitación por link con token efímero; grant firmado; clave envuelta X25519.
- groupInvite: crear/parsear link, claim/grant sellados.
- groupKeyWrap: envoltura X25519 de la clave (v1 aceptada hasta 2026-10-14).
- inviteEngine (quien entra) · inviteAdmit (quien invita).
- suscripciones (ex relay/invitaciones): escuchar buzones de invitación.
- groupKeyOffers + keyConflictNotice: claves en disputa (T-136).
Por el relay de GRUPO nunca viaja una clave (ADR-003 §1): viaja por acá.
Producto: no va al paquete.
Leer: ADR-003 (enmienda T-034), ADR-013, T-172.
Tests: invitaciones/__tests__.
```

**`avisos/README.md`**
```
# avisos — lo que el sync le cuenta a la persona
Traduce el diagnóstico del motor a avisos de bandeja, UNA vez por hecho.
- syncDownNotices: «este grupo dejó de sincronizar» (too_large/no_key).
- clockNotice: «tu reloj está mal» (T-038), se olvida solo al corregirse.
La marca de «ya avisé» se persiste; el fallo en sí vive en memoria.
Los hooks de React (useManifestGap, useSyncFailure) van a src/hooks/.
Consume puertos de salida del motor (Avisos): el paquete no avisa, informa.
Textos: claves i18n (claveDeFalloDeSync), nunca strings en el sync.
Producto: no va al paquete.
Leer: T-054, T-058, T-038.
Tests: avisos/__tests__.
```

### 3.3 · Costo de la mudanza y cómo hacerla sin romper

**Qué hay que tocar (medido):**
- **Aristas de import:** 329 de producción y 587 desde tests, contadas como pares archivo→módulo.
- **Archivos fuera de `src/sync/`:** 127 importan `@/src/sync/…` (46 de producción, 81 tests).
- **Mocks:** 234 `jest.mock`/`doMock` sobre módulos de sync, de los cuales 103 usan el alias `@/src/sync/…` y el resto son relativos. Hay además ~44 `jest.requireActual`.
- **4 `jest.mock('../relayEngine', …, { virtual: true })`:** `manifiestoTrasRebanadas.test.ts:83`, `receptorIncremental.test.ts:46`, `publicacionIncrementalReingreso.test.ts:31` y `retenidasCursor.test.ts:34`. Un mock virtual sobre una ruta que ya no existe **no falla**: deja de mockear y ya.
- **Tests que leen archivos por ruta:**
  - `mergeGate.test.ts:118,137-141`
  - `relayFrontera.guard.test.ts:31,38-47`
  - `relayModulos.guard.test.ts:14-15,49,55,70`
  - `src/__tests__/prendaNoViaja.test.ts:68`
  - `src/__tests__/verificarEnvBuild.test.ts:69,72`
  - `src/store/__tests__/memberIdsWriters.guard.test.ts:36`
  - `src/services/__tests__/inventarioDeAvisos.test.ts:141-146`: lista cerrada con `sync/relay/contactos`, `sync/relay/drain` y `sync/relay/publish`. Este me lo marcó el orquestador y se me había pasado.
  - `src/store/__tests__/accountCoverage.test.ts`: arma ids de módulo por ruta relativa (:49).
  - `noConsoleLog.test.ts:13`: barre `src/sync` entero y sigue sirviendo.

**Recomendación: moverlo todo de una vez con un script, no con fachadas.**

La razón es concreta. `jest.mock(ruta)` reemplaza **esa** identidad de módulo. Si `motor/drenar.ts` importa `adaptadores/supabase/relay` y un test sigue mockeando `@/src/sync/relay`, que sería la fachada vieja, el mock no alcanza a `drenar` y el test pasa a ejercitar el transporte real. En el mejor caso falla; en el peor pasa por la razón equivocada. Hoy ya se vive con esa tensión: `relaySync.ts:12-14` aclara que «los 2 tests que mockean `sync/relaySync` no cambian» precisamente porque la producción sigue importando la fachada. Dejar 88 fachadas multiplica ese riesgo por 88.

**Pasos (un solo PR, sin cambio de comportamiento):**
1. Un mapa `viejo → nuevo` en `scripts/mudanza-sync.mjs`. Son los 88 archivos de §3.1, más los 114 tests asignados por su primer import de sync.
2. `git mv` de cada archivo, para conservar la historia por archivo.
3. Reescribir **todo** especificador que resuelva a un archivo movido en `app/`, `src/`, `components/` y `hooks/`. Eso cubre `import`/`export … from`, `require(`, `import(`, `typeof import(`, `jest.mock(`, `jest.doMock(`, `jest.requireActual(` y `jest.requireMock(`. Regla: alias `@/src/sync/<carpeta>/<archivo>` entre carpetas, relativo dentro de la misma carpeta. El script resuelve con la misma función que usé para medir (alias `@/` más `.ts`/`.tsx`).
4. Editar a mano los ~8 tests que leen rutas (lista de arriba) y reemplazar `relayFrontera.guard` por el guard por carpeta de §2.2.
5. **Chequeo extra, nuevo:** un test que verifica que cada `jest.mock`/`doMock` con `{ virtual: true }` apunte a algo que **no** existe a propósito y que cada uno sin `virtual` resuelva a un archivo. Así se cazan los 4 mocks virtuales de `relayEngine`.
6. Correr `npx tsc --noEmit`, `npm run lint`, `npm test` (y `npm run test:int` si el PO tiene Supabase local).

**Costo estimado:** 1 a 1,5 días de agente para el script, la corrida, el arreglo de rezagados y el guard nuevo. **Riesgo bajo** siempre que el paso 5 exista.

**Alternativa descartada:** fachadas de re-export en las rutas viejas «por un tiempo». Se descarta por la trampa de identidad de `jest.mock` descrita arriba, y porque «por un tiempo» en este repo ya produjo fachadas de un solo importador (D9).

---

## 4 · Código muerto y deuda (segunda pasada tras T-193)

> **Resumen.** Lo más grande que sobra es el camino QR: `buildDelta`, `peerIsOutdated` y la **adopción de claves** dentro de `applyDelta`. Ya no tiene pantalla, y en el único camino vivo esa rama no se alcanza nunca. Le sigue `buildGroupPayload`, que sólo existe para tests que verifican algo que ya no viaja.
> Hay constantes y helpers triplicados (`byteLength`, timeouts de 15 s), re-exports que sólo usan los tests y 34 comentarios que ubican código en `relaySync.ts`/`relayEngine.ts` aunque ya se mudó.
> El 43% de las líneas del sync son comentario (5.105 de 11.776). Muchas narran rondas del verifier y deberían ser un puntero al ADR.

| # | Ítem (evidencia) | Acción propuesta | Riesgo |
|---|---|---|---|
| D1 | **Camino QR muerto.** `buildDelta` (`applyDelta.ts:54`) y `peerIsOutdated` (`applyDelta.ts:161-163`) no tienen importadores de producción; `app/sync/` no existe en el worktree. `applyDelta` adopta claves y `personal` (`applyDelta.ts:151-153`, campos en `:39-51`), pero su único llamador vivo es `adaptador.aplicar` (`relay/adaptadorHushSplit.ts:128-130`), y siempre después de `acotarDeltaAlGrupo`, que los vacía (`acotarDeltaAlGrupo.ts:206-207`). | Borrar `buildDelta` y `peerIsOutdated`. Sacar `groupKeys`/`personal` de `SyncDelta` y de `applyDelta`. Mover `DELTA_FEATURE_VERSION` al codec. Ajustar `types/models.ts:284` (comentario). | **bajo**, y **mejora la seguridad**: hoy hay una rama que adopta claves de grupo a un salto de distancia de cualquier llamador que se olvide de acotar |
| D2 | **`buildGroupPayload` sin uso en producción** (`relay/publicar.ts:21-54`). Sólo lo usan 7 tests (`relayScope`, `relayScopeFiltraPrimero`, `canonicalNoAlcanzaElCable`, `deltaCompleteness`, `soloLocal`, `relaySync`, `reingresoNoResucita`). Lo que viaja de verdad es `armar` + `antesDePublicar` + `envolver` (`relay/publicar.ts:204-215`). El comentario `relay/adaptadorHushSplit.ts:56-60` dice que «sigue existiendo para el QR/pairing»; ese QR ya no existe. | Reapuntar esos tests a `adaptador.armar`/`envolver` (y a `antesDePublicar` para la foto) y borrarlo. | **medio**: son tests de seguridad (qué sale al cable) y hay que migrarlos sin perder casos |
| D3 | **`slices.ts` casi vacío.** `MAX_SLICE_BYTES` (:11) no tiene usos de producción. El comentario :14-18 habla de «ÍNDICE», pero hoy el índice es un prefijo (T-191). Sólo `deriveCkey` (:23) está vivo. | Borrar la constante, corregir el comentario y renombrar a `nucleo/ckey.ts`. | bajo |
| D4 | **`buildManifest`** (`manifest.ts:12-20`) sólo lo usan 5 tests; la producción arma el manifiesto inline (`relay/publicarCubos.ts:122`). | Borrarlo y hacer que los tests usen `publicarPorCubos` o armen el objeto. | bajo |
| D5 | **`ckeysDelTopic`** (`relay/sliceLedger.ts:118-121`) sólo lo usan tests. | Prefijo `__` o borrar. | bajo |
| D6 | **`AlmacenPort` y `leerJson` duplicados**: `relay/sliceLedger.ts:29-56` y `relay/appliedSlices.ts:23-46`. | Un solo `Almacen` en `puertos/` y un `leerJsonValidado` en `nucleo/`. | bajo |
| D7 | **`byteLength` escrito tres veces**: `relayErrors.ts:39`, `topes.ts:47` (`byteLengthUtf8`) y `relay/cubos.ts:29`. | Uno solo en `nucleo/hexBytes.ts` (ya tiene `utf8Bytes`, :28). | bajo |
| D8 | **Timeouts y topes duplicados.** `15_000` aparece en `avatarTopic.ts:25`, `relayQueue.ts:87` y `relay/publicar.ts:81`. El comentario de `avatarTopic.ts:19-23,88-93` justifica duplicarlo «para no cerrar el ciclo `relaySync.ts` → …», pero el código ya no está en `relaySync.ts`. `262_144` aparece en `slices.ts:11` y `topes.ts:45`, justificado por «no arrastrar `expo-crypto`» (`topes.ts:44`), motivo que desaparece con V5. | Crear `nucleo/limites.ts`, un módulo hoja sin imports, con `TIMEOUT_ENVIO_MS`, `MAX_REGISTRO_BYTES`, `RENEWAL_WINDOW_MS` y `SPLIT_BYTES`. | bajo |
| D9 | **Re-exports que sólo usan los tests o que sobran:** `relay.ts:222-223` (`envelopeRow`, `esLimiteDeRitmo`, `RPC_REINTENTO_MS`, `byteLength`, usados por `relayCompaction.test.ts:1`, `ckeyEndToEnd.test.ts:84`, `relayRpc`, `relayPrenda`); `groupInvite.ts:364` (`V1_ACEPTADO_HASTA`); `relay/drenar.ts:21-23` (fachada doble que sólo consume `relaySync.ts:24-31`); el alias `POLL_INTERVAL_MS` (`relay/poll.ts:25-27`, sólo tests); `toHex`/`fromHex` re-exportados desde `envelopeCrypto.ts:99` (22 importadores que deberían ir a `hexBytes`). | Que cada consumidor importe del módulo dueño y borrar los re-exports. | bajo (es mecánico; conviene hacerlo en el mismo script de la mudanza) |
| D10 | **Abrir un sobre está escrito dos veces**: `relay/abrirSobre.ts:19-62` y `relay/relectura.ts:65-72` (firma, descifrado, parse y descarte de manifiestos). | Que `releerFaltantes` llame a `abrirSobre` y filtre por `tipo === 'rebanada'`. | bajo–medio (la relectura hoy no registra `manifest_malformado`; con `abrirSobre` sí lo haría, y es un cambio de rastro, no de datos) |
| D11 | **Comentarios que ubican mal el código.** 34 referencias a `relaySync.ts`/`relayEngine.ts` como dueños de código que se mudó (p. ej. `relay/sliceLedger.ts:5,15,23`, `relay/publicarCubos.ts:16`, `manifest.ts:33,44`, `relay/adaptadorHushSplit.ts:27-29,59,97,122-126`). Hay funciones inexistentes: `buildRelayPayload` (`applyDelta.ts:43`) y `sliceEntities` (`topes.ts:13`, `relay/cubos.ts:8-11`, `relay/publicarCubos.ts:61`). `relay/adaptadorHushSplit.ts:122-126` describe un `mergeGate` que mira `relaySync.ts`, cuando hoy mira `relay/drenar.ts` (`mergeGate.test.ts:118,137`). `relayEngine.ts:20` dice «13 importadores + 84 tests»; hoy son 17 importadores de producción y 83 archivos de test. | Reescribir cada docblock con el esquema **porqué en 1-3 líneas + puntero** (`ver ADR-007 §3.4`, `spec 2026-09-28 §8 C2`). La historia de rondas («verifier, tercera tanda», «hallazgo M3») sale del código: ya está en `git log` y en los specs. Archivos con más de 3 menciones de ese tipo: `relay/publicar.ts` (9), `topes.ts` (6), `avatarTopic.ts` (6), `relaySession.ts`, `relayQueue.ts`, `relay/drenar.ts`, `relay/contactos.ts`, `directoryAuth.ts` (5 cada uno). | nulo en comportamiento. Ojo: `mergeGate.test.ts` busca literales en el código fuente; hay que revisar que ningún guard busque texto dentro de un comentario |
| D12 | **`sliceRenewal.ts` sólo lo usan las fotos** (`avatarTopic.ts:9,78,101,148-149`), para **dos** cosas distintas en el mismo storage: la renovación de la foto propia (marcador `avatar:<user>:<digest>`) y una caché negativa de reintentos de 5 min (`avatar-attempt:…`, `avatarTopic.ts:146-149`). Los marcadores nunca se borran: crecen con cada foto nueva y cada intento. Además exporta `RENEWAL_WINDOW_MS` (:17), que el núcleo importa (V3). | **Unificar con el ledger de cubos** para la publicación de la foto: `leerCubo`/`registrarCubo` sobre el topic de la foto dan exactamente «cambió el digest o venció la renovación» (`relay/publicarCubos.ts:84-87`). La caché negativa pasa a un `Map` en memoria (es un freno de red, no un dato). Borrar `sliceRenewal.ts`. | **medio**: 3 tests de avatar y un cambio de namespace (la primera vez se republica la foto, que es inocuo) |
| D13 | **`turnstileHtml.ts`/`captchaBridge.ts` son de auth, no de sync.** Resuelven el captcha de `signInAnonymously` (`captchaBridge.ts:1-11`); los consume `src/components/TurnstileWidget.tsx:16-17` y, dentro del sync, `relaySession`/`relayNetworkTimeout`. | Mover a `sesion/` en la mudanza. Si algún día existe `src/auth/`, van ahí. | bajo |
| D14 | **Hooks de React dentro del sync**: `useManifestGap.ts` y `useSyncFailure.ts`, los dos sobre `@/src/hooks/useLiveValue` (:1). `useSyncFailure.ts:37` re-exporta `claveDeFalloDeSync` para la pantalla. | Mover a `src/hooks/`. `app/groups/[id].tsx:28-29` importa `claveDeFalloDeSync` de `publishHealth`. Ajustar `src/screens/__tests__/groupManifestGap.test.tsx:32,39`. | bajo |
| D15 | **`require` perezoso hacia la fachada**: `pendingDrain.ts:129-138` pide `./relayEngine` sólo para `olvidarCursor`, que vive en `relay/cursor.ts:30`, una hoja sin imports del sync. | Importarlo directo de `relay/cursor`. Los 4 mocks virtuales de `'../relayEngine'` (§3.3) pasan a mockear `relay/cursor` o se borran. | bajo–medio (esos 4 tests hoy dependen del mock virtual) |
| D16 | **Rama con fecha de vencimiento**: `V1_ACEPTADO_HASTA = 2026-10-14` (`groupKeyWrap.ts:50`); pasada esa fecha, la rama v1 (:111) está muerta. | Ticket fechado para el 2026-10-15: borrar la rama v1 y la constante. | bajo |
| D17 | **Exports que sólo usan los tests y no llevan prefijo `__`**: `olvidarAvisoDeReloj` (`clockNotice.ts:47`), `olvidarPrendaEnCache` (`ownerPledge.ts:38`), `gruposPendientesDeDrenaje` (`pendingDrain.ts:180`), `parseContactInviteLink` (`contactInvite.ts:353`) y `slotsOf` (`recordCore.ts:210`). `myKeyPresence` (`deviceKeys.ts:188-191`) dice «lo lee la UI», pero ningún archivo de UI lo importa. | Prefijo `__` (convención ya usada en `relayQueue.ts:213`, `relaySession.ts:47`) o borrarlos si el test puede ir por la API pública. | bajo |
| D18 | **Módulos que existen por el guard de tamaño**: `relay/drenarTypes.ts:1` («aparte para que el archivo con la lógica quede bajo 260 líneas»). | Llevar sus tipos a `puertos/`, donde tienen sentido propio. | bajo |
| D19 | **Frontera P15 desactualizada**: lista `documento.ts`, que no existe (`relayFrontera.guard.test.ts:43`). | La reemplaza el guard por carpeta (§2.2). | bajo |

**Top 5 de código muerto:** D1 (camino QR y adopción de claves), D2 (`buildGroupPayload`), D3 (`MAX_SLICE_BYTES` y el comentario de índice), D4 (`buildManifest`), D9 (re-exports que sólo usan los tests).

---

## 5 · Si fuera un paquete npm

> **Resumen.** Nombre tentativo: `@hushsplit/relay-sync`. Es ESM-only, como `@noble/*` v2 (`node_modules/@noble/hashes/package.json`: `"type": "module"`; el repo ya importa con sufijo `.js`, p. ej. `envelopeSign.ts:1`).
> Contenido: núcleo + motor + puertos, más un subpath opcional `./supabase` con el adaptador de transporte. Contactos, invitaciones, confianza por registro, sesión y UI quedan afuera.
> Lo que sigue es el borrador COMPLETO del README, en español, tal como lo leería alguien que lo instala.

### 5.1 · Borrador del README

````markdown
# @hushsplit/relay-sync

Sincronización local-first **por estado** entre los dispositivos de un grupo,
a través de un servidor **tonto** que guarda sobres cifrados y no puede abrirlos.

## Qué problema resuelve

Varios dispositivos editan los mismos datos sin servidor propio de aplicación.
Cada uno publica el ESTADO de lo que sabe, partido en rebanadas cifradas y
firmadas, en un buzón compartido. Los demás lo leen desde su cursor y mergean
con la regla de tu app (p. ej. last-write-wins por registro).

## Modelo de amenaza

- El servidor **no puede leer** (XChaCha20-Poly1305 con la clave del grupo) ni **fabricar** sobres (firma Ed25519).
- El servidor **sí puede** retener, borrar, reordenar o reenviar sobres viejos. El manifiesto hace visible lo que falta; el merge descarta lo viejo.
- Quien conoce el topic (un miembro o ex miembro de esa época) puede borrar rebanadas ajenas. Eso se ve (manifiesto) pero no se impide.
- **Fuera de alcance: miembros maliciosos.** Quien tiene la clave del grupo puede escribir cualquier cosa. Para eso hace falta firma por registro, y eso lo pone tu app.
- La distribución de claves de grupo NO es parte del paquete: tu app entrega `claveDelGrupo(grupoId)` y rota épocas.

## Cómo funciona (en una pantalla)

- **Topic** = `SHA-256(hex(clave) : época)`. Sin la clave no se sabe ni dónde mirar.
- Cada campo del documento se corta en **cubos estables por prefijo de id** (16 cubos; con histéresis sube a 256, y nunca baja).
- Cada cubo viaja en un sobre **compactable** por `ckey = SHA-256(hex(clave):ckey:campo:prefijo)`: el buzón guarda sólo la última versión de cada cubo por emisor.
- Sólo se publica un cubo si **cambió su digest** o si pasaron **20 días** (renovación contra el TTL de 30). Además va SIEMPRE un **manifiesto** por emisor con el digest de cada cubo.
- El receptor lee desde su cursor, verifica la firma, descifra, **acota** (tu app decide qué es legítimo) y aplica. Recuerda qué cubos ya aplicó.
- Si el manifiesto declara algo que no tiene, relee **una vez** desde 0. Si sigue faltando, lo reporta. El cursor nunca pasa una rebanada retenida por dependencia.
- **Nunca publica un grupo antes de haberlo drenado** al menos una vez desde que entró (evita resucitar lo que el grupo borró mientras no estabas).

## Instalación

```sh
npm i @hushsplit/relay-sync @noble/ciphers @noble/curves @noble/hashes
# con el adaptador de Supabase:
npm i @supabase/supabase-js
```

En React Native **inyectá `cripto.aleatorio`** con una fuente nativa (p. ej. `expo-crypto` `getRandomBytes`). No confíes en un polyfill de `getRandomValues`: si falla, degrada la entropía en silencio en vez de tirar.

## Puertos

```ts
interface Transporte {
  publicar(topic: string, payload: string, o: { ckey?: string; compactable: boolean; signal?: AbortSignal }):
    Promise<{ ok: true; seq: number } | { ok: false; reason: 'not_configured' | 'too_large' | 'network' | 'rate_limited'; detail?: string }>;
  leerDesde(topic: string, cursor: number, o?: { excluirEmisor?: string; limite?: number }):
    Promise<{ ok: true; sobres: Sobre[]; cursor: number; hayMas?: boolean } | { ok: false; reason: 'not_configured' | 'network'; detail?: string }>;
  borrarMios(topic: string): Promise<{ ok: true; borrados: number } | { ok: false; reason: string; detail?: string }>;
  suscribir(topic: string, alAviso: () => void, alEstado?: (sano: boolean) => void): () => void;
  readonly maxPayloadBytes: number;
}
interface Almacen { get(k: string): string | undefined; set(k: string, v: string): void; delete(k: string): void }
interface Identidad {
  emisor(): string;
  firmar(sellado: string): string;
  claveDelGrupo(grupoId: string): { clave: Uint8Array; epoch: number } | null;
  sesion(): string | null;
  verificarEmisor?(grupoId: string, autor: string, clavePublica: string): Promise<'ok' | 'descartar'>;
}
interface Documento {
  campos: readonly string[];   // en orden de dependencia: lo que otro campo referencia va antes
  armar(grupoId: string, ctx: { emisor: string }): Promise<Record<string, { id: string }[]>>;
  aplicar(grupoId: string, campo: string, registros: unknown[]): Promise<{ porTope: number; porDependencia: number }>;
  excede?(registro: unknown): string | null;
  codec?: { envolver(campo: string, regs: { id: string }[]): unknown; desenvolver(x: unknown): { campo: string; registros: unknown[] }[] };
}
interface Cripto { sha256Hex(s: string): Promise<string>; aleatorio(n: number): Uint8Array }  // default: @noble + getRandomValues
interface Reloj { ahora(): number; ceder(): Promise<void>; alVolverAPrimerPlano?(fn: () => void): () => void }
interface Log { error(mensaje: string, e?: unknown): void }
interface Avisos { publicacion?(g: string, r: ResultadoPublicacion): void; manifiesto?(g: string, faltan: string[]): void; aplicado?(g: string, n: number): void }
```

**Contrato de `aplicar`:** tiene que ser **idempotente** y **conmutativo por registro**: el mismo cubo puede llegar dos veces, o una versión vieja después de una nueva. `porDependencia > 0` significa «esto referencia algo que todavía no tengo»: el motor lo retiene y lo reintenta al final del drenaje, y el cursor no lo pasa.
**Contrato de `Almacen`:** síncrono y ya separado por cuenta. El paquete no sabe de cuentas.

## Ejemplo de integración

```ts
import { crearMotor } from '@hushsplit/relay-sync';
import { transporteSupabase } from '@hushsplit/relay-sync/supabase';

const motor = crearMotor({
  transporte: transporteSupabase(supabase),
  almacen: { get: k => kv.getString(k), set: (k, v) => kv.set(k, v), delete: k => kv.delete(k) },
  identidad: {
    emisor: () => deviceId,
    firmar: sellado => firmarConMiClave(sellado),
    claveDelGrupo: id => claves.get(id) ?? null,         // { clave: Uint8Array(32), epoch }
    sesion: () => usuarioActual?.id ?? null,
  },
  documento: {
    campos: ['tableros', 'tarjetas', 'comentarios'],
    armar: async id => ({ tableros: db.tableros(id), tarjetas: db.tarjetas(id), comentarios: db.comentarios(id) }),
    aplicar: async (id, campo, regs) => db.mergeLWW(id, campo, regs),  // devuelve { porTope, porDependencia }
  },
  avisos: { manifiesto: (g, faltan) => faltan.length && console.warn('incompleto', g) },
});

await motor.publicar('tablero-1');          // sube los cubos que cambiaron + el manifiesto
const r = await motor.drenar('tablero-1');  // baja desde el cursor, verifica, aplica
const off = motor.escuchar('tablero-1');    // aviso realtime → drenaje con debounce + poll de respaldo
```

## Garantías

**Lo que no se pierde:**
- Ningún sobre ajeno se aplica: sin firma válida o sin la clave se descarta antes de tocar tus datos.
- El buzón guarda el **estado completo**: la última versión de cada cubo de cada emisor. Quien entra tarde lee desde 0 y ve todo el historial, sin claves viejas.
- El receptor **recuerda** lo que aplicó. Una publicación parcial no da un falso «falta».
- El ledger del emisor registra un cubo **sólo** cuando el servidor lo confirmó. Un envío que venció por tiempo se reenvía.
- Las publicaciones de un mismo grupo se **serializan**. Una vieja no puede pisar a una nueva en la compactación.
- El cursor **nunca retrocede** por debajo de donde arrancó, y nunca pasa una rebanada retenida que todavía tiene reintentos.

**Límites conocidos (no son bugs, son el diseño):**
- **TTL 30 días vs renovación a 20 días.** Si ningún miembro abre la app durante 30 días, el buzón se vacía de a poco. Nadie pierde datos locales, pero quien entre después no ve lo expirado. El TTL depende de que tu servidor lo corra.
- **Dependencia irresoluble.** Una rebanada que tras **3 drenajes** sigue referenciando algo que no existe se deja atrás: el cursor la pasa, queda reportada como faltante y no se aplica.
- **Relectura acotada.** Se relee a lo sumo **una vez por versión de manifiesto** de cada emisor. Si sigue faltando, se reporta y se espera al próximo manifiesto.
- **Emisor silencioso.** Su manifiesto puede sobrevivir hasta 20 días a un cubo vencido. Quien entra ve el «falta» (ruidoso, no silencioso) y recibe los datos por los demás miembros.
- **Cubo > 256 KB a profundidad máxima (65.536 cubos por campo):** se rechaza `too_large`. Es un grupo de decenas de miles de registros.
- **El `sender` no está autenticado por el servidor;** la clave de firma sí. El manifiesto se cierra sólo con cubos firmados por la misma clave.
- **La firma cubre el sobre sellado**, no el `topic`, la `ckey` ni el `seq`. El servidor puede mover un sobre de lugar; lo que no puede es hacer que se abra con otro contenido.
- **Orden y reloj:** el merge es tuyo. Si usás LWW por `updatedAt`, necesitás un reloj razonable.

## Qué NO incluye

- Distribución y rotación de claves de grupo (invitaciones, links, envoltura X25519).
- Contactos, directorio de claves públicas por cuenta, confianza/firma por registro.
- Autenticación contra el servidor (sesión, captcha): el adaptador de Supabase recibe un cliente ya autenticado.
- UI, notificaciones, i18n, hooks de React.
- El modelo de datos: el paquete ve `{ id: string }[]` por campo, nada más.

## Comparación honesta con Jazz

Jazz (CoJSON) sincroniza **operaciones** de valores colaborativos (CoValues) contra un servidor de sync que conserva el historial, con grupos, roles y permisos resueltos criptográficamente. Este paquete sincroniza **estado** por rebanadas sobre un buzón que olvida (TTL) y deja el merge y los permisos a tu app.
Elegí Jazz si arrancás el modelo de cero, querés historial, roles, reactividad y colaboración fina. Elegí este si ya tenés un modelo con merge LWW propio, querés un servidor que sólo sea un buzón expirable (cualquier Postgres, S3 o KV) y aceptás el costo O(tamaño del grupo) al entrar.
Ninguno de los dos protege contra un miembro malicioso que tiene la clave sin firma por registro de tu lado.

## Versionado y compatibilidad

El **formato de cable** es un contrato entre dispositivos que no se actualizan juntos. Cambiar cualquiera de estos puntos es **versión mayor**:
- Sobre firmado: `{"v":1,"p":<base64(nonce24‖ciphertext)>,"k":<ed25519 pub hex>,"s":<firma hex sobre p>}`.
- Derivación de `topic` y de `ckey` (SHA-256 sobre el texto exacto descrito arriba).
- Manifiesto: `{"version": 2, "entries": [{"ckey","digest"}]}` (`MANIFEST_VERSION = 2`).
- Profundidad máxima (4) y regla de prefijo (hex del UUID, o `sha256(id)` si no es UUID).
- El `codec` por defecto de las piezas. Si tu app pasa su propio `codec`, su formato es contrato TUYO.

Agregar un puerto **opcional** o un aviso nuevo es versión menor. Un receptor que ve un `version` de manifiesto desconocido lo trata como rebanada de datos y el `codec` la rechaza: no se aplica nada que no se entienda.
````

### 5.2 · `package.json` mínimo

```json
{
  "name": "@hushsplit/relay-sync",
  "version": "0.1.0",
  "description": "Sync local-first por estado sobre un buzón tonto, cifrado de punta a punta.",
  "license": "UNLICENSED",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".":          { "types": "./dist/index.d.ts",           "import": "./dist/index.js" },
    "./nucleo":   { "types": "./dist/nucleo/index.d.ts",    "import": "./dist/nucleo/index.js" },
    "./supabase": { "types": "./dist/supabase/index.d.ts",  "import": "./dist/supabase/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist", "README.md"],
  "peerDependencies": {
    "@noble/ciphers": "^2.3.0",
    "@noble/curves": "^2.3.0",
    "@noble/hashes": "^2.3.0",
    "@supabase/supabase-js": "^2.109.0"
  },
  "peerDependenciesMeta": { "@supabase/supabase-js": { "optional": true } },
  "engines": { "node": ">=18" },
  "scripts": { "build": "tsc -p tsconfig.build.json", "test": "vitest run" }
}
```

**Notas:**
- Las versiones de `@noble/*` y `@supabase/supabase-js` son las de la app (`package.json:53-55,60`).
- No hay Expo, React ni React Native en ningún campo.
- `license: UNLICENSED` es un placeholder: si el paquete se publica en abierto, la licencia **la elige el PO**.
- `./nucleo` expone sólo las funciones puras (cubos, ledger, manifiesto, sobre) para quien quiera armar su propio motor. Es opcional: si no hay un caso, conviene no exponerlo y achicar la superficie.

---

## 6 · Hoja de ruta

> **Resumen.**
> - **(a)** Carpetas + poda: 2 a 3 días de agente, riesgo bajo, sin cambio de comportamiento. Recomiendo hacerla **ya**.
> - **(b)** Puertos + inyección, para que el núcleo deje de importar stores: 4 a 6 días, riesgo medio, toca el camino caliente de publicar y drenar.
> - **(c)** Paquete consumido por la app: 3 a 5 días más, riesgo medio por Metro/EAS en monorepo. Recomiendo hacerla **después del lanzamiento y después de T-190**, porque si el spike de Jazz dice «migrar», (c) es trabajo tirado.

| Etapa | Qué | Costo (días de agente) | Riesgo | Nivel P-11 |
|---|---|---|---|---|
| **(a)** Reordenar + podar | Script de mudanza (§3.3), guard por carpeta, READMEs. Poda de D1, D3-D9, D11, D13-D19. D2 (migrar los tests de `buildGroupPayload`) y D12 (fotos al ledger) van en la misma etapa pero en PRs separados. | 1–1,5 mudanza + 1–1,5 poda = **2–3** | **bajo**. Sin cambio de comportamiento, salvo D1 (borra una rama que no se alcanza) y D10/D12 (rastro y namespace). La suite entera es la red. | Standard; D1 y D12 en Strong |
| **(b)** Puertos + inyección | Crear `puertos/`, `crearMotor(puertos)` y el adaptador HushSplit como objeto. Corregir V1-V11. Vectores de prueba cripto antes de V5. `mergeGate` reescrito sobre la inyección. | **4–6** | **medio**. Toca `publishToGroup`/`drainGroup`, que ya pasaron 4 tandas de verifier en T-191. Los tests de caracterización (`relayEngineCaracterizacion`, `publicacionIncremental*`, `receptorIncremental`, `retenidasCursor`) tienen que quedar verdes **sin editarse**, salvo las rutas de mock. | Adversarial (arquitecto + verifier ciego) |
| **(c)** Paquete | `packages/relay-sync` en el mismo repo (npm workspaces), con build ESM y tests propios sin Jest de Expo. La app lo consume. Configurar Metro para el workspace y `transformIgnorePatterns`. Prueba de build EAS Android e iOS. Publicación opcional en npm (licencia: decisión del PO). | **3–5** | **medio**. El riesgo no está en el código sino en el pipeline de build: Metro con monorepo, EAS y el pipeline Android que todavía está sin confirmar. | Strong |

**Recomendación:**
- **(a) ahora, antes del lanzamiento.** Es mecánica, se verifica con la suite y deja el sync legible para cualquier persona. D1 además cierra una rama latente de adopción de claves. Es lo que responde directo a «que ya quede en esta app con esquema modularizado».
- **(b) después del lanzamiento, salvo lo chico que sale gratis en (a):** V3 (MMKV transitivo), V11 (`require` a la fachada), V8 (`memberIds` en el núcleo) y el `Almacen` único de D6. Hacer (b) completa antes de lanzar reabre un camino que acaba de estabilizarse con T-191, a cambio de nada que el usuario vea.
- **(c) después de T-190.** Si el spike de Jazz concluye que conviene migrar, el paquete no tiene futuro y (a)+(b) igual dejaron la app mejor. Si concluye que no, (c) se hace sobre una (b) ya asentada.

**Alternativa descartada:** hacer (b) y (c) juntas antes de lanzar, «para no tocar dos veces». Se descarta porque pone el camino de datos de plata y el pipeline de build en riesgo al mismo tiempo, justo antes del lanzamiento, y porque T-190 puede volver innecesaria a (c).

— nerv-arquitecto · 2026-09-28 · auditoría de sólo lectura, sin stamp de aprobación (no es un plan de ticket; lo revisa el orquestador con el PO)

---

## 7 · Anexo: decisiones del PO, segunda app («QR + mapa + seguirse») y cruce con el diseño del orquestador

> **Resumen.** Para una app de «agregar por QR y verse en un mapa», lo que más sirve **no es el motor de cubos**. Sirve la capa de **identidad + sobre + transporte + contactos por QR + entrega de claves**. La posición es un documento de un registro por persona y no necesita cubos, manifiesto ni renovación.
> Recomiendo **dos paquetes**: `relay-sync`, que además expone la base común (`./sobre`, `./transporte`), y `contact-keys`. Si la próxima app es la del mapa, el orden es base común → `contact-keys` → motor de cubos. Choca con D4 (contactos como capa de HushSplit), así que lo planteo como canje para el PO.
> Hay además un hallazgo de seguridad que en HushSplit pesa poco y en una app de «seguir» pesa más. Una tarjeta de contacto que llega por el buzón no está firmada y trae un `userId` elegido por quien la manda. Alguien que escaneó mi QR puede ocupar de antemano la identidad de otra persona en mi lista (§7.4).

### 7.1 · Qué cambia arriba con las decisiones del PO

| Decisión | Efecto sobre este documento |
|---|---|
| D1: apps propias, no npm público; T-190 cancelado | El §5 queda como README de un **paquete interno** (`"private": true` en lugar de `license`). La etapa (c) del §6 ya no depende de T-190: se hace **cuando exista la segunda app** (coincido con la etapa C del orquestador). |
| D2: cifrado siempre | Sin cambios: el §2/§5 no ofrece modo sin cifrar. |
| D3: documento genérico, merge de la app | Coincide con el puerto Documento (§2.1). |
| D4: motor = sólo sobres y cubos | Coincide para `relay-sync`. Discrepo en que contactos y claves sean **sólo** capas de HushSplit: para la segunda app son lo reutilizable (§7.5). |

### 7.2 · Caso «agregar por QR, verse en un mapa, seguirse»

**(1) Lo que sirve tal cual**

| Pieza | Dónde está | Qué da |
|---|---|---|
| Identidad del aparato: Ed25519 (firma) y X25519 (envoltura) | Generación en `groupInvite.ts:42-45` y `groupKeyWrap.ts:116`. Guardado en `src/store/identityStore.ts:54` (`ensureIdentity`) y `:64` (`ensureWrapKeypair`), **fuera de `src/sync`** | Un par de claves por aparato, persistido cifrado |
| Contacto por QR con canal **mutuo** | `contactChannel.ts:30-56` (diseño), `ensureContactSecret` :68, `announceContact` :136, `drainContacts` :236 | Un escaneo agrega en los dos teléfonos. Deja un buzón por persona, que es la base de «seguir» |
| Topic y clave del buzón de contacto, con dominios separados | `contactTopic.ts:11-31` | El servidor ve el topic pero no puede derivar la clave |
| Pineo de claves («verificar en persona») | `contactPeers.ts:37-45` (`savePeer`, pisa), `:60-71` (`savePeerFromCard`, sólo completa huecos), `:153-160` (`hasConflictingPinnedKeys`, lo usa `app/contact/add.tsx:159,343`) | Una clave vista en persona no la reemplaza el buzón |
| Entrega de la clave de un grupo a un contacto, firmada y envuelta X25519, con época | `contactGroupKeyDrop.ts:37-50` (formato), `:106` (firma), `:150-161` (verificación contra la pineada) | Sirve para repartir la clave de «mi posición» a quien me sigue |
| Política ante claves en disputa (T-136) | `groupKeyOffers.ts:100` (`aplicarOferta`) y `:143` (`estadoDe`), las dos puras | Dos claves distintas para lo mismo → no se adopta ninguna y decide la persona |
| Sobre cifrado + firmado | `envelopeCrypto.ts:53`, `envelopeSign.ts:46` | Igual |
| Transporte + aviso realtime + poll de respaldo | `relay.ts:104,197`, `relaySend.ts:73`, `relay/poll.ts:23-24` | Igual |
| Agregar a distancia por link de un solo uso | `contactInvite.ts:52` (`createContactInvite`), `:186-293` (claim/grant) | «Seguime» por WhatsApp sin estar juntos |

**(2) Lo que sirve a medias: la «última posición conocida»**

El modelo natural es **un topic por persona** con **su** clave: un «grupo» donde escribe una sola persona y leen sus seguidores. La clave llega por `contactGroupKeyDrop`. Dejar de compartir con alguien = **rotar la época** y volver a entregar la clave a los demás. Cuesta O(seguidores) sobres.

- **Costo por actualización con el motor de cubos, tal como está: 2 sobres** (el cubo + el manifiesto, que sale siempre: `relay/publicarCubos.ts:122-126`; spec §5 P7).
  - La cuota es **20 sobres/min por uid** (`supabase/011a_relay_rls_aditiva.sql:17`). Nace en modo observar y **011b la pasa a rechazar** (`011b_relay_rls_corte.sql:27,115`).
  - Eso da como techo teórico ~10 posiciones/min, si esa persona no manda ningún otro sobre.
  - `publishToGroup` no pasa por `relayQueue` (spec §8 C4). Una ráfaga termina en `rate_limited`, que se reintenta **una vez por vuelta de poll** (`relay/publish.ts:139-144`).
- **Costo con una «pieza única» compactable: 1 sobre.** Es un sobre con `ckey` fija por persona, sin cubos ni manifiesto, el mismo patrón que la foto (`avatarTopic.ts:65-102`) pero compactable. Techo teórico ~20/min. Uso sano: una cada 15-30 s en movimiento y nada estando quieto.
  - El manifiesto existe para que un documento **grande** no parezca completo cuando le falta algo (ADR-007 §8.2). Con un solo registro no hay nada que completar: si no llegó la última, se ve la anterior.
- **Latencia de punta a punta con el socket sano:**
  - debounce de publicación de 1,5 s (`relay/publish.ts:23`);
  - aviso Realtime;
  - debounce de drenaje de 1,5 s (`relay/drain.ts:110`);
  - `fetchSince` y ~37 ms de verificación por sobre (spec §1).

  En total **~3-5 s**. Si el aviso se pierde, hasta **90 s** con los canales sanos o **20 s** con alguno caído (`relay/poll.ts:23-24`).
- **Con la app cerrada no hay nada.** El poll sólo se reengancha al volver a primer plano (`relay/poll.ts:111-113`). «Seguirse» en segundo plano necesita una tarea de ubicación en background que publique, y eso está fuera del sync.
- **La renovación a 20 días y el TTL de 30 no aportan nada, o molestan.** Una posición de hace 20 días no tiene que renovarse: la app la oculta por antigüedad (campo `at` del registro).
- **Metadatos que el servidor sí ve:** `topic`, `sender` (el id del aparato, columna `sender` de la fila: `relaySend.ts:17-26`), el horario y la frecuencia de publicación. No ve la posición, pero la frecuencia delata «se está moviendo». Hay que decirlo en la política de privacidad de esa app.

**(3) Lo que no sirve**

- **Stream continuo (≤ 1 s):** la cuota de 20/min lo impide y cada sobre es una fila persistida. Hace falta un canal **efímero** (broadcast cifrado sin persistir). Hoy no existe: el cliente sólo **escucha** un aviso y «nadie puede PUBLICAR desde el cliente (no hay policy de insert)» (`relay.ts:180-181`). Es otro transporte y otra migración de servidor.
- **Sin internet:** nada. El QR sólo lleva el secreto; el intercambio de tarjetas va por el buzón (`contactChannel.ts:136`). La sync por QR sin internet se sacó (T-085) y BLE está planeado, no implementado (CLAUDE.md, tabla de stack).

### 7.3 · Contactos + claves + identidad: qué importan y cuánto cuesta darles frontera propia

| Módulo | Importa de la app | Qué lo ata a HushSplit | Costo |
|---|---|---|---|
| `contactTopic.ts` | `expo-crypto` :1 | Los dominios `'splitp2p/contact/v1…'` (:11-12) son **contrato de cable**: se parametrizan con default igual al actual | **chico** |
| `groupKeyWrap.ts` | `expo-crypto` :4 (bytes aleatorios en :117) | Nada. La rama v1 muere el 2026-10-14 (:50, D16) | **chico** |
| `contactPeers.ts` | utils/secureStorage :1, store/userScope :2, `type ContactCard` :3 | Sólo el almacén → puerto Almacén **seguro** | **chico** |
| `groupKeyOffers.ts` | utils/secureStorage :1, store/userScope :2, store/groupKeyStore :3 | Tiene núcleo puro (`aplicarOferta` :100, `estadoDe` :143) y el resto es persistencia + lectura de la clave local | **chico** |
| `contactGroupKeyDrop.ts` | store/identityStore :4, store/authStore :5, store/groupKeyStore :6, `groupInvite` :7 (wrap), `groupKeyOffers` :8, `relay` :3; tiene su propio `utf8` (:13-24), un duplicado más de D7 | `groupName` en el formato (:40); lee la clave del store; firma con la privada del store (:106) | **medio** |
| `contactChannel.ts` | `expo-crypto` :1, utils/secureStorage :2, store/userScope :3, svc/avatarSize :4, store/authStore :5, store/userStore :6, store/identityStore :9, store/groupKeyStore :10, utils/syncedClock :11 | **Mezcla tres cosas:** (a) canal: secreto, topic, enviar y drenar; (b) una tarjeta con **perfil de HushSplit** (`name`, `avatar` + `avatarCabe`, :79-128) que al llegar **escribe en `useUserStore`** con `authProvider: 'google'` (:270-281, el campo en :277); (c) **adopción de claves de grupo** dentro del drenaje (`resolverOfertas` :206-228, llamado en :309) | **medio–grande**: hay que partirlo en canal / tarjeta (puerto Perfil) / claves. 358 líneas, 21 `jest.mock`, 26 archivos de test |
| `contactInvite.ts` | `@noble/curves` :1, `expo-crypto` :2, utils/appLink :6, utils/linkCompacto :7, utils/nombreSeguro :8 | El formato del **link** (dominio y ruta de HushSplit) va junto con la cripto del token | **medio**: separar un codec de link (app) de claim/grant (paquete) |
| `deviceKeys.ts` | store/identityStore :2, store/authStore :3; tabla de Supabase directa (`getRelayClient` + `.from(TABLE)`, :47-60) | Es el **directorio por cuenta** (ADR-004): necesita cuentas y una tabla del servidor. La app del mapa, con pineo por QR, no lo necesita | queda como **adaptador opcional** (puerto `Directorio`); no entra al paquete |
| `ownerPledge.ts` | `require` de store/identityStore :21 | Es la prenda de ADR-009 para borrar lo propio: **detalle del transporte Supabase**, no de contactos | va a `adaptadores/supabase` (ya está así en §3.1) |
| *(fuera de sync)* `src/store/identityStore.ts` | `expo-crypto` :1, secureStorage :3, userScope :4, `groupInvite` :6 | Genera y guarda identidad, envoltura y prenda, y además guarda invitaciones (:127-237) | **medio**: generación y guardado de claves → `contact-keys/identidad`; las invitaciones siguen en la app |

**Total estimado para darle frontera propia a `contact-keys`: 3-5 días de agente, riesgo medio.** Lo caro es partir `contactChannel.ts`. Las pruebas de dos dispositivos que ya existen (`anunciarMiTarjeta.test.ts`, `contactChannel.test.ts`, `contactInviteEngine.test.ts`) son la red.

### 7.4 · Hallazgo: se puede ocupar de antemano la identidad de un contacto por el buzón

- La tarjeta que llega por el buzón de contactos **no va firmada**. Se sella con la clave del buzón y se manda (`contactChannel.ts:167-171`); del otro lado se abre sin verificar ninguna firma (`contactChannel.ts:265`).
- Su `userId` lo elige quien la manda: sólo se descarta si es el propio (`contactChannel.ts:269`).
- La clave de ese buzón la tiene «TODO el que haya escaneado ese código alguna vez» (`contactGroupKeyDrop.ts:31-34`).
- `savePeerFromCard` **nunca reemplaza** una clave ya guardada (`contactPeers.ts:46-71`).
- **Consecuencia:** quien escaneó mi QR puede dejarme una tarjeta a nombre del `userId` de Carol, con **sus** claves, antes de que Carol aparezca. Cuando la tarjeta verdadera de Carol llegue por el buzón, sus claves se ignoran.
- La defensa que hay es el QR en persona: `hasConflictingPinnedKeys`, desde `app/contact/add.tsx:159,343`. Esa defensa sólo se activa si **yo** escaneo a Carol, no si ella me escanea a mí.
- **En HushSplit** (círculos chicos de gente conocida) el riesgo es bajo. **En una app de «seguir»**, donde muchos escanean a una persona, cualquiera de esos seguidores puede sembrar contactos falsos.
- **Corrección para `contact-keys`, no para este documento:** la tarjeta se firma con la Ed25519 de quien la manda, y el `userId` del canal pasa a ser **autocertificado** (derivado de la clave pública, p. ej. su huella). Así un `userId` no se puede ocupar con otra clave.
- Queda **a confirmar con un test rojo** antes de abrir un ticket. Es seguridad de identidad: la severidad la fija el PO.

### 7.5 · ¿Uno o dos paquetes? ¿En qué orden?

**Decisión: dos paquetes, sin un tercero por ahora.**
- **`@hushsplit/relay-sync`**: motor de cubos (§2, §5). Además expone la base común en `./sobre` (cifrar, firmar, topic, hex) y `./transporte` (puerto + adaptador Supabase + poll). Suma un modo **pieza única compactable** (`publicarUnica`/`leerUltima` por `(topic, emisor)`), generalizando lo que hoy hace `avatarTopic.ts` para las fotos. Es lo que necesita la posición.
- **`@hushsplit/contact-keys`**: identidad del aparato, canal de contacto mutuo por QR o link, pineo, entrega de claves envueltas con época y política de ofertas en disputa. Depende de `relay-sync/sobre` y `relay-sync/transporte`. Sus puertos son **Perfil** (qué lleva la tarjeta y qué hacer al recibirla; en HushSplit, escribir en `userStore`), **ClavesLocales** (leer y adoptar; en HushSplit, `groupKeyStore`), **Almacén seguro** y **Directorio** opcional.

**Por qué dos y no uno:** tienen **contratos de cable distintos** y cambian a ritmos distintos. Los cubos y el manifiesto (`MANIFEST_VERSION`) por un lado; los dominios `splitp2p/contact/v1`, el formato de tarjeta y la firma del drop (`contactGroupKeyDrop.ts:52-54`) por el otro. También tienen **modelos de amenaza distintos**: el motor asume miembros honestos; `contact-keys` es justamente donde se decide en quién confiar. Con un paquete único, un cambio en la tarjeta obligaría a subir la versión mayor del motor.

**Alternativa descartada:** tres paquetes (`sobre`/`transporte` aparte). Hoy sólo agrega versionado y ninguna app lo pide. Si aparece un tercer consumidor de la base, se separa: en un monorepo es barato.

**Orden de extracción (canje para el PO; D4 dice otra cosa):**
1. **Etapa (a) del §6**: carpetas + poda, igual que antes.
2. **Base común**: V5 (Cripto) + V6 (Transporte) + `Almacén` único. Es chica y la necesitan los dos paquetes.
3. **Si la próxima app es la del mapa**: `contact-keys` (§7.3, 3-5 días) + pieza única (~1 día) **antes** que los puertos del motor de cubos. La app del mapa no usa cubos.
4. **Si la próxima app es de «documento por grupo»** (lista, presupuesto, inventario): etapa (b) del motor de cubos primero, y `contact-keys` después.

Mi recomendación, dado lo que describe el PO, es la **3**. Pero es decisión de producto: depende de cuál es de verdad la segunda app.

### 7.6 · Dónde difiero del diseño del orquestador (`2026-09-28-motor-sync-reutilizable-design.md`)

| # | Tema | Orquestador | Arquitecto | Por qué |
|---|---|---|---|---|
| 1 | `relayNetworkTimeout` | `motor/publicacion/` (:90) | `sesion/` | Importa `captchaBridge` (`relayNetworkTimeout.ts:1`) y pausa el timeout mientras el captcha es interactivo. Es de sesión, y metido en el motor le trae el captcha adentro |
| 2 | `topes` | `motor/sobre/` (:86) | núcleo, **partido** | Mide `memberIds` ≤ 100 (`topes.ts:20-23,43`), una regla de HushSplit. En el motor, por defecto sólo bytes; lo demás va por `documento.excede` (V8) |
| 3 | `claveVigente` | `adaptadores/documento/` (:95) | motor (puerto ClavesDeGrupo) | Compara clave y época del **grupo** (`relay/claveVigente.ts:14-17`), no tiene nada del documento. Lo usan `drenar` y `relectura` |
| 4 | `derivedRecords` | `adaptadores/documento/` (:95) | `confianza/` | Es T-041 S6 («registros que nadie puede firmar»); lo usan `recordHealth.ts:7` y `trustCheck.ts:4` |
| 5 | `relayQueue`, `cederHilo` | los dos en `motorApp/` (:98) | **Concedo `relayQueue`**: sus únicos importadores son `relayEngine` y `relay/contactos` (§1.2), porque `publishToGroup` no la usa (spec C4). **Mantengo `cederHilo` en el núcleo** | `cederHilo` lo usan `relay/publicar.ts:8` y `relay/drenar.ts:10` |
| 6 | `publishHealth`, `manifestHealth` | `avisos/` (:103) | motor/núcleo en la etapa A; `avisos/` **después** de B | Antes de los puertos, `chequeoManifiesto` importa `manifestHealth` (`relay/chequeoManifiesto.ts:3`). Moverlo a `avisos/` en A haría que el motor importe una capa de producto |
| 7 | Guard | barrer el directorio `motor/` con prohibiciones por nombre (:40) | lo mismo **más** prohibir todo import relativo que salga de la carpeta, y chequear **transitivamente** | Sin eso, `motor/publicarCubos` → `../motorApp/sliceRenewal` (MMKV) pasa el guard: es V3 |
| 8 | `Identidad.clavePrivadaFirma(): Uint8Array` | exponer la privada (:57) | `firmar(sellado): string` | El motor nunca necesita **tener** la privada. Así la app puede firmar desde el llavero del sistema |
| 9 | `Transporte.publicar(…, ownerTag, …)` | `ownerTag` en el puerto (:47) | adentro del adaptador de Supabase | La prenda y el `owner_tag` son de ADR-009 y del esquema de Supabase (`ownerPledge.ts:1-12`). Otro servidor autentica distinto |
| 10 | Puerto Documento | `envolver` + `acotar` + `aplicar(delta)` separados (:63-70) | `aplicar(grupo, campo, registros)` + `codec` | **Concedo el del orquestador para la etapa B**: coincide 1:1 con `adaptadorHushSplit` y achica el cambio. El mío es para el README del paquete; se converge después |
| 11 | Costo y momento de B | 2-3 días, «ahora» (:126) | 4-6 días, después del lanzamiento salvo lo chico | Mi estimación suma los vectores cripto (V5), el `SyncDelta` genérico (V4), reescribir `mergeGate` (V1) y la verificación Adversarial. El orquestador tiene razón en que sin T-190 no hay motivo de producto para esperar. **La diferencia es de riesgo antes del lanzamiento: decide el PO** |
| 12 | Conteo | «~85 archivos» (:243) | 88 | Medido (§3.1) |
| 13 | Guards a actualizar | lista `inventarioDeAvisos` y `accountCoverage` | se me habían pasado | **El orquestador tiene razón**: los agregué a §3.3 |
| 14 | Contactos/claves | capa de HushSplit (D4) | candidato a segundo paquete (§7.5) | Por la app del mapa |

— nerv-arquitecto · 2026-09-28 · anexo agregado a pedido del orquestador; §2.1, §3.3 y §5.1 corregidos en el mismo pase (fuente aleatoria en RN, dos guards que faltaban)
