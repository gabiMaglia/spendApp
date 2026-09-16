---
name: deploy-splitp2p
description: Dispara el pipeline de build de producción de spendApp (EAS Workflows) cuando el PO decide generar bundles nuevos para las stores.
---

# Deploy de producción — spendApp

Dispará el pipeline de build de producción (iOS + Android) de spendApp vía EAS Workflows.

## Qué hacer

1. Correr, desde la raíz del repo (`/Users/gabrielsk/Documents/Proyects/spendApp`):

   ```bash
   eas workflow:run .eas/workflows/build-produccion.yml
   ```

2. El pipeline corre en la infraestructura de EAS, no en esta sesión: primero el job `gate_calidad` (lint, `tsc --noEmit`, jest, y el chequeo de requisitos de tienda); si pasa, dispara en paralelo `build_ios` y `build_android` (perfil `production`).
3. Reportar el output tal cual lo imprime `eas-cli`, incluyendo el link al run en el dashboard de EAS — ahí se sigue el progreso en vivo de cada job.
4. Este pipeline **no sube nada a las stores**: termina en el build. Subir a TestFlight/Play sigue siendo un `eas submit` manual aparte, fuera de esta skill.

## Si falla

- Error de autenticación (`eas-cli` pide login): indicar que corra `eas login` una vez, después reintentar el mismo comando.
- Si `gate_calidad` falla: el output de `eas-cli` señala qué paso (lint/tsc/jest/requisitos de tienda) cortó la ejecución — no se disparan los builds. Hay que arreglar eso en el código antes de volver a correr la skill, no reintentar a ciegas.
