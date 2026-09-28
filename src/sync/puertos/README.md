# puertos — lo que el núcleo/motor pide y la app provee
Sólo TIPOS (un único archivo: `puertos.ts`). Nadie los implementa todavía
salvo `Almacen` (usado por `nucleo/sliceLedger.ts` y `nucleo/appliedSlices.ts`).
- Transporte: `publicar` / `leerDesde(cursor)` / `borrarMios` / `suscribir`.
- Almacen: get/set/delete síncrono, YA scopeado por cuenta.
- Identidad: `emisor`, `firmar(sellado): string` (nunca la privada), `claveDelGrupo(epoch)`, `sesion`.
- Documento: `campos` (orden de dependencia), `armar`, `aplicar(grupo, campo, registros)`, `excede?`, `codec?`.
- Cripto: `sha256Hex`, `aleatorio`. Reloj: `ahora`, `ceder`, `alVolverAPrimerPlano?`.
- Log: `error`. Avisos: `publicacion?`, `manifiesto?`, `aplicado?`.
Un puerto nuevo, o un cambio de firma, es superficie pública del paquete futuro — requiere ADR.
No hay lógica en esta carpeta; si aparece, va a `nucleo/` o `motor/`.
Depende de: nada. Lo usan (sólo tipos): `nucleo/` y `motor/drenar.ts` (`DrainResult`/`DrainOptions`); el resto del motor sigue leyendo stores directo hoy (deuda V1/V2/V7/V9/V10 — etapa B).
Tests: tipos verificados por `tsc`; sin `__tests__` propio.
