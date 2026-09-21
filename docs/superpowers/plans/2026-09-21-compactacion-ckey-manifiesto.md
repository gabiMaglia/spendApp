# Compactación por rebanada (ckey) + manifiesto + fotos por referencia — Implementation Plan

> ⚠️ **DEPLOYMENT ORDER:** `supabase/010_ckey_compaction.sql` must be applied to production Supabase **BEFORE** any client build from this branch ships. Skipping this causes silent group data loss (slice N deletes slice N-1 server-side).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the structural sync ceiling by splitting each group's full-state envelope into size-bounded "slices" (rebanadas) plus a manifest declaring completeness, and stop resending unchanged user avatars in every publish.

**Architecture:** Instead of one envelope per group publish carrying the whole `SyncDelta`, a device partitions its copy of the group into N slices (one per entity type, sub-split by id when an entity type alone exceeds a size target) and publishes one envelope per slice plus one small "manifest" envelope listing every slice's `ckey` and content digest. `drainGroup` collects all of a topic's envelopes, applies every valid slice via the existing `applyDelta`, and cross-checks against manifests to detect a missing slice. Compaction on the server keeps this bounded: the existing per-device write pledge (`owner_tag`, already in production since T-087/ADR-009) gets a new `ckey` column added to its match predicate, so publishing slice 2 no longer deletes slice 1. Avatars move from inline bytes in the `users` slice to a content-addressed reference (digest) resolved lazily from a separate per-user topic.

**Tech Stack:** TypeScript, Zustand, `expo-crypto` (`Crypto.digestStringAsync`), `@noble/ciphers` (xchacha20poly1305, already used by `envelopeCrypto.ts`), Supabase/Postgres (PL/pgSQL), Jest + `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-09-21-compactacion-ckey-design.md` (implements `docs/ADR-007-el-estado-vive-en-el-buzon.md`, ACEPTADO 2026-09-21)

## Global Constraints

- **Real payload cap today is `MAX_PAYLOAD_BYTES = 1_048_576`** (`src/sync/relay.ts:65`), checked BEFORE base64 inflation — NOT the 262,144 figure in ADR-007's original arithmetic (that ADR was written before `006_payload_limit.sql` raised the cap). Effective plaintext JSON budget is therefore **~786,000 bytes**, not ~196,000. This plan's slice-size constants (below) are picked with fresh headroom against the real cap.
- **Slice size targets (new constants, this plan, not in ADR-007):** `TARGET_SLICE_BYTES = 65_536` (64 KB of JSON — the size a device tries to stay under per slice), `MAX_SLICE_BYTES = 262_144` (256 KB — hard cap; a single oversized entity that alone exceeds this is still sent whole and flagged, never dropped or truncated). Both are comfortably under the ~786 KB effective budget, leaving headroom for the wrapper/signature overhead (~220 bytes) and for a slice to grow between renewal cycles without approaching the cliff.
- **Renewal window: 20 days** (ADR-007 §3.4) — a slice not republished within 20 days of its last publish must be republished on the next drain/publish cycle, before the 30-day TTL could drop it.
- **P-13 resolution (corrected during planning — see Task 1):** the device write-pledge (`owner_tag`, from `ensureOwnerPledge()` in `src/store/identityStore.ts:93-101`) is already device-wide and already unforgeable by a third party (T-087/ADR-009, live in production). Scoping compaction to `(topic, owner_tag, ckey)` instead of `(topic, owner_tag)` requires **no new secret derivation** — it only adds `ckey` to the trigger's match predicate. The spec's §3.3 description of a per-slice derived secret (`HMAC(secreto_dispositivo, ckey)`) is unnecessary; this plan uses the simpler, already-secure path.
- **P-12 resolution:** manifest-incomplete state reuses the existing `SyncWarningBanner` component (`src/components/SyncWarningBanner.tsx`) and the existing wiring pattern in `app/groups/[id].tsx:282-287` (see Task 7).
- **i18n:** every new user-facing string goes through `t('key')` in all three locale files (`src/i18n/locales/{es,en,pt}.json`), es is the source of truth, written first.
- **Testing:** every module of business logic and every component with its own behavior needs a test (CLAUDE.md). No tests on sizes/colors/margins.
- **No flag day:** a device running the old code (unsliced, no manifest) must keep working against the new server and against new devices, exactly as ADR-007 §5 describes. Every task must preserve this — never remove the ability to read an envelope with no `ckey`.
- **Migration-before-app order:** `supabase/010_ckey_compaction.sql` (Task 1) must be applied to the production Supabase project before any client build from Task 4 onward ships. This plan does not gate that in code — it is a deployment-order fact for the PO, called out again in Task 1's step 5.

---

### Task 1: Server migration — `ckey` column + compaction scoped by slice

**Files:**
- Create: `supabase/010_ckey_compaction.sql`
- Test: `src/sync/__tests__/ckeyCompactionSql.test.ts`

**Interfaces:**
- Produces: a `ckey text` nullable column on `public.envelopes`; `compact_envelopes()` now deletes by `(topic, owner_tag, ckey)` when both `owner_tag` and `ckey` are present, leaving every other branch (no owner_tag, no ckey) byte-for-byte as `009_owner_tag_only.sql` left it.

This project doesn't run migrations from a test harness (Supabase applies them by hand — see `src/sync/__tests__/prendaSql.test.ts` for the established pattern of testing SQL files as **text**, by asserting on function bodies extracted from the raw file). Follow that same pattern here: no live Postgres in CI, just string assertions on the SQL source.

- [ ] **Step 1: Write the failing test**

```typescript
// src/sync/__tests__/ckeyCompactionSql.test.ts
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(__dirname, '../../../supabase/010_ckey_compaction.sql'), 'utf8');

function cuerpoDe(sql: string, fnName: string): string {
  const start = sql.indexOf(`function public.${fnName}(`);
  if (start === -1) throw new Error(`no se encontró ${fnName}`);
  const end = sql.indexOf('$$;', start);
  return sql.slice(start, end);
}

describe('010_ckey_compaction.sql', () => {
  it('agrega la columna ckey como nullable, sin default', () => {
    expect(sql).toMatch(/alter table public\.envelopes\s+add column if not exists ckey text;/);
  });

  it('compact_envelopes reemplazado incluye ckey en el predicado con prenda', () => {
    const cuerpo = cuerpoDe(sql, 'compact_envelopes');
    expect(cuerpo).toMatch(/and\s+ckey\s+is\s+not\s+distinct\s+from\s+new\.ckey/);
  });

  it('la rama sin prenda de 009 no se toca (no hay owner_tag is null en este archivo)', () => {
    // 009 ya cerró esa rama; esta migración no la reabre.
    expect(sql).not.toMatch(/owner_tag is null/);
  });

  it('agrega un índice que incluye ckey', () => {
    expect(sql).toMatch(/create index if not exists envelopes_owner_ckey_idx/);
    expect(sql).toMatch(/\(topic, owner_tag, ckey, seq\)/);
  });

  it('no borra ni reescribe filas existentes (sin DELETE ni UPDATE fuera de una función)', () => {
    const fueraDeFunciones = sql
      .split(/create or replace function/i)[0]; // todo lo anterior a la primera función
    expect(fueraDeFunciones).not.toMatch(/\bdelete\s+from\b/i);
    expect(fueraDeFunciones).not.toMatch(/\bupdate\s+public\.envelopes\b/i);
  });

  it('recarga el cache de esquema de PostgREST al final', () => {
    expect(sql.trim().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/sync/__tests__/ckeyCompactionSql.test.ts`
Expected: FAIL — `ENOENT` reading `010_ckey_compaction.sql` (file doesn't exist yet).

- [ ] **Step 3: Write the migration**

```sql
-- ---------------------------------------------------------------------------
-- 010 · Compactación por rebanada (ckey)  (ADR-007, T-058 de fondo)
--
-- QUÉ ARREGLA
-- Hoy compact_envelopes() (009_owner_tag_only.sql) borra TODO sobre anterior
-- del mismo owner_tag en el topic. Eso es correcto cuando cada sobre lleva el
-- estado COMPLETO del grupo. Con este cambio, un dispositivo publica el
-- estado partido en varias "rebanadas" (una por sobre) más un manifiesto —
-- así que publicar la rebanada 2 NO debe borrar la rebanada 1: son estado
-- completo de PORCIONES distintas, no versiones sucesivas de lo mismo.
--
-- CÓMO
-- Una columna nueva, `ckey`, identifica la rebanada (opaca para el servidor,
-- derivada de la clave del grupo — ver src/sync/slices.ts). La compactación
-- pasa a operar por (topic, owner_tag, ckey): sólo reemplaza la versión
-- ANTERIOR de la MISMA rebanada del MISMO dispositivo.
--
-- QUÉ NO CAMBIA
-- La prenda de escritura (owner_tag/owner_proof, 008/009) seguí exactamente
-- igual — no hace falta un secreto nuevo por rebanada. Sigue siendo
-- imposible que un tercero sin el secreto del dispositivo fabrique su
-- owner_tag, y ahora tampoco puede borrar sólo UNA rebanada ajena sin
-- también conocer ese secreto. La rama sin prenda que 009 ya cerró
-- (envelopes sin owner_tag no se compactan, sólo expiran por TTL) no se
-- reabre acá.
--
-- ORDEN — esta migración se aplica ANTES de desplegar la app que publica
-- rebanadas (ver Global Constraints del plan). Un cliente viejo sigue
-- publicando con ckey = null y compactando exactamente como hoy.
-- ---------------------------------------------------------------------------

begin;

-- 1 · Columna nueva ---------------------------------------------------------
alter table public.envelopes add column if not exists ckey text;

-- 2 · Compactación, ahora también por rebanada ------------------------------
create or replace function public.compact_envelopes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.compactable then
    return null;
  end if;

  if new.owner_tag is not null then
    delete from public.envelopes
     where topic = new.topic
       and owner_tag = new.owner_tag
       and ckey is not distinct from new.ckey
       and compactable
       and seq < new.seq;
  end if;

  return null; -- AFTER trigger: el valor de retorno se ignora
end;
$$;

drop trigger if exists envelopes_compact on public.envelopes;
create trigger envelopes_compact
  after insert on public.envelopes
  for each row
  execute function public.compact_envelopes();

-- 3 · Índice para la compactación por rebanada ------------------------------
create index if not exists envelopes_owner_ckey_idx
  on public.envelopes (topic, owner_tag, ckey, seq)
  where compactable and owner_tag is not null;

commit;

-- 4 · Refrescar el caché de esquema de PostgREST ----------------------------
notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/sync/__tests__/ckeyCompactionSql.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/010_ckey_compaction.sql src/sync/__tests__/ckeyCompactionSql.test.ts
git commit -m "feat(sync): migración de compactación por ckey (ADR-007)"
```

**Note for whoever deploys this:** this file is SQL the PO runs by hand in the Supabase SQL editor, same as 004/006/008/009. It is not applied by CI or by this repo's test suite. Flag this to the PO before Task 4 ships.

---

### Task 2: `src/sync/slices.ts` — ckey derivation and slice partitioning (pure)

**Files:**
- Create: `src/sync/slices.ts`
- Test: `src/sync/__tests__/slices.test.ts`

**Interfaces:**
- Consumes: `GroupKey` type and `toHex` from `src/sync/envelopeCrypto.ts`.
- Produces:
  - `export const TARGET_SLICE_BYTES = 65_536;`
  - `export const MAX_SLICE_BYTES = 262_144;`
  - `export async function deriveCkey(key: GroupKey, tipo: string, seedId: string): Promise<string>`
  - `export function sliceEntities<T extends { id: string }>(entities: T[]): T[][]` — used by Task 4, which pairs each returned group with a `deriveCkey` call using that group's first entity's `id` as `seedId`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/sync/__tests__/slices.test.ts
import * as Crypto from 'expo-crypto';
import { generateGroupKey } from '../envelopeCrypto';
import { deriveCkey, sliceEntities, TARGET_SLICE_BYTES } from '../slices';

describe('deriveCkey', () => {
  it('es determinística para la misma clave/tipo/seed', async () => {
    const key = generateGroupKey();
    const a = await deriveCkey(key, 'expenses', 'e1');
    const b = await deriveCkey(key, 'expenses', 'e1');
    expect(a).toBe(b);
  });

  it('cambia con el tipo, con el seed, o con la clave', async () => {
    const key = generateGroupKey();
    const base = await deriveCkey(key, 'expenses', 'e1');
    expect(await deriveCkey(key, 'payments', 'e1')).not.toBe(base);
    expect(await deriveCkey(key, 'expenses', 'e2')).not.toBe(base);
    expect(await deriveCkey(generateGroupKey(), 'expenses', 'e1')).not.toBe(base);
  });

  it('es hex de 64 caracteres (sha256)', async () => {
    const key = generateGroupKey();
    const ck = await deriveCkey(key, 'expenses', 'e1');
    expect(ck).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sliceEntities', () => {
  function gasto(id: string, relleno = ''): { id: string; relleno: string } {
    return { id, relleno };
  }

  it('lista vacía produce cero rebanadas', () => {
    expect(sliceEntities([])).toEqual([]);
  });

  it('una lista chica cabe en una sola rebanada', () => {
    const items = [gasto('a'), gasto('b'), gasto('c')];
    const slices = sliceEntities(items);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toEqual(items);
  });

  it('una lista grande se parte en varias rebanadas, cada una bajo el objetivo', () => {
    const relleno = 'x'.repeat(2_000);
    const items = Array.from({ length: 200 }, (_, i) => gasto(`e${i}`, relleno));
    const slices = sliceEntities(items);
    expect(slices.length).toBeGreaterThan(1);
    for (const slice of slices) {
      expect(JSON.stringify(slice).length).toBeLessThanOrEqual(TARGET_SLICE_BYTES * 1.05);
    }
    // ninguna entidad se pierde ni se duplica
    const idsDeVuelta = slices.flat().map(s => s.id).sort();
    expect(idsDeVuelta).toEqual(items.map(i => i.id).sort());
  });

  it('un solo elemento que ya supera el objetivo va solo en su rebanada, no se descarta', () => {
    const gigante = gasto('grande', 'x'.repeat(TARGET_SLICE_BYTES * 2));
    const items = [gasto('chico1'), gigante, gasto('chico2')];
    const slices = sliceEntities(items);
    const conElGigante = slices.find(s => s.some(i => i.id === 'grande'));
    expect(conElGigante).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/sync/__tests__/slices.test.ts`
Expected: FAIL with "Cannot find module '../slices'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/sync/slices.ts
import * as Crypto from 'expo-crypto';
import type { GroupKey } from './envelopeCrypto';
import { toHex } from './envelopeCrypto';

/**
 * Objetivo de tamaño por rebanada (JSON, antes de sellar/firmar) y tope duro.
 * El presupuesto real hoy es ~786.000 bytes de JSON (MAX_PAYLOAD_BYTES = 1 MB
 * en relay.ts, menos el ×4/3 del base64 y el esqueleto del sobre firmado).
 * 64 KB de objetivo y 256 KB de tope dejan margen de sobra para crecer entre
 * ciclos de renovación sin acercarse al acantilado.
 */
export const TARGET_SLICE_BYTES = 65_536;
export const MAX_SLICE_BYTES = 262_144;

/**
 * `ckey` es opaca para el servidor — se deriva de la clave del grupo, nunca
 * del id de un registro (eso le daría al relay un conteo de registros).
 * Mismo mecanismo que `deriveTopic` (SHA256 de la clave en hex + contexto),
 * no HMAC formal: la clave del grupo ya es un secreto de 32 bytes de alta
 * entropía, de un solo uso por grupo, así que la propiedad que hace falta
 * (nadie sin la clave puede reproducir el hash) ya está cubierta.
 */
export async function deriveCkey(key: GroupKey, tipo: string, seedId: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${toHex(key)}:ckey:${tipo}:${seedId}`,
  );
}

/**
 * Parte una lista de entidades en rebanadas, cada una intentando quedar bajo
 * `TARGET_SLICE_BYTES` de JSON. Greedy: acumula en orden hasta que agregar el
 * siguiente elemento cruzaría el objetivo, ahí cierra la rebanada y empieza
 * otra. Un elemento solo que ya supera el objetivo queda solo en su propia
 * rebanada — nunca se descarta ni se trunca (ver `MAX_SLICE_BYTES` como aviso,
 * no como corte: cortar a la mitad un registro lo rompería).
 *
 * Partición puramente LOCAL: cada dispositivo decide la suya sin coordinarse
 * con otros (ADR-007 §3.1) — por eso el orden de entrada (por `id`) es lo
 * único que importa para que la partición sea estable entre publicaciones
 * sucesivas del MISMO dispositivo, no para que coincida con la de otro.
 */
export function sliceEntities<T extends { id: string }>(entities: T[]): T[][] {
  if (entities.length === 0) return [];

  const ordenadas = [...entities].sort((a, b) => a.id.localeCompare(b.id));
  const rebanadas: T[][] = [];
  let actual: T[] = [];
  let tamanoActual = 2; // '[' + ']'

  for (const item of ordenadas) {
    const tamanoItem = JSON.stringify(item).length + 1; // + coma/cierre
    if (actual.length > 0 && tamanoActual + tamanoItem > TARGET_SLICE_BYTES) {
      rebanadas.push(actual);
      actual = [];
      tamanoActual = 2;
    }
    actual.push(item);
    tamanoActual += tamanoItem;
  }
  if (actual.length > 0) rebanadas.push(actual);

  return rebanadas;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/sync/__tests__/slices.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/sync/slices.ts src/sync/__tests__/slices.test.ts
git commit -m "feat(sync): derivación de ckey y partición en rebanadas"
```

---

### Task 3: `src/sync/manifest.ts` — manifest type, build, and detection

**Files:**
- Create: `src/sync/manifest.ts`
- Test: `src/sync/__tests__/manifest.test.ts`

**Interfaces:**
- Consumes: nothing beyond `expo-crypto`.
- Produces:
  - `export const MANIFEST_VERSION = 2;`
  - `export type SliceManifestEntry = { ckey: string; digest: string };`
  - `export type SliceManifest = { version: 2; entries: SliceManifestEntry[] };`
  - `export async function digestOfJson(json: string): Promise<string>`
  - `export async function buildManifest(slices: { ckey: string; json: string }[]): Promise<SliceManifest>`
  - `export function isManifest(value: unknown): value is SliceManifest` — used by Task 6 (`drainGroup`) to tell a manifest envelope apart from a `SyncDelta` slice envelope after `JSON.parse`.

**Why `version: 2` and not `1`:** `applyDelta` (`src/sync/useSyncQR.ts:126`) already discards anything with `delta.version !== 1` before touching any store — that's the existing "unknown envelope shape, ignore it" guard a manifest needs from an old client that doesn't know about manifests yet. Giving the manifest `version: 2` means an old client's `applyDelta` call on it is a silent no-op, exactly like ADR-007 §3.3 requires.

- [ ] **Step 1: Write the failing test**

```typescript
// src/sync/__tests__/manifest.test.ts
import { buildManifest, digestOfJson, isManifest, MANIFEST_VERSION } from '../manifest';

describe('digestOfJson', () => {
  it('es determinístico y sensible al contenido', async () => {
    const a = await digestOfJson('{"x":1}');
    const b = await digestOfJson('{"x":1}');
    const c = await digestOfJson('{"x":2}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('buildManifest', () => {
  it('produce una entrada por rebanada, con su ckey y digest', async () => {
    const manifiesto = await buildManifest([
      { ckey: 'ck1', json: '{"a":1}' },
      { ckey: 'ck2', json: '{"b":2}' },
    ]);
    expect(manifiesto.version).toBe(MANIFEST_VERSION);
    expect(manifiesto.entries).toHaveLength(2);
    expect(manifiesto.entries[0].ckey).toBe('ck1');
    expect(manifiesto.entries[0].digest).toBe(await digestOfJson('{"a":1}'));
  });

  it('lista vacía produce un manifiesto sin entradas, no un error', async () => {
    const manifiesto = await buildManifest([]);
    expect(manifiesto.entries).toEqual([]);
  });
});

describe('isManifest', () => {
  it('reconoce un manifiesto válido', async () => {
    const m = await buildManifest([{ ckey: 'ck1', json: '{}' }]);
    expect(isManifest(m)).toBe(true);
  });

  it('rechaza un SyncDelta normal (version 1)', () => {
    expect(isManifest({ version: 1, fromUserId: 'u1', groups: [] })).toBe(false);
  });

  it('rechaza basura', () => {
    expect(isManifest(null)).toBe(false);
    expect(isManifest('texto')).toBe(false);
    expect(isManifest({ version: 2 })).toBe(false); // sin entries
    expect(isManifest({ version: 2, entries: 'no-array' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/sync/__tests__/manifest.test.ts`
Expected: FAIL with "Cannot find module '../manifest'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/sync/manifest.ts
import * as Crypto from 'expo-crypto';

export const MANIFEST_VERSION = 2;

export type SliceManifestEntry = { ckey: string; digest: string };
export type SliceManifest = { version: 2; entries: SliceManifestEntry[] };

export async function digestOfJson(json: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, json);
}

export async function buildManifest(
  slices: { ckey: string; json: string }[],
): Promise<SliceManifest> {
  const entries: SliceManifestEntry[] = [];
  for (const slice of slices) {
    entries.push({ ckey: slice.ckey, digest: await digestOfJson(slice.json) });
  }
  return { version: MANIFEST_VERSION, entries };
}

export function isManifest(value: unknown): value is SliceManifest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.version === MANIFEST_VERSION && Array.isArray(v.entries);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/sync/__tests__/manifest.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/sync/manifest.ts src/sync/__tests__/manifest.test.ts
git commit -m "feat(sync): tipo y construcción del manifiesto de rebanadas"
```

---

### Task 4: `sendEnvelope`/`envelopeRow` accept and persist `ckey`

**Files:**
- Modify: `src/sync/relay.ts:99-190`
- Test: `src/sync/__tests__/relayCompaction.test.ts` (extend existing file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `envelopeRow(topic, payload, sender, compactable = false, ownerProof?, ckey?)` and `sendEnvelope(topic, payload, sender, compactable = false, ckey?)` — both gain a 6th/5th optional trailing parameter so every existing call site (which passes none) keeps compiling unchanged. Task 5 is the only caller that passes it.

- [ ] **Step 1: Write the failing test**

Add to `src/sync/__tests__/relayCompaction.test.ts` (the existing file already tests `envelopeRow`'s `compactable` default — follow its exact style):

```typescript
describe('ckey opcional', () => {
  it('envelopeRow sin ckey no incluye la clave en la fila', () => {
    const fila = envelopeRow('t', 'x', 'dev1');
    expect(fila).not.toHaveProperty('ckey');
  });

  it('envelopeRow con ckey la incluye tal cual', () => {
    const fila = envelopeRow('t', 'x', 'dev1', true, null, 'abc123');
    expect(fila).toMatchObject({ ckey: 'abc123' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/sync/__tests__/relayCompaction.test.ts`
Expected: FAIL — `envelopeRow` doesn't accept a 6th argument yet (TS error) / the returned row has no `ckey`.

- [ ] **Step 3: Write minimal implementation**

In `src/sync/relay.ts`, change the `envelopeRow` signature and body (around line 99-110):

```typescript
export function envelopeRow(
  topic: string,
  payload: string,
  sender: string,
  compactable = false,
  ownerProof?: string | null,
  ckey?: string,
): { topic: string; payload: string; sender: string; compactable: boolean; owner_proof?: string; ckey?: string } {
  const fila: ReturnType<typeof envelopeRow> = { topic, payload, sender, compactable };
  if (ownerProof) fila.owner_proof = ownerProof;
  if (ckey) fila.ckey = ckey;
  return fila;
}
```

And `sendEnvelope` (around line 143-190) gains the same trailing parameter, threaded into its call to `envelopeRow`:

```typescript
export async function sendEnvelope(
  topic: string,
  payload: string,
  sender: string,
  compactable = false,
  ckey?: string,
): Promise<SendResult> {
  // ... cuerpo existente sin cambios hasta la llamada a envelopeRow ...
  const proof = servidorSinPrenda ? null : (prendaDelAparato()?.proof ?? null);
  // ...
  const { data, error } = await client
    .from('envelopes')
    .insert(envelopeRow(topic, payload, sender, compactable, proof, ckey))
    .select('seq,created_at')
    .single();
  // ... resto sin cambios, incluido el retry recursivo, que debe reenviar `ckey` también:
  // return sendEnvelope(topic, payload, sender, compactable, ckey);
}
```

(Locate the exact existing retry call inside `sendEnvelope` — it currently calls `sendEnvelope(topic, payload, sender, compactable)` on pledge rejection — and add `ckey` as its 5th argument so a retry doesn't silently drop the slice identity.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/sync/__tests__/relayCompaction.test.ts src/sync/__tests__/relay.test.ts`
Expected: PASS, including all pre-existing tests in both files (regression check).

- [ ] **Step 5: Commit**

```bash
git add src/sync/relay.ts src/sync/__tests__/relayCompaction.test.ts
git commit -m "feat(sync): sendEnvelope/envelopeRow aceptan ckey opcional"
```

---

### Task 5: `publishToGroup` publishes slices + manifest instead of one full envelope

**Files:**
- Modify: `src/sync/relaySync.ts:87-123`
- Test: `src/sync/__tests__/relaySlicedPublish.test.ts` (new)

**Interfaces:**
- Consumes: `sliceEntities`, `deriveCkey` (Task 2), `buildManifest` (Task 3), `sendEnvelope` with `ckey` (Task 4).
- Produces: `publishToGroup` keeps its exact existing signature and `PublishResult` type — callers in `relayEngine.ts` don't change. Internally it now sends K+1 envelopes (K slices + 1 manifest) instead of 1.

**Design within this task:** `buildGroupPayload` (unchanged, still returns one full `SyncDelta` for the group) is now only an intermediate value. This task adds a new internal function, `buildSlicedEnvelopes`, that takes that `SyncDelta` and the `GroupKey` and returns the list of `{ ckey, json }` pairs to seal+sign+send — one per entity-type-and-sub-slice, plus the manifest. Only `groups`, `expenses`, `payments`, `users`, `recurring`, `comments` are sliced (the fields `buildGroupPayload` already fills); `personal` and `groupKeys` are never present in a group payload (already excluded, unchanged).

- [ ] **Step 1: Write the failing test**

```typescript
// src/sync/__tests__/relaySlicedPublish.test.ts
jest.mock('../relay', () => {
  const buzones = new Map<string, { seq: number; topic: string; payload: string; sender: string; compactable?: boolean; ckey?: string }[]>();
  let seq = 0;
  return {
    __buzones: buzones,
    __reset: () => { buzones.clear(); seq = 0; },
    isRelayConfigured: () => true,
    subscribeTopic: () => () => {},
    sendEnvelope: async (topic: string, payload: string, sender: string, compactable = false, ckey?: string) => {
      const lista = buzones.get(topic) ?? [];
      lista.push({ seq: ++seq, topic, payload, sender, compactable, ckey });
      buzones.set(topic, lista);
      return { ok: true, seq };
    },
    fetchSince: async (topic: string, since: number) => {
      const lista = (buzones.get(topic) ?? []).filter(e => e.seq > since);
      return { ok: true, envelopes: lista, cursor: lista.length ? lista[lista.length - 1].seq : since };
    },
  };
});

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { publishToGroup } from '../relaySync';
import { isManifest } from '../manifest';
import type { Group, Expense } from '@/src/types/models';

const relayMock = jest.requireMock('../relay') as {
  __buzones: Map<string, { ckey?: string; compactable?: boolean; payload: string }[]>;
  __reset: () => void;
};

function grupo(): Group {
  return {
    id: 'G', name: 'Grupo', memberIds: ['u1'], currency: 'USD',
    createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Group;
}

function gasto(id: string): Expense {
  return {
    id, groupId: 'G', description: 'x'.repeat(2_000), amount: 10, currency: 'USD',
    paidById: 'u1', splits: [{ userId: 'u1', amount: 10 }], splitMode: 'equal',
    category: 'general', date: 1, createdAt: 1, createdById: 'u1', deletionVotes: [],
    updatedAt: 1_000, isDeleted: false,
  } as Expense;
}

describe('publishToGroup publica rebanadas + manifiesto', () => {
  beforeEach(() => {
    relayMock.__reset();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('G');
    useGroupStore.setState({ groups: [grupo()] } as never);
    const muchosGastos = Array.from({ length: 200 }, (_, i) => gasto(`e${i}`));
    useExpenseStore.setState({ expenses: muchosGastos } as never);
  });

  it('manda más de un sobre para un grupo grande, y el último es un manifiesto', async () => {
    const result = await publishToGroup('G', 'u1', 'device1');
    expect(result.ok).toBe(true);

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)!;
    expect(sobres.length).toBeGreaterThan(1);

    // Todos menos potencialmente el manifiesto llevan ckey y son compactable.
    for (const sobre of sobres) {
      expect(sobre.compactable).toBe(true);
      expect(sobre.ckey).toBeTruthy();
    }
  });

  it('el manifiesto declara una ckey por cada rebanada de datos publicada', async () => {
    await publishToGroup('G', 'u1', 'device1');
    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)!;

    // El sobre de manifiesto es identificable porque su ckey es distinta de
    // las de datos y su payload (una vez abierto) cumple isManifest. Acá se
    // verifica indirectamente contando: K rebanadas de datos + 1 manifiesto.
    const ckeys = new Set(sobres.map(s => s.ckey));
    expect(ckeys.size).toBe(sobres.length); // cada rebanada (y el manifiesto) tiene su propia ckey única
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/sync/__tests__/relaySlicedPublish.test.ts`
Expected: FAIL — today `publishToGroup` sends exactly 1 envelope, no `ckey` at all.

- [ ] **Step 3: Write minimal implementation**

In `src/sync/relaySync.ts`, add above `publishToGroup`:

```typescript
import { sliceEntities, deriveCkey } from './slices';
import { buildManifest } from './manifest';
import type { SyncDelta } from './useSyncQR';
import type { GroupKey } from './envelopeCrypto';

const SLICED_FIELDS = ['groups', 'expenses', 'payments', 'users', 'recurring', 'comments'] as const;
type SlicedField = typeof SLICED_FIELDS[number];

async function buildSlicedEnvelopes(
  delta: SyncDelta,
  key: GroupKey,
): Promise<{ ckey: string; json: string }[]> {
  const piezas: { ckey: string; json: string }[] = [];

  for (const campo of SLICED_FIELDS) {
    const lista = (delta[campo] ?? []) as { id: string }[];
    const rebanadas = sliceEntities(lista);
    for (const rebanada of rebanadas) {
      const seedId = rebanada[0].id;
      const ckey = await deriveCkey(key, campo, seedId);
      const parcial: SyncDelta = {
        version: 1,
        featureVersion: delta.featureVersion,
        fromUserId: delta.fromUserId,
        timestamp: delta.timestamp,
        groups: [], expenses: [], payments: [], users: [],
        [campo]: rebanada,
      } as SyncDelta;
      piezas.push({ ckey, json: JSON.stringify(parcial) });
    }
  }

  const manifiesto = await buildManifest(piezas);
  const manifiestoCkey = await deriveCkey(key, 'manifest', 'unica');
  piezas.push({ ckey: manifiestoCkey, json: JSON.stringify(manifiesto) });

  return piezas;
}
```

Then rewrite `publishToGroup`'s body (keeping its exact existing signature and `PublishResult` return type):

```typescript
export async function publishToGroup(
  groupId: string,
  currentUserId: string,
  deviceId: string,
): Promise<PublishResult> {
  const key = groupKeyBytes(groupId);
  if (!key) return { ok: false, reason: 'no_key' };
  const record = useGroupKeyStore.getState().getKey(groupId)!;
  const topic = await deriveTopic(key, record.epoch);

  const delta = buildGroupPayload(groupId, currentUserId);
  const piezas = await buildSlicedEnvelopes(delta, key);

  for (const pieza of piezas) {
    const sealed = sealEnvelope(key, pieza.json);
    const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
    const result = await sendEnvelope(topic, firmado, deviceId, true, pieza.ckey);
    if (!result.ok) {
      return result.reason === 'too_large'
        ? { ok: false, reason: 'too_large', detail: `rebanada ${pieza.ckey} superó el tope` }
        : { ok: false, reason: result.reason, detail: result.detail };
    }
  }

  const ultimo = piezas[piezas.length - 1];
  return { ok: true, seq: 0 }; // el seq individual de cada rebanada ya no identifica "la" publicación; ver nota abajo
}
```

**Note carried to the task reviewer:** `PublishResult`'s `{ ok: true; seq: number }` shape assumed one envelope per publish. With K+1 envelopes, no single `seq` represents "the publish" anymore. Check every caller of `publishToGroup`'s `seq` field (`relayEngine.ts`'s `publishNow` and `recordPublish`) before deciding whether `seq` should become the manifest's seq (recommended — it's the last one sent and the one a reader needs to know exists) or whether `PublishResult` needs a shape change. This task's minimal fix returns `0` as a placeholder value ONLY for `ok: true` — **the implementer must resolve this before marking the task done**, by making `sendEnvelope`'s result for the manifest publish flow into the returned `seq` (i.e., capture `result.seq` from the manifest's own `sendEnvelope` call, not hardcode `0`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/sync/__tests__/relaySlicedPublish.test.ts src/sync/__tests__/relaySigned.test.ts src/sync/__tests__/relayScope.test.ts`
Expected: PASS. `relayScope.test.ts` (pre-existing, guards `buildGroupPayload`'s field exclusions) must still pass unchanged since `buildGroupPayload` itself isn't touched by this task.

- [ ] **Step 5: Commit**

```bash
git add src/sync/relaySync.ts src/sync/__tests__/relaySlicedPublish.test.ts
git commit -m "feat(sync): publishToGroup parte el estado en rebanadas + manifiesto"
```

---

### Task 6: `drainGroup` applies slices, cross-checks manifests, flags gaps

**Files:**
- Modify: `src/sync/relaySync.ts:177-253`
- Create: `src/sync/manifestHealth.ts`
- Test: `src/sync/__tests__/relaySlicedDrain.test.ts` (new), `src/sync/__tests__/manifestHealth.test.ts` (new)

**Interfaces:**
- Consumes: `isManifest` (Task 3).
- Produces (`src/sync/manifestHealth.ts`, mirrors `src/sync/publishHealth.ts`'s exact shape so Task 7 can reuse the same UI pattern):
  - `export type ManifestGap = { groupId: string; missingCkeys: string[]; at: number };`
  - `export function recordManifestCheck(groupId: string, missingCkeys: string[]): void` — clears the gap if `missingCkeys` is empty, records it otherwise. In-memory `Map`, same as `publishHealth.ts`'s `fallos`.
  - `export function manifestGapFor(groupId: string): ManifestGap | null`
  - `export function clearManifestGaps(): void` (test-only reset, mirrors `clearPublishFailures`)

- [ ] **Step 1: Write the failing test — `manifestHealth.ts`**

```typescript
// src/sync/__tests__/manifestHealth.test.ts
import { recordManifestCheck, manifestGapFor, clearManifestGaps } from '../manifestHealth';

describe('manifestHealth', () => {
  beforeEach(() => clearManifestGaps());

  it('sin ckeys faltantes, no hay gap', () => {
    recordManifestCheck('G', []);
    expect(manifestGapFor('G')).toBeNull();
  });

  it('con ckeys faltantes, registra el gap', () => {
    recordManifestCheck('G', ['ck1', 'ck2']);
    const gap = manifestGapFor('G');
    expect(gap?.groupId).toBe('G');
    expect(gap?.missingCkeys).toEqual(['ck1', 'ck2']);
  });

  it('un chequeo posterior sin faltantes borra el gap anterior', () => {
    recordManifestCheck('G', ['ck1']);
    recordManifestCheck('G', []);
    expect(manifestGapFor('G')).toBeNull();
  });

  it('grupos distintos no se pisan', () => {
    recordManifestCheck('G1', ['ck1']);
    recordManifestCheck('G2', []);
    expect(manifestGapFor('G1')?.groupId).toBe('G1');
    expect(manifestGapFor('G2')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/sync/__tests__/manifestHealth.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation — `manifestHealth.ts`**

```typescript
// src/sync/manifestHealth.ts
/**
 * Estado de "¿este grupo tiene todas las rebanadas que su manifiesto
 * declara?", en memoria — mismo patrón que publishHealth.ts: diagnóstico del
 * momento, no un dato persistido del usuario.
 */
export type ManifestGap = { groupId: string; missingCkeys: string[]; at: number };

const gaps = new Map<string, ManifestGap>();

export function recordManifestCheck(groupId: string, missingCkeys: string[]): void {
  if (missingCkeys.length === 0) {
    gaps.delete(groupId);
    return;
  }
  gaps.set(groupId, { groupId, missingCkeys, at: Date.now() });
}

export function manifestGapFor(groupId: string): ManifestGap | null {
  return gaps.get(groupId) ?? null;
}

export function clearManifestGaps(): void {
  gaps.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/sync/__tests__/manifestHealth.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test — `drainGroup` sliced behavior**

```typescript
// src/sync/__tests__/relaySlicedDrain.test.ts
// Reuse the same relay mock shape as relaySlicedPublish.test.ts (Task 5) —
// copy its jest.mock('../relay', ...) block verbatim into this file's top.

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { publishToGroup, drainGroup } from '../relaySync';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
import type { Group, Expense } from '@/src/types/models';

// ... grupo()/gasto() helpers identical to Task 5's test file ...

describe('drainGroup aplica rebanadas y detecta manifiestos incompletos', () => {
  beforeEach(() => {
    relayMock.__reset();
    clearManifestGaps();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('G');
  });

  it('reconstruye el estado completo leyendo todas las rebanadas', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    const gastos = Array.from({ length: 200 }, (_, i) => gasto(`e${i}`));
    useExpenseStore.setState({ expenses: gastos } as never);
    await publishToGroup('G', 'u1', 'device1');

    // Un segundo "dispositivo" (mismo store en este test, cursor en 0) drena.
    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true);
    expect(useExpenseStore.getState().expenses.length).toBe(200);
    expect(manifestGapFor('G')).toBeNull();
  });

  it('si falta una rebanada declarada por el manifiesto, marca el gap y NO rompe el resto', async () => {
    useGroupStore.setState({ groups: [grupo()] } as never);
    useExpenseStore.setState({ expenses: [gasto('e1'), gasto('e2')] } as never);
    await publishToGroup('G', 'u1', 'device1');

    const [topic] = [...relayMock.__buzones.keys()];
    const sobres = relayMock.__buzones.get(topic)!;
    sobres.splice(0, 1); // se "pierde" la primera rebanada de datos

    useExpenseStore.setState({ expenses: [] } as never);
    const result = await drainGroup('G', 'u1', 'device2', 0);
    expect(result.ok).toBe(true); // el drenaje en sí no falla
    expect(manifestGapFor('G')).not.toBeNull();
    expect(manifestGapFor('G')!.missingCkeys.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest src/sync/__tests__/relaySlicedDrain.test.ts`
Expected: FAIL — `drainGroup` today calls `JSON.parse` and feeds straight to `applyDelta`, never checking `isManifest` and never calling `recordManifestCheck`.

- [ ] **Step 7: Write minimal implementation**

In `src/sync/relaySync.ts`, modify `drainGroup`'s loop (around lines 200-231). The existing per-envelope steps (verify signature → open → parse → apply) stay, but the loop first does a **collection pass**, then an **apply pass**, so the manifest (which can arrive at any position among the fetched envelopes, not necessarily last) is checked against everything collected in this drain:

```typescript
import { isManifest, type SliceManifest } from './manifest';
import { recordManifestCheck } from './manifestHealth';

// ... dentro de drainGroup, reemplazando el cuerpo del for-loop existente:

const rebanadasRecibidas: { ckey?: string; delta: SyncDelta }[] = [];
const manifiestos: SliceManifest[] = [];

for (const envelope of fetched.envelopes) {
  const opened = verifyEnvelope(envelope.payload);
  if (!opened) { skipped++; continue; }
  const plain = openEnvelope(key, opened.sealed);
  if (!plain) { skipped++; continue; }

  let parsed: unknown;
  try { parsed = JSON.parse(plain); } catch { skipped++; continue; }

  if (isManifest(parsed)) {
    manifiestos.push(parsed);
    continue;
  }

  const delta = parsed as SyncDelta;
  rebanadasRecibidas.push({ ckey: (envelope as { ckey?: string }).ckey, delta });
}

// Manifiesto: chequear completitud ANTES de aplicar, para no depender del
// orden de llegada de los sobres dentro de este mismo drenaje.
if (manifiestos.length > 0) {
  const ckeysDeclaradas = new Set(manifiestos.flatMap(m => m.entries.map(e => e.ckey)));
  const ckeysRecibidas = new Set(rebanadasRecibidas.map(r => r.ckey).filter(Boolean));
  const faltantes = [...ckeysDeclaradas].filter(ck => !ckeysRecibidas.has(ck));
  recordManifestCheck(groupId, faltantes);
}

for (const { delta } of rebanadasRecibidas) {
  void observeAuthor(groupId, delta.fromUserId, /* senderKey del sobre correspondiente */ '');
  try {
    applyDelta(acotarDeltaAlGrupo(delta, groupId), currentUserId);
    applied++;
  } catch {
    skipped++;
  }
}
```

**Note carried to the task reviewer:** the existing code calls `observeAuthor(groupId, delta.fromUserId, firmado.senderKey)` using `firmado` (the per-envelope verified wrapper) — the rewrite above must keep `senderKey` threaded through per-envelope, not dropped. Adjust the collection pass to also store `senderKey` alongside `delta` (e.g., `rebanadasRecibidas.push({ ckey, delta, senderKey: opened.senderKey })`) and use it in the apply pass. Also confirm this rewrite doesn't change the pre-existing `sigueSiendoLaClave` check that runs before the loop starts (keep it exactly where it is, guarding the whole drain, not per-envelope).

- [ ] **Step 8: Run test to verify it passes**

Run: `npx jest src/sync/__tests__/relaySlicedDrain.test.ts src/sync/__tests__/relaySigned.test.ts`
Expected: PASS, including pre-existing `relaySigned.test.ts` (regression on signature-verification-order and key_changed behavior).

- [ ] **Step 9: Commit**

```bash
git add src/sync/relaySync.ts src/sync/manifestHealth.ts src/sync/__tests__/relaySlicedDrain.test.ts src/sync/__tests__/manifestHealth.test.ts
git commit -m "feat(sync): drainGroup aplica rebanadas y detecta manifiestos incompletos"
```

---

### Task 7: UI — warn when a group's manifest is incomplete

**Files:**
- Create: `src/sync/useManifestGap.ts`
- Modify: `app/groups/[id].tsx`
- Modify: `src/i18n/locales/es.json`, `src/i18n/locales/en.json`, `src/i18n/locales/pt.json`
- Test: `src/sync/__tests__/useManifestGap.test.ts`, extend `src/screens/__tests__/` group-detail test with a manifest-gap case (find the existing group-detail screen test file via `find src/screens/__tests__ app -iname '*groupDetail*' -o -iname '*grupoDetalle*'` and add to it — do not create a duplicate screen test file).

**Interfaces:**
- Consumes: `manifestGapFor` (Task 6).
- Produces: `export function useManifestGap(groupId: string): boolean` — polling hook, same shape as the existing `useGroupSyncFailure` in `src/sync/useSyncFailure.ts` (uses whatever live-polling utility that file imports — read it first to reuse the exact same helper, e.g. `useLiveValue`).

- [ ] **Step 1: Add i18n keys (es first, source of truth)**

`src/i18n/locales/es.json` — add under the `sync` object (same object `sync.failure_title`/`sync.failure_too_large` already live in):
```json
"manifest_gap_title": "Faltan datos de un miembro",
"manifest_gap_body": "Los balances de este grupo pueden estar incompletos hasta que sincronice."
```

`src/i18n/locales/en.json`:
```json
"manifest_gap_title": "Missing data from a member",
"manifest_gap_body": "This group's balances may be incomplete until it syncs."
```

`src/i18n/locales/pt.json`:
```json
"manifest_gap_title": "Faltam dados de um membro",
"manifest_gap_body": "Os saldos deste grupo podem estar incompletos até sincronizar."
```

- [ ] **Step 2: Write the failing test — hook**

```typescript
// src/sync/__tests__/useManifestGap.test.ts
import { renderHook, waitFor } from '@testing-library/react-native';
import { recordManifestCheck, clearManifestGaps } from '../manifestHealth';
import { useManifestGap } from '../useManifestGap';

describe('useManifestGap', () => {
  beforeEach(() => clearManifestGaps());

  it('false cuando no hay gap', () => {
    const { result } = renderHook(() => useManifestGap('G'));
    expect(result.current).toBe(false);
  });

  it('true cuando se registró un gap para ese grupo', async () => {
    recordManifestCheck('G', ['ck1']);
    const { result } = renderHook(() => useManifestGap('G'));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('no reacciona a gaps de otro grupo', () => {
    recordManifestCheck('OTRO', ['ck1']);
    const { result } = renderHook(() => useManifestGap('G'));
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/sync/__tests__/useManifestGap.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Write minimal implementation**

First read `src/sync/useSyncFailure.ts` in full to copy its exact polling utility import and call pattern (the earlier codebase research found it uses `useLiveValue(blockingFailures, 3_000)` — confirm the import path for `useLiveValue` from that file before writing this one). Then:

```typescript
// src/sync/useManifestGap.ts
import { useLiveValue } from '<mismo path que usa useSyncFailure.ts>';
import { manifestGapFor } from './manifestHealth';

export function useManifestGap(groupId: string): boolean {
  const gap = useLiveValue(() => manifestGapFor(groupId), 3_000);
  return gap != null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/sync/__tests__/useManifestGap.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Wire the banner into the group screen**

In `app/groups/[id].tsx`, alongside the existing `falloDeSync` block (lines ~63, ~282-287):

```typescript
import { useManifestGap } from '@/src/sync/useManifestGap';

// ...
const manifiestoIncompleto = useManifestGap(id as string);

// ... en el JSX, junto al banner existente de falloDeSync:
{manifiestoIncompleto && !falloDeSync && (
  <SyncWarningBanner
    title={t('sync.manifest_gap_title')}
    body={t('sync.manifest_gap_body')}
  />
)}
```

(`!falloDeSync` avoids stacking two banners when a group is both `too_large`-blocked and has a manifest gap — the `too_large` banner takes priority since it's the more actionable of the two.)

- [ ] **Step 7: Run the full group-detail screen test suite**

Run: `npx jest app/groups/__tests__/` (or wherever the existing test for this screen lives — locate it first with `find . -path ./node_modules -prune -o -iname '*group*detail*test*' -print -o -iname '*grupo*detalle*test*' -print`)
Expected: PASS, including a new case asserting the banner renders when `useManifestGap` is mocked/forced `true` and doesn't render otherwise (add this case to whichever existing file that `find` locates — follow its existing mocking conventions for `useGroupSyncFailure` as the template for mocking `useManifestGap`).

- [ ] **Step 8: Commit**

```bash
git add src/sync/useManifestGap.ts app/groups/[id].tsx src/i18n/locales/es.json src/i18n/locales/en.json src/i18n/locales/pt.json src/sync/__tests__/useManifestGap.test.ts
git commit -m "feat(groups): aviso visible cuando el manifiesto de rebanadas está incompleto"
```

---

### Task 8: Renewal — republish slices older than 20 days

> **Post-implementation clarification (final review):** this task, as delivered, only wires the RECORDING half (`recordSlicePublished`, called on every real publish) into the live publish path. The staleness CHECK (`staleSliceCkeys`) exists as a tested, correct pure primitive, but nothing invokes it on a schedule — there is no timer or poll-cycle check that finds stale slices and forces a renewal republish. Do not read this task's title as "stale slices self-heal today": only the bookkeeping is live. Wiring a scheduler is deferred pending a PO decision on check cadence (see step 5 below, and the Global Constraints/Scope summary at the end of this plan).

**Files:**
- Create: `src/sync/sliceRenewal.ts`
- Modify: `src/sync/relaySync.ts` (`publishToGroup`, to call the renewal check)
- Test: `src/sync/__tests__/sliceRenewal.test.ts`

**Interfaces:**
- Produces:
  - `export const RENEWAL_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;`
  - `export function recordSlicePublished(ckey: string, at: number): void`
  - `export function staleSliceCkeys(ckeys: string[], now: number): string[]` — returns the subset of the given `ckey`s whose last recorded publish is older than the renewal window, OR that have no record at all (never published locally, e.g. after a reinstall — same "publish everything" path ADR-007 §3.4 describes).

Storage: a new bucket via `createStorage` (from `src/utils/createStorage.ts`) — **not** `createSecureStorage`, since a `ckey → timestamp` map reveals nothing sensitive on its own (no group content, no keys) and doesn't need encryption at rest, following the same tier distinction the codebase already draws in `secureStorage.ts`'s `SECURE_IDS` vs. plain storage.

- [ ] **Step 1: Write the failing test**

```typescript
// src/sync/__tests__/sliceRenewal.test.ts
import { recordSlicePublished, staleSliceCkeys, RENEWAL_WINDOW_MS } from '../sliceRenewal';

describe('sliceRenewal', () => {
  it('una ckey nunca publicada localmente se considera vieja', () => {
    expect(staleSliceCkeys(['nueva'], Date.now())).toEqual(['nueva']);
  });

  it('una ckey publicada hace poco no es vieja', () => {
    const ahora = Date.now();
    recordSlicePublished('ck1', ahora);
    expect(staleSliceCkeys(['ck1'], ahora + 1000)).toEqual([]);
  });

  it('una ckey publicada hace más de 20 días es vieja', () => {
    const ahora = Date.now();
    recordSlicePublished('ck1', ahora);
    expect(staleSliceCkeys(['ck1'], ahora + RENEWAL_WINDOW_MS + 1)).toEqual(['ck1']);
  });

  it('justo en el borde (exactamente 20 días) todavía no es vieja', () => {
    const ahora = Date.now();
    recordSlicePublished('ck1', ahora);
    expect(staleSliceCkeys(['ck1'], ahora + RENEWAL_WINDOW_MS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/sync/__tests__/sliceRenewal.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/sync/sliceRenewal.ts
import { createStorage } from '@/src/utils/createStorage';

const storage = createStorage('slice-renewal');

export const RENEWAL_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;

export function recordSlicePublished(ckey: string, at: number): void {
  storage.set(ckey, at);
}

export function staleSliceCkeys(ckeys: string[], now: number): string[] {
  return ckeys.filter(ck => {
    const last = storage.getNumber(ck);
    if (last === undefined) return true;
    return now - last > RENEWAL_WINDOW_MS;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/sync/__tests__/sliceRenewal.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire renewal into `publishToGroup`**

In `src/sync/relaySync.ts`'s `buildSlicedEnvelopes` (Task 5), after computing each `ckey` and before pushing to `piezas`, call `recordSlicePublished(ckey, Date.now())` unconditionally — every publish IS a fresh publish of that slice, so it always resets the renewal clock. `staleSliceCkeys` isn't consulted inside `publishToGroup` (a device only knows what it's about to send anyway, and it always resends everything it currently holds — the renewal problem is really about a slice a device is NOT otherwise about to touch, e.g. from a group whose other fields haven't changed).

Add a second, separate scheduled path instead: `relayEngine.ts`'s existing `drainNow`/`publishNow` cycle (called every `POLL_INTERVAL_MS`) is where staleness actually needs checking — but that requires knowing which `ckey`s exist for a group without republishing everything, which only the last-sent manifest tracks. **Defer the "detect staleness and trigger a renewal-only republish independent of content changes" scheduling to a follow-up task, out of this plan's scope** — this task delivers the pure staleness-detection primitive (`staleSliceCkeys`) and the recording side (`recordSlicePublished`, wired into every publish), which is what the test suite in Task 10 needs to verify the 20-day rule exists and is exercised; wiring a background timer that calls `staleSliceCkeys` against a group's last-known manifest and force-republishes is a product-scheduling decision (how often to check, whether it needs `useAppState` foreground detection like the existing `POLL_INTERVAL_MS`) that the PO should confirm before adding a second timer to `relayEngine.ts`. Record this as an open item in the final review, not a silent gap.

- [ ] **Step 6: Run relevant tests**

Run: `npx jest src/sync/__tests__/sliceRenewal.test.ts src/sync/__tests__/relaySlicedPublish.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sync/sliceRenewal.ts src/sync/relaySync.ts src/sync/__tests__/sliceRenewal.test.ts
git commit -m "feat(sync): registro de renovación de rebanadas (ventana de 20 días)"
```

---

### Task 9: Avatars by reference — stop resending photo bytes on every publish

**Files:**
- Create: `src/sync/avatarTopic.ts`
- Modify: `src/sync/relaySync.ts` (`buildGroupPayload` call site in `publishToGroup`/`buildSlicedEnvelopes`, and `drainGroup`)
- Modify: `src/store/userStore.ts` (nothing structural — confirm `preservarAvatar` still applies to whatever shape the `users` slice carries; see step 3 note)
- Test: `src/sync/__tests__/avatarTopic.test.ts`, extend `src/sync/__tests__/relaySlicedPublish.test.ts`

**Interfaces:**
- Produces:
  - `export async function deriveAvatarTopic(key: GroupKey, userId: string, avatarDigest: string): Promise<string>`
  - `export async function publishAvatarIfOwn(groupId: string, currentUserId: string, deviceId: string): Promise<void>` — no-ops if `currentUserId`'s own `avatar` hasn't changed since last publish (tracked the same way as slice renewal, Task 8's `sliceRenewal.ts` pattern, keyed by a digest instead of a ckey).
  - `export async function fetchAvatarIfMissing(groupId: string, userId: string, avatarDigest: string): Promise<void>` — called from `drainGroup` when an incoming `users` slice entry's digest doesn't match what's cached locally.

**Design:** the `users` field inside each sliced `SyncDelta` (Task 5's `buildSlicedEnvelopes`) stops carrying the real `avatar` bytes. Each `User` entry in that slice gets its `avatar` field replaced with `null` (the existing tombstone value `preservarAvatar` already understands — **not** `undefined`, which `preservarAvatar` treats as "no info, keep what I had" per its own docblock) plus a new field `avatarDigest?: string` carrying the content hash. This is a new optional field on `User`, so `preservarAvatar`'s three-way logic (`null` = tombstone, `undefined`/absent = preserve, present = adopt) doesn't change — it only ever looks at `avatar`, never at `avatarDigest`.

**Why this doesn't touch `recordCore.ts`'s signed-core classification:** `User` records aren't part of the signed-core system at all (only `Expense` and `Group` are — confirmed, no `USER_SLOTS` exists). `userStore.ts`'s own docblock explicitly rules out signing `User`/`avatar` (six non-member creation paths, some for people without an account to sign with). This feature doesn't reopen that — `avatarDigest` travels the same unsigned, LWW-merged path `avatar` already does.

- [ ] **Step 1: Write the failing test — topic derivation**

```typescript
// src/sync/__tests__/avatarTopic.test.ts
import { generateGroupKey } from '../envelopeCrypto';
import { deriveAvatarTopic } from '../avatarTopic';

describe('deriveAvatarTopic', () => {
  it('es determinística para la misma clave/usuario/digest', async () => {
    const key = generateGroupKey();
    const a = await deriveAvatarTopic(key, 'u1', 'digest1');
    const b = await deriveAvatarTopic(key, 'u1', 'digest1');
    expect(a).toBe(b);
  });

  it('cambia si cambia el digest (la foto)', async () => {
    const key = generateGroupKey();
    const a = await deriveAvatarTopic(key, 'u1', 'digest1');
    const b = await deriveAvatarTopic(key, 'u1', 'digest2');
    expect(a).not.toBe(b);
  });

  it('cambia si cambia el usuario', async () => {
    const key = generateGroupKey();
    const a = await deriveAvatarTopic(key, 'u1', 'digest1');
    const b = await deriveAvatarTopic(key, 'u2', 'digest1');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/sync/__tests__/avatarTopic.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/sync/avatarTopic.ts
import * as Crypto from 'expo-crypto';
import type { GroupKey } from './envelopeCrypto';
import { toHex } from './envelopeCrypto';
import { sealEnvelope, openEnvelope } from './envelopeCrypto';
import { signEnvelope, verifyEnvelope } from './envelopeSign';
import { sendEnvelope, fetchSince } from './relay';
import { ensureIdentity } from './identity'; // usar el mismo import que ya usa relaySync.ts para ensureIdentity — confirmar path exacto ahí
import { useUserStore } from '@/src/store/userStore';
import { recordSlicePublished, staleSliceCkeys } from './sliceRenewal';

export async function deriveAvatarTopic(key: GroupKey, userId: string, avatarDigest: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${toHex(key)}:avatar:${userId}:${avatarDigest}`,
  );
}

export async function publishAvatarIfOwn(
  key: GroupKey,
  currentUserId: string,
  deviceId: string,
  avatar: string,
  avatarDigest: string,
): Promise<void> {
  const marcador = `avatar:${currentUserId}:${avatarDigest}`;
  if (staleSliceCkeys([marcador], Date.now()).length === 0) return; // ya publicada, nada cambió

  const topic = await deriveAvatarTopic(key, currentUserId, avatarDigest);
  const sealed = sealEnvelope(key, avatar);
  const firmado = signEnvelope(sealed, ensureIdentity().privateKey);
  const result = await sendEnvelope(topic, firmado, deviceId, false); // no compactable: distintos digests son distintos topics, nunca se reemplazan entre sí
  if (result.ok) recordSlicePublished(marcador, Date.now());
}

export async function fetchAvatarIfMissing(
  key: GroupKey,
  userId: string,
  avatarDigest: string,
): Promise<void> {
  const local = useUserStore.getState().getUserById(userId);
  if (local?.avatarDigest === avatarDigest && local.avatar) return; // ya la tengo

  const topic = await deriveAvatarTopic(key, userId, avatarDigest);
  const fetched = await fetchSince(topic, 0);
  if (!fetched.ok || fetched.envelopes.length === 0) return; // todavía no llegó, se reintenta en el próximo ciclo de sync

  const ultimo = fetched.envelopes[fetched.envelopes.length - 1];
  const opened = verifyEnvelope(ultimo.payload);
  if (!opened) return;
  const avatar = openEnvelope(key, opened.sealed);
  if (!avatar) return;

  useUserStore.getState().addOrUpdateUser({ ...local, avatar, avatarDigest } as never);
}
```

**Note carried to the task reviewer:** confirm the exact import path for `ensureIdentity` (used by `publishToGroup` already in `relaySync.ts` — copy that import line verbatim) rather than the placeholder `./identity` path above, which was not verified against the actual file layout during planning.

- [ ] **Step 4: Add `avatarDigest?: string` to the `User` type**

In `src/types/models.ts`, in the `User` interface (around line 42-75), add one field next to `avatar`:

```typescript
avatarDigest?: string; // hash del contenido de `avatar` — permite pedir la foto aparte sin reenviarla en cada rebanada
```

- [ ] **Step 5: Strip `avatar` bytes from the sliced `users` field, add digest**

In `src/sync/relaySync.ts`'s `buildSlicedEnvelopes` (Task 5), before slicing the `users` field specifically:

```typescript
import { digestOfJson } from './manifest';
import { publishAvatarIfOwn } from './avatarTopic';

// Dentro de buildSlicedEnvelopes, ANTES del loop de SLICED_FIELDS, tratar 'users' aparte:
const usuariosConDigest = await Promise.all(
  (delta.users ?? []).map(async (u) => {
    if (!u.avatar) return u; // sin foto, nada que referenciar
    const digest = await digestOfJson(u.avatar);
    if (u.id === delta.fromUserId) {
      // Es mi propia foto: la publico en su topic aparte (fire-and-forget,
      // no bloquea la publicación del resto del grupo).
      void publishAvatarIfOwn(key, delta.fromUserId, deviceId, u.avatar, digest);
    }
    return { ...u, avatar: null, avatarDigest: digest };
  }),
);
// Reemplazar delta.users por usuariosConDigest antes de pasarlo a sliceEntities para el campo 'users'.
```

**Note carried to the task reviewer:** `buildSlicedEnvelopes` doesn't currently receive `deviceId` as a parameter (Task 5 didn't need it). Add `deviceId: string` as a parameter to `buildSlicedEnvelopes` and thread it from `publishToGroup`'s existing `deviceId` argument.

- [ ] **Step 6: Resolve missing avatars during drain**

In `src/sync/relaySync.ts`'s `drainGroup` (Task 6), after `applyDelta` succeeds for a slice containing `users`:

```typescript
for (const u of delta.users ?? []) {
  if (u.avatarDigest && u.id !== currentUserId) {
    void fetchAvatarIfMissing(key, u.id, u.avatarDigest); // fire-and-forget, mismo patrón que observeAuthor/refreshPendingAuthors existentes
  }
}
```

- [ ] **Step 7: Write the integration test extending `relaySlicedPublish.test.ts`**

```typescript
// añadir a src/sync/__tests__/relaySlicedPublish.test.ts
it('no reenvía los bytes de la foto de un usuario que no cambió', async () => {
  useAuthStore.setState({ user: { id: 'u1' } } as never);
  const conFoto = { id: 'u1', name: 'Uno', email: '', authProvider: 'google', createdAt: 1, avatar: 'foto-base64-larga'.repeat(500), updatedAt: 1, isDeleted: false } as never;
  useUserStore.setState({ users: [conFoto] });
  useGroupStore.setState({ groups: [{ ...grupo(), memberIds: ['u1'] }] } as never);
  useExpenseStore.setState({ expenses: [gasto('e1')] } as never);

  await publishToGroup('G', 'u1', 'device1');

  const [topic] = [...relayMock.__buzones.keys()];
  const sobres = relayMock.__buzones.get(topic)!;
  const contieneFotoLarga = sobres.some(s => s.payload.includes('foto-base64-larga'));
  expect(contieneFotoLarga).toBe(false); // la foto viaja en su propio topic, no en la rebanada de users
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest src/sync/__tests__/avatarTopic.test.ts src/sync/__tests__/relaySlicedPublish.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/sync/avatarTopic.ts src/sync/relaySync.ts src/types/models.ts src/sync/__tests__/avatarTopic.test.ts src/sync/__tests__/relaySlicedPublish.test.ts
git commit -m "feat(sync): fotos de usuario por referencia, fetch bajo demanda"
```

---

### Task 10: End-to-end regression — the T-056 scenario that started this, now passing

**Files:**
- Create: `src/sync/__tests__/ckeyEndToEnd.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-9.

This is the acceptance test for the whole plan: the exact scenario documented in ADR-007/T-058 as the one that broke (5 members, 200 expenses, ~319 KB unsliced) must now publish and drain successfully, and a member joining late must still reconstruct the complete history (P-2, ADR-007 §4 row 4).

- [ ] **Step 1: Write the test**

```typescript
// src/sync/__tests__/ckeyEndToEnd.test.ts
// jest.mock('../relay', ...) igual que en Tasks 5/6 (copiar el bloque verbatim).

import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { publishToGroup, drainGroup } from '../relaySync';
import { manifestGapFor, clearManifestGaps } from '../manifestHealth';
import type { Group, Expense } from '@/src/types/models';

// ... grupo()/gasto() helpers, 5 miembros, con splits reales de 5 personas
// (no 1 como en los tests anteriores, para reproducir el peso real por gasto) ...

describe('escenario T-056/T-058: 5 miembros, 200 gastos', () => {
  beforeEach(() => {
    relayMock.__reset();
    clearManifestGaps();
    useAuthStore.setState({ user: { id: 'u1' } } as never);
    useGroupKeyStore.setState({ keys: [] });
    useGroupKeyStore.getState().ensureKey('G');
  });

  it('publica sin too_large donde antes fallaba', async () => {
    const miembros = ['u1', 'u2', 'u3', 'u4', 'u5'];
    useGroupStore.setState({ groups: [{ ...grupo(), memberIds: miembros }] } as never);
    const gastos = Array.from({ length: 200 }, (_, i) => gastoDeCincoMiembros(`e${i}`, miembros));
    useExpenseStore.setState({ expenses: gastos } as never);

    const result = await publishToGroup('G', 'u1', 'device1');
    expect(result.ok).toBe(true);
  });

  it('el que entra tarde reconstruye el historial completo (P-2)', async () => {
    const miembros = ['u1', 'u2', 'u3', 'u4', 'u5'];
    useGroupStore.setState({ groups: [{ ...grupo(), memberIds: miembros }] } as never);
    const gastos = Array.from({ length: 200 }, (_, i) => gastoDeCincoMiembros(`e${i}`, miembros));
    useExpenseStore.setState({ expenses: gastos } as never);
    await publishToGroup('G', 'u1', 'device1');

    // "u2" entra tarde: store vacío, drena desde 0.
    useExpenseStore.setState({ expenses: [] } as never);
    const drenaje = await drainGroup('G', 'u2', 'device2', 0);

    expect(drenaje.ok).toBe(true);
    expect(useExpenseStore.getState().expenses).toHaveLength(200);
    expect(manifestGapFor('G')).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm it passes**

Run: `npx jest src/sync/__tests__/ckeyEndToEnd.test.ts`
Expected: PASS — both cases. If the first case still fails with `too_large`, the slicing constants in Task 2 need to be reduced (check `TARGET_SLICE_BYTES` against the actual measured per-slice size for this fixture before changing global constants shared by other tasks).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: 0 failures. This is also the checkpoint to confirm no `__tests__` directory anywhere still imports the pre-Task-4 `envelopeRow`/`sendEnvelope` signatures in a way that broke from the added optional trailing parameters.

- [ ] **Step 4: Commit**

```bash
git add src/sync/__tests__/ckeyEndToEnd.test.ts
git commit -m "test(sync): escenario T-056/T-058 (5 miembros, 200 gastos) ahora publica y drena completo"
```

---

## Self-Review Notes (for the plan author — already applied above, kept here for the reviewer's benefit)

1. **Spec coverage:** §2 (rebanadas/manifiesto/ckey opaca/renovación/migración/compatibilidad) → Tasks 1-6, 8. §3.1 (P-11, TTL) → not implementable in code, flagged as a PO action in Global Constraints, not silently dropped. §3.2 (P-12, banner) → Task 7. §3.3 (P-13, prenda) → Task 1, with the derivation simplified from the spec's original text (documented in Global Constraints, not a silent deviation). §3.4 (avatars) → Task 9. §4 (testing) → covered per-task plus Task 10's acceptance scenario.
2. **Placeholder scan:** the two `// ver Nota` callouts in Tasks 5, 6, and 9 (the `seq: 0` in `publishToGroup`'s return, the `senderKey` threading in `drainGroup`, and the `ensureIdentity` import path in `avatarTopic.ts`) are flagged explicitly as unresolved integration details for the implementer to close **during that task**, not deferred past it — each names exactly what "closed" looks like, so none of them is a bare TBD.
3. **Type consistency:** `SyncDelta`, `Group`, `Expense`, `User` types used across tasks match `src/types/models.ts`/`src/sync/useSyncQR.ts` as read from the current tree. `ckey`/`SliceManifest`/`ManifestGap` names are consistent from their defining task (2, 3, 6) through every consumer (4, 5, 6, 7).
4. **Scope not covered, called out explicitly rather than silently dropped:** group-key epoch rotation (ADR-007 §4's "publish everything on rotation" obligation) — out of scope, no rotation mechanism exists yet, per spec §5. The `drainGroup` verify-before-decrypt cost inversion (ADR-007 §8 risk 6) — out of scope per spec §5. The background scheduling of stale-slice renewal beyond the recording primitive (Task 8, step 5) — flagged as needing a PO product decision on timer cadence before wiring it into `relayEngine.ts`'s poll loop.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-21-compactacion-ckey-manifiesto.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
