# T-124 · L-E — Clave de cifrado MMKV de entropía real (arranque en limpio)

- **Fecha:** 2026-09-14
- **Ticket:** T-124 (parte L-E). L-B, L-C y L-F van aparte, con diseño corto, sin spec.
- **Nivel:** Strong (cifrado en reposo) → QA Strong + verificador ciego.
- **Origen:** auditoría de seguridad #2, hallazgo L-E (Baja) · `engram/qa/SEC2*.md`.
- **Decisiones del PO (2026-09-14):** partir T-124; no hay datos que preservar (sólo builds de desarrollo); enfoque **B · empezar de cero**.

## 1. Problema

`src/utils/encryptionKey.ts` genera 32 bytes aleatorios y los guarda como **64 caracteres hex**. La clave viaja a nativo como `std::string` (`node_modules/react-native-mmkv/cpp/MmkvHostObject.cpp:21`) y MMKV copia como mucho `AES_KEY_LEN` = 16 bytes (`node_modules/react-native-mmkv/MMKV/Core/aes/AESCrypt.cpp:51`). Los primeros 16 caracteres hex son 8 bytes de entropía: **AES-128 con 64 bits reales**, no los 256 que dice el código.

## 2. Objetivo y no-objetivos

**Objetivo:** que los 16 bytes que usa MMKV sean de entropía máxima práctica y que ninguna instalación quede cifrada con la clave vieja.

**No-objetivos:**
- 128 bits reales: exigiría pasar bytes crudos a nativo (cambio del módulo o de cómo se pasa la clave). Queda fuera.
- Preservar datos locales existentes (decisión del PO: sólo hay datos de prueba).
- Respaldo cifrado con frase clave (L-F, futuro).

## 3. Diseño

### 3.1 Clave v2 — `src/utils/encryptionKey.ts`

- Nombre en el llavero: `mmkv_encryption_key_v2`. Opciones iguales a hoy: `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- Formato: **16 caracteres del ASCII imprimible `0x21`–`0x7E`** (alfabeto de 94). Cada carácter ocupa 1 byte en UTF-8, así que son exactamente los 16 bytes que usa MMKV. Entropía: `16 · log2(94) ≈ 104.9 bits`.
- Función pura exportada `generarClaveMMKV(fuente: () => Uint8Array | Promise<Uint8Array>)` con **muestreo por rechazo**: descarta bytes `≥ 188` (`188 = 2·94`, el mayor múltiplo de 94 ≤ 256) y mapea `b % 94 + 0x21`; pide más bytes hasta completar 16.
- `getOrCreateEncryptionKey()` lee o crea **sólo** la v2. Se agrega `borrarClaveV1()` que elimina `mmkv_encryption_key_v1` del llavero (idempotente, ignora "no existe").
- No se usan bytes crudos (`> 0x7F`): en UTF-8 ocupan 2 bytes y MMKV cortaría la clave a mitad de carácter.

### 3.2 Arranque en limpio — `src/utils/secureStorage.ts` · `bootstrapSecureStorage()`

Marca nueva en el meta store en claro `enc_meta`: **`enc_clave_v2`**.

**Sin `enc_clave_v2`** (primer arranque de la versión nueva, o instalación limpia), en este orden:

1. Para cada `id` de `SECURE_IDS`:
   - abrir el bucket como hoy: con la clave v1 si `enc_<id>_v1` es `true` y la v1 existe en el llavero; si no, en claro;
   - `clearAll()`;
   - `recrypt(claveV2)`.
2. Vaciar los buckets **en claro por cuenta**: `settings` y `tier`, la misma lista `SCOPED_PLAIN` de `src/store/wipeDevice.ts`, que se exporta y se reutiliza para no duplicarla. **No** se tocan `theme`, `lang`, `fx` ni `migrations`.
3. Escribir `enc_clave_v2 = true` y borrar las marcas `enc_<id>_v1`.
4. Recién después, `borrarClaveV1()`.
5. Registrar las instancias abiertas (ya con v2) en `instances`, como hoy.

**Con `enc_clave_v2`:** abrir cada bucket con `encryptionKey: claveV2`. No hay `clearAll` ni `recrypt`.

**Robustez ante un corte a mitad de camino:** la marca se escribe al final, así que un corte deja la marca sin escribir y el próximo arranque repite los pasos 1-4. Un bucket ya recifrado con v2 que se abre con v1 (o en claro) devuelve basura o nada y se vuelve a vaciar y recifrar. El estado final es idéntico (todo vacío, cifrado con v2), por eso **no hacen falta marcas por bucket**. La clave v1 sólo se borra con la marca ya escrita, así nunca falta mientras pueda hacer falta.

**Fallas:** se conserva el comportamiento actual. Si no se puede obtener la clave v2, todo cae a memoria con error registrado. Si un `id` falla, sólo ese cae a memoria con `logStorageFailure` y el resto sigue.

### 3.3 Qué ve quien ya tiene la app instalada

Al abrir la versión nueva queda **sin sesión y sin datos locales**:
- pierde grupos, gastos, contactos, claves de grupo e identidad de dispositivo;
- sus contactos tienen que volver a escanearlo;
- en el buzón quedan sobres viejos ilegibles, que vencen solos a los 30 días.

Dos teléfonos de prueba que comparten un grupo lo pierden los dos. El respaldo exportado antes de actualizar recupera los datos del grupo, pero no las claves ni los contactos. Esto es aceptado por el PO. El PO lo tiene que saber antes de instalar la versión, así que se anota en el handoff del ticket y en las notas del build.

## 4. Tests

Todos los tests son de lógica, no de estilos, y usan los mocks de `src/test-utils/setup.ts`. Se amplía el mock de MMKV para registrar `clearAll`, `recrypt` y la `encryptionKey` de cada instancia.

**`src/utils/__tests__/encryptionKey.test.ts`**
1. `generarClaveMMKV`: longitud 16; todos los caracteres en `0x21`–`0x7E`; `Buffer.byteLength(clave, 'utf8') === 16`.
2. Rechazo: con una fuente que primero entrega sólo bytes `≥ 188` y después bytes válidos, descarta los altos y termina con 16 caracteres.
3. Mapeo determinístico: bytes conocidos dan la clave esperada.
4. La constante del alfabeto tiene 94 símbolos, así que la entropía por diseño es ≥ 104 bits. Guarda contra volver a hex.
5. `getOrCreateEncryptionKey` crea `mmkv_encryption_key_v2`, la reutiliza si existe y nunca lee ni devuelve la v1.
6. `borrarClaveV1` elimina la v1 y no falla si no existe.

**`src/utils/__tests__/secureStorage.test.ts`**
1. Sin `enc_clave_v2` y con buckets marcados `enc_<id>_v1`: los 10 ids reciben `clearAll` y `recrypt(v2)`; `settings` y `tier` quedan vaciados; `theme` y `lang` intactos; queda `enc_clave_v2 = true`; las marcas v1 borradas; la clave v1 borrada **después** de escribir la marca (orden verificado).
2. Instalación limpia (sin v1 ni marcas): termina con la marca v2 y no falla por ausencia de la v1.
3. Con `enc_clave_v2`: abre con v2; cero `clearAll` y cero `recrypt`.
4. Corte simulado (excepción tras el bucket 5): no se escribe la marca ni se borra la v1; en el arranque siguiente se repite todo y se llega al estado final.
5. Un `id` que falla cae a memoria y los demás siguen.

**Prueba de rojo:** los tests 1-5 de clave y 1-4 de bootstrap fallan contra `main` antes del cambio.

**Mutaciones que deben hacer caer tests:**
- clave de vuelta a hex de 64;
- `borrarClaveV1()` antes de escribir la marca;
- quitar `clearAll()` del paso 1;
- quitar el vaciado de `SCOPED_PLAIN`.

Verificación de rutina: `npx jest`, `npx tsc --noEmit`, `npm run lint` (base 127 warnings / 0 errores).

## 5. Verificación en aparato (obligatoria antes de Done)

El mock no prueba el comportamiento real de MMKV, así que hay que recorrer esto en un teléfono:

1. Instalar la versión actual (`main` previo) y crear un grupo con un gasto.
2. Sin desinstalar, instalar la versión nueva con `npx expo run:ios`.
3. Comprobar que arranca sin sesión, vacía y sin crash.
4. Iniciar sesión, crear datos, cerrar la app a la fuerza y reabrir: los datos persisten. Eso confirma que la clave v2 abre lo que cifró.
5. Repetir en Android con `npx expo run:android`.
6. Opcional: matar la app durante el primer arranque de la versión nueva y confirmar que el siguiente queda limpio y usable.

No hay cambio de dependencias nativas, así que no hace falta `expo prebuild --clean`.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| `recrypt` sobre un bucket abierto con la clave equivocada se comporta distinto en nativo que en el mock | Se vacía antes de recifrar; verificación en aparato §5.6 |
| Otro módulo abre un bucket cifrado antes del bootstrap | Sin cambio: los proxies ya resuelven a la instancia después del bootstrap (`SecureLazyStorage`) |
| Un tester instala sin saber que pierde todo | Aviso en handoff y en las notas del build (§3.3) |
| La lista `SCOPED_PLAIN` se desincroniza (lección T-055/T-057/T-060) | Se importa desde `wipeDevice.ts` en vez de duplicarla |
