# ADR-011 · KDF sobre el secreto X25519 de envoltura de la clave de grupo

**Estado:** PROPUESTO — pendiente de decisión del PO
**Enmienda a:** ADR-003 (`engram/02_architecture.md:298-581`), la envoltura de `GK` hacia cada
X25519 de destinatario. Cierra la deuda (b) anotada en ADR-010 (`engram/plans/T-121.md` §1.3.4).
**Fecha:** 2026-09-13 · **Autor:** nerv-mobile · **Nivel:** Strong
**Plan:** `engram/plans/T-129.md`

---

## 1 · El problema

`wrapGroupKey` / `unwrapGroupKey` (`src/sync/groupInvite.ts`) usan el secreto compartido de
X25519 **directo** como clave de `sealEnvelope` (XChaCha20-Poly1305), sin pasar por un KDF:

```ts
// antes de esta ADR
const shared = x25519.getSharedSecret(fromHex(senderPrivateKey), fromHex(recipientWrapPublicKey));
return sealEnvelope(shared.slice(0, 32), groupKeyHex);
```

RFC 7748 §6.1 recomienda no usar el secreto ECDH crudo como clave simétrica. El secreto ya tiene
256 bits de entropía, así que no es una vulnerabilidad explotable conocida, pero es una debilidad
de composición (T-121 §1.3.4, punto 4) — sin separación de dominio, el mismo secreto compartido
X25519 podría en el futuro derivar en dos usos distintos y colisionar.

**Alcance verificado** (grep `x25519`, `getSharedSecret`, `wrap` en `src/` y `app/`): el único
punto que usa el secreto crudo como clave AEAD es `wrapGroupKey`/`unwrapGroupKey`. Dos
consumidores lo importan sin conocer el detalle: `src/sync/inviteEngine.ts` (invitación por
link) y `src/sync/contactChannel.ts` (entrega a un contacto ya conocido) — ninguno de los dos
necesita cambios, porque el fix es interno a `groupInvite.ts` y la firma pública no cambia.
`contactChannel.ts` deriva su propia clave de CANAL con `SHA256(dominio ‖ secreto de contacto)`
(P4 de T-121, no P2/X25519): queda fuera de esta ADR.

## 2 · Decisión

1. **HKDF-SHA256** (`hkdf(sha256, secretoCompartido, salt=undefined, info, 32)` de
   `@noble/hashes/hkdf.js`, ya en `package.json` vía `@noble/hashes` ^2.3.0 — firma verificada
   contra `node_modules/@noble/hashes/hkdf.d.ts`, no de memoria).
2. `info = 'spendapp/grupo-clave/v2:' + [públicaA, públicaB].sort().join(':')`: las dos públicas
   X25519 en **orden canónico** (comparación lexicográfica de hex), para que emisor y receptor
   deriven la misma clave sin acordar de antemano quién es cada rol.
3. **Versionado sin campo previo.** El formato de envoltura no tenía marca de versión — era
   `base64(nonce ‖ ciphertext)` puro. Toda envoltura nueva lleva el prefijo literal `"v2:"`.
   Un receptor que no conozca el prefijo (código anterior a esta ADR) recibe un string con `:`,
   carácter fuera del alfabeto base64 propio del repo (`envelopeCrypto.ts`); su decodificación
   **falla explícito** (`null`), nunca silencioso con una clave equivocada.
4. **Ventana de transición: 30 días**, igual al TTL del buzón del relay
   (`supabase/004_compaction.sql`, regla de negocio #8 de `CLAUDE.md`). Es la cota real de cuánto
   puede seguir "en vuelo" una entrega de clave emitida antes de este cambio: más larga que la
   invitación por link (48hs) y una cota razonable para la entrega por contacto conocido, que no
   declara su propio TTL y hereda el del buzón. Durante la ventana, `unwrapGroupKey` acepta
   **v2** (con el prefijo, HKDF) siempre, y **v1** (sin prefijo, secreto crudo) como
   compatibilidad. Pasados los 30 días de este cambio, la rama v1 se retira en un ticket aparte.
5. **Sin otros cambios al protocolo:** firmas Ed25519, formato de sobre
   (`envelopeCrypto.ts`) y las demás derivaciones SHA-256 con separación de dominio
   (`inviteKey`/`deriveInviteTopic` de `groupInvite.ts`, `contactChannel.ts`) quedan igual —
   son una deuda distinta y menor (T-121 §1.3.3), no la que este ticket ataca.

## 3 · Descartado

- **Migrar también las derivaciones SHA-256 ad hoc a HKDF.** Fuera de alcance de T-129: esa deuda
  (T-121 §1.3.3) es de una clase distinta — el secreto de entrada ahí también tiene 256 bits y ya
  hay separación de dominio, sólo no es un KDF normado. Mezclar los dos cambios en un mismo
  ticket habría tocado el resto del protocolo, que el criterio de aceptación pide no tocar.
- **Cortar la compatibilidad v1 de inmediato.** Rompería invitaciones y entregas de clave ya
  emitidas y en vuelo, sin manera de que el servidor (buzón tonto, ADR-003) reenvíe nada
  distinto de lo que ya dejó el emisor — inaceptable en una app E2E sin backend propio.

## 4 · Consecuencias

- **+** Cierra la deuda (b) de ADR-010; sigue la recomendación de RFC 7748 §6.1.
- **+** El prefijo de versión deja un patrón reusable para un futuro v3.
- **−** Por 30 días conviven dos ramas de descifrado en `unwrapGroupKey` (deuda de código menor,
  con fecha de retiro).
- **−** No hay tráfico real en este entorno de desarrollo (sin backend con datos persistentes
  fuera del dispositivo) para probar la compatibilidad v1/v2 contra invitaciones o entregas
  efectivamente en curso; se verificó con fixtures de test
  (`src/sync/__tests__/groupInvite.test.ts`), no en producción.

## 5 · Verificación

- `src/sync/__tests__/groupInvite.test.ts` — describe `KDF con separación de dominio (T-129)`:
  round-trip v2, prefijo de versión, la clave v2 difiere del secreto crudo, un v1 fabricado a
  mano sigue abriendo, abrir v2 como v1 falla, cambiar la etiqueta del `info` o invertir el
  orden de las públicas falla.
- `src/sync/__tests__/inviteEngine.test.ts` y `src/sync/__tests__/contactChannel.test.ts` (no
  tocados) siguen en verde sin aflojar ninguna aserción.
