# Features: HushSplit — lo que existe hoy

**Reescrito 2026-09-29** (auditoría de negocio, `engram/qa/auditoria-negocio-2026-09-29.md`). Este documento describe **lo que la app hace**, no un roadmap. Lo que no existe está en la última sección, marcado como tal, para que ningún agente lo implemente creyendo que estaba pedido.

## Modelo de negocio

**Lanzamiento gratis, sin anuncios y sin plan Pro** (decisión del PO 2026-09-03). No hay AdMob, ni RevenueCat, ni compras in-app en el proyecto.

- La regla «4 gastos de grupo por día gratis, del 5.º en adelante un anuncio» está escrita (`src/store/tierStore.ts`) pero **no bloquea**: `ADS_DISPONIBLES = false`. El contador diario (hora local) sigue contando creaciones de gastos de grupo, y un test se cae si alguien enciende la bandera sin conectar un anuncio.
- `PRO_DISPONIBLE = false`: la UI no ofrece Pro. Todas las funciones de abajo están disponibles para todos.

## Lo que hay

### Grupos y gastos
- Grupos con **una moneda** (elegida al crear; 9 monedas soportadas, ver `CLAUDE.md`), modo de división por defecto opcional, sin límite de grupos.
- Gastos con pagador único o **varios pagadores** (desglose que suma exacto), división en partes iguales o por porcentaje, categoría, fecha, nota y foto de ticket (local, sin OCR).
- **Borrado libre**: cualquier miembro edita, borra y restaura cualquier gasto al instante; Actividad muestra quién borró o restauró y permite deshacer en un toque (T-186; no hay modo «con acuerdo», ver `docs/CONSENSO-PENDIENTE.md`).
- Comentarios por gasto (entidad propia, sobreviven al merge).
- **Gastos recurrentes** (semanal, quincenal, mensual, anual), gratis, materializados al abrir la app, para grupo o personales.
- Límite de 450 gastos por grupo (aviso a los 350) con **traspaso** a un grupo nuevo que arrastra el saldo.
- Archivar grupos (reversible, salvo los archivados por traspaso).

### Deudas y saldos
- Deuda **por par, por moneda y por dirección**, sin compensar (ADR-006 + T-225): Te deben y Debés son brutos en Personal, Grupos, Amigos y en el detalle de grupo; la tarjeta de cada amigo muestra su neto; el balance neto del grupo va debajo del timeline.
- **Saldar** en el grupo (a una persona, parcial permitido, o «Todo» repartido entre acreedores) y desde Amigos (la totalidad con esa persona, un pago por grupo compartido). Cualquiera puede registrar un pago, cuenta al instante, sin acuse.
- Totales convertidos a la moneda que elige el usuario, sólo para mostrar; lo que no se pudo convertir se avisa, nunca se suma como 0.
- Salir de un grupo o expulsar (sólo el creador) exige no tener deuda viva en ninguna dirección (decisión 2026-09-29; `docs/ALGORITHMS.md` §7).

### Personal y presupuesto
- Tab Personal: gastos e ingresos propios del mes, presupuesto mensual por moneda, «incluir lo que me deben», carryover automático al cambiar de mes, réplica de lo que pagué en grupos (ADR-006 d3), «disponible tras saldar».

### Contactos e invitaciones
- Contactos por **QR presencial** (`app/contact/add.tsx`) con canal de contacto cifrado; crear un grupo con un contacto le entrega la clave por ese canal (ADR-013).
- Invitación a un grupo por **deep link** que expira a las 48 h (`src/sync/invitaciones/groupInvite.ts`).
- Amigos muestra sólo contactos con historial económico, con neto por persona y botón Saldar cuando le debo algo.

### Sync y datos
- **Sync por buzón cifrado en Supabase** (ADR-003/007): el servidor no puede leer nada; cada publicación aporta las rebanadas que cambiaron y el buzón conserva el estado completo del grupo (T-191). Automática al abrir, al recuperar red y por Realtime con poll de respaldo (regla #10 de `CLAUDE.md`).
- Firma del núcleo de cada registro por su autor, disputa de autoría visible, merge por niveles con tope de reloj (ADR-004/005/008).
- **Notificaciones locales** post-sync (`expo-notifications`): gasto nuevo, restauración, pago registrado que me involucra, invitación, traspaso, conflicto de clave. Sin push ni Firebase.
- **Backup** `.hushsplit` v3 (JSON en claro, con claves de grupo, restauración por reemplazo) exportable/importable desde Cuenta → Respaldo; **exportación CSV** de gastos y de movimientos personales desde el mismo lugar.
- Almacenamiento local: MMKV cifrado por bucket y scopeado por cuenta (`src/utils/secureStorage.ts`).

### Cuenta
- Login con **Google**, **Apple** o **invitado** (sin proveedor; sync igual, fuera del directorio de claves).
- Varias cuentas en el mismo teléfono, enlazables (ADR-008: identidad con alias).
- **Borrar la cuenta** (T-074/T-187): sale de los grupos sin deuda, queda como «Cuenta borrada» donde la tiene (los importes no se tocan), purga el buzón propio, borra lo local aunque no haya red y reanuda al arrancar. Exigencia de las dos tiendas.
- Dos skins (Clásico y Aero), tres idiomas (es/en/pt), 9 monedas.

## Lo que NO existe (y no hay que dar por pedido)

| Idea | Estado |
|---|---|
| Anuncios (AdMob) y plan Pro (RevenueCat) | Apagados por decisión; sólo queda el contador diario |
| OCR de tickets (ML Kit) | No instalado. La foto del ticket se guarda local, nada más |
| Conversión de moneda **al liquidar** (`Payment.targetCurrency`) | Campos en el modelo, sin UI. Un pago va siempre en la moneda del grupo |
| Gráficos y estadísticas, búsqueda avanzada | No |
| Backup a iCloud / Google Drive | No: el archivo se comparte con la hoja del sistema |
| WatermelonDB | Evaluado y sacado (2026-09-03) |
| WebRTC / BLE / Wi-Fi local | WebRTC sacado (T-083); BLE y mDNS nunca implementados |
| Invitación por username | No hay directorio: sólo QR y deep link |
| Modo «con acuerdo» (rondas de borrado, acuse de pago) | Sacado en T-186; mapa para volver en `docs/CONSENSO-PENDIENTE.md` |
| Absorción de saldo al salir/expulsar | Eliminada en T-228: nadie sale con deuda viva |
