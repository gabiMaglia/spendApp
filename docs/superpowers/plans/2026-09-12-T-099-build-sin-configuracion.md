# T-099 · El build no sale sin configuración, y la app lo dice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un build de EAS `production`/`preview` falle si falta alguna de las 4 variables `EXPO_PUBLIC_*`, y que la pestaña Yo avise cuando la sincronización no está configurada.

**Architecture:** Un script Node sin dependencias (`scripts/verificar-env-build.js`) corre como hook `eas-build-post-install` de EAS; su lógica es una función pura testeable que sólo mira **presencia** de nombres. En la app, un componente `SyncNoDisponible` lee `isRelayConfigured()` y dibuja una sección en Yo sólo cuando da `false`.

**Tech Stack:** Node (CommonJS), EAS Build hooks (`eas-build-post-install` en `package.json`), React Native, i18next, Jest.

**Spec:** `docs/superpowers/specs/2026-09-12-fase1-endurecimiento-links-design.md` (sección T-099).

## Global Constraints
- Agente: `nerv-mobile`. QA: `nerv-qa` Standard. **Proof of red** documentado por criterio.
- **El script nunca imprime, loguea ni compara contra un VALOR de variable. Sólo nombres.** Nunca leer `.env` ni correr `eas env:list`.
- Sin dependencias nuevas. Alias `@/` en código de la app. i18n es (fuente) / en / pt, sin strings en JSX.
- Decisión del PO: el aviso va **sólo en Yo**, sin banner en Grupos.
- Suite verde, `npx tsc --noEmit` 0, `npm run lint` 0 errores.
- Rama: `fix/T-099-build-sin-config` desde `main`. Commits con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. No mergear ni pushear.

## File Structure
- Create `scripts/verificar-env-build.js` — `REQUERIDAS`, `faltantes(env, perfil)`, `main(env, log)`.
- Create `src/__tests__/verificarEnvBuild.test.ts`.
- Modify `package.json` — script `eas-build-post-install`.
- Create `src/components/SyncNoDisponible.tsx`.
- Create `src/components/__tests__/SyncNoDisponible.test.tsx`.
- Modify `app/(tabs)/user.tsx` — renderiza `<SyncNoDisponible />` antes de «Seguridad» (línea ~383).
- Modify `src/i18n/locales/{es,en,pt}.json` — claves bajo `profile`.

---

### Task 1: Guard de build

**Files:**
- Create: `scripts/verificar-env-build.js`
- Modify: `package.json` (`scripts`)
- Test: `src/__tests__/verificarEnvBuild.test.ts`

**Interfaces:**
- Produces (CommonJS): `REQUERIDAS: string[]`, `faltantes(env: Record<string,string|undefined>, perfil: string|undefined): string[]`, `main(env?, log?): 0 | 1`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/verificarEnvBuild.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { REQUERIDAS, faltantes, main } = require('../../scripts/verificar-env-build.js');

/**
 * **Un build sin buzón no sale** (T-099).
 *
 * Sin `EXPO_PUBLIC_SUPABASE_*`, la sync se apaga en silencio (`relayEngine.ts:129`) y
 * además `authStore.ts:240` fusiona cuentas sin probar el proveedor.
 */
const COMPLETO = Object.fromEntries(
  ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB', 'EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS']
    .map(n => [n, `CENTINELA-${n}`]),
);

describe('verificar-env-build', () => {
  it('exige exactamente las 4 variables que lee el código', () => {
    expect([...REQUERIDAS].sort()).toEqual(Object.keys(COMPLETO).sort());
  });

  it('con las 4 presentes no falta nada', () => {
    expect(faltantes(COMPLETO, 'production')).toEqual([]);
  });

  it('lista las ausentes y las vacías, en production y preview', () => {
    const env = { ...COMPLETO, EXPO_PUBLIC_SUPABASE_URL: undefined, EXPO_PUBLIC_SUPABASE_ANON_KEY: '   ' };
    for (const perfil of ['production', 'preview']) {
      expect(faltantes(env, perfil).sort()).toEqual(['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_URL']);
    }
  });

  it('development no se chequea', () => {
    expect(faltantes({}, 'development')).toEqual([]);
  });

  it('fuera de EAS no hace nada (expo start, builds locales)', () => {
    const log = jest.fn();
    expect(main({}, log)).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it('en EAS falla si falta algo, y la salida NO contiene ningún valor', () => {
    const log = jest.fn();
    const env = { ...COMPLETO, EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS: '' };
    expect(main(env, log)).toBe(1);
    const salida = log.mock.calls.flat().join('\n');
    expect(salida).toContain('EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS');
    expect(salida).not.toMatch(/CENTINELA/);
  });

  it('en EAS con todo presente pasa', () => {
    expect(main({ ...COMPLETO, EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'preview' }, jest.fn())).toBe(0);
  });

  it('EAS lo corre: package.json lo engancha como eas-build-post-install', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    expect(pkg.scripts['eas-build-post-install']).toBe('node scripts/verificar-env-build.js');
  });

  it('las 4 variables son las que usa el código', () => {
    const relay = readFileSync(join(__dirname, '..', 'sync', 'relay.ts'), 'utf8');
    const auth = readFileSync(join(__dirname, '..', '..', 'app', 'auth', 'index.tsx'), 'utf8');
    const usadas = new Set([...(relay + auth).matchAll(/process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)/g)].map(m => m[1]));
    expect([...usadas].sort()).toEqual([...REQUERIDAS].sort());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/__tests__/verificarEnvBuild.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/verificar-env-build.js'`.

- [ ] **Step 3: Implementation**

```js
// scripts/verificar-env-build.js
/**
 * Guard de build (T-099): un build de EAS production/preview no sale sin las variables
 * que la app necesita. Sin las de Supabase la sync se apaga EN SILENCIO.
 *
 * Mira sólo PRESENCIA. Nunca imprime ni compara un valor.
 * Lo corre EAS como `eas-build-post-install` (package.json). Fuera de EAS no hace nada.
 */
const REQUERIDAS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB',
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS',
];
const PERFILES_CHEQUEADOS = ['production', 'preview'];

function faltantes(env, perfil) {
  if (!PERFILES_CHEQUEADOS.includes(perfil)) return [];
  return REQUERIDAS.filter(nombre => typeof env[nombre] !== 'string' || env[nombre].trim() === '');
}

function main(env = process.env, log = console.error) {
  if (!env.EAS_BUILD) return 0;
  const perfil = env.EAS_BUILD_PROFILE;
  const lista = faltantes(env, perfil);
  if (lista.length === 0) return 0;
  log(`Build "${perfil}" sin configuración. Faltan en el entorno de EAS: ${lista.join(', ')}`);
  return 1;
}

module.exports = { REQUERIDAS, faltantes, main };

if (require.main === module) process.exitCode = main();
```

En `package.json`, dentro de `"scripts"`, sumar:
```json
    "eas-build-post-install": "node scripts/verificar-env-build.js",
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/__tests__/verificarEnvBuild.test.ts`
Expected: PASS (9).

- [ ] **Step 5: Proof of red**

(a) En `faltantes`, cambiar `env[nombre].trim() === ''` por `false`: cae «lista las ausentes y las vacías». (b) En `main`, cambiar el mensaje a `` `${lista.map(n => `${n}=${env[n]}`).join(', ')}` ``: cae «la salida NO contiene ningún valor». Restaurar ambos, PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/verificar-env-build.js src/__tests__/verificarEnvBuild.test.ts package.json
git commit -m "fix(build): EAS production/preview no sale sin las variables de la app (T-099)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: Aviso en Yo

**Files:**
- Create: `src/components/SyncNoDisponible.tsx`
- Test: `src/components/__tests__/SyncNoDisponible.test.tsx`
- Modify: `app/(tabs)/user.tsx`, `src/i18n/locales/es.json`, `en.json`, `pt.json`

**Interfaces:**
- Consumes: `isRelayConfigured(): boolean` de `@/src/sync/relay`; `Band`, `BandRow`, `SectionLabel` de `@/src/components/Band`.
- Produces: `SyncNoDisponible({ configurado }: { configurado?: boolean })`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/__tests__/SyncNoDisponible.test.tsx
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));

import { SyncNoDisponible } from '@/src/components/SyncNoDisponible';

describe('SyncNoDisponible (T-099)', () => {
  it('sin buzón configurado, avisa', () => {
    const { getByText } = render(<SyncNoDisponible configurado={false} />);
    expect(getByText('profile.sync_unavailable')).toBeTruthy();
    expect(getByText('profile.sync_unavailable_sub')).toBeTruthy();
  });

  it('con buzón configurado, no dibuja nada', () => {
    const { queryByText } = render(<SyncNoDisponible configurado />);
    expect(queryByText('profile.sync_unavailable')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/components/__tests__/SyncNoDisponible.test.tsx`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementation**

```tsx
// src/components/SyncNoDisponible.tsx
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Band, BandRow, SectionLabel } from '@/src/components/Band';
import { isRelayConfigured } from '@/src/sync/relay';

/**
 * **La app dice cuando no puede sincronizar** (T-099).
 *
 * Un build sin el buzón configurado abre, guarda gastos y nunca sincroniza. El único
 * indicador estaba en una pantalla de debug que no existe en producción.
 * Decisión del PO: el aviso vive sólo en Yo.
 */
export function SyncNoDisponible({ configurado = isRelayConfigured() }: { configurado?: boolean }) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  if (configurado) return null;

  return (
    <>
      <SectionLabel label={t('profile.section_sync')} />
      <Band>
        <BandRow last>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[Typography.bodyL, { color: c.text }]}>{t('profile.sync_unavailable')}</Text>
            <Text style={[Typography.caption, { color: c.textTertiary }]}>{t('profile.sync_unavailable_sub')}</Text>
          </View>
          <Ionicons name="cloud-offline-outline" size={18} color={c.semantic.warning} />
        </BandRow>
      </Band>
    </>
  );
}
```

- [ ] **Step 4: i18n** — dentro del objeto `"profile"` de cada archivo:

`es.json`:
```json
    "section_sync": "Sincronización",
    "sync_unavailable": "Sincronización no disponible",
    "sync_unavailable_sub": "Esta versión no tiene configurado el servidor de sincronización: tus datos quedan sólo en este teléfono.",
```
`en.json`:
```json
    "section_sync": "Sync",
    "sync_unavailable": "Sync unavailable",
    "sync_unavailable_sub": "This version has no sync server configured: your data stays only on this phone.",
```
`pt.json`:
```json
    "section_sync": "Sincronização",
    "sync_unavailable": "Sincronização indisponível",
    "sync_unavailable_sub": "Esta versão não tem o servidor de sincronização configurado: seus dados ficam só neste telefone.",
```

- [ ] **Step 5: Montarlo en Yo**

En `app/(tabs)/user.tsx`, sumar el import `import { SyncNoDisponible } from '@/src/components/SyncNoDisponible';` y, justo antes de `{/* Seguridad */}` (línea ~383):
```tsx
        <SyncNoDisponible />
```

- [ ] **Step 6: Run tests**

Run: `npx jest src/components/__tests__/SyncNoDisponible.test.tsx`
Expected: PASS. Si existe un test de paridad de claves i18n (buscar con `grep -rln "en.json" src/**/__tests__`), correrlo también: PASS.

- [ ] **Step 7: Proof of red** — cambiar `if (configurado) return null;` por `if (!configurado) return null;`: caen los dos tests. Restaurar, PASS.

- [ ] **Step 8: Suite, tipos, lint**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: verde.

- [ ] **Step 9: Commit**

```bash
git add src/components/SyncNoDisponible.tsx src/components/__tests__/SyncNoDisponible.test.tsx "app/(tabs)/user.tsx" src/i18n/locales/es.json src/i18n/locales/en.json src/i18n/locales/pt.json
git commit -m "feat(yo): avisa cuando la sincronización no está configurada (T-099)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

## Criterios de la spec → tareas
1 → Task 1 (tests de `faltantes` y `main`) · 2 → Task 1 test «la salida NO contiene ningún valor» · 3 → Task 2.
**No verificable acá:** que EAS realmente corra el hook y corte el build → Fase 2 (primer `eas build --profile preview`).
