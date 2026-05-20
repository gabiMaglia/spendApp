# Features: SplitP2P

## Modelo de monetización

**La monetización principal es por publicidad, no por suscripción.**

- **Free**: Primeros 4 gastos del día sin restricciones. A partir del 5to, el usuario debe ver un anuncio (rewarded ad) para desbloquear la creación. Sin límite de grupos.
- **Pro**: Sin anuncios. Sin límite de gastos diarios. Acceso a features premium.

El contador de gastos diarios es de **creaciones** (no de gastos activos). Borrar un gasto no devuelve slots.

---

## Matrix Free vs Pro

| Feature | Free | Pro | Implementación |
|---|---|---|---|
| **Gastos diarios** | 4 gratis + rewarded ads | Ilimitados | Contador en MMKV por fecha UTC; rewarded ad via AdMob |
| **Cálculo de balances** | ✅ | ✅ | Sumatoria en `calculateBalances()` |
| **Simplificación de deudas** | ✅ | ✅ | Greedy en `simplifyDebts()` |
| **Grupos** | Ilimitados | Ilimitados | Sin restricción |
| **Liquidación de deudas** | ✅ | ✅ | `Payment` entity, sin consenso |
| **Multi-moneda (balance separado)** | ✅ | ✅ | Balances por currency code |
| **Conversión de divisas al liquidar** | Manual (el usuario ingresa el tipo) | Automático (API de exchange rates) | Free: campo editable; Pro: fetch en tiempo real |
| **Escaneo de recibos (OCR)** | ❌ | ✅ | API externa de OCR (imagen → montos) |
| **Gráficos y estadísticas** | ❌ | ✅ | Agregaciones locales por categoría/fecha |
| **Búsqueda avanzada** | Solo texto básico | Filtros por fecha, monto, categoría | WatermelonDB query builder |
| **Respaldo de recibos en nube** | ❌ | ❌ | Imágenes solo locales en ambos tiers. La diferenciación Pro es el OCR. |
| **Backup a iCloud / Google Drive** | ✅ | ✅ | Feature de seguridad básico |
| **Publicidad (banners + rewarded)** | ✅ | ❌ | AdMob SDK |
| **Sync P2P** | ✅ | ✅ | Sin restricciones |
| **Exportar CSV/PDF** | ❌ | ✅ | Generación local |

El plan Pro se valida vía RevenueCat SDK (verificación de compra en App Store / Play Store). Requiere internet para la verificación inicial; el estado se cachea localmente.

---

## Fases de construcción

### Fase 1 — Fundación (MVP offline, un usuario)
Objetivo: la app funciona completamente offline para un solo usuario.

- [ ] Configurar Jest + `@testing-library/react-native` + `jest-expo`
- [ ] Configurar i18n (`expo-localization` + `i18next`) con locales es/en/pt
- [ ] `src/constants/currencies.ts` con las 9 monedas + formateador con `Intl.NumberFormat`
- [ ] Autenticación con Google (Expo Auth Session)
- [ ] Autenticación con Apple (Sign in with Apple)
- [ ] Schema WatermelonDB (User, Group, Expense, Payment, Split)
- [ ] CRUD de grupos (sin límite)
- [ ] CRUD de gastos con splits manuales (4 modos: igual, exacto, porcentaje, partes)
- [ ] Liquidación de deudas (`Payment` entity, sin consenso)
- [ ] Cálculo de balances por grupo (multi-moneda: balances separados por currency)
- [ ] Simplificación de deudas (algoritmo Greedy)
- [ ] Balance global cross-group en dashboard
- [ ] UI: Dashboard, lista de grupos, detalle de grupo, crear gasto, liquidar deuda
- [ ] Monetización básica: AdMob rewarded ad a partir del 5to gasto del día
- [ ] Backup a iCloud / Google Drive (exportar/importar `.splitp2p`)

### Fase 2 — Sincronización P2P
Objetivo: dos dispositivos se sincronizan correctamente.

- [ ] `SyncEngine` con `mergeData` (LWW) y tombstones
- [ ] `buildDelta` para enviar solo cambios por grupo
- [ ] `resolveDeletionVotes` con timeout de 72hs y override del creador
- [ ] Token de invitación (base64url con groupId + clave AES)
- [ ] `useP2PConnection` vía WebRTC (signaling: Google STUN + Open Relay TURN)
- [ ] Handshake con `SyncHandshake` payload
- [ ] Sync automática al abrir app, al recuperar internet, cada 15min en primer plano
- [ ] UI: pantalla "Agregar miembro" con QR y deep link
- [ ] UI: indicador de estado de sync (sincronizado / pendiente / error)

### Fase 3 — Monetización Pro
Objetivo: conversión a plan pago y features premium.

- [ ] Integración RevenueCat (compra de Pro en App Store / Play Store)
- [ ] OCR de recibos (API externa — ver punto abierto en FEATURES.md)
- [ ] Conversión de divisas automática al liquidar (API exchange rates)
- [ ] Gráficos y estadísticas (Victory Native o Skia)
- [ ] Búsqueda avanzada con filtros
- [ ] Respaldo de imágenes de recibos en nube
- [ ] Exportación CSV/PDF local
- [ ] Eliminar ads para usuarios Pro

### Fase 4 — Conectividad extendida
Objetivo: sync sin necesidad de internet.

- [ ] `useP2PConnection` vía BLE (`react-native-ble-plx`)
- [ ] Sync por Wi-Fi local (mDNS / Bonjour)
- [ ] Username como atajo para invitar a peers conocidos

---

## Reglas de UX para borrado consensuado

**DECISIÓN**: El creador del gasto puede forzar el borrado. Los demás tienen 72hs para objetar.

### Flujo para el creador del gasto

1. Toca "Eliminar gasto".
2. Opciones:
   - **"Solicitar eliminación"** → los demás tienen 72hs para objetar. Si no hay objeción, se borra.
   - **"Forzar eliminación ahora"** → se borra inmediatamente sin esperar. Queda en el historial de actividad.
3. El gasto queda visible pero marcado con badge "Eliminación pendiente" hasta que se resuelva.

### Flujo para miembros que no son el creador

1. Ven el badge "Eliminación pendiente" en el gasto.
2. Pueden tocar "Objetar" → agrega voto `cancel`, cancela el borrado y notifica al creador.
3. Si no hacen nada en 72hs, el gasto se borra automáticamente.

### Diferencia con liquidar una deuda

Liquidar no tiene este flujo. Cualquier miembro puede registrar un pago sin aprobación de los demás. Ver `docs/ARCHITECTURE.md#debt-settlement`.

---

## Monetización por publicidad (Free tier)

**Lógica**: Los primeros 4 gastos del día son gratuitos. A partir del 5to, el usuario debe ver un **rewarded ad** (anuncio recompensado de AdMob) para desbloquear cada gasto adicional. El contador nunca se revierte — borrar gastos no devuelve slots.

```typescript
// src/services/tierLimits.ts
const FREE_DAILY_FREE_EXPENSES = 4; // gratis sin ad
// A partir del 5to: rewarded ad por cada gasto adicional

export function getDailyExpenseCount(userId: string): number {
  const today = new Date().toISOString().split('T')[0]; // 'YYYY-MM-DD' UTC
  const key = `expense_count_${userId}_${today}`;
  return parseInt(MMKV.getString(key) ?? '0', 10);
}

export function requiresRewardedAd(userId: string, isPro: boolean): boolean {
  if (isPro) return false;
  return getDailyExpenseCount(userId) >= FREE_DAILY_FREE_EXPENSES;
}

export function incrementExpenseCount(userId: string): void {
  const today = new Date().toISOString().split('T')[0];
  const key = `expense_count_${userId}_${today}`;
  const count = getDailyExpenseCount(userId);
  MMKV.set(key, String(count + 1));
}
```

### Flujo UX del rewarded ad

1. Usuario toca "Agregar gasto" (es su 5to del día).
2. La app muestra: *"Viste tus 4 gastos gratis de hoy. Ver un anuncio para continuar."*
3. Botones: **"Ver anuncio"** | **"Obtener Pro"**
4. Si elige "Ver anuncio": AdMob muestra el rewarded ad. Al completarlo, se desbloquea la creación.
5. Si el ad falla (sin internet, etc.): *"No hay anuncios disponibles ahora. Intentá más tarde."*

## Notificaciones

**DECISIÓN**: Notificaciones locales únicamente, disparadas después de cada sync P2P. Sin push real ni Firebase. El usuario recibe las notificaciones la próxima vez que abre la app y el sync corre.

### Eventos que generan notificación local post-sync

| Evento | Texto de la notificación |
|---|---|
| Gasto nuevo en un grupo mío | `"Ana agregó $1200 en 'Supermercado' — tu parte: $600"` |
| Solicitud de borrado de gasto | `"Carlos quiere borrar 'Cena' ($800). Tenés 72hs para objetar."` |
| Pago / liquidación registrada | `"Bob te marcó como pagado $500."` |
| Invitación a un grupo nuevo | `"Laura te invitó al grupo 'Vacaciones 2025'."` |

### Implementación

```typescript
// src/sync/SyncEngine.ts — post-merge hook
function notifyLocalChanges(newRecords: SyncMeta[], currentUserId: string) {
  for (const record of newRecords) {
    if (record.isDeleted || record.createdById === currentUserId) continue;

    if (record.type === 'expense') {
      scheduleLocalNotification({
        title: record.groupName,
        body: `${record.createdByName} agregó $${record.amount} en "${record.description}"`,
      });
    }
    // ... otros tipos
  }
}
```

Se usa `expo-notifications` para programar la notificación local. No requiere FCM, Firebase, ni permisos de red adicionales. En iOS requiere el permiso de notificaciones del usuario.

---

## OCR de recibos (Pro) {#ocr}

**DECISIÓN**: On-device con Google ML Kit. Sin API externa, sin internet, sin credenciales.

- Librería: `@react-native-ml-kit/text-recognition`
- Corre 100% en el dispositivo (modelo descargado con la app)
- El usuario saca una foto del ticket → ML Kit extrae el texto → un parser local identifica los campos

### Qué se extrae

| Campo | Estrategia de extracción |
|---|---|
| **Monto total** | Regex buscando el número más grande precedido de "total", "importe", "$", etc. |
| **Ítems individuales** | Líneas con patrón `[descripción] [precio]` — permite dividir item por item en el gasto |
| **Fecha** | Regex de formatos de fecha comunes (DD/MM/YYYY, YYYY-MM-DD, etc.) |
| **Nombre del comercio** | Primera o segunda línea del ticket (suele ser el header del local) |

### Flujo UX

1. Usuario toca "Escanear ticket" (solo visible en Pro).
2. Expo Camera abre en modo captura.
3. La imagen se procesa con ML Kit → campos detectados se pre-completan en el formulario del gasto.
4. El usuario revisa y corrige antes de confirmar.
5. La imagen original se guarda en `Expo FileSystem` (local).

### Almacenamiento de imágenes

**DECISIÓN**: Solo local. Las imágenes de recibos viven en `Expo FileSystem` del dispositivo. No hay respaldo en nube. Si el usuario desinstala, las imágenes se pierden (los datos del gasto en sí se recuperan vía backup o P2P sync; solo las fotos no).

La diferenciación Pro en esta feature viene por el OCR (extracción automática de datos), no por el storage de la imagen.
