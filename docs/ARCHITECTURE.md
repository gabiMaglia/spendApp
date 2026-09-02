# Arquitectura: Motor de Sincronización Local-First P2P

## Principio general

Toda la información vive en la base de datos embebida del dispositivo. La app funciona al 100% sin internet. Cuando dos dispositivos se encuentran (hoy: por internet vía relay cifrado, o WebRTC directo escaneando un QR; BLE está planeado y no implementado), intercambian solo los cambios que el otro no tiene (delta sync).

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
  // Borrado consensuado
  deletionVotes: DeletionVote[];
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
  // Borrado consensuado
  deletionVotes: DeletionVote[];
}

interface Split {
  userId: string;
  amount: number;             // cuánto debe este usuario de este gasto
  isPaid: boolean;
}

interface DeletionVote {
  userId: string;
  votedAt: number;
  action: 'delete' | 'cancel';
}

type ExpenseCategory =
  | 'food' | 'transport' | 'accommodation' | 'entertainment'
  | 'utilities' | 'health' | 'shopping' | 'other';
```

---

## Motor de sincronización: `SyncEngine`

### Regla fundamental: Last-Write-Wins por `updatedAt`

```typescript
// src/sync/SyncEngine.ts
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

---

## Borrado consensuado {#deletion-consensus}

**DECISIÓN**: El creador del gasto puede forzar el borrado unilateralmente. Los demás miembros pueden objetar (voto `cancel`), pero no pueden bloquearlo permanentemente.

### Diferencia entre borrar y liquidar

Estas son dos acciones completamente distintas con flujos separados:

| Acción | Qué hace | Necesita consenso |
|---|---|---|
| **Liquidar deuda** | Registra que el dinero se transfirió en la realidad. El gasto queda en el historial. | No — cualquier miembro lo puede hacer unilateralmente. |
| **Borrar gasto** | Elimina el gasto del cálculo de balances, como si nunca hubiera existido. | Sí — con poder de veto parcial (ver abajo). |

### Reglas del borrado

1. Cuando alguien quiere borrar un gasto, emite un `DeletionVote { action: 'delete', userId, votedAt }`.
2. Los demás miembros ven una notificación "X quiere borrar este gasto" y pueden votar `cancel`.
3. **Si nadie objeta en 72 horas** (o el creador del gasto lo fuerza), el gasto se marca `isDeleted: true`.
4. Si alguien vota `cancel`, el borrado se cancela y el creador recibe notificación.
5. El **creador del gasto** (`createdById`) puede forzar el borrado inmediato independientemente de los otros votos.

```typescript
// src/sync/deletionConsensus.ts

const DELETION_TIMEOUT_MS = 72 * 60 * 60 * 1000; // 72 horas

export function resolveDeletionVotes(
  expense: Expense,
  currentUserId: string
): boolean {
  const latestVotes = new Map<string, DeletionVote>();
  for (const vote of expense.deletionVotes) {
    const existing = latestVotes.get(vote.userId);
    if (!existing || vote.votedAt > existing.votedAt) {
      latestVotes.set(vote.userId, vote);
    }
  }

  // El creador puede forzar el borrado unilateralmente
  const creatorVote = latestVotes.get(expense.createdById);
  if (creatorVote?.action === 'delete' && creatorVote.userId === expense.createdById) {
    // Verificar si marcó "forzar"
    if ((creatorVote as any).forced === true) return true;
  }

  // Algún miembro objetó → no borrar
  const hasCancelVote = Array.from(latestVotes.values()).some(v => v.action === 'cancel');
  if (hasCancelVote) return false;

  // Timeout: si hay voto de delete y pasaron 72hs sin objeciones
  const deleteVotes = Array.from(latestVotes.values()).filter(v => v.action === 'delete');
  if (deleteVotes.length > 0) {
    const oldestDeleteVote = Math.min(...deleteVotes.map(v => v.votedAt));
    return Date.now() - oldestDeleteVote > DELETION_TIMEOUT_MS;
  }

  return false;
}
```

### Caso de conflicto offline simultáneo

- Usuario A emite `delete` mientras está offline.
- Usuario B emite `cancel` mientras está offline.
- Al sincronizarse, `mergeData` fusiona los `deletionVotes` por `userId`, ganando el de mayor `votedAt`.
- Si gana `cancel`, el borrado no procede (la objeción de B prevalece).
- Si A es el creador y forzó el borrado, prevalece sobre cualquier otro voto.

---

## Liquidación de deudas {#debt-settlement}

Liquidar es un gasto especial de tipo `payment`:

```typescript
interface Payment extends SyncMeta {
  groupId: string;
  fromUserId: string;   // quien pagó
  toUserId: string;     // quien recibió
  amount: number;
  currency: string;     // en qué moneda se hizo el pago
  targetCurrency?: string; // si el pago fue en divisa diferente a la deuda
  exchangeRate?: number;   // tipo de cambio usado (Pro)
  date: number;
  type: 'payment';      // distingue de Expense
}
```

`Payment` es un tipo de `Expense` con `type: 'payment'` y `splits` pre-calculados que cancelan el balance entre dos usuarios. Cualquier miembro puede **declarar** que pagó.

### El acuse de recibo (T-064, 2026-09-01)

Esta sección decía «no necesita consenso para registrarse» y **eso ya no es cierto en un grupo `consensus`**. Declarar el pago no lo efectiviza: quien **cobra** tiene que acusar recibo.

| Estado | Cuenta en el balance | Cómo se llega |
|---|---|---|
| `efectivo` | sí | grupo `open`, o lo declaró quien cobra, o hay acuse `confirm` |
| `pendiente` | **sí** | lo declaró quien paga y todavía no hay acuse |
| `rechazado` | **no** | quien cobra dijo que no lo recibió ⇒ la deuda vuelve |

Que `pendiente` cuente es deliberado (D1): quien ya transfirió la plata **no puede quedar de deudor** mientras espera. Lo que no hace es mostrarse como cerrado — la fila lo dice, y quien cobra recibe el aviso `settlement_pending`.

**No hay plazo automático** (D2). A diferencia del borrado consensuado, acá el silencio no consiente. La contracara es que un pago falso le borra la deuda al que lo declara hasta que el otro actúe, y por eso **el rechazo no es opcional**: es el único freno que existe.

El acuse es un registro **firmado y colaborativo**, no un campo de estado: `SettlementConfirmation` con `k`/`s`, unido en el merge como los votos de borrado. Un `status` guardado sería LWW y cualquier peer lo pisaría republicando con `updatedAt` mayor — la trampa exacta de T-053. `paymentId` va adentro de la firma, o un "sí, lo recibí" de mil pesos valdría para uno de cien mil.

Ver `engram/plans/T-064.md` para las tres decisiones del PO y `src/algorithms/settlementStatus.ts` para el derivador.

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

---

## Capa P2P: `useP2PConnection`

**DECISIÓN**: Sync automática P2P pura via signaling público (Google STUN/TURN, Matrix).

### Estrategia de conectividad

| Canal | Cuándo usarlo | Librería |
|---|---|---|
| WebRTC automático | App en primer plano con internet | `react-native-webrtc` + STUN de Google |
| BLE | Usuarios cerca sin internet | `react-native-ble-plx` — **NO IMPLEMENTADO.** No está en `package.json` ni hay código que lo use. Lo que existe para el caso sin internet es el emparejamiento WebRTC por QR (`src/p2p/`) |
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

Para que dos teléfonos establezcan una conexión WebRTC necesitan intercambiar señales ICE. Se usarán:
- **STUN servers de Google**: `stun:stun.l.google.com:19302` (gratuitos, estables)
- **TURN server de Open Relay**: `turn:openrelay.metered.ca` (fallback si STUN falla por NAT)
- Los peers se "encuentran" usando su `groupId` como room ID en un servidor de signaling público Matrix.

### Seguridad del canal

- La clave de cifrado simétrico del grupo se genera al crear el grupo y viaja en el token de invitación (QR o deep link).
- Todo payload se cifra con XChaCha20-Poly1305 usando esa clave antes de enviarse por el relay o por WebRTC DataChannel (`envelopeCrypto.ts`). BLE no existe todavía.
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

- El usuario puede exportar un archivo `.splitp2p` cifrado con su clave de cifrado maestra (derivada del `userId`).
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
