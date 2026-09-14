# T-122 — OTA apagado en producción (cierra SEC M-6)

- **Fecha:** 2026-09-14
- **Ticket:** T-122 · hallazgo M-6 de la auditoría de seguridad #2 (`engram/qa/SEC2*.md`).
- **Nivel:** Standard.
- **Decisiones del PO (2026-09-14):** no mantener OTA; no desinstalar `expo-updates` («lo que sea menos conflictivo para la publicación en tiendas»). Enfoque: apagar con bandera.

## 1. Problema

`expo-updates` está configurado (`app.json` → `updates.url` a EAS, `checkAutomatically: ON_LOAD`, `runtimeVersion: { policy: fingerprint }`) desde T-079, y los builds de `eas.json` tienen `channel`. Quien controle la cuenta de Expo puede publicar JavaScript que se ejecuta en todos los teléfonos sin pasar por App Review y sin firma de código (M-6, Media, supply chain). Ningún archivo de `src/` o `app/` usa la API de `expo-updates`: el mecanismo existe, pero el producto no lo necesita.

## 2. Objetivo y no-objetivos

**Objetivo:** que el binario de producción no consulte ni aplique updates remotos. Así se ejecuta siempre el bundle embebido, que es el que revisa Apple.

**No-objetivos:**
- Desinstalar `expo-updates` o tocar dependencias.
- Firma de código de updates (`codeSigningCertificate`): queda como requisito para reactivar OTA en el futuro.
- Cambiar `runtimeVersion`, `updates.url` o los `channel` de `eas.json`.

## 3. Diseño

### 3.1 Configuración — `app.json`

Agregar `"enabled": false` dentro de `expo.updates`, sin tocar el resto:

```json
"updates": {
  "enabled": false,
  "url": "https://u.expo.dev/88d3c8b4-b5e6-4a6e-babb-10ce779746e2",
  "fallbackToCacheTimeout": 0,
  "checkAutomatically": "ON_LOAD"
}
```

`expo prebuild` lo traduce a `EXUpdatesEnabled = false` en `Expo.plist` (iOS) y a la meta-data `expo.modules.updates.ENABLED = false` (Android). Con eso el módulo no consulta el servidor y usa sólo el bundle embebido.

Para reactivar hay que poner `true`, pero sólo después de configurar la firma de código (§3.3).

### 3.2 Test — `src/__tests__/configDeUpdates.test.ts`

- Se conserva el test existente de `runtimeVersion` = `fingerprint`, que sigue siendo válido si OTA se reactiva.
- Nuevo `describe('OTA en producción (T-122)')`:
  - `it('updates.enabled es exactamente false')`: lee `app.json` y exige `expo.updates.enabled === false`. Si falla, el mensaje dice que activarlo reabre SEC M-6 (cualquiera con la cuenta de Expo ejecuta código en todos los teléfonos sin App Review) y que antes hay que configurar `updates.codeSigningCertificate` y `codeSigningMetadata`, decidirlo con un ADR y actualizar este test.
- El docblock del archivo se amplía con un párrafo sobre T-122.
- **Prueba de rojo:** el test nuevo falla contra el `app.json` actual (`enabled` ausente).

### 3.3 Documentación — ADR en `engram/02_architecture.md`

ADR nuevo (próximo número libre tras ADR-013), estado **Aceptado** por decisión del PO del 2026-09-14:
- **Contexto:** M-6 y la intención original de T-079.
- **Decisión:** OTA apagado en producción con `updates.enabled: false`; la dependencia se conserva.
- **Descartado:** desinstalar `expo-updates` (cambio de dependencia, más fricción para publicar) y OTA con firma de código (custodia y rotación de clave sin necesidad actual).
- **Consecuencias:** un bug urgente espera un build y App Review. Reactivar OTA exige firma de código y cambiar el test.

## 4. Verificación

- `npx jest src/__tests__/configDeUpdates.test.ts`, suite completa, `npx tsc --noEmit`, `npm run lint` (base 127 warnings / 0 errores).
- **En el build de release (PO):** después de `npx expo prebuild --clean`, `ios/spendApp/Supporting/Expo.plist` contiene `EXUpdatesEnabled` en `false`. No hace falta prueba funcional extra.

## 5. Riesgos

| Riesgo | Mitigación |
|---|---|
| Alguien reactiva OTA editando `app.json` | El test falla con un mensaje que explica M-6 y el requisito de firma |
| Ya se publicó un `eas update` al canal `production` | Con `enabled: false` no se aplica; el binario usa su bundle embebido |
| Se pierde la capacidad de hotfix rápido | Aceptado por el PO: los fixes van por build + App Review |
