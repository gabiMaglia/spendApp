# Arquitectura: local-first con buzón cifrado

## Principio general

Toda la información vive en el dispositivo. La app funciona al 100 % sin internet. Los miembros de un grupo se sincronizan **sólo por internet, a través de un buzón cifrado en Supabase** que guarda sobres que no puede abrir (ADR-003). Cada publicación lleva las rebanadas del estado del grupo que cambiaron y el buzón conserva el estado completo (ADR-007, T-191); no hay delta por fecha ni conexión directa entre teléfonos (ver «Transporte»).

No hay servidor con lógica de negocio ni base de datos compartida en claro.

---

## Modelo de datos TypeScript

**La fuente de verdad es `src/types/models.ts`**; acá va el mapa, no el detalle. Toda entidad que viaja por el sobre lleva `SyncMeta` (`id` UUID de cliente, `updatedAt`, `isDeleted` tombstone) y, si tiene núcleo firmado, `CoreSigned` (`rev`, `k`, `s`).

| Entidad | Campos que deciden negocio | Notas |
|---|---|---|
| `User` | `name`, `email`, `avatar` (data URI; `null` = tombstone), `authProvider` google/apple/guest, `deletedAt` | `deletedAt` hace que cada peer muestre «Cuenta borrada» en su idioma |
| `Group` | `name`, `currency` (una por grupo), `createdById`, `miembros: {userId: {estado: in/out, at}}`, `memberIds` **derivado**, `defaultSplitMode`, `supersededByGroupId` (traspaso) | `leaveRequest` existe hoy y se elimina con la absorción (auditoría H-1) |
| `Expense` | `groupId`, `amount` entero, `currency`, `paidById` + `payers?`, `splits[{userId, amount, isPaid}]`, `splitMode`, `category`, `date`, `createdById`, `editedById`, `deletedById`/`restoredById` (LWW, sin firma), `autoriaDisputada` | id `rec_<plantilla>_<vencimiento>` si lo materializó una recurrente |
| `Payment` | `groupId`, `fromUserId`, `toUserId`, `amount`, `currency`, `date`, `createdById` | `targetCurrency`/`exchangeRate` sin UI |
| `ExpenseComment` | `expenseId`, `authorId`, `text` | entidad propia para que dos comentarios simultáneos sobrevivan al LWW |
| `RecurringExpense` | igual que un gasto + `rule {frequency, startDate, endDate?}`, `memberIds`, `splitValues`, `lastMaterializedAt`, `isActive` | `groupId: ''` = personal |

Locales por cuenta (no viajan; el backup los cubre): `PersonalEntry` (`kind` expense/income/group_replicated/carryover, `sourceGroupExpenseId`), `PersonalBudget`, archivados, ajustes, contactos, alias.

Derivados en runtime, nunca persistidos: `DeudaPar`, `Balance`/`BalanceByCurrency`, `Transaction` (sugerencia de `simplifyDebts`), `Notice`. El DER completo está en `engram/qa/auditoria-negocio-2026-09-29.md` §6.

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

  // NO hay buildDelta por fecha: se publica el ESTADO del grupo por rebanadas
  // (regla #8 de CLAUDE.md, ADR-007, T-191).
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

Dos mecanismos:

| Método | Flujo | Archivo |
|---|---|---|
| **Contacto por QR presencial** | Cada uno escanea el QR del otro; queda un canal de contacto cifrado. Crear un grupo con un contacto le entrega la clave por ese canal (sección siguiente). | `app/contact/add.tsx`, `src/sync/contactos/` |
| **Deep link al grupo** | El creador comparte un link con `groupId` + clave envuelta; expira a las 48 h. | `src/sync/invitaciones/groupInvite.ts`, `app/groups/join.tsx` |

No hay invitación por username: sin directorio no hay a quién buscar.

### Clave de grupo entregada por contacto (T-136 · ADR-013)

Crear un grupo con un contacto le entrega la clave por el buzón de contacto (`sendGroupKey`), firmada y envuelta para su X25519. La firma prueba **quién** manda, no que sea miembro: «contacto» es cualquiera que haya escaneado mi QR. Por eso una clave entregada no se adopta a ciegas:

- Cada entrega válida es una **oferta** por (grupo, remitente) en `src/sync/invitaciones/groupKeyOffers.ts` (bucket cifrado `groupkeys`, scopeado por cuenta, tope de 5 remitentes por grupo, dedupe del reenvío de cada arranque).
- Al final de cada drenaje (`drainContacts`), un grupo sin clave local cuyas ofertas coinciden se **adopta solo**: es el camino normal.
- Si las ofertas difieren —entre sí, o contra una clave local que vino de contacto— **no se adopta ni se sustituye nada**. Se avisa `group_key_conflict` (un solo aviso sin leer por grupo) y el usuario elige un remitente en `GroupKeyConflictCard`. Lo mismo si un grant de invitación choca con una clave de contacto (`inviteEngine.redeem`).
- Elegir (`services/elegirClaveDeGrupo.ts`) sólo es posible si la clave local, de existir, vino de una oferta adoptada. Purga la copia local del grupo (`purgarGrupoLocalmente`), adopta la elegida, marca el grupo pendiente de drenaje y drena el topic real. No publica nada.
- Las claves de `ensureKey`, del QR y de la invitación **nunca** son sustituibles por este camino: S3-A1 sigue cerrado.

Residual (ADR-013): atar el `groupId` a su creador con firma daría un árbitro criptográfico y haría innecesaria la elección manual; un usuario engañado puede elegir mal, y el aviso aclara que el nombre del contacto no está verificado.

---

## Transporte: sólo el relay {#transporte}

**No hay capa P2P.** WebRTC se sacó en T-083, BLE y Wi-Fi local nunca se implementaron, y la pantalla de sync por QR sin internet se borró en T-193 (tag `qr-sync-antes-de-T-193`). El único camino es el buzón cifrado de Supabase: cada grupo tiene un topic derivado de su clave, cada publicación va cifrada con XChaCha20-Poly1305 (`src/sync/nucleo/envelopeCrypto.ts`) y firmada (`envelopeSign.ts`); el servidor guarda bytes que no puede abrir. No hay handshake ni `lastSyncTimestamp` por peer: hay un cursor por topic (`src/sync/motor/`).

La sync corre sola: al abrir la app, al recuperar red, por Realtime y con un poll de respaldo cada 90 s (20 s si un canal se cayó, DEC-04). Ver `src/sync/README.md` para el mapa de carpetas y `docs/ADR-007-el-estado-vive-en-el-buzon.md` para por qué el buzón conserva el estado completo.

## Almacenamiento local

| Qué guarda | Dónde |
|---|---|
| Entidades (Group, Expense, Payment, User, comentarios, recurrentes) | MMKV, un bucket por store, cifrado con clave por dispositivo y scopeado por cuenta (`src/utils/secureStorage.ts`, `src/store/userScope.ts`), en memoria con Zustand |
| Personal, presupuesto, ajustes, archivados, contactos, alias | MMKV, mismos buckets scopeados |
| Claves de grupo, identidad del aparato, prenda del buzón | MMKV cifrado (`groupKeyStore`, `identityStore`) |
| Cursores de sync, diario de borrado, migraciones | MMKV |
| Foto de ticket y avatar | data URI / URI local (`expo-file-system`) |
| Cotizaciones | MMKV sin scope (son públicas) |

WatermelonDB se evaluó y se sacó el 2026-09-03: seis semanas instalado sin que nada lo importara.

## Backup y recuperación {#backup}

Archivo `.hushsplit` **v3** (`src/services/backup.ts`, T-213): JSON **en claro** con todo lo que la app persiste por cuenta, incluidas las claves de grupo, exportable e importable desde Cuenta → Respaldo mediante la hoja de compartir del sistema. Importar es **RESTORE por reemplazo**: deja los datos exactamente como el archivo. No hay integración con iCloud ni Google Drive. Desde el mismo lugar se exportan CSV de gastos y de movimientos personales (`csvExport.ts`).

---

## Autenticación

Google (Expo Auth Session), Apple (`expo-apple-authentication`) o **invitado** sin proveedor (`authProvider: 'guest'`). El `sub` del proveedor (o un id local para invitado) es el id de la cuenta; no hay sesión en servidor. La identidad criptográfica es del aparato (Ed25519/X25519, ADR-004) y se ata a la cuenta por el directorio de claves de Supabase, salvo para invitados, que quedan fuera del directorio pero sincronizan igual. Varias cuentas en el mismo teléfono se enlazan por alias (ADR-008). El detalle vive en `src/sync/sesion/` y `src/sync/confianza/`.
