# Arquitectura: Motor de Sincronización Local-First P2P

## Principio general

Toda la información vive en la base de datos embebida del dispositivo. La app funciona al 100% sin internet. Cuando dos dispositivos se encuentran (hoy: **por internet vía relay cifrado, y nada más**; el WebRTC directo por QR se sacó en T-083 —estaba en el repo pero no se llegaba a él— y BLE está planeado y no implementado), intercambian solo los cambios que el otro no tiene (delta sync).

No hay servidor central. No hay base de datos compartida en la nube.

---

## Modelo de datos TypeScript

Toda entidad persistida debe incluir los tres campos de sincronización obligatorios:

```typescript
interface SyncMeta {
  id: string;           // UUID generado en el cliente (nunca en servidor)
  updatedAt: number;    // Unix timestamp en ms — define quién gana en conflictos
  isDeleted: boolean;   // Tombstone — nunca hacer DELETE físico
}

interface User extends SyncMeta {
  name: string;
  email: string;
  avatarUrl?: string;
  authProvider: 'google' | 'apple';
}

interface Group extends SyncMeta {
  name: string;
  memberIds: string[];        // IDs de User
  currency: string;           // ISO 4217, ej: 'ARS', 'USD'
  createdAt: number;
}

interface Expense extends SyncMeta {
  groupId: string;
  description: string;
  amount: number;
  currency: string;
  paidById: string;           // quién pagó
  splits: Split[];
  receiptImageUri?: string;   // local URI o URL S3 (Pro)
  category: ExpenseCategory;
  date: number;               // timestamp del gasto (no del registro)
  createdById: string;
  // Borrado libre (T-186): campos del "resto", sin firma — sólo para
  // que Actividad muestre quién borró/restauró.
  deletedById?: string;
  restoredById?: string;
}

interface Split {
  userId: string;
  amount: number;             // cuánto debe este usuario de este gasto
  isPaid: boolean;
}

type ExpenseCategory =
  | 'food' | 'transport' | 'accommodation' | 'entertainment'
  | 'utilities' | 'health' | 'shopping' | 'other';
```

---

## Motor de sincronización: `SyncEngine`

> **Nota de rutas (T-206-A).** `SyncEngine.ts` es un nombre conceptual: no
> existe ese archivo. La implementación real vive repartida en
> `src/sync/motor/` (cuándo sincronizar), `src/sync/nucleo/` (el protocolo) y
> `src/sync/adaptadores/hushsplit/applyDelta.ts` (el merge LWW de abajo). Ver
> `src/sync/README.md` para el mapa completo de carpetas.

### Regla fundamental: Last-Write-Wins por `updatedAt`

```typescript
// concepto — implementación real en src/sync/adaptadores/hushsplit/applyDelta.ts
export class SyncEngine {
  /**
   * Combina estado local y remoto. Gana siempre el registro con mayor updatedAt.
   * Si isDeleted=true con updatedAt mayor, el borrado se propaga.
   */
  mergeData<T extends SyncMeta>(local: T[], remote: T[]): T[] {
    const map = new Map<string, T>();

    for (const item of local) {
      map.set(item.id, item);
    }

    for (const item of remote) {
      const existing = map.get(item.id);
      if (!existing || item.updatedAt > existing.updatedAt) {
        map.set(item.id, item);
      }
    }

    return Array.from(map.values());
  }

  /**
   * Genera el delta a enviar al peer: solo registros más nuevos que su último sync.
   */
  buildDelta<T extends SyncMeta>(allRecords: T[], peerLastSync: number): T[] {
    return allRecords.filter(r => r.updatedAt > peerLastSync);
  }
}
```

### Por qué los tombstones evitan la resurrección de datos

Escenario sin tombstones:
1. Usuario A borra un gasto (offline) → lo elimina de su DB.
2. Usuario B tiene el gasto → al sincronizar, B "enseña" el gasto a A.
3. SyncEngine lo ve como nuevo en A y lo recrea. El gasto resucita.

Con tombstones (`isDeleted: true`, `updatedAt` actualizado):
1. Usuario A marca el gasto con `isDeleted: true, updatedAt: Date.now()`.
2. Al sincronizar con B, `mergeData` compara timestamps.
3. Si `updatedAt` de A > `updatedAt` de B, el estado `isDeleted=true` gana.
4. El gasto queda marcado como borrado en ambos dispositivos. Nunca resucita.

> **Nota T-146:** El drenaje pagina (`DRAIN_FETCH_LIMIT` × `DRAIN_MAX_PAGES`), no
> avanza el cursor sobre una rebanada que falló (3 intentos, `drainFailures.ts`)
> y la `ckey` de una rebanada es por índice (T-146).

---

## Borrado y liquidación: libres, sin acuerdo (T-186)

**DECISIÓN (2026-09-27):** hasta T-186 existía un modo «con acuerdo» — ronda de 72hs para objetar un borrado, override firmado del creador, y acuse de recibo para liquidar. Se sacó de cuajo. Ahora hay un solo comportamiento, para las dos acciones:

- **Borrar un gasto**: cualquier miembro del grupo lo borra al instante (`isDeleted: true` + `deletedById`, tombstone de siempre). Cualquier miembro lo restaura desde Actividad (`isDeleted: false` + `restoredById`). `deletedById`/`restoredById` son campos del nivel "resto" — LWW, sin firma, no una prueba — sólo para que Actividad muestre quién hizo qué.
- **Liquidar una deuda**: cualquier miembro **declara** un `Payment` y cuenta para el balance al instante. No hay acuse de quien cobra ni estado `pendiente`/`rechazado` — `src/algorithms/settlementStatus.ts` se reduce a `pagosQueCuentan(payments, group)`, que sólo filtra por grupo y por tombstone.

Lo que **no** cambió: la firma del núcleo (`recordCore`/`recordSign`), la disputa de autoría (`autoriaTrust`), el merge por niveles y `leaveRequest` con sus aprobaciones firmadas.

El mapa completo de lo que se sacó, dónde vivía cada pieza y cómo volver a traer el modo «con acuerdo» si hiciera falta está en **`docs/CONSENSO-PENDIENTE.md`** — no se repite acá para no tener dos fuentes de verdad.

---

## Invitación a grupos {#group-invitation}

**DECISIÓN**: Tres mecanismos de invitación disponibles simultáneamente.

Un "token de invitación" contiene `groupId` + clave de cifrado AES-256 del grupo, codificado en base64url.

| Método | Flujo | Cuándo usarlo |
|---|---|---|
| **QR presencial** | El creador muestra un QR en pantalla. El invitado lo escanea. | Cuando están físicamente juntos. El más seguro. |
| **Deep link** | El creador comparte `splitp2p://join/<token>` por WhatsApp/SMS/etc. | Cuando están lejos. El token expira en 48hs. |
| **Username** | El creador escribe el username del otro usuario. Necesita que ambos se hayan "visto" antes (sync previo). | Para usuarios frecuentes. Ver nota abajo. |

**Nota sobre username sin servidor**: Sin servidor de directorio, un username solo puede usarse para invitar a alguien que ya fue peer tuyo en el pasado (su perfil está en tu DB local). Para el MVP, los métodos principales son QR y deep link. El username como atajo para peers conocidos se agrega en Fase 2.

### Clave de grupo entregada por contacto (T-136 · ADR-013)

Crear un grupo con un contacto le entrega la clave por el buzón de contacto (`sendGroupKey`), firmada y envuelta para su X25519. La firma prueba **quién** manda, no que sea miembro: «contacto» es cualquiera que haya escaneado mi QR. Por eso una clave entregada no se adopta a ciegas:

- Cada entrega válida es una **oferta** por (grupo, remitente) en `src/sync/invitaciones/groupKeyOffers.ts` (bucket cifrado `groupkeys`, scopeado por cuenta, tope de 5 remitentes por grupo, dedupe del reenvío de cada arranque).
- Al final de cada drenaje (`drainContacts`), un grupo sin clave local cuyas ofertas coinciden se **adopta solo**: es el camino normal.
- Si las ofertas difieren —entre sí, o contra una clave local que vino de contacto— **no se adopta ni se sustituye nada**. Se avisa `group_key_conflict` (un solo aviso sin leer por grupo) y el usuario elige un remitente en `GroupKeyConflictCard`. Lo mismo si un grant de invitación choca con una clave de contacto (`inviteEngine.redeem`).
- Elegir (`services/elegirClaveDeGrupo.ts`) sólo es posible si la clave local, de existir, vino de una oferta adoptada. Purga la copia local del grupo (`purgarGrupoLocalmente`), adopta la elegida, marca el grupo pendiente de drenaje y drena el topic real. No publica nada.
- Las claves de `ensureKey`, del QR y de la invitación **nunca** son sustituibles por este camino: S3-A1 sigue cerrado.

Residual (ADR-013): atar el `groupId` a su creador con firma daría un árbitro criptográfico y haría innecesaria la elección manual; un usuario engañado puede elegir mal, y el aviso aclara que el nombre del contacto no está verificado.

---

## Capa P2P: `useP2PConnection`

**DECISIÓN**: Sync automática P2P pura via signaling público (Google STUN/TURN, Matrix).

### Estrategia de conectividad

| Canal | Cuándo usarlo | Librería |
|---|---|---|
| ~~WebRTC automático~~ | — | **SACADO el 2026-09-08 (T-083).** Nunca estuvo enchufado: la única entrada era un botón dentro de una pantalla huérfana. Arrastraba ocho permisos de Android y dos cadenas del `Info.plist` de iOS, incluida la de micrófono |
| BLE | Usuarios cerca sin internet | `react-native-ble-plx` — **NO IMPLEMENTADO.** No está en `package.json` ni hay código que lo use. La pantalla de sync por QR sin internet (T-085), que nadie navegaba, se borró en T-193 — tag `qr-sync-antes-de-T-193` |
| Wi-Fi Local | Misma red local | mDNS / Bonjour |

La sync se intenta automáticamente:
1. Al abrir la app.
2. Cuando el dispositivo recupera conectividad.
3. Cada 15 minutos mientras la app está en primer plano.

### Protocolo de handshake

Al conectarse dos dispositivos intercambian primero su estado de sync:

```typescript
interface SyncHandshake {
  userId: string;
  groupIds: string[];              // grupos en común
  lastSyncTimestampByGroup: Record<string, number>; // por grupo para granularidad
}
```

Cada dispositivo responde enviando solo el delta: registros con `updatedAt > lastSyncTimestamp` del peer. Esto minimiza el payload en cada sync.

### Signaling P2P sin servidor propio

**Sección histórica — WebRTC se sacó en T-083 y esto NO describe el sistema de hoy.** Se conserva porque el diseño puede volver a hacer falta el día que se reabra: para que dos teléfonos establezcan una conexión WebRTC necesitan intercambiar señales ICE, y se iban a usar:
- **STUN servers de Google**: `stun:stun.l.google.com:19302` (gratuitos, estables)
- **TURN server de Open Relay**: `turn:openrelay.metered.ca` (fallback si STUN falla por NAT)
- Los peers se "encuentran" usando su `groupId` como room ID en un servidor de signaling público Matrix.

### Seguridad del canal

- La clave de cifrado simétrico del grupo se genera al crear el grupo y viaja en el token de invitación (QR o deep link).
- Todo payload se cifra con XChaCha20-Poly1305 usando esa clave antes de enviarse por el relay (`envelopeCrypto.ts`). El DataChannel de WebRTC se fue con T-083; BLE no existe todavía.
- El servidor de signaling solo ve el `groupId` (sin contenido ni identidades reales).
- Sin la clave del grupo, un tercero no puede leer los datos en tránsito.

---

## Almacenamiento local

| Qué guarda | Dónde |
|---|---|
| Entidades principales (Expense, Group, User, Payment) | WatermelonDB (SQLite embebido, reactivo) |
| Estado de sync (lastSyncTimestamp por grupo/peer) | MMKV (clave-valor rápido) |
| Clave de cifrado del grupo | Expo SecureStore (Keychain / Keystore) |
| Imágenes de recibos (local) | Expo FileSystem |
| Estado de sesión (JWT, userId, isPro) | MMKV |

WatermelonDB permite queries reactivas en tiempo real que actualizan la UI automáticamente cuando llegan cambios del peer.

## Backup y recuperación {#backup}

**DECISIÓN**: Backup cifrado exportable a iCloud Drive (iOS) / Google Drive (Android).

- El usuario puede exportar un archivo `.hushsplit` cifrado con su clave de cifrado maestra (derivada del `userId`).
- Para importar en un dispositivo nuevo, el usuario provee el archivo + su cuenta Google/Apple (para derivar la clave de descifrado).
- Este backup incluye todos los grupos, gastos y claves de cifrado de grupos.
- Disponible para todos los tiers (Free y Pro) — es un mecanismo de seguridad básico, no un diferenciador de plan.

**Limitación**: El backup solo contiene los datos del usuario que lo generó. Al sincronizar con peers, el dispositivo nuevo recibirá los datos actualizados del grupo vía P2P sync normal.

---

## Autenticación

Flujo con Expo Auth Session (sin backend):

1. Usuario inicia sesión con Google o Apple → obtiene un JWT del proveedor.
2. El JWT se verifica localmente (claims básicos) y se guarda en MMKV.
3. El `sub` (subject) del JWT se usa como `userId` global del usuario.
4. No hay sesión en servidor: la identidad es el JWT del proveedor.

La autenticación solo identifica al usuario dentro del dispositivo y para compartir su `userId` con peers. No hay autorización centralizada.
