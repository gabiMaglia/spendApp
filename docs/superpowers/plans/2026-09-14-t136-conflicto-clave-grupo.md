# T-136 · Clave de grupo por contacto: ofertas y elección ante conflicto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una clave de grupo entregada por contacto nunca gane sola cuando otro remitente entrega una distinta: se registran ofertas por (grupo, remitente), se adopta sólo la unánime, y ante conflicto el usuario elige desde la bandeja (purga local + adopción de la elegida).

**Architecture:** Un store nuevo `src/sync/groupKeyOffers.ts` (cifrado, scopeado por cuenta, con núcleo puro `aplicarOferta`/`estadoDe`) guarda las ofertas. `contactChannel.drainContacts` deja de adoptar dentro del loop: registra ofertas y al final del lote adopta las unánimes y devuelve los grupos en conflicto. `relayEngine` e `inviteEngine.redeem` avisan el conflicto con `keyConflictNotice.ts` (un aviso sin leer por grupo, vía `notifications.announceKeyConflict`). `services/elegirClaveDeGrupo.ts` valida (S3-A1), purga con `purgarGrupoLocalmente`, adopta, deja pendiente de drenaje y drena. La UI es `GroupKeyConflictCard` abierta desde el aviso en `TabHeader`.

**Tech Stack:** Expo SDK 54, TypeScript estricto, Zustand, MMKV (`createSecureStorage` + `readScoped`/`writeScoped`), i18next (es/en/pt), Jest + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-09-14-t136-conflicto-clave-grupo-design.md` · ADR-013 (`engram/02_architecture.md`, ACEPTADO) · plan del arquitecto `engram/plans/T-136.md`.

## Global Constraints

- `MAX_OFERTAS_POR_GRUPO = 5` (el sexto remitente NUEVO se ignora; un remitente existente puede reemplazar su oferta).
- Tipo: `KeyOffer = { groupId, fromUserId, key, epoch, origen: 'contact' | 'invite', receivedAt, adoptada: boolean }`.
- Almacenamiento de ofertas: bucket cifrado `groupkeys`, clave base `key_offers_v1`, siempre por `readScoped`/`writeScoped`.
- Nuevo `Notice` kind: `group_key_conflict` — accionable (`esAccionable` → `true`), toggle `notifInvites`, sin push nuevo.
- `DrainContactsResult` suma `conflictedGroups: string[]` (spec) y `nombresDeDrop: Record<string, string>` (ver Desvíos).
- Firma pública: `elegirClaveDeGrupo(groupId: string, fromUserId: string): Promise<boolean>` en `src/services/elegirClaveDeGrupo.ts`.
- Claves i18n bajo `sync.keyConflict.*` en `src/i18n/locales/es.json` (fuente), `en.json`, `pt.json`. Ningún string en JSX.
- Título (2 remitentes), verbatim: `Dos personas te mandaron claves distintas para "{{group}}"`
- Título (más de 2), verbatim: `Recibiste claves distintas para "{{group}}"`
- Cuerpo, verbatim: `Sólo una es la real. Elegí la de alguien que sepas que está en el grupo. El nombre es el que tenés guardado del contacto; la app no puede verificar quién es.`
- Nombre sin verificar, verbatim: `{{group}} (nombre sin verificar)`
- Botón por remitente, verbatim: `Usar la clave de {{name}}` · botón extra: `Decidir después`
- Confirmación, verbatim: título `¿Usar la clave de {{name}}?` · cuerpo `Se borra lo que tenés de "{{group}}" en este teléfono y se vuelve a bajar con esa clave. Lo que hayas cargado desde que llegó la otra clave se pierde.` · botones `Cancelar` / `Usar esta clave` (destructivo).
- `src/sync/groupInvite.ts` NO se toca (T-129 v2).
- Nivel **Strong**: QA Strong + verificador ciego (nerv-verifier) + mutaciones M1–M4 antes de merge.
- Rama: `fix/T-136-conflicto-clave`.
- Commits terminan con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Sin `npm install` en worktrees** (si se trabaja en worktree, se reusa el `node_modules` del repo principal por symlink; nunca se instala). Sin dependencias nativas nuevas → sin `prebuild --clean`.
- Path alias `@/` en código de producción; los tests existentes usan `../` relativo y se respeta el estilo de cada archivo.
- Tests: sólo comportamiento, nunca estilos. Comentarios en español, con el estilo del archivo.
- Verificación de rutina: `npx jest`, `npx tsc --noEmit`, `npm run lint` → base `127 problems (0 errors, 127 warnings)`.

### Desvíos del spec decididos en este plan (anotar en el handoff)

1. **Oferta ya adoptada no se reemplaza.** El spec dice «clave distinta del mismo remitente → reemplaza su oferta». Si esa oferta ya está `adoptada`, reemplazarla borraría la única prueba de que la clave local vino de contacto (`claveLocalVinoDeContacto` pasaría a `false`) y dejaría un «conflicto» de un solo remitente imposible de resolver. Se ignora. Antes de adoptar, el reemplazo funciona como dice el spec.
2. **Remitente de una oferta de invitación.** `InviteGrant` no trae `userId` de quien entrega. `fromUserId` de una oferta `origen: 'invite'` es `invite:<inviterFingerprint>` (`idDeOfertaDeInvitacion`), y la tarjeta la nombra con `sync.keyConflict.invite_sender` («la invitación»), sin avatar.
3. **`Notice` lleva `nombreVerificado: boolean`.** El spec pide mostrar «(nombre sin verificar)» cuando el nombre sale del drop; sin un campo, el aviso congelado en la bandeja no puede saberlo.
4. **`DrainContactsResult.nombresDeDrop`.** `relayEngine` necesita el nombre del drop para el aviso y `conflictedGroups: string[]` no lo trae.
5. **`elegirClaveDeGrupo` paso 4.** `purgarGrupoLocalmente` ya olvida TODAS las ofertas del grupo (spec), así que «marcarAdoptada y descartar las demás» se implementa re-registrando la elegida y marcándola adoptada. Además llama `await marcarConTopic([groupId])` (la marca de `adoptKeys` es `void`) y `void startRelay()` tras drenar, igual que `drainContactsNow` al entrar a un grupo.
6. **Clave de i18n extra:** `unknown_name`, `invite_sender`, `failed` (elegir devolvió `false`).
7. **Aviso bajo fusión de cuentas:** `sync/groupKeyOffers` va a `EXCLUIDOS_FUSION` (no se fusiona). Perderlas cierra hacia S3-A1 (nada queda elegible).

Riesgo a declarar (no desvío): cuando el grupo YA existe localmente (caso dos lotes), el spec usa su nombre como «verificado», pero ese grupo vino del topic de la clave en disputa. Se implementa como dice el spec; queda anotado para el PO.

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/sync/groupKeyOffers.ts` | Crear | Tipo `KeyOffer`, núcleo puro (`aplicarOferta`, `estadoDe`) y store cifrado/scopeado de ofertas |
| `src/sync/__tests__/groupKeyOffers.test.ts` | Crear | Dedupe, reemplazo, tope, estado, scope, bucket, corrupción |
| `src/store/accountLink.ts` | Modificar | Declarar `sync/groupKeyOffers` en `EXCLUIDOS_FUSION` |
| `src/services/syncNotices.ts` | Modificar | Kind `group_key_conflict`, `esAccionable`, `KeyConflictNotice`, `nombreDeGrupoEnConflicto` |
| `src/services/notifications.ts` | Modificar | `isEnabled`/`textFor` del kind nuevo; `announceKeyConflict` (un aviso sin leer por grupo) |
| `src/services/__tests__/syncNotices.test.ts` | Modificar | Clasificación exhaustiva + nombre del grupo |
| `src/services/__tests__/notifications.test.ts` | Modificar | Toggle y textos del kind nuevo |
| `src/services/__tests__/announce.test.ts` | Modificar | Tope de un aviso sin leer por grupo |
| `src/services/__tests__/inventarioDeAvisos.test.ts` | Modificar | Inventario de la bandeja con el kind nuevo |
| `src/sync/keyConflictNotice.ts` | Crear | Arma el aviso (nombre local o del drop, remitentes con oferta) y lo anuncia |
| `src/sync/__tests__/keyConflictNotice.test.ts` | Crear | Menos de dos remitentes, nombre verificado/no verificado, ids hostiles |
| `src/sync/contactChannel.ts` | Modificar | `registrarDropComoOferta`, `resolverOfertas`, `DrainContactsResult` nuevo |
| `src/sync/relayEngine.ts` | Modificar | `drainContactsNow` avisa `conflictedGroups` |
| `src/sync/__tests__/contactChannel.test.ts` | Modificar | Mocks + describe T-136 (criterios 1–4, 6) |
| `src/sync/inviteEngine.ts` | Modificar | `redeem` async: oferta `origen:'invite'` + aviso ante choque con clave de contacto |
| `src/sync/__tests__/inviteEngine.test.ts` | Modificar | Criterio 5 |
| `src/services/elegirClaveDeGrupo.ts` | Crear | Guardas S3-A1, purga, adopción, pendiente de drenaje, drenaje |
| `src/services/__tests__/elegirClaveDeGrupo.test.ts` | Crear | Camino feliz, guardas, sin publicación |
| `src/services/salirDelGrupo.ts` | Modificar | `purgarGrupoLocalmente` olvida ofertas |
| `src/store/__tests__/purgaAlSalir.test.ts` | Modificar | La purga olvida las ofertas del grupo y sólo las de ese grupo |
| `src/components/GroupKeyConflictCard.tsx` | Crear | Tarjeta: un `ActionButton` por remitente en `ButtonRack`, confirmación, «Decidir después» |
| `src/components/__tests__/GroupKeyConflictCard.test.tsx` | Crear | Botones, confirmación, cancelar, fallo, i18n verbatim y en/pt |
| `src/components/TabHeader.tsx` | Modificar | Abrir la tarjeta desde el aviso sin marcarlo leído |
| `src/components/__tests__/TabHeader.test.tsx` | Modificar | Integración aviso → tarjeta |
| `src/i18n/locales/es.json`, `en.json`, `pt.json` | Modificar | `sync.keyConflict.*` |
| `src/store/groupKeyStore.ts` | Modificar (comentario) | Regla «nunca automáticamente» (ADR-013) |
| `docs/ARCHITECTURE.md` | Modificar | Subsección de entrega de claves por contacto |
| `engram/05_handoff_log.md`, `engram/03_backlog.md` | Modificar (gitignored) | Handoff y estado del ticket |

Dependencias entre tareas: Task 1 → {Task 2, Task 3, Task 4} (independientes entre sí, paralelizables en worktrees separados si el orquestador quiere; tocan archivos distintos) → Task 5 (usa Task 1 y la firma de Task 4) → Task 6 (serie, necesita todo).

---

### Task 1: Ofertas de clave + contrato del aviso

**Files:**
- Create: `src/sync/groupKeyOffers.ts`
- Test: `src/sync/__tests__/groupKeyOffers.test.ts`
- Modify: `src/store/accountLink.ts` (`EXCLUIDOS_FUSION`, ~línea 728-747)
- Modify: `src/services/syncNotices.ts:85` (unión `Notice`), `:108-124` (`esAccionable`)
- Modify: `src/services/notifications.ts:130-160` (`isEnabled`), `:163-223` (`textFor`), final del archivo (`announceKeyConflict`)
- Modify tests: `src/services/__tests__/syncNotices.test.ts:370-393`, `src/services/__tests__/notifications.test.ts` (final), `src/services/__tests__/announce.test.ts` (final), `src/services/__tests__/inventarioDeAvisos.test.ts:64`

**Interfaces:**
- Consumes: `createSecureStorage` (`@/src/utils/secureStorage`), `readScoped`/`writeScoped` (`@/src/store/userScope`), `useGroupKeyStore` (`@/src/store/groupKeyStore`), `announce`, `useNoticeInboxStore`.
- Produces (`src/sync/groupKeyOffers.ts`):
  - `export const MAX_OFERTAS_POR_GRUPO = 5;`
  - `export const BUCKET_OFERTAS = 'groupkeys';`
  - `export const PREFIJO_OFERTA_INVITACION = 'invite:';`
  - `export type OrigenOferta = 'contact' | 'invite';`
  - `export type KeyOffer = { groupId: string; fromUserId: string; key: string; epoch: number; origen: OrigenOferta; receivedAt: number; adoptada: boolean };`
  - `export type EstadoOfertas = 'sin_ofertas' | 'unanime' | 'conflicto';`
  - `export function aplicarOferta(lista: readonly KeyOffer[], o: KeyOffer): KeyOffer[] | null`
  - `export function estadoDe(ofertas: readonly KeyOffer[], claveLocal?: string): EstadoOfertas`
  - `export function registrarOferta(o: KeyOffer): boolean`
  - `export function ofertasDe(groupId: string): KeyOffer[]`
  - `export function estado(groupId: string, claveLocal?: string): EstadoOfertas`
  - `export function marcarAdoptada(groupId: string, fromUserId: string): void`
  - `export function olvidarOfertas(groupId: string): void`
  - `export function claveLocalVinoDeContacto(groupId: string): boolean`
  - `export function idDeOfertaDeInvitacion(inviterFingerprint: string): string`
  - `export function esOfertaDeInvitacion(fromUserId: string): boolean`
- Produces (`src/services/syncNotices.ts`):
  - miembro de `Notice`: `{ kind: 'group_key_conflict'; groupId: string; groupName: string; nombreVerificado: boolean; senderIds: string[] }`
  - `export type KeyConflictNotice = Extract<Notice, { kind: 'group_key_conflict' }>;`
  - `export function nombreDeGrupoEnConflicto(notice: Pick<KeyConflictNotice, 'groupName' | 'nombreVerificado'>, t: (key: string, opts?: Record<string, unknown>) => string): string`
- Produces (`src/services/notifications.ts`): `export async function announceKeyConflict(notice: KeyConflictNotice): Promise<number>`
- Contrato fijado para Task 4/5 (se implementa en Task 4): `elegirClaveDeGrupo(groupId: string, fromUserId: string): Promise<boolean>`.

- [ ] **Step 1: Crear la rama**

```bash
cd /Users/gabrielsk/Documents/Proyects/spendApp
git checkout main && git pull -q && git checkout -b fix/T-136-conflicto-clave
```

- [ ] **Step 2: Escribir los tests del store de ofertas (fallan)**

Crear `src/sync/__tests__/groupKeyOffers.test.ts`:

```ts
import {
  BUCKET_OFERTAS, MAX_OFERTAS_POR_GRUPO, aplicarOferta, claveLocalVinoDeContacto,
  esOfertaDeInvitacion, estado, estadoDe, idDeOfertaDeInvitacion, marcarAdoptada,
  ofertasDe, olvidarOfertas, registrarOferta, type KeyOffer,
} from '../groupKeyOffers';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { createSecureStorage, SECURE_IDS } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * T-136 · ADR-013. Las ofertas son lo que reemplaza al «primero en llegar gana»
 * de `adoptDroppedKey`: una por (grupo, remitente), y la clave sólo se adopta
 * sola si todas coinciden.
 */

const K1 = 'a1'.repeat(32);
const K2 = 'b2'.repeat(32);

const oferta = (fromUserId: string, key = K1, over: Partial<KeyOffer> = {}): KeyOffer => ({
  groupId: 'g1', fromUserId, key, epoch: 1, origen: 'contact', receivedAt: 0, adoptada: false, ...over,
});

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: { id: 'ana' } as User });
  useGroupKeyStore.setState({ keys: [] });
});

describe('aplicarOferta (pura)', () => {
  it('una oferta nueva se agrega', () => {
    expect(aplicarOferta([], oferta('beto'))).toEqual([oferta('beto')]);
  });

  it('la misma clave del mismo remitente es no-op (el reenvío de cada arranque)', () => {
    expect(aplicarOferta([oferta('beto')], oferta('beto'))).toBeNull();
  });

  it('la misma clave en mayúsculas es la misma clave', () => {
    expect(aplicarOferta([oferta('beto')], oferta('beto', K1.toUpperCase()))).toBeNull();
  });

  it('otra clave del mismo remitente reemplaza SÓLO su oferta', () => {
    const r = aplicarOferta([oferta('beto'), oferta('carla')], oferta('beto', K2))!;
    expect(r).toHaveLength(2);
    expect(r.find(o => o.fromUserId === 'beto')!.key).toBe(K2);
    expect(r.find(o => o.fromUserId === 'carla')!.key).toBe(K1);
  });

  // Desvío 1 del plan: reemplazar una oferta adoptada borraría la prueba de que
  // la clave local vino de contacto y dejaría un conflicto sin salida.
  it('una oferta ya adoptada no se reemplaza', () => {
    expect(aplicarOferta([oferta('beto', K1, { adoptada: true })], oferta('beto', K2))).toBeNull();
  });

  it(`el tope es ${MAX_OFERTAS_POR_GRUPO} remitentes por grupo: el sexto se ignora`, () => {
    expect(MAX_OFERTAS_POR_GRUPO).toBe(5);
    const cinco = ['a', 'b', 'c', 'd', 'e'].map(id => oferta(id));
    expect(aplicarOferta(cinco, oferta('f', K2))).toBeNull();
  });

  it('con el tope lleno, un remitente que ya estaba puede reemplazar su oferta', () => {
    const cinco = ['a', 'b', 'c', 'd', 'e'].map(id => oferta(id));
    expect(aplicarOferta(cinco, oferta('a', K2))).toHaveLength(5);
  });

  it('el tope es por grupo, no global', () => {
    const cinco = ['a', 'b', 'c', 'd', 'e'].map(id => oferta(id));
    expect(aplicarOferta(cinco, oferta('f', K2, { groupId: 'g2' }))).toHaveLength(6);
  });
});

describe('estadoDe (pura)', () => {
  it('sin ofertas es sin_ofertas, haya o no clave local', () => {
    expect(estadoDe([])).toBe('sin_ofertas');
    expect(estadoDe([], K1)).toBe('sin_ofertas');
  });

  it('dos remitentes con la misma clave son unánimes', () => {
    expect(estadoDe([oferta('beto'), oferta('carla')])).toBe('unanime');
  });

  it('dos claves distintas son conflicto', () => {
    expect(estadoDe([oferta('beto'), oferta('mallory', K2)])).toBe('conflicto');
  });

  it('una oferta distinta de la clave local es conflicto; igual, unánime', () => {
    expect(estadoDe([oferta('beto', K2)], K1)).toBe('conflicto');
    expect(estadoDe([oferta('beto')], K1.toUpperCase())).toBe('unanime');
  });
});

describe('store de ofertas', () => {
  it('registrar devuelve true la primera vez y false al repetir', () => {
    expect(registrarOferta(oferta('beto'))).toBe(true);
    expect(registrarOferta(oferta('beto'))).toBe(false);
    expect(ofertasDe('g1')).toHaveLength(1);
  });

  it('estado mira todas las ofertas del grupo', () => {
    registrarOferta(oferta('beto'));
    expect(estado('g1')).toBe('unanime');
    registrarOferta(oferta('mallory', K2));
    expect(estado('g1')).toBe('conflicto');
    expect(estado('otro')).toBe('sin_ofertas');
  });

  it('vive en un bucket CIFRADO (guarda claves)', () => {
    expect(SECURE_IDS).toContain(BUCKET_OFERTAS);
  });

  it('está scopeado por cuenta: otra cuenta no ve las ofertas', () => {
    registrarOferta(oferta('beto'));
    useAuthStore.setState({ currentUser: { id: 'otra' } as User });
    expect(ofertasDe('g1')).toEqual([]);
  });

  it('un dato corrupto se degrada a «sin ofertas»', () => {
    createSecureStorage('groupkeys').set('key_offers_v1::u:ana', '{no es json');
    expect(ofertasDe('g1')).toEqual([]);
  });

  it('olvidarOfertas borra sólo las del grupo', () => {
    registrarOferta(oferta('beto'));
    registrarOferta(oferta('beto', K1, { groupId: 'g2' }));
    olvidarOfertas('g1');
    expect(ofertasDe('g1')).toEqual([]);
    expect(ofertasDe('g2')).toHaveLength(1);
  });
});

describe('claveLocalVinoDeContacto', () => {
  it('sin clave local es false', () => {
    registrarOferta(oferta('beto'));
    marcarAdoptada('g1', 'beto');
    expect(claveLocalVinoDeContacto('g1')).toBe(false);
  });

  it('es true sólo con una oferta ADOPTADA cuya clave es la local', () => {
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: K1, epoch: 1 }] });
    registrarOferta(oferta('beto'));
    expect(claveLocalVinoDeContacto('g1')).toBe(false);
    marcarAdoptada('g1', 'beto');
    expect(claveLocalVinoDeContacto('g1')).toBe(true);
  });

  it('una oferta adoptada con OTRA clave no cuenta (la local vino de ensureKey/QR/invitación)', () => {
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: K2, epoch: 1 }] });
    registrarOferta(oferta('beto'));
    marcarAdoptada('g1', 'beto');
    expect(claveLocalVinoDeContacto('g1')).toBe(false);
  });
});

describe('remitente de una oferta de invitación', () => {
  it('se identifica por la huella de quien invita, con prefijo propio', () => {
    const id = idDeOfertaDeInvitacion('fp123');
    expect(id).toBe('invite:fp123');
    expect(esOfertaDeInvitacion(id)).toBe(true);
    expect(esOfertaDeInvitacion('u-beto')).toBe(false);
  });
});
```

- [ ] **Step 3: Correrlos y ver el rojo**

Run: `npx jest src/sync/__tests__/groupKeyOffers.test.ts`
Expected: FAIL — `Cannot find module '../groupKeyOffers'`.

- [ ] **Step 4: Implementar el store de ofertas**

Crear `src/sync/groupKeyOffers.ts`:

```ts
import { createSecureStorage } from '@/src/utils/secureStorage';
import { readScoped, writeScoped } from '@/src/store/userScope';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';

/**
 * **Ofertas de clave de grupo** (T-136 · ADR-013).
 *
 * Hasta acá, la primera clave firmada que llegaba por contacto para un grupo
 * que no teníamos ganaba para siempre. «Peer» es cualquiera que conozca mi
 * secreto de contacto —cualquiera que haya escaneado mi QR—, así que ese
 * «primero» podía ser un atacante: bloqueaba la entrega real, la invitación y
 * leía lo que la víctima escribía en su topic.
 *
 * Ahora cada clave entregada es una OFERTA por (grupo, remitente). Se adopta
 * sola sólo si todas las ofertas del grupo coinciden; si no, decide el usuario
 * (`services/elegirClaveDeGrupo.ts`). La membresía no sirve para arbitrar: el
 * roster viaja cifrado con la clave en disputa y `memberIds` no está firmado.
 *
 * Guarda CLAVES: por eso vive en el bucket cifrado `groupkeys` y scopeado por
 * cuenta, igual que `groupKeyStore`. No es un store de zustand ni cachea en
 * memoria: se lee del disco en cada llamada, así que no hay nada que soltar al
 * cambiar de cuenta.
 */

export const MAX_OFERTAS_POR_GRUPO = 5;
export const BUCKET_OFERTAS = 'groupkeys';
export const PREFIJO_OFERTA_INVITACION = 'invite:';

const storage = createSecureStorage(BUCKET_OFERTAS);
const K_OFERTAS = 'key_offers_v1';

export type OrigenOferta = 'contact' | 'invite';

export type KeyOffer = {
  groupId: string;
  /** Id de quien la entregó. Para una invitación: `invite:<huella>`. */
  fromUserId: string;
  /** Clave en hex, siempre en minúsculas. */
  key: string;
  epoch: number;
  origen: OrigenOferta;
  receivedAt: number;
  /** `true` si ESTA clave es la que se adoptó: la prueba de que la local vino de contacto. */
  adoptada: boolean;
};

export type EstadoOfertas = 'sin_ofertas' | 'unanime' | 'conflicto';

/**
 * Suma una oferta a la lista. `null` si no cambia nada.
 *
 *  - Misma clave del mismo remitente → no-op: es el reenvío de cada arranque.
 *  - Otra clave del mismo remitente → reemplaza SU oferta, salvo que ya esté
 *    adoptada: esa es la prueba de origen de la clave local y no se pisa.
 *  - Remitente nuevo con el grupo lleno (`MAX_OFERTAS_POR_GRUPO`) → se ignora.
 */
export function aplicarOferta(lista: readonly KeyOffer[], o: KeyOffer): KeyOffer[] | null {
  const entrante: KeyOffer = { ...o, key: o.key.toLowerCase() };
  const i = lista.findIndex(x => x.groupId === entrante.groupId && x.fromUserId === entrante.fromUserId);

  if (i !== -1) {
    const previa = lista[i]!;
    if (previa.key === entrante.key) return null;
    if (previa.adoptada) return null;
    const nueva = [...lista];
    nueva[i] = entrante;
    return nueva;
  }

  const delGrupo = lista.filter(x => x.groupId === entrante.groupId).length;
  if (delGrupo >= MAX_OFERTAS_POR_GRUPO) return null;
  return [...lista, entrante];
}

/** ¿Las ofertas (y la clave local, si se pasa) coinciden todas? */
export function estadoDe(ofertas: readonly KeyOffer[], claveLocal?: string): EstadoOfertas {
  if (ofertas.length === 0) return 'sin_ofertas';
  const claves = new Set(ofertas.map(o => o.key.toLowerCase()));
  if (claveLocal !== undefined) claves.add(claveLocal.toLowerCase());
  return claves.size === 1 ? 'unanime' : 'conflicto';
}

function esOferta(x: unknown): x is KeyOffer {
  const o = x as Partial<KeyOffer> | null;
  return !!o
    && typeof o.groupId === 'string'
    && typeof o.fromUserId === 'string'
    && typeof o.key === 'string'
    && typeof o.epoch === 'number'
    && typeof o.adoptada === 'boolean';
}

function leer(): KeyOffer[] {
  const raw = readScoped(storage, K_OFERTAS);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(esOferta) : [];
  } catch {
    return []; // dato corrupto: sin ofertas no hay nada elegible, que es el lado seguro
  }
}

function guardar(lista: KeyOffer[]): void {
  writeScoped(storage, K_OFERTAS, JSON.stringify(lista));
}

/** `true` si la oferta dejó la tabla distinta (nueva o reemplazada). */
export function registrarOferta(o: KeyOffer): boolean {
  const nueva = aplicarOferta(leer(), o);
  if (!nueva) return false;
  guardar(nueva);
  return true;
}

export function ofertasDe(groupId: string): KeyOffer[] {
  return leer().filter(o => o.groupId === groupId);
}

export function estado(groupId: string, claveLocal?: string): EstadoOfertas {
  return estadoDe(ofertasDe(groupId), claveLocal);
}

export function marcarAdoptada(groupId: string, fromUserId: string): void {
  let cambio = false;
  const nueva = leer().map(o => {
    if (o.groupId !== groupId || o.fromUserId !== fromUserId || o.adoptada) return o;
    cambio = true;
    return { ...o, adoptada: true };
  });
  if (cambio) guardar(nueva);
}

export function olvidarOfertas(groupId: string): void {
  const lista = leer();
  const quedan = lista.filter(o => o.groupId !== groupId);
  if (quedan.length !== lista.length) guardar(quedan);
}

/**
 * ¿La clave local de este grupo vino de una oferta adoptada?
 *
 * Es LA guarda de S3-A1: sólo una clave de contacto puede entrar en disputa.
 * Las de `ensureKey`, QR o invitación no tienen oferta adoptada, así que nunca
 * son sustituibles por este camino.
 */
export function claveLocalVinoDeContacto(groupId: string): boolean {
  const local = useGroupKeyStore.getState().getKey(groupId);
  if (!local) return false;
  const k = local.key.toLowerCase();
  return ofertasDe(groupId).some(o => o.adoptada && o.key === k);
}

/** `InviteGrant` no trae el id de quien entrega: se usa la huella del link. */
export function idDeOfertaDeInvitacion(inviterFingerprint: string): string {
  return `${PREFIJO_OFERTA_INVITACION}${inviterFingerprint}`;
}

export function esOfertaDeInvitacion(fromUserId: string): boolean {
  return fromUserId.startsWith(PREFIJO_OFERTA_INVITACION);
}
```

- [ ] **Step 5: Correr y ver PASS**

Run: `npx jest src/sync/__tests__/groupKeyOffers.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 6: Ver el guard de cuenta en rojo y declararlo**

Run: `npx jest src/store/__tests__/accountCoverage.test.ts`
Expected: FAIL en «ningún módulo scopeado queda sin declarar» con `["sync/groupKeyOffers"]`.

En `src/store/accountLink.ts`, dentro de `EXCLUIDOS_FUSION`, agregar después de la entrada `'sync/recordHealth': …,`:

```ts
  'sync/groupKeyOffers':
    'Ofertas de clave de grupo por remitente (T-136, ADR-013): el estado de una decisión pendiente de ESTE teléfono. Heredar las de otra cuenta mezclaría conflictos ajenos. Perderlas es el lado seguro: sin oferta adoptada, claveLocalVinoDeContacto da false y ninguna clave queda elegible (S3-A1 sigue cerrado); un conflicto real vuelve a registrarse con el reenvío de cada arranque (relayEngine.reenviarClavesDeGrupo).',
```

Run: `npx jest src/store/__tests__/accountCoverage.test.ts`
Expected: PASS.

- [ ] **Step 7: Tests del contrato del aviso (fallan)**

En `src/services/__tests__/syncNotices.test.ts`, cambiar la línea 1:

```ts
import { snapshot, noticesFor, esAccionable, msRestanteDeBorrado, type Notice } from '../syncNotices';
```

por:

```ts
import {
  snapshot, noticesFor, esAccionable, msRestanteDeBorrado, nombreDeGrupoEnConflicto, type Notice,
} from '../syncNotices';
```

y reemplazar el `describe('esAccionable (T-062)', …)` completo (líneas 370-393) por:

```ts
describe('esAccionable (T-062)', () => {
  it('deletion, settlement_pending, sync_down, clock_off y group_key_conflict piden acción; el resto informa', () => {
    // `Record<Notice['kind'], boolean>` en vez de dos ejemplos sueltos: si se
    // agrega un `kind` a `Notice` sin decidir acá, este objeto deja de
    // compilar — la exhaustividad la garantiza el tipo, no el `expect` de abajo.
    const clasificacion: Record<Notice['kind'], boolean> = {
      deletion: esAccionable('deletion'),
      settlement_pending: esAccionable('settlement_pending'),
      sync_down: esAccionable('sync_down'),
      clock_off: esAccionable('clock_off'),
      group_key_conflict: esAccionable('group_key_conflict'),
      expenses: esAccionable('expenses'),
      settled: esAccionable('settled'),
      restored: esAccionable('restored'),
      joined: esAccionable('joined'),
    };
    expect(clasificacion).toEqual({
      // `clock_off` es accionable aunque lo que hay que hacer esté FUERA de la
      // app: clasificarlo como historia dejaría al usuario viendo fechas mal
      // para siempre sin saber por qué.
      deletion: true, settlement_pending: true, sync_down: true, clock_off: true,
      // T-136: leerlo no lo resuelve — hay que elegir una clave.
      group_key_conflict: true,
      expenses: false, settled: false, restored: false, joined: false,
    });
  });
});

describe('nombreDeGrupoEnConflicto (T-136)', () => {
  const t = (key: string, opts?: Record<string, unknown>) => `${key}(${JSON.stringify(opts ?? {})})`;

  it('con el nombre del grupo local, se muestra tal cual', () => {
    expect(nombreDeGrupoEnConflicto({ groupName: 'Viaje', nombreVerificado: true }, t)).toBe('Viaje');
  });

  it('con el nombre que trajo el drop, se marca «sin verificar»', () => {
    expect(nombreDeGrupoEnConflicto({ groupName: 'Viaje', nombreVerificado: false }, t))
      .toBe('sync.keyConflict.unverified_name({"group":"Viaje"})');
  });
});
```

Al final de `src/services/__tests__/notifications.test.ts` agregar:

```ts
describe('conflicto de clave de grupo (T-136)', () => {
  const dos: Notice = {
    kind: 'group_key_conflict', groupId: 'g1', groupName: 'Viaje', nombreVerificado: true,
    senderIds: ['u-beto', 'u-mallory'],
  };
  const tres: Notice = { ...dos, senderIds: ['u-beto', 'u-mallory', 'u-carla'] };
  const sinVerificar: Notice = { ...dos, nombreVerificado: false };

  it('mira el toggle de invitaciones', () => {
    useSettingsStore.setState({ notifInvites: false });
    expect(isEnabled(dos)).toBe(false);
    useSettingsStore.setState({ notifInvites: true });
    expect(isEnabled(dos)).toBe(true);
  });

  it('el título cambia con más de dos remitentes', () => {
    expect(textFor(dos).title).not.toBe(textFor(tres).title);
    expect(textFor(dos).body).toBeTruthy();
    expect(textFor(dos).body).toBe(textFor(tres).body);
  });

  it('un nombre sin verificar no se muestra igual que uno verificado', () => {
    expect(textFor(sinVerificar).title).not.toBe(textFor(dos).title);
  });
});
```

Al final de `src/services/__tests__/announce.test.ts`, reemplazar la línea 1:

```ts
import { announce } from '../notifications';
```

por:

```ts
import { announce, announceKeyConflict } from '../notifications';
```

y la línea `import type { Notice } from '../syncNotices';` por:

```ts
import type { KeyConflictNotice, Notice } from '../syncNotices';
```

y agregar al final del archivo:

```ts
describe('announceKeyConflict (T-136): como máximo un aviso sin leer por grupo', () => {
  const conflicto: KeyConflictNotice = {
    kind: 'group_key_conflict', groupId: 'g1', groupName: 'Viaje', nombreVerificado: false,
    senderIds: ['u-beto', 'u-mallory'],
  };

  it('el primero se registra y avisa', async () => {
    expect(await announceKeyConflict(conflicto)).toBe(1);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
  });

  it('otro conflicto del MISMO grupo con uno sin leer no apila', async () => {
    await announceKeyConflict(conflicto);
    expect(await announceKeyConflict({ ...conflicto, senderIds: ['u-beto', 'u-mallory', 'u-carla'] })).toBe(0);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('otro grupo sí avisa', async () => {
    await announceKeyConflict(conflicto);
    await announceKeyConflict({ ...conflicto, groupId: 'g2' });
    expect(useNoticeInboxStore.getState().items).toHaveLength(2);
  });

  it('con el anterior ya leído, un conflicto nuevo vuelve a avisar', async () => {
    await announceKeyConflict(conflicto);
    useNoticeInboxStore.getState().markAllRead();
    await announceKeyConflict(conflicto);
    expect(useNoticeInboxStore.getState().items).toHaveLength(2);
  });
});
```

En `src/services/__tests__/inventarioDeAvisos.test.ts`, después de la línea `  clock_off: 'el reloj del teléfono está mal y las fechas se ven cambiadas',` agregar:

```ts
  /**
   * **Pide elegir, y entra igual** (T-136 · ADR-013). Lo que llega a la bandeja
   * es enterarse; la elección se hace en la tarjeta que abre el aviso, con los
   * remitentes delante. Un modal en el arranque sería lo que el PO no quiere.
   */
  group_key_conflict: 'dos o más contactos entregaron claves distintas para un grupo y hay que elegir una',
```

- [ ] **Step 8: Correr y ver el rojo**

Run: `npx jest src/services/__tests__/syncNotices.test.ts src/services/__tests__/notifications.test.ts src/services/__tests__/announce.test.ts src/services/__tests__/inventarioDeAvisos.test.ts`
Expected: FAIL — `nombreDeGrupoEnConflicto is not a function`, `announceKeyConflict is not a function`, `esAccionable('group_key_conflict')` devuelve `undefined`, y el inventario ve `group_key_conflict` declarado de más.

- [ ] **Step 9: Implementar el contrato en `syncNotices.ts`**

En `src/services/syncNotices.ts`, reemplazar:

```ts
  | { kind: 'sync_down'; groupId: string; groupName: string; reason: BlockingReason }
```

por:

```ts
  | { kind: 'sync_down'; groupId: string; groupName: string; reason: BlockingReason }
  /**
   * Dos o más contactos entregaron claves DISTINTAS para el mismo grupo
   * (T-136 · ADR-013). No se adoptó ninguna sola: el usuario elige.
   *
   * `nombreVerificado` es `false` cuando el nombre salió del drop, que lo
   * escribe el remitente. `senderIds` es la foto del momento del aviso; la
   * tarjeta relee las ofertas vivas (`ofertasDe`).
   */
  | { kind: 'group_key_conflict'; groupId: string; groupName: string; nombreVerificado: boolean;
      senderIds: string[] }
```

En `esAccionable`, reemplazar:

```ts
    case 'clock_off':
      return true;
```

por:

```ts
    case 'clock_off':
    // T-136: leerlo no resuelve nada; hay que elegir una clave.
    case 'group_key_conflict':
      return true;
```

Y justo después del `}` de cierre de `esAccionable` agregar:

```ts
export type KeyConflictNotice = Extract<Notice, { kind: 'group_key_conflict' }>;

/**
 * Nombre del grupo tal como se muestra en un conflicto de clave (T-136).
 * Una sola función para el aviso y para la tarjeta: dos redacciones del mismo
 * «sin verificar» se contradicen sin que nadie mire.
 */
export function nombreDeGrupoEnConflicto(
  notice: Pick<KeyConflictNotice, 'groupName' | 'nombreVerificado'>,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return notice.nombreVerificado
    ? notice.groupName
    : t('sync.keyConflict.unverified_name', { group: notice.groupName });
}
```

- [ ] **Step 10: Implementar el contrato en `notifications.ts`**

En `src/services/notifications.ts`, reemplazar:

```ts
import type { Notice } from './syncNotices';
```

por:

```ts
import { nombreDeGrupoEnConflicto, type KeyConflictNotice, type Notice } from './syncNotices';
```

En `isEnabled`, reemplazar:

```ts
    case 'clock_off': return true;
  }
}
```

por:

```ts
    case 'clock_off': return true;
    // T-136: es sobre a qué grupo entrás; mismo dominio que `joined`.
    case 'group_key_conflict': return s.notifInvites;
  }
}
```

En `textFor`, reemplazar:

```ts
        body: t(claveDeFalloDeSync(notice.reason)),
      };
  }
}
```

por:

```ts
        body: t(claveDeFalloDeSync(notice.reason)),
      };
    case 'group_key_conflict': {
      const group = nombreDeGrupoEnConflicto(notice, t);
      return {
        title: t(
          notice.senderIds.length > 2 ? 'sync.keyConflict.title_many' : 'sync.keyConflict.title_two',
          { group },
        ),
        body: t('sync.keyConflict.body'),
      };
    }
  }
}
```

Al final del archivo agregar:

```ts
/**
 * Anuncia un conflicto de clave **sin apilar** (T-136, spec §4.6).
 *
 * Un atacante reenvía en cada arranque; sin este tope, cada clave nueva de un
 * remitente ya en conflicto sumaría otro aviso. Si ya hay uno SIN LEER de ese
 * grupo no se anuncia nada: la tarjeta relee las ofertas vivas al abrirse.
 */
export async function announceKeyConflict(notice: KeyConflictNotice): Promise<number> {
  const yaHay = useNoticeInboxStore.getState().items.some(i =>
    i.readAt === null
    && i.notice.kind === 'group_key_conflict'
    && i.notice.groupId === notice.groupId);
  if (yaHay) return 0;
  return announce([notice]);
}
```

- [ ] **Step 11: Correr y ver PASS; tipos**

Run: `npx jest src/sync/__tests__/groupKeyOffers.test.ts src/services/__tests__/syncNotices.test.ts src/services/__tests__/notifications.test.ts src/services/__tests__/announce.test.ts src/services/__tests__/inventarioDeAvisos.test.ts src/store/__tests__/accountCoverage.test.ts src/components/__tests__/NoticeInbox.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit` → Expected: sin salida.

- [ ] **Step 12: Commit**

```bash
git add src/sync/groupKeyOffers.ts src/sync/__tests__/groupKeyOffers.test.ts src/store/accountLink.ts \
  src/services/syncNotices.ts src/services/notifications.ts \
  src/services/__tests__/syncNotices.test.ts src/services/__tests__/notifications.test.ts \
  src/services/__tests__/announce.test.ts src/services/__tests__/inventarioDeAvisos.test.ts
git commit -m "feat(sync): ofertas de clave de grupo y aviso group_key_conflict (T-136)

Store cifrado y scopeado de ofertas por (grupo, remitente) con dedupe, tope
de 5 y estado unánime/conflicto. Nuevo Notice accionable con un solo aviso
sin leer por grupo. Excluido de la fusión de cuentas con razón escrita.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: El canal de contacto registra ofertas y avisa conflictos

**Files:**
- Create: `src/sync/keyConflictNotice.ts`
- Test: `src/sync/__tests__/keyConflictNotice.test.ts`
- Modify: `src/sync/contactChannel.ts:1-13` (imports), `:246-375` (`adoptDroppedKey` → `registrarDropComoOferta`, `DrainContactsResult`, `resolverOfertas`, `drainContacts`)
- Modify: `src/sync/relayEngine.ts:23` (import), `:476-506` (`drainContactsNow`)
- Test: `src/sync/__tests__/contactChannel.test.ts` (mocks arriba; describe nuevo al final)

**Interfaces:**
- Consumes (Task 1): `registrarOferta`, `ofertasDe`, `estado`, `marcarAdoptada`, `claveLocalVinoDeContacto`, `KeyOffer`, `announceKeyConflict`, `KeyConflictNotice`.
- Produces:
  - `src/sync/contactChannel.ts`: `export type DrainContactsResult = { added: number; joinedGroups: string[]; conflictedGroups: string[]; nombresDeDrop: Record<string, string>; cursor: number };` (`drainContacts` conserva su firma).
  - `src/sync/keyConflictNotice.ts`:
    - `export function noticeDeConflicto(groupId: string, nombreDelDrop: string | undefined): KeyConflictNotice | null`
    - `export async function avisarConflictoDeClave(groupId: string, nombreDelDrop: string | undefined): Promise<number>`
    - `export async function avisarConflictosDelDrenaje(r: Pick<DrainContactsResult, 'conflictedGroups' | 'nombresDeDrop'>): Promise<number>`

- [ ] **Step 1: Tests de `keyConflictNotice` (fallan)**

Crear `src/sync/__tests__/keyConflictNotice.test.ts`:

```ts
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}), drainNow: jest.fn(async () => 0), startRelay: jest.fn(async () => {}),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: async () => 'id',
}));

import { avisarConflictosDelDrenaje, noticeDeConflicto } from '../keyConflictNotice';
import { registrarOferta, type KeyOffer } from '../groupKeyOffers';
import { useAuthStore } from '@/src/store/authStore';
import { useGroupStore } from '@/src/store/groupStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

const oferta = (fromUserId: string, key: string, groupId = 'g1'): KeyOffer => ({
  groupId, fromUserId, key, epoch: 1, origen: 'contact', receivedAt: 0, adoptada: false,
});

beforeEach(() => {
  for (const b of ['groupkeys', 'groups', 'notices'] as const) createSecureStorage(b).clearAll();
  useAuthStore.setState({ currentUser: { id: 'ana' } as User });
  useGroupStore.setState({ groups: [] });
  useNoticeInboxStore.setState({ items: [] });
});

describe('noticeDeConflicto', () => {
  it('con menos de dos remitentes no hay conflicto que avisar', () => {
    registrarOferta(oferta('u-beto', 'ab'.repeat(32)));
    expect(noticeDeConflicto('g1', 'Viaje')).toBeNull();
  });

  it('sin grupo local, el nombre sale del drop y va SIN VERIFICAR', () => {
    registrarOferta(oferta('u-beto', 'ab'.repeat(32)));
    registrarOferta(oferta('u-mallory', 'cd'.repeat(32)));
    expect(noticeDeConflicto('g1', 'Viaje')).toEqual({
      kind: 'group_key_conflict', groupId: 'g1', groupName: 'Viaje', nombreVerificado: false,
      senderIds: ['u-beto', 'u-mallory'],
    });
  });

  it('con grupo local vivo, usa su nombre', () => {
    registrarOferta(oferta('u-beto', 'ab'.repeat(32)));
    registrarOferta(oferta('u-mallory', 'cd'.repeat(32)));
    useGroupStore.setState({ groups: [{ id: 'g1', name: 'Asado', isDeleted: false } as never] });
    expect(noticeDeConflicto('g1', 'Otro')).toMatchObject({ groupName: 'Asado', nombreVerificado: true });
  });
});

describe('avisarConflictosDelDrenaje', () => {
  it('avisa cada grupo en conflicto una vez', async () => {
    registrarOferta(oferta('u-beto', 'ab'.repeat(32)));
    registrarOferta(oferta('u-mallory', 'cd'.repeat(32)));
    const r = { conflictedGroups: ['g1'], nombresDeDrop: { g1: 'Viaje' } };

    expect(await avisarConflictosDelDrenaje(r)).toBe(1);
    expect(await avisarConflictosDelDrenaje(r)).toBe(0);
    expect(useNoticeInboxStore.getState().items).toHaveLength(1);
  });

  // Los ids de grupo vienen de afuera: `nombresDeDrop['constructor']` no puede
  // devolver una función del prototipo como nombre.
  it('un groupId hostil no toma nombres del prototipo', async () => {
    registrarOferta(oferta('u-beto', 'ab'.repeat(32), 'constructor'));
    registrarOferta(oferta('u-mallory', 'cd'.repeat(32), 'constructor'));
    await avisarConflictosDelDrenaje({ conflictedGroups: ['constructor'], nombresDeDrop: {} });

    const aviso = useNoticeInboxStore.getState().items[0]!.notice;
    expect(aviso).toMatchObject({ groupId: 'constructor', groupName: '' });
  });
});
```

Run: `npx jest src/sync/__tests__/keyConflictNotice.test.ts`
Expected: FAIL — `Cannot find module '../keyConflictNotice'`.

- [ ] **Step 2: Tests del canal de contacto (fallan)**

En `src/sync/__tests__/contactChannel.test.ts`, reemplazar las líneas 1-13 (imports) por:

```ts
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
// `keyConflictNotice` → `groupStore` → `relayEngine`: se corta acá para que el
// motor real no arranque en los tests del canal.
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}), drainNow: jest.fn(async () => 0), startRelay: jest.fn(async () => {}),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: async () => 'id',
}));

import {
  ensureContactSecret, myContactCard, announceContact, drainContacts,
  deriveContactTopic, savePeer, peerSecret, listPeers, sendGroupKey,
  getPeer, peersIncompletos, hasConflictingPinnedKeys,
} from '../contactChannel';
import { ofertasDe } from '../groupKeyOffers';
import { avisarConflictosDelDrenaje } from '../keyConflictNotice';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { ensureIdentity, ensureWrapKeypair } from '@/src/store/identityStore';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { openEnvelope, sealEnvelope, fromHex } from '../envelopeCrypto';
import * as Crypto from 'expo-crypto';
import type { KeyConflictNotice } from '@/src/services/syncNotices';
import type { User } from '@/src/types/models';
```

Al final del archivo agregar:

```ts
/**
 * T-136 · ADR-013. «Peer» es cualquiera que haya escaneado mi QR: su firma
 * prueba quién manda, no que sea miembro del grupo. Mallory escaneó el QR de
 * Ana y no está en el grupo; Beto sí.
 */
describe('T-136 · claves distintas para el mismo grupo', () => {
  const MALLORY = usuario('u-mallory', 'Mallory');
  const FALSA = 'ab'.repeat(32);

  /** Beto y Mallory escanearon el QR de Ana, y Ana recogió las dos tarjetas. */
  async function anaTieneDosContactos(): Promise<{ deAna: string; cursor: number }> {
    usar(ANA);
    const deAna = ensureContactSecret()!;
    const tarjeta = myContactCard()!;
    for (const quien of [BETO, MALLORY]) {
      usar(quien);
      savePeer(ANA.id, {
        secret: deAna,
        wrapPublicKey: tarjeta.wrapPublicKey,
        identityPublicKey: tarjeta.identityPublicKey,
      });
      await announceContact(deAna, `dev-${quien.id}`);
    }
    usar(ANA);
    const r = await drainContacts(deAna, 'dev-ana', 0);
    return { deAna, cursor: r.cursor };
  }

  /** Mallory planta una clave suya para g1, con una época absurda. */
  async function malloryPlanta(): Promise<void> {
    usar(MALLORY);
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: FALSA, epoch: 1e9 }] });
    await sendGroupKey(ANA.id, { id: 'g1', name: 'Viaje' }, 'dev-mallory');
  }

  /** Beto, el miembro real, entrega la clave de verdad. */
  async function betoEntrega(): Promise<string> {
    usar(BETO);
    const clave = useGroupKeyStore.getState().ensureKey('g1').key;
    await sendGroupKey(ANA.id, { id: 'g1', name: 'Viaje' }, 'dev-beto');
    return clave;
  }

  /** Lo mismo que hace `relayEngine.drainContactsNow` con el resultado. */
  async function anaDrena(deAna: string, desde: number) {
    usar(ANA);
    const r = await drainContacts(deAna, 'dev-ana', desde);
    await avisarConflictosDelDrenaje(r);
    return r;
  }

  const conflictosDe = (groupId: string): KeyConflictNotice[] => useNoticeInboxStore.getState().items
    .map(i => i.notice)
    .filter((n): n is KeyConflictNotice => n.kind === 'group_key_conflict' && n.groupId === groupId);

  beforeEach(() => {
    createSecureStorage('notices').clearAll();
    useNoticeInboxStore.setState({ items: [] });
  });

  it('criterio 2 · mismo lote: claves distintas de dos remitentes → no se adopta ninguna y hay UN aviso', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    await betoEntrega();

    const r = await anaDrena(deAna, cursor);

    expect(useGroupKeyStore.getState().getKey('g1')).toBeUndefined();
    expect(r.joinedGroups).not.toContain('g1');
    expect(r.conflictedGroups).toEqual(['g1']);
    const avisos = conflictosDe('g1');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ groupName: 'Viaje', nombreVerificado: false });
    expect([...avisos[0]!.senderIds].sort()).toEqual([BETO.id, MALLORY.id].sort());
  });

  it('criterio 1 (sin elegir) · dos lotes: la primera clave queda y la segunda distinta levanta el conflicto', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    const r1 = await anaDrena(deAna, cursor);
    expect(r1.joinedGroups).toEqual(['g1']); // un solo remitente: camino feliz

    await betoEntrega();
    const r2 = await anaDrena(deAna, r1.cursor);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual({ groupId: 'g1', key: FALSA, epoch: 1e9 });
    expect(r2.joinedGroups).not.toContain('g1');
    expect(r2.conflictedGroups).toEqual(['g1']);
    expect(conflictosDe('g1')).toHaveLength(1);
  });

  it('criterio 3/6 · los reenvíos de cada arranque no crean ofertas ni avisos nuevos', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    const r1 = await anaDrena(deAna, cursor);
    await betoEntrega();
    const r2 = await anaDrena(deAna, r1.cursor);

    await malloryPlanta();
    await betoEntrega();
    const r3 = await anaDrena(deAna, r2.cursor);

    expect(r3.conflictedGroups).toEqual([]);
    expect(ofertasDe('g1')).toHaveLength(2);
    expect(conflictosDe('g1')).toHaveLength(1);
  });

  it('criterio 3 · la misma clave del mismo remitente N veces en un lote deja UNA oferta y adopta', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    usar(BETO);
    const clave = useGroupKeyStore.getState().ensureKey('g1').key;
    for (let i = 0; i < 3; i++) await sendGroupKey(ANA.id, { id: 'g1', name: 'Viaje' }, 'dev-beto');

    const r = await anaDrena(deAna, cursor);

    expect(r.joinedGroups).toEqual(['g1']);
    expect(ofertasDe('g1')).toHaveLength(1);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(clave);
    expect(conflictosDe('g1')).toHaveLength(0);
  });

  it('criterio 3 · dos remitentes con la MISMA clave adoptan sin aviso', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    const clave = await betoEntrega();
    usar(MALLORY);
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: clave, epoch: 1 }] });
    await sendGroupKey(ANA.id, { id: 'g1', name: 'Viaje' }, 'dev-mallory');

    const r = await anaDrena(deAna, cursor);

    expect(r.joinedGroups).toEqual(['g1']);
    expect(r.conflictedGroups).toEqual([]);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(clave);
    expect(conflictosDe('g1')).toHaveLength(0);
  });

  it('criterio 4 · S3-A1: con una clave local que NO vino de contacto, otra clave no deja oferta ni aviso', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    usar(ANA);
    const propia = useGroupKeyStore.getState().ensureKey('g1');
    await betoEntrega();

    const r = await anaDrena(deAna, cursor);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual(propia);
    expect(r.conflictedGroups).toEqual([]);
    expect(ofertasDe('g1')).toEqual([]);
    expect(conflictosDe('g1')).toHaveLength(0);
  });
});
```

Run: `npx jest src/sync/__tests__/contactChannel.test.ts -t "T-136"`
Expected: FAIL — `Cannot find module '../keyConflictNotice'` (y, una vez creado el módulo, fallan «criterio 2» porque `adoptDroppedKey` adopta la primera clave, y «criterio 1» porque `conflictedGroups` es `undefined`: esto es la prueba de rojo del ataque en `main`; anotar la salida).

- [ ] **Step 3: Implementar `keyConflictNotice.ts`**

Crear `src/sync/keyConflictNotice.ts`:

```ts
import { useGroupStore } from '@/src/store/groupStore';
import { announceKeyConflict } from '@/src/services/notifications';
import type { KeyConflictNotice } from '@/src/services/syncNotices';
import type { DrainContactsResult } from './contactChannel';
import { ofertasDe } from './groupKeyOffers';

/**
 * El aviso de claves en disputa, armado igual desde el canal de contacto y
 * desde la invitación (T-136). Una sola función: dos armados del mismo aviso
 * terminan diciendo cosas distintas.
 *
 * `null` si no hay dos remitentes: un conflicto de uno solo no tiene nada que
 * elegir.
 */
export function noticeDeConflicto(groupId: string, nombreDelDrop: string | undefined): KeyConflictNotice | null {
  const senderIds = [...new Set(ofertasDe(groupId).map(o => o.fromUserId))];
  if (senderIds.length < 2) return null;

  const local = useGroupStore.getState().getById(groupId);
  const nombreLocal = local && !local.isDeleted ? local.name : undefined;

  return {
    kind: 'group_key_conflict',
    groupId,
    groupName: nombreLocal ?? nombreDelDrop ?? '',
    nombreVerificado: nombreLocal !== undefined,
    senderIds,
  };
}

export async function avisarConflictoDeClave(groupId: string, nombreDelDrop: string | undefined): Promise<number> {
  const notice = noticeDeConflicto(groupId, nombreDelDrop);
  return notice ? announceKeyConflict(notice) : 0;
}

/** Lo que `drainContactsNow` hace con los grupos en conflicto de un drenaje. */
export async function avisarConflictosDelDrenaje(
  r: Pick<DrainContactsResult, 'conflictedGroups' | 'nombresDeDrop'>,
): Promise<number> {
  let avisados = 0;
  for (const groupId of r.conflictedGroups) {
    // Los ids vienen de afuera: sin `hasOwnProperty`, 'constructor' devolvería
    // una función del prototipo como nombre del grupo.
    const nombre = Object.prototype.hasOwnProperty.call(r.nombresDeDrop, groupId)
      ? r.nombresDeDrop[groupId]
      : undefined;
    try {
      avisados += await avisarConflictoDeClave(groupId, nombre);
    } catch { /* un aviso que falla no frena a los demás ni al sync */ }
  }
  return avisados;
}
```

- [ ] **Step 4: Implementar el cambio en `contactChannel.ts`**

En `src/sync/contactChannel.ts`, después de la línea `import { syncedNow } from '@/src/utils/syncedClock';` agregar:

```ts
import {
  claveLocalVinoDeContacto, estado, marcarAdoptada, ofertasDe, registrarOferta,
} from './groupKeyOffers';
```

Reemplazar desde el comentario `/**\n * Adopta una clave que llegó por el canal de contacto.` (línea 246) hasta el `}` que cierra `drainContacts` (línea 375) por:

```ts
/**
 * Registra como OFERTA una clave que llegó por el canal de contacto
 * (T-136 · ADR-013). Ya no adopta: eso se decide al final del lote, en
 * `resolverOfertas`, mirando todas las ofertas del grupo.
 *
 * Se acepta SÓLO si viene de alguien que escaneamos y la firma corresponde a la
 * identidad que guardamos de esa persona. Sin este chequeo, cualquiera que
 * conozca el buzón (todos los que escanearon el mismo código) podría meter una
 * clave inventada.
 *
 * Lo que la firma NO prueba: que el remitente sea miembro del grupo. Por eso
 * una oferta sola nunca sustituye nada.
 *
 * `true` sólo si dejó una oferta nueva o cambiada: es lo que marca al grupo
 * para resolverlo en este lote.
 */
function registrarDropComoOferta(drop: GroupKeyDrop, myUserId: string): boolean {
  // Redundante con la criptografía —una entrega envuelta para otro no la puedo
  // abrir igual— y por eso ningún test puede matarlo. Se deja porque hace
  // explícita la intención y corta antes de gastar una operación de curva.
  if (drop.forUserId !== myUserId || drop.fromUserId === myUserId) return false;

  const peer = getPeer(drop.fromUserId);
  if (!peer?.identityPublicKey || peer.identityPublicKey !== drop.senderIdentity) return false;

  try {
    const { kind: _k, signature, ...datos } = drop;
    const ok = ed25519.verify(fromHex(signature), utf8(dropPayload(datos)), fromHex(drop.senderIdentity));
    if (!ok) return false;
  } catch {
    return false;
  }

  // El unwrap va ANTES de mirar la clave local (T-136): para saber si hay
  // conflicto hay que comparar claves. Destinatario y firma ya se verificaron.
  const wrap = ensureWrapKeypair();
  const key = unwrapGroupKey(drop.wrappedKey, drop.senderWrapPublicKey, wrap.privateKey);
  // Una clave del largo equivocado dejaría el grupo ilegible para siempre, sin
  // más síntoma que "no me llega nada".
  if (!key || !/^[0-9a-f]{64}$/i.test(key)) return false;

  const local = useGroupKeyStore.getState().getKey(drop.groupId);
  if (local) {
    if (local.key.toLowerCase() === key.toLowerCase()) return false; // ya la teníamos

    // T-132 criterio 4 (`qa/SEC3-2026-09-14.md`): esta guarda es la que hace
    // que S3-A1 NO se repita acá. Una clave local de `ensureKey`, QR o
    // invitación no deja ni oferta ni aviso, y `drop.epoch` no se mira para
    // nada: no hay sustitución posible. Ver `contactChannel.test.ts` — "una
    // época absurda en el mensaje NO alcanza para sustituir una clave que ya
    // tenemos". Sólo una clave que vino de contacto puede entrar en disputa, y
    // aun así la decide el usuario (`elegirClaveDeGrupo`).
    if (!claveLocalVinoDeContacto(drop.groupId)) return false;
  }

  return registrarOferta({
    groupId: drop.groupId,
    fromUserId: drop.fromUserId,
    key: key.toLowerCase(),
    epoch: drop.epoch,
    origen: 'contact',
    receivedAt: Date.now(),
    adoptada: false,
  });
}

export type DrainContactsResult = {
  added: number;
  /** Grupos cuya clave adoptamos: el llamador tiene que drenarlos. */
  joinedGroups: string[];
  /**
   * Grupos con claves DISTINTAS de remitentes distintos (T-136). No se adoptó
   * ni se sustituyó nada: el llamador avisa y decide el usuario.
   */
  conflictedGroups: string[];
  /** Nombre que traía el drop de cada grupo en conflicto. SIN VERIFICAR: lo escribe el remitente. */
  nombresDeDrop: Record<string, string>;
  cursor: number;
};

function sinNovedades(cursor: number): DrainContactsResult {
  return { added: 0, joinedGroups: [], conflictedGroups: [], nombresDeDrop: {}, cursor };
}

/**
 * Decide, grupo por grupo, qué hacer con las ofertas nuevas de este lote (T-136).
 *
 *  - Todas iguales y sin clave local → se adopta: el camino feliz de siempre.
 *  - Distintas entre sí, o contra la local que vino de contacto → no se adopta
 *    ni se sustituye nada; el grupo vuelve como conflicto.
 *
 * Al final del lote y no dentro del loop, a propósito: si Mallory y Beto mandan
 * claves distintas en el mismo drenaje, adoptar la primera sería exactamente el
 * «primero en llegar gana» que este ticket cierra.
 */
function resolverOfertas(grupos: string[]): { joinedGroups: string[]; conflictedGroups: string[] } {
  const joinedGroups: string[] = [];
  const conflictedGroups: string[] = [];

  for (const groupId of grupos) {
    const local = useGroupKeyStore.getState().getKey(groupId);
    const ofertas = ofertasDe(groupId);
    const est = estado(groupId, local?.key);

    if (est === 'conflicto') {
      conflictedGroups.push(groupId);
      continue;
    }
    if (est !== 'unanime' || local) continue;

    const epoch = Math.max(...ofertas.map(o => o.epoch));
    useGroupKeyStore.getState().adoptKeys([{ groupId, key: ofertas[0]!.key, epoch }]);
    for (const o of ofertas) marcarAdoptada(groupId, o.fromUserId);
    joinedGroups.push(groupId);
  }

  return { joinedGroups, conflictedGroups };
}

/**
 * Recoge las tarjetas que dejaron en MI buzón y las guarda como contactos.
 *
 * El cursor lo administra el llamador: este módulo no sabe nada de persistencia
 * del motor de sync, y así no se acopla al relay.
 */
export async function drainContacts(
  mySecret: string,
  deviceId: string,
  sinceSeq: number,
): Promise<DrainContactsResult> {
  const me = useAuthStore.getState().currentUser;
  if (!me || !mySecret) return sinNovedades(sinceSeq);

  let topic: string;
  let key: Uint8Array;
  try {
    topic = await deriveContactTopic(mySecret);
    key = await contactKey(mySecret);
  } catch {
    return sinNovedades(sinceSeq);
  }

  const r = await fetchSince(topic, sinceSeq, deviceId);
  if (!r.ok) return sinNovedades(sinceSeq);

  let added = 0;
  /** Buzones a los que hay que devolverles nuestra tarjeta. Ver abajo. */
  const responder: string[] = [];
  /** Grupos con una oferta nueva en ESTE lote, con el nombre con que llegó. */
  const conOfertaNueva = new Map<string, string>();

  for (const envelope of r.envelopes) {
    // Un sobre que no abre es basura de alguien que conoce el topic: se saltea
    // sin frenar la cola.
    const msg = parseMessage(openEnvelope(key, envelope.payload));
    if (!msg) continue;

    if (msg.kind === 'contact') {
      if (msg.userId === me.id) continue;
      useUserStore.getState().addOrUpdateUser({
        id: msg.userId,
        name: msg.name,
        // La tarjeta ya no trae email (T-093 / SEC H-1): se conserva el que ya
        // hubiera localmente en vez de pisarlo con vacío.
        email: useUserStore.getState().getUserById(msg.userId)?.email ?? '',
        avatar: msg.avatar,
        authProvider: 'google',
        createdAt: Date.now(),
        updatedAt: syncedNow(),
        isDeleted: false,
      });
      // Si de esta persona todavía no teníamos sus públicas y ahora sí, le
      // devolvemos la nuestra. Es lo que repara los contactos creados con una
      // versión anterior del código, que viajaba sin ellas: los dos lados se
      // completan solos al abrir la app, sin volver a escanear nada.
      //
      // No hay ping-pong: sólo se responde cuando la tarjeta trae algo que no
      // teníamos, así que a la segunda vuelta ya nadie responde.
      const previo = getPeer(msg.userId);
      const esNuevo = Boolean(msg.wrapPublicKey) && !previo?.wrapPublicKey;

      savePeerFromCard(msg.userId, {
        secret: msg.contactSecret,
        wrapPublicKey: msg.wrapPublicKey,
        identityPublicKey: msg.identityPublicKey,
      });
      if (esNuevo) responder.push(msg.contactSecret);
      added++;
      continue;
    }

    if (registrarDropComoOferta(msg, me.id)) conOfertaNueva.set(msg.groupId, msg.groupName);
  }

  const { joinedGroups, conflictedGroups } = resolverOfertas([...conOfertaNueva.keys()]);
  const nombresDeDrop = Object.fromEntries(
    conflictedGroups.map(groupId => [groupId, conOfertaNueva.get(groupId) ?? '']),
  );

  for (const secreto of responder) await announceContact(secreto, deviceId);

  return { added, joinedGroups, conflictedGroups, nombresDeDrop, cursor: r.cursor };
}
```

- [ ] **Step 5: Implementar el aviso en `relayEngine.ts`**

En `src/sync/relayEngine.ts`, después de `import { activeInvites, processInvite, processAllInvites } from './inviteEngine';` agregar:

```ts
import { avisarConflictosDelDrenaje } from './keyConflictNotice';
```

En `drainContactsNow`, reemplazar:

```ts
    return r.added + r.joinedGroups.length;
```

por:

```ts
    // T-136: claves distintas para un mismo grupo. No se adoptó nada; el
    // usuario elige desde la bandeja. Un solo aviso sin leer por grupo.
    await avisarConflictosDelDrenaje(r);

    return r.added + r.joinedGroups.length + r.conflictedGroups.length;
```

- [ ] **Step 6: Correr y ver PASS**

Run: `npx jest src/sync/__tests__/keyConflictNotice.test.ts src/sync/__tests__/contactChannel.test.ts`
Expected: PASS — los 6 de T-136, los 5 de `keyConflictNotice` y **todos** los tests previos de `contactChannel.test.ts`, incluido «una época absurda en el mensaje NO alcanza para sustituir una clave que ya tenemos».

Si algún test previo de `contactChannel.test.ts` falla por el mock de `relayEngine` (una función que falte en el factory), agregarla al factory como `jest.fn()` y no tocar el test.

Run: `grep -n "avisarConflictosDelDrenaje(r)" src/sync/relayEngine.ts` → Expected: una línea (el cableado que los tests del canal replican en `anaDrena`).
Run: `npx tsc --noEmit` → Expected: sin salida.

- [ ] **Step 7: Commit**

```bash
git add src/sync/keyConflictNotice.ts src/sync/__tests__/keyConflictNotice.test.ts \
  src/sync/contactChannel.ts src/sync/relayEngine.ts src/sync/__tests__/contactChannel.test.ts
git commit -m "fix(sync): una clave de contacto ya no gana sola ante otra distinta (T-136)

drainContacts registra ofertas por (grupo, remitente) y resuelve al final del
lote: adopta sólo la unánime y devuelve conflictedGroups. relayEngine avisa
group_key_conflict. La clave local de ensureKey/QR/invitación sigue sin ser
elegible (S3-A1).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: La invitación no se cierra en silencio ante una clave plantada

**Files:**
- Modify: `src/sync/inviteEngine.ts:1-16` (imports), `:107` (`processInvite`), `:175-195` (`redeem`)
- Test: `src/sync/__tests__/inviteEngine.test.ts` (mock arriba, imports, describe nuevo al final)

**Interfaces:**
- Consumes (Task 1): `claveLocalVinoDeContacto`, `idDeOfertaDeInvitacion`, `registrarOferta`, `ofertasDe`, `marcarAdoptada`. (Task 2): `avisarConflictoDeClave(groupId, nombreDelDrop)`.
- Produces: `processInvite(invite: GroupInvite, deviceId: string): Promise<string[]>` sin cambios de firma; `redeem` privado pasa a `async (grant, invite, myUserId) => Promise<boolean>`.

- [ ] **Step 1: Tests (fallan)**

En `src/sync/__tests__/inviteEngine.test.ts`, antes de la línea 1 agregar:

```ts
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  scheduleNotificationAsync: async () => 'id',
}));
```

Después de `import { createSecureStorage } from '@/src/utils/secureStorage';` agregar:

```ts
import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';
import { idDeOfertaDeInvitacion, marcarAdoptada, ofertasDe, registrarOferta } from '../groupKeyOffers';
```

Al final del archivo agregar:

```ts
/**
 * T-136 criterio 5. Antes, `redeem` veía «ya tengo clave» y cerraba el ingreso
 * en silencio: una clave plantada por contacto también bloqueaba el link.
 */
describe('T-136 · la invitación choca con una clave plantada por contacto', () => {
  const FALSA = 'ab'.repeat(32);

  /** Ana invitó y ya entregó el grant; Beto todavía no procesó su buzón. */
  async function grantEsperandoABeto(): Promise<{ invite: GroupInvite; clave: string }> {
    const { invite, clave } = anaInvita();
    usar('beto', BETO);
    await publishClaim(invite, 'dev-beto');
    usar('ana', ANA);
    await processInvite(invite, 'dev-ana');
    usar('beto', BETO);
    createSecureStorage('notices').clearAll();
    useNoticeInboxStore.setState({ items: [] });
    return { invite, clave };
  }

  /** Lo que habría dejado `drainContacts`: la clave de Mallory, adoptada por contacto. */
  function plantadaPorContacto(key: string): void {
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key, epoch: 1e9 }] });
    registrarOferta({
      groupId: 'g1', fromUserId: 'u-mallory', key, epoch: 1e9,
      origen: 'contact', receivedAt: 0, adoptada: false,
    });
    marcarAdoptada('g1', 'u-mallory');
  }

  const avisos = () => useNoticeInboxStore.getState().items.filter(i => i.notice.kind === 'group_key_conflict');

  it('con OTRA clave: registra la oferta de la invitación, avisa y no sustituye', async () => {
    const { invite, clave } = await grantEsperandoABeto();
    plantadaPorContacto(FALSA);

    expect(await processInvite(invite, 'dev-beto')).toEqual([]);

    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);
    expect(ofertasDe('g1').find(o => o.origen === 'invite')).toMatchObject({
      key: clave, fromUserId: idDeOfertaDeInvitacion(invite.inviterFingerprint), adoptada: false,
    });
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]!.notice).toMatchObject({ groupName: 'Viaje', nombreVerificado: false });
    expect(listPendingJoins()).toHaveLength(0);
  });

  it('reprocesar el mismo buzón no apila ofertas ni avisos', async () => {
    const { invite } = await grantEsperandoABeto();
    plantadaPorContacto(FALSA);

    await processInvite(invite, 'dev-beto');
    await processInvite(invite, 'dev-beto');

    expect(ofertasDe('g1').filter(o => o.origen === 'invite')).toHaveLength(1);
    expect(avisos()).toHaveLength(1);
  });

  it('con la MISMA clave: se cierra como siempre, sin oferta ni aviso', async () => {
    const { invite, clave } = await grantEsperandoABeto();
    plantadaPorContacto(clave);

    expect(await processInvite(invite, 'dev-beto')).toEqual([]);

    expect(ofertasDe('g1').filter(o => o.origen === 'invite')).toEqual([]);
    expect(avisos()).toHaveLength(0);
    expect(listPendingJoins()).toHaveLength(0);
  });

  it('S3-A1 · clave local que NO vino de contacto: se cierra como siempre, sin oferta ni aviso', async () => {
    const { invite } = await grantEsperandoABeto();
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: FALSA, epoch: 1 }] });

    expect(await processInvite(invite, 'dev-beto')).toEqual([]);

    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);
    expect(ofertasDe('g1')).toEqual([]);
    expect(avisos()).toHaveLength(0);
    expect(listPendingJoins()).toHaveLength(0);
  });
});
```

Run: `npx jest src/sync/__tests__/inviteEngine.test.ts -t "T-136"`
Expected: FAIL en «con OTRA clave» (no hay oferta `invite` ni aviso: hoy `redeem` cierra en silencio) y en «reprocesar». Los otros dos pasan ya (comportamiento de hoy). Anotar la salida.

- [ ] **Step 2: Implementar**

En `src/sync/inviteEngine.ts`, después de `import { syncedNow } from '@/src/utils/syncedClock';` agregar:

```ts
import { claveLocalVinoDeContacto, idDeOfertaDeInvitacion, registrarOferta } from './groupKeyOffers';
import { avisarConflictoDeClave } from './keyConflictNotice';
```

Reemplazar:

```ts
      if (grant && redeem(grant, invite, me.id)) adoptados.push(grant.groupId);
```

por:

```ts
      if (grant && await redeem(grant, invite, me.id)) adoptados.push(grant.groupId);
```

Reemplazar la función `redeem` entera (desde `/** Lado del que entra: abre la clave y la adopta.` hasta su `}`) por:

```ts
/**
 * Lado del que entra: abre la clave y la adopta. `true` si adoptó algo nuevo.
 *
 * T-136 · ADR-013: si ya hay clave local y vino de CONTACTO, un grant con otra
 * clave no se cierra en silencio — queda como oferta de la invitación y se
 * avisa el conflicto. Una clave local de `ensureKey`, QR o invitación cierra el
 * ingreso como siempre (S3-A1).
 */
async function redeem(grant: InviteGrant, invite: GroupInvite, myUserId: string): Promise<boolean> {
  if (grant.forUserId !== myUserId || grant.groupId !== invite.groupId) return false;

  const wrap = ensureWrapKeypair();
  const abierta = unwrapGroupKey(grant.wrappedKey, grant.senderWrapPublicKey, wrap.privateKey);
  // Una clave del largo equivocado no se adopta ni se ofrece: dejaría el grupo
  // ilegible para siempre y sin síntoma más claro que "no llega nada".
  const clave = abierta && /^[0-9a-f]{64}$/i.test(abierta) ? abierta : null;

  const local = useGroupKeyStore.getState().getKey(grant.groupId);
  if (local) {
    const distinta = clave !== null && clave.toLowerCase() !== local.key.toLowerCase();
    if (distinta && claveLocalVinoDeContacto(grant.groupId)) {
      const nueva = registrarOferta({
        groupId: grant.groupId,
        fromUserId: idDeOfertaDeInvitacion(invite.inviterFingerprint),
        key: clave.toLowerCase(),
        epoch: grant.epoch,
        origen: 'invite',
        receivedAt: Date.now(),
        adoptada: false,
      });
      if (nueva) await avisarConflictoDeClave(grant.groupId, invite.groupName);
    }
    // El ingreso por link está cerrado: o ya la teníamos, o decide el usuario
    // desde el aviso.
    removePendingJoin(invite.token);
    return false;
  }

  if (!clave) return false;

  useGroupKeyStore.getState().adoptKeys([
    { groupId: grant.groupId, key: clave, epoch: grant.epoch },
  ]);
  removePendingJoin(invite.token);
  return true;
}
```

Nota de tipos: `distinta` es `boolean` y TS no estrecha `clave` a `string` a través de ella; si `tsc` marca `clave` como posiblemente `null` en `clave.toLowerCase()`, reemplazar la condición por `if (clave !== null && clave.toLowerCase() !== local.key.toLowerCase() && claveLocalVinoDeContacto(grant.groupId)) {` y borrar la línea `const distinta = …`.

- [ ] **Step 3: Correr y ver PASS**

Run: `npx jest src/sync/__tests__/inviteEngine.test.ts`
Expected: PASS (los 4 de T-136 y todos los previos, incluido «una clave con formato inválido no se adopta»).
Run: `npx tsc --noEmit` → Expected: sin salida.

- [ ] **Step 4: Commit**

```bash
git add src/sync/inviteEngine.ts src/sync/__tests__/inviteEngine.test.ts
git commit -m "fix(sync): la invitación levanta el conflicto en vez de cerrar en silencio (T-136)

Con una clave local plantada por contacto, un grant con otra clave queda como
oferta origen 'invite' y se avisa group_key_conflict. Con la misma clave, o
con una clave local que no vino de contacto, se comporta como hoy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Elegir la clave de un remitente

**Files:**
- Create: `src/services/elegirClaveDeGrupo.ts`
- Test: `src/services/__tests__/elegirClaveDeGrupo.test.ts`
- Modify: `src/services/salirDelGrupo.ts:1-7` (import), `:95-97` (`purgarGrupoLocalmente`)
- Test: `src/store/__tests__/purgaAlSalir.test.ts` (import + describe nuevo al final)

**Interfaces:**
- Consumes (Task 1): `ofertasDe`, `claveLocalVinoDeContacto`, `registrarOferta`, `marcarAdoptada`, `olvidarOfertas`, `KeyOffer`. Existentes: `purgarGrupoLocalmente(groupId: string): void`, `useGroupKeyStore.getState().adoptKeys(incoming: GroupKeyRecord[]): void`, `marcarConTopic(groupIds: string[]): Promise<void>`, `estaPendienteDeDrenaje(groupId: string): boolean`, `drainNow(groupId: string): Promise<number>`, `startRelay(): Promise<void>`.
- Produces: `export async function elegirClaveDeGrupo(groupId: string, fromUserId: string): Promise<boolean>`.

- [ ] **Step 1: Tests (fallan)**

Crear `src/services/__tests__/elegirClaveDeGrupo.test.ts`:

```ts
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}), drainNow: jest.fn(async () => 0), startRelay: jest.fn(async () => {}),
}));

import { elegirClaveDeGrupo } from '../elegirClaveDeGrupo';
import {
  claveLocalVinoDeContacto, marcarAdoptada, ofertasDe, registrarOferta, type KeyOffer,
} from '@/src/sync/groupKeyOffers';
import { estaPendienteDeDrenaje } from '@/src/sync/pendingDrain';
import { useAuthStore } from '@/src/store/authStore';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { useGroupStore } from '@/src/store/groupStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { User } from '@/src/types/models';

/**
 * T-136 · ADR-013. Elegir es la ÚNICA forma de sustituir una clave de grupo que
 * ya está en uso, y sólo sobre una que vino de contacto. Primero se purga lo
 * local del grupo: nada del grupo falso puede terminar publicado con la real.
 */

const relayEngine = jest.requireMock('@/src/sync/relayEngine') as {
  drainNow: jest.Mock; publishNow: jest.Mock;
};

const YO = { id: 'ana', name: 'Ana' } as User;
const FALSA = 'ab'.repeat(32);
const REAL = 'cd'.repeat(32);
const OTRA = 'ee'.repeat(32);
const meta = { updatedAt: 1, isDeleted: false };

const grupo = (id: string) => ({
  id, name: 'Viaje', memberIds: ['ana', 'u-mallory'], currency: 'ARS',
  createdAt: 0, createdById: 'u-mallory', deletionVotes: [], ...meta,
}) as never;
const gasto = (id: string, groupId: string) => ({
  id, groupId, description: id, amount: 1, currency: 'ARS', paidById: 'ana', splitMode: 'equal',
  splits: [], category: 'other', date: 0, createdAt: 0, createdById: 'ana', deletionVotes: [], ...meta,
}) as never;

const oferta = (fromUserId: string, key: string, epoch: number): KeyOffer => ({
  groupId: 'g1', fromUserId, key, epoch, origen: 'contact', receivedAt: 0, adoptada: false,
});

beforeEach(() => {
  for (const b of ['groups', 'expenses', 'payments', 'recurring', 'comments', 'groupkeys'] as const) {
    createSecureStorage(b).clearAll();
  }
  jest.clearAllMocks();
  useAuthStore.setState({ currentUser: YO });
  useGroupStore.setState({ groups: [grupo('g1'), grupo('g2')] });
  useExpenseStore.setState({ expenses: [gasto('e-falso', 'g1'), gasto('e-otro', 'g2')] });
  useGroupKeyStore.setState({ keys: [] });
});

/** Tras el ataque en dos lotes: K' de Mallory adoptada por contacto y la oferta de Beto en disputa. */
function trasElAtaque(): void {
  useGroupKeyStore.setState({ keys: [
    { groupId: 'g1', key: FALSA, epoch: 1e9 },
    { groupId: 'g2', key: OTRA, epoch: 1 },
  ] });
  registrarOferta(oferta('u-mallory', FALSA, 1e9));
  marcarAdoptada('g1', 'u-mallory');
  registrarOferta(oferta('u-beto', REAL, 3));
}

const idsDeGastos = () => useExpenseStore.getState().expenses.map(e => e.id);
const idsDeGrupos = () => useGroupStore.getState().groups.map(g => g.id);

describe('elegir la clave de un remitente', () => {
  it('purga lo local del grupo, adopta la elegida con SU época y deja el grupo pendiente de drenaje', async () => {
    trasElAtaque();

    expect(await elegirClaveDeGrupo('g1', 'u-beto')).toBe(true);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual({ groupId: 'g1', key: REAL, epoch: 3 });
    expect(idsDeGastos()).toEqual(['e-otro']);
    expect(idsDeGrupos()).toEqual(['g2']);
    expect(estaPendienteDeDrenaje('g1')).toBe(true);
    expect(relayEngine.drainNow).toHaveBeenCalledWith('g1');
  });

  it('queda sólo la oferta elegida, adoptada: la nueva clave local vino de contacto', async () => {
    trasElAtaque();
    await elegirClaveDeGrupo('g1', 'u-beto');

    expect(ofertasDe('g1')).toEqual([expect.objectContaining({ fromUserId: 'u-beto', adoptada: true })]);
    expect(claveLocalVinoDeContacto('g1')).toBe(true);
  });

  it('no toca la clave de otros grupos', async () => {
    trasElAtaque();
    await elegirClaveDeGrupo('g1', 'u-beto');
    expect(useGroupKeyStore.getState().getKey('g2')).toEqual({ groupId: 'g2', key: OTRA, epoch: 1 });
  });

  // No llama a `salirDelGrupo`: publicar la salida iría al topic del atacante.
  it('no publica nada', async () => {
    trasElAtaque();
    await elegirClaveDeGrupo('g1', 'u-beto');
    expect(relayEngine.publishNow).not.toHaveBeenCalled();
  });

  it('criterio 2 · sin clave local y con ofertas en conflicto (mismo lote) se puede elegir', async () => {
    registrarOferta(oferta('u-mallory', FALSA, 1e9));
    registrarOferta(oferta('u-beto', REAL, 3));

    expect(await elegirClaveDeGrupo('g1', 'u-beto')).toBe(true);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(REAL);
  });
});

describe('cuándo NO se puede elegir (S3-A1)', () => {
  it('un remitente sin oferta → false sin efectos', async () => {
    trasElAtaque();

    expect(await elegirClaveDeGrupo('g1', 'u-nadie')).toBe(false);

    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);
    expect(idsDeGastos()).toContain('e-falso');
    expect(relayEngine.drainNow).not.toHaveBeenCalled();
  });

  it('una clave local de ensureKey/QR/invitación (sin oferta adoptada) → false aunque haya ofertas', async () => {
    // Conflicto en el mismo lote (no se adoptó nada) y después el QR trajo otra clave.
    registrarOferta(oferta('u-mallory', FALSA, 1e9));
    registrarOferta(oferta('u-beto', REAL, 3));
    useGroupKeyStore.setState({ keys: [{ groupId: 'g1', key: 'ff'.repeat(32), epoch: 2 }] });

    expect(await elegirClaveDeGrupo('g1', 'u-beto')).toBe(false);

    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe('ff'.repeat(32));
    expect(idsDeGastos()).toContain('e-falso');
    expect(relayEngine.drainNow).not.toHaveBeenCalled();
  });
});
```

Run: `npx jest src/services/__tests__/elegirClaveDeGrupo.test.ts`
Expected: FAIL — `Cannot find module '../elegirClaveDeGrupo'`.

- [ ] **Step 2: Test de la purga (falla)**

En `src/store/__tests__/purgaAlSalir.test.ts`, después de `import { purgarGrupoLocalmente } from '@/src/services/salirDelGrupo';` agregar:

```ts
import { ofertasDe, registrarOferta } from '@/src/sync/groupKeyOffers';
```

Al final del archivo agregar:

```ts
describe('T-136 · las ofertas de clave del grupo', () => {
  it('se olvidan con la purga, sin tocar las de otros grupos', () => {
    for (const groupId of ['G', 'H']) {
      registrarOferta({
        groupId, fromUserId: 'beto', key: 'ab'.repeat(32), epoch: 1,
        origen: 'contact', receivedAt: 0, adoptada: false,
      });
    }

    purgarGrupoLocalmente('G');

    expect(ofertasDe('G')).toEqual([]);
    expect(ofertasDe('H')).toHaveLength(1);
  });
});
```

Run: `npx jest src/store/__tests__/purgaAlSalir.test.ts -t "T-136"`
Expected: FAIL — `ofertasDe('G')` todavía tiene una oferta.

- [ ] **Step 3: La purga olvida las ofertas**

En `src/services/salirDelGrupo.ts`, después de `import { marcarConTopic } from '@/src/sync/pendingDrain';` agregar:

```ts
import { olvidarOfertas } from '@/src/sync/groupKeyOffers';
```

Reemplazar:

```ts
  useGroupKeyStore.getState().forgetKey(groupId);
}
```

por:

```ts
  useGroupKeyStore.getState().forgetKey(groupId);

  // Y las ofertas de clave de ese grupo (T-136): sin la copia local no queda
  // nada que elegir, y una oferta vieja adoptada haría «elegible» una clave
  // que el grupo ya no tiene.
  olvidarOfertas(groupId);
}
```

- [ ] **Step 4: Implementar `elegirClaveDeGrupo.ts`**

Crear `src/services/elegirClaveDeGrupo.ts`:

```ts
import { useGroupKeyStore } from '@/src/store/groupKeyStore';
import { marcarConTopic } from '@/src/sync/pendingDrain';
import {
  claveLocalVinoDeContacto, marcarAdoptada, ofertasDe, registrarOferta,
} from '@/src/sync/groupKeyOffers';
import { purgarGrupoLocalmente } from './salirDelGrupo';

/**
 * **El usuario elige la clave de un remitente** (T-136 · ADR-013).
 *
 * Es la única forma de reemplazar una clave de grupo que ya está en uso, y por
 * eso las guardas no son opcionales:
 *
 *  1. tiene que haber una oferta de ese remitente, y
 *  2. la clave local, si existe, tiene que haber venido de contacto
 *     (`claveLocalVinoDeContacto`). Las de `ensureKey`, QR o invitación nunca
 *     se sustituyen por acá: es lo que mantiene cerrado S3-A1.
 *
 * El orden importa: **primero se purga** la copia local del grupo. Si se
 * adoptara antes, lo que vino del topic falso se publicaría con la clave real
 * (regla #8: se publica el estado completo). Después se adopta, queda
 * pendiente de drenaje y se drena el topic real.
 *
 * No llama a `salirDelGrupo`: eso publicaría una salida en el topic del
 * atacante. Lo cargado desde que llegó la clave falsa se pierde; la
 * confirmación de la tarjeta lo dice.
 */
export async function elegirClaveDeGrupo(groupId: string, fromUserId: string): Promise<boolean> {
  // 1 · guardas
  const elegida = ofertasDe(groupId).find(o => o.fromUserId === fromUserId);
  if (!elegida) return false;
  const local = useGroupKeyStore.getState().getKey(groupId);
  if (local && !claveLocalVinoDeContacto(groupId)) return false;

  // 2 · purga (incluye `forgetKey` y `olvidarOfertas`)
  purgarGrupoLocalmente(groupId);

  // 3 · adoptar. La marca de `adoptKeys` es `void`: se espera acá para que el
  // grupo quede pendiente ANTES de cualquier publicación.
  useGroupKeyStore.getState().adoptKeys([{ groupId, key: elegida.key, epoch: elegida.epoch }]);
  await marcarConTopic([groupId]);

  // 4 · la elegida queda como única oferta, adoptada: la purga ya descartó las demás.
  registrarOferta({ ...elegida, adoptada: false });
  marcarAdoptada(groupId, fromUserId);

  // 5 · drenar el topic real. Perezoso como en `salirDelGrupo`: `relayEngine`
  // importa a los stores que esto usa.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drainNow, startRelay } = require('@/src/sync/relayEngine') as typeof import('@/src/sync/relayEngine');
    await drainNow(groupId);
    void startRelay();
  } catch {
    // Sin red: el grupo quedó pendiente y se drena en el próximo arranque.
  }
  return true;
}
```

- [ ] **Step 5: Correr y ver PASS**

Run: `npx jest src/services/__tests__/elegirClaveDeGrupo.test.ts src/store/__tests__/purgaAlSalir.test.ts src/services/__tests__/applyLeave.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit` → Expected: sin salida.

- [ ] **Step 6: Commit**

```bash
git add src/services/elegirClaveDeGrupo.ts src/services/__tests__/elegirClaveDeGrupo.test.ts \
  src/services/salirDelGrupo.ts src/store/__tests__/purgaAlSalir.test.ts
git commit -m "feat(sync): elegir la clave de grupo de un remitente, previa purga (T-136)

elegirClaveDeGrupo exige oferta del remitente y clave local de contacto;
purga lo local, adopta con la época de la oferta, deja el grupo pendiente de
drenaje y drena. No publica nada. La purga también olvida las ofertas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Tarjeta de elección, textos e integración en la bandeja

**Files:**
- Create: `src/components/GroupKeyConflictCard.tsx`
- Test: `src/components/__tests__/GroupKeyConflictCard.test.tsx`
- Modify: `src/i18n/locales/es.json`, `en.json`, `pt.json` (bloque `sync`)
- Modify: `src/components/TabHeader.tsx:1-23` (imports), `:70` (estado), `:86-103` (`abrirAviso`), `:143-151` (render)
- Test: `src/components/__tests__/TabHeader.test.tsx` (imports + describe nuevo al final)

**Interfaces:**
- Consumes: `KeyConflictNotice`, `nombreDeGrupoEnConflicto` (Task 1); `textFor` (Task 1); `esOfertaDeInvitacion`, `ofertasDe`, `idDeOfertaDeInvitacion`, `registrarOferta` (Task 1); `elegirClaveDeGrupo` (Task 4); `ActionButton` (`action`, `label`, `icon`, `variant`, `full`, `disabled`, `loading`, `testID`, `style`), `ButtonRack` (`placement`), `UserAvatar` (`userId`, `name`, `size`), `BottomSheet` (`visible`, `onClose`, `children`).
- Produces:
  - `export interface GroupKeyConflictCardProps { notice: KeyConflictNotice; senderIds: string[]; onResuelto: () => void; onDespues: () => void }`
  - `export function GroupKeyConflictCard(props: GroupKeyConflictCardProps): React.JSX.Element`
  - testIDs: `key-conflict-card`, `key-conflict-sender-<id>`, `key-conflict-later`.

- [ ] **Step 1: Tests de la tarjeta (fallan)**

Crear `src/components/__tests__/GroupKeyConflictCard.test.tsx`:

```tsx
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => null) }));
jest.mock('@/src/sync/relayEngine', () => ({
  schedulePublish: jest.fn(), deviceId: () => 'dev', olvidarCursor: jest.fn(),
  publishNow: jest.fn(async () => {}), drainNow: jest.fn(async () => 0), startRelay: jest.fn(async () => {}),
}));
jest.mock('@/src/services/elegirClaveDeGrupo', () => ({ elegirClaveDeGrupo: jest.fn(async () => true) }));

import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { GroupKeyConflictCard } from '../GroupKeyConflictCard';
import { elegirClaveDeGrupo } from '@/src/services/elegirClaveDeGrupo';
import { idDeOfertaDeInvitacion } from '@/src/sync/groupKeyOffers';
import { useAuthStore } from '@/src/store/authStore';
import { useUserStore } from '@/src/store/userStore';
import type { KeyConflictNotice } from '@/src/services/syncNotices';
import type { User } from '@/src/types/models';
import es from '@/src/i18n/locales/es.json';
import en from '@/src/i18n/locales/en.json';
import pt from '@/src/i18n/locales/pt.json';

const elegir = elegirClaveDeGrupo as jest.MockedFunction<typeof elegirClaveDeGrupo>;

const NOTICE: KeyConflictNotice = {
  kind: 'group_key_conflict', groupId: 'g1', groupName: 'Viaje', nombreVerificado: false,
  senderIds: ['u-beto', 'u-mallory'],
};

const props = {
  notice: NOTICE,
  senderIds: ['u-beto', 'u-mallory'],
  onResuelto: jest.fn(),
  onDespues: jest.fn(),
};

let alerta: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  elegir.mockResolvedValue(true);
  useAuthStore.setState({ currentUser: { id: 'u-ana', name: 'Ana' } as User });
  useUserStore.setState({ users: [
    { id: 'u-beto', name: 'Beto' } as User,
    { id: 'u-mallory', name: 'Mallory' } as User,
  ] });
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => alerta.mockRestore());

/** Los botones de la última confirmación mostrada. */
function botones(): AlertButton[] {
  return (alerta.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
}

describe('qué muestra', () => {
  it('un botón por remitente, con el nombre guardado del contacto', () => {
    const r = render(<GroupKeyConflictCard {...props} />);
    expect(r.getByTestId('key-conflict-sender-u-beto')).toBeTruthy();
    expect(r.getByTestId('key-conflict-sender-u-mallory')).toBeTruthy();
    expect(r.getAllByText(/Beto/).length).toBeGreaterThan(0);
    expect(r.getAllByText(/Mallory/).length).toBeGreaterThan(0);
  });

  it('tres remitentes, tres botones', () => {
    const r = render(<GroupKeyConflictCard {...props} senderIds={['u-beto', 'u-mallory', 'u-carla']} />);
    expect(r.getAllByTestId(/^key-conflict-sender-/)).toHaveLength(3);
  });

  it('un remitente sin nombre guardado no muestra su id', () => {
    const r = render(<GroupKeyConflictCard {...props} senderIds={['u-beto', 'u-desconocido']} />);
    expect(r.getAllByText(/sync\.keyConflict\.unknown_name/).length).toBeGreaterThan(0);
    expect(r.queryByText(/u-desconocido/)).toBeNull();
  });

  it('la oferta de una invitación se nombra como invitación', () => {
    const r = render(
      <GroupKeyConflictCard {...props} senderIds={['u-beto', idDeOfertaDeInvitacion('fp123')]} />,
    );
    expect(r.getAllByText(/sync\.keyConflict\.invite_sender/).length).toBeGreaterThan(0);
    expect(r.queryByText(/fp123/)).toBeNull();
  });
});

describe('elegir', () => {
  it('tocar un remitente pide confirmación y todavía no elige', () => {
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-sender-u-beto'));

    expect(alerta).toHaveBeenCalledTimes(1);
    expect(String(alerta.mock.calls[0]![0])).toContain('sync.keyConflict.confirm_title');
    expect(String(alerta.mock.calls[0]![0])).toContain('Beto');
    expect(elegir).not.toHaveBeenCalled();
  });

  it('confirmar llama a elegirClaveDeGrupo(groupId, userId) y avisa resuelto', async () => {
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-sender-u-beto'));
    botones().find(b => b.style === 'destructive')!.onPress!();

    await waitFor(() => expect(props.onResuelto).toHaveBeenCalledTimes(1));
    expect(elegir).toHaveBeenCalledWith('g1', 'u-beto');
  });

  it('cancelar no llama a elegir', () => {
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-sender-u-beto'));
    botones().find(b => b.style === 'cancel')!.onPress?.();

    expect(elegir).not.toHaveBeenCalled();
    expect(props.onResuelto).not.toHaveBeenCalled();
  });

  it('si elegir devuelve false, no se da por resuelto y se avisa', async () => {
    elegir.mockResolvedValue(false);
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-sender-u-beto'));
    botones().find(b => b.style === 'destructive')!.onPress!();

    await waitFor(() => expect(alerta).toHaveBeenCalledTimes(2));
    expect(String(alerta.mock.calls[1]![0])).toContain('sync.keyConflict.failed');
    expect(props.onResuelto).not.toHaveBeenCalled();
  });

  it('«Decidir después» cierra sin elegir ni resolver', () => {
    const r = render(<GroupKeyConflictCard {...props} />);
    fireEvent.press(r.getByTestId('key-conflict-later'));

    expect(props.onDespues).toHaveBeenCalledTimes(1);
    expect(elegir).not.toHaveBeenCalled();
    expect(props.onResuelto).not.toHaveBeenCalled();
  });
});

describe('textos (spec §3.2, aprobados por el PO)', () => {
  type Dict = { sync: { keyConflict?: Record<string, string> } };
  const dicts = { es, en, pt } as unknown as Record<string, Dict>;
  const CLAVES = [
    'title_two', 'title_many', 'body', 'unverified_name', 'use_key_of', 'decide_later',
    'confirm_title', 'confirm_body', 'cancel', 'confirm_use', 'unknown_name', 'invite_sender', 'failed',
  ];

  it.each(CLAVES)('sync.keyConflict.%s existe en es, en y pt', clave => {
    for (const [lang, d] of Object.entries(dicts)) {
      expect(`${lang}: ${d.sync.keyConflict?.[clave] ?? ''}`).not.toBe(`${lang}: `);
    }
  });

  it('el español es el del spec, verbatim', () => {
    const k = (es as unknown as Dict).sync.keyConflict!;
    expect(k.title_two).toBe('Dos personas te mandaron claves distintas para "{{group}}"');
    expect(k.title_many).toBe('Recibiste claves distintas para "{{group}}"');
    expect(k.body).toBe('Sólo una es la real. Elegí la de alguien que sepas que está en el grupo. El nombre es el que tenés guardado del contacto; la app no puede verificar quién es.');
    expect(k.unverified_name).toBe('{{group}} (nombre sin verificar)');
    expect(k.use_key_of).toBe('Usar la clave de {{name}}');
    expect(k.decide_later).toBe('Decidir después');
    expect(k.confirm_title).toBe('¿Usar la clave de {{name}}?');
    expect(k.confirm_body).toBe('Se borra lo que tenés de "{{group}}" en este teléfono y se vuelve a bajar con esa clave. Lo que hayas cargado desde que llegó la otra clave se pierde.');
    expect(k.cancel).toBe('Cancelar');
    expect(k.confirm_use).toBe('Usar esta clave');
  });

  it('en y pt están traducidos, no copiados del español', () => {
    for (const clave of ['title_two', 'body', 'confirm_body']) {
      const textos = Object.values(dicts).map(d => d.sync.keyConflict?.[clave]);
      expect(new Set(textos).size).toBe(3);
    }
  });
});
```

Run: `npx jest src/components/__tests__/GroupKeyConflictCard.test.tsx`
Expected: FAIL — `Cannot find module '../GroupKeyConflictCard'`.

- [ ] **Step 2: Textos i18n**

En `src/i18n/locales/es.json`, justo después de la línea `  "sync": {` insertar:

```json
    "keyConflict": {
      "title_two": "Dos personas te mandaron claves distintas para \"{{group}}\"",
      "title_many": "Recibiste claves distintas para \"{{group}}\"",
      "body": "Sólo una es la real. Elegí la de alguien que sepas que está en el grupo. El nombre es el que tenés guardado del contacto; la app no puede verificar quién es.",
      "unverified_name": "{{group}} (nombre sin verificar)",
      "use_key_of": "Usar la clave de {{name}}",
      "decide_later": "Decidir después",
      "confirm_title": "¿Usar la clave de {{name}}?",
      "confirm_body": "Se borra lo que tenés de \"{{group}}\" en este teléfono y se vuelve a bajar con esa clave. Lo que hayas cargado desde que llegó la otra clave se pierde.",
      "cancel": "Cancelar",
      "confirm_use": "Usar esta clave",
      "unknown_name": "Contacto sin nombre",
      "invite_sender": "la invitación",
      "failed": "No se pudo usar esa clave. Volvé a abrir el aviso."
    },
```

En `src/i18n/locales/en.json`, justo después de `  "sync": {` insertar:

```json
    "keyConflict": {
      "title_two": "Two people sent you different keys for \"{{group}}\"",
      "title_many": "You got different keys for \"{{group}}\"",
      "body": "Only one is the real one. Pick someone you know is in the group. The name is the one you saved for the contact; the app can't verify who they are.",
      "unverified_name": "{{group}} (unverified name)",
      "use_key_of": "Use {{name}}'s key",
      "decide_later": "Decide later",
      "confirm_title": "Use {{name}}'s key?",
      "confirm_body": "Everything you have from \"{{group}}\" on this phone is deleted and downloaded again with that key. Anything you added since the other key arrived is lost.",
      "cancel": "Cancel",
      "confirm_use": "Use this key",
      "unknown_name": "Unnamed contact",
      "invite_sender": "the invite link",
      "failed": "That key couldn't be used. Open the notice again."
    },
```

En `src/i18n/locales/pt.json`, justo después de `  "sync": {` insertar:

```json
    "keyConflict": {
      "title_two": "Duas pessoas te enviaram chaves diferentes para \"{{group}}\"",
      "title_many": "Você recebeu chaves diferentes para \"{{group}}\"",
      "body": "Só uma é a verdadeira. Escolha a de alguém que você sabe que está no grupo. O nome é o que você salvou do contato; o app não consegue verificar quem é.",
      "unverified_name": "{{group}} (nome não verificado)",
      "use_key_of": "Usar a chave de {{name}}",
      "decide_later": "Decidir depois",
      "confirm_title": "Usar a chave de {{name}}?",
      "confirm_body": "O que você tem de \"{{group}}\" neste telefone é apagado e baixado de novo com essa chave. O que você adicionou desde que a outra chave chegou se perde.",
      "cancel": "Cancelar",
      "confirm_use": "Usar esta chave",
      "unknown_name": "Contato sem nome",
      "invite_sender": "o convite",
      "failed": "Não foi possível usar essa chave. Abra o aviso de novo."
    },
```

Run: `node -e "for (const l of ['es','en','pt']) JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'.json','utf8'))"` → Expected: sin salida (JSON válido).

- [ ] **Step 3: Implementar la tarjeta**

Crear `src/components/GroupKeyConflictCard.tsx`:

```tsx
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { textFor } from '@/src/services/notifications';
import { nombreDeGrupoEnConflicto, type KeyConflictNotice } from '@/src/services/syncNotices';
import { elegirClaveDeGrupo } from '@/src/services/elegirClaveDeGrupo';
import { esOfertaDeInvitacion } from '@/src/sync/groupKeyOffers';
import { useUserStore } from '@/src/store/userStore';
import { ActionButton } from './ActionButton';
import { ButtonRack } from './ButtonRack';
import { UserAvatar } from './UserAvatar';

export interface GroupKeyConflictCardProps {
  notice: KeyConflictNotice;
  /** Remitentes con oferta HOY (`ofertasDe`), no la foto congelada del aviso. */
  senderIds: string[];
  /** La elección salió bien: quien la aloja marca el aviso leído y cierra. */
  onResuelto: () => void;
  /** «Decidir después»: cierra y el aviso sigue pendiente. */
  onDespues: () => void;
}

/**
 * **Elegir entre claves distintas para un mismo grupo** (T-136 · ADR-013).
 *
 * Un botón por remitente, con el nombre que ESTE teléfono tiene guardado de
 * ese contacto: no es identidad verificada (ADR-012), y el cuerpo lo dice.
 * Elegir borra la copia local del grupo, así que siempre pide confirmación.
 */
export function GroupKeyConflictCard({ notice, senderIds, onResuelto, onDespues }: GroupKeyConflictCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();
  const usuarios = useUserStore(s => s.users);
  const [eligiendo, setEligiendo] = useState<string | null>(null);

  const { title, body } = textFor(notice);
  const grupo = nombreDeGrupoEnConflicto(notice, t);

  const nombreDe = (id: string): string => {
    if (esOfertaDeInvitacion(id)) return t('sync.keyConflict.invite_sender');
    return usuarios.find(u => u.id === id)?.name ?? t('sync.keyConflict.unknown_name');
  };

  async function elegir(userId: string): Promise<void> {
    setEligiendo(userId);
    const ok = await elegirClaveDeGrupo(notice.groupId, userId).catch(() => false);
    setEligiendo(null);
    if (ok) onResuelto();
    else Alert.alert(t('sync.keyConflict.failed'));
  }

  function confirmar(userId: string): void {
    const name = nombreDe(userId);
    Alert.alert(
      t('sync.keyConflict.confirm_title', { name }),
      t('sync.keyConflict.confirm_body', { group: grupo }),
      [
        { text: t('sync.keyConflict.cancel'), style: 'cancel' },
        {
          text: t('sync.keyConflict.confirm_use'),
          style: 'destructive',
          onPress: () => { void elegir(userId); },
        },
      ],
    );
  }

  return (
    <View testID="key-conflict-card" style={styles.card}>
      <Text style={[Typography.bodyL, { color: c.text, fontWeight: '700' }]}>{title}</Text>
      <Text style={[Typography.bodyS, { color: c.textSecondary }]}>{body}</Text>

      <ButtonRack placement="inline">
        {senderIds.map(id => (
          <View key={id} style={styles.fila}>
            {!esOfertaDeInvitacion(id) && <UserAvatar userId={id} name={nombreDe(id)} size={32} />}
            <ActionButton
              testID={`key-conflict-sender-${id}`}
              label={t('sync.keyConflict.use_key_of', { name: nombreDe(id) })}
              icon={esOfertaDeInvitacion(id) ? 'link-outline' : 'key-outline'}
              variant="secondary"
              loading={eligiendo === id}
              disabled={eligiendo !== null}
              action={() => confirmar(id)}
              style={styles.boton}
            />
          </View>
        ))}
        <ActionButton
          testID="key-conflict-later"
          label={t('sync.keyConflict.decide_later')}
          variant="ghost"
          full
          disabled={eligiendo !== null}
          action={onDespues}
        />
      </ButtonRack>
    </View>
  );
}

const styles = StyleSheet.create({
  card:  { gap: Spacing[2] },
  fila:  { flexDirection: 'row', alignItems: 'center', gap: Spacing[2] },
  boton: { flex: 1 },
});
```

Run: `npx jest src/components/__tests__/GroupKeyConflictCard.test.tsx`
Expected: PASS (24 tests: 4 de «qué muestra», 5 de «elegir», 13 del `it.each` y 2 de textos).

- [ ] **Step 4: Test de integración en `TabHeader` (falla)**

En `src/components/__tests__/TabHeader.test.tsx`, después de `import { useNoticeInboxStore } from '@/src/store/noticeInboxStore';` agregar:

```tsx
import { registrarOferta } from '@/src/sync/groupKeyOffers';
import { createSecureStorage } from '@/src/utils/secureStorage';
import type { KeyConflictNotice } from '@/src/services/syncNotices';
```

Al final del archivo agregar:

```tsx
/**
 * T-136: el aviso de claves en disputa se resuelve eligiendo, no leyéndolo.
 * Tocarlo abre la tarjeta; «Decidir después» la cierra y el aviso sigue
 * pendiente.
 */
describe('T-136 · el aviso de claves en disputa abre la elección', () => {
  const conflicto: KeyConflictNotice = {
    kind: 'group_key_conflict', groupId: 'g1', groupName: 'Viaje', nombreVerificado: false,
    senderIds: ['u-beto', 'u-mallory'],
  };

  function dosOfertas(): void {
    registrarOferta({ groupId: 'g1', fromUserId: 'u-beto', key: 'cd'.repeat(32), epoch: 1, origen: 'contact', receivedAt: 0, adoptada: false });
    registrarOferta({ groupId: 'g1', fromUserId: 'u-mallory', key: 'ab'.repeat(32), epoch: 1, origen: 'contact', receivedAt: 0, adoptada: false });
  }

  beforeEach(() => {
    createSecureStorage('groupkeys').clearAll();
    useNoticeInboxStore.setState({ items: [{ id: 'n1', readAt: null, createdAt: 0, notice: conflicto }] });
  });

  const leido = () => useNoticeInboxStore.getState().items[0]!.readAt;

  it('tocar el aviso abre la tarjeta con los remitentes y NO lo marca leído', () => {
    dosOfertas();
    const r = montar();
    fireEvent.press(r.getByTestId('notice-bell'));
    fireEvent.press(r.getByTestId('notice-n1'));

    expect(r.getByTestId('key-conflict-card')).toBeTruthy();
    expect(r.getByTestId('key-conflict-sender-u-beto')).toBeTruthy();
    expect(r.getByTestId('key-conflict-sender-u-mallory')).toBeTruthy();
    expect(leido()).toBeNull();
  });

  it('«Decidir después» cierra la tarjeta y el aviso sigue pendiente', () => {
    dosOfertas();
    const r = montar();
    fireEvent.press(r.getByTestId('notice-bell'));
    fireEvent.press(r.getByTestId('notice-n1'));
    fireEvent.press(r.getByTestId('key-conflict-later'));

    expect(r.queryByTestId('key-conflict-card')).toBeNull();
    expect(leido()).toBeNull();
  });

  it('si ya no hay conflicto (menos de dos ofertas), tocarlo lo marca leído sin abrir nada', () => {
    const r = montar();
    fireEvent.press(r.getByTestId('notice-bell'));
    fireEvent.press(r.getByTestId('notice-n1'));

    expect(r.queryByTestId('key-conflict-card')).toBeNull();
    expect(leido()).not.toBeNull();
  });
});
```

Run: `npx jest src/components/__tests__/TabHeader.test.tsx -t "T-136"`
Expected: FAIL — `Unable to find an element with testID: key-conflict-card` (hoy tocar el aviso lo marca leído y navega/alerta).

- [ ] **Step 5: Integrar en `TabHeader.tsx`**

En `src/components/TabHeader.tsx`, reemplazar:

```tsx
import { NoticeInboxSheet } from './NoticeInboxSheet';
```

por:

```tsx
import { NoticeInboxSheet } from './NoticeInboxSheet';
import { GroupKeyConflictCard } from './GroupKeyConflictCard';
import { BottomSheet } from './Sheet';
```

Reemplazar:

```tsx
import { esAccionable } from '@/src/services/syncNotices';
```

por:

```tsx
import { esAccionable, type KeyConflictNotice } from '@/src/services/syncNotices';
import { ofertasDe } from '@/src/sync/groupKeyOffers';
```

Reemplazar:

```tsx
  const [monedas, setMonedas] = useState(false);
```

por:

```tsx
  const [monedas, setMonedas] = useState(false);
  /** Aviso de claves en disputa abierto (T-136): el id para marcarlo leído al resolver. */
  const [conflicto, setConflicto] = useState<{ id: string; notice: KeyConflictNotice } | null>(null);
```

Reemplazar la función `abrirAviso` entera por:

```tsx
  function abrirAviso(item: StoredNotice) {
    // La constante es necesaria para que TypeScript estreche el union: sobre
    // `item.notice` el `in` no acota nada.
    const aviso = item.notice;

    /**
     * T-136: leer este aviso no lo resuelve — hay que elegir una clave. Se abre
     * la tarjeta y queda sin leer hasta que la elección salga bien. Si ya no
     * quedan dos ofertas, el conflicto se resolvió por otro lado: se marca
     * leído y no se abre nada.
     */
    if (aviso.kind === 'group_key_conflict') {
      setBandeja(false);
      if (ofertasDe(aviso.groupId).length < 2) { markRead(item.id); return; }
      setConflicto({ id: item.id, notice: aviso });
      return;
    }

    markRead(item.id);
    setBandeja(false);

    // No todo aviso es de un grupo: el del reloj (T-038) es del aparato. Se
    // marca leído y no se navega a ningún lado, que es lo correcto — no hay
    // pantalla adentro de la app donde arreglar la hora del teléfono.
    if (!('groupId' in aviso)) return;

    const grupo = groups.find(g => g.id === aviso.groupId && !g.isDeleted);
    // El grupo pudo borrarse entre que llegó el aviso y que lo tocaron. Sin
    // esto la navegación deja una pantalla de detalle vacía sin explicación.
    if (!grupo) { alert(t('notifications.inbox_gone')); return; }
    router.push(`/groups/${grupo.id}` as never);
  }
```

Reemplazar:

```tsx
        onMarkAll={() => markAllRead()}
      />
    </>
```

por:

```tsx
        onMarkAll={() => markAllRead()}
      />
      {conflicto && (
        <BottomSheet visible onClose={() => setConflicto(null)}>
          <GroupKeyConflictCard
            notice={conflicto.notice}
            senderIds={ofertasDe(conflicto.notice.groupId).map(o => o.fromUserId)}
            onResuelto={() => { markRead(conflicto.id); setConflicto(null); }}
            onDespues={() => setConflicto(null)}
          />
        </BottomSheet>
      )}
    </>
```

- [ ] **Step 6: Correr y ver PASS; guards de i18n**

Run: `npx jest src/components/__tests__/GroupKeyConflictCard.test.tsx src/components/__tests__/TabHeader.test.tsx src/components/__tests__/NoticeInbox.test.tsx src/i18n/__tests__ src/services/__tests__/notifications.test.ts`
Expected: PASS — incluidos `paridad.test.ts` y `deadKeysGuard.test.ts` (todas las `sync.keyConflict.*` están en los tres idiomas y se usan como literal en el código).

Si `deadKeysGuard` marca alguna de `title_two`/`title_many` como huérfana (el escáner no ve literales dentro de un ternario), reemplazar en `textFor` la expresión del título por dos llamadas literales: `title: notice.senderIds.length > 2 ? t('sync.keyConflict.title_many', { group }) : t('sync.keyConflict.title_two', { group }),`.

Run: `npx tsc --noEmit` → Expected: sin salida.

- [ ] **Step 7: Commit**

```bash
git add src/components/GroupKeyConflictCard.tsx src/components/__tests__/GroupKeyConflictCard.test.tsx \
  src/components/TabHeader.tsx src/components/__tests__/TabHeader.test.tsx \
  src/i18n/locales/es.json src/i18n/locales/en.json src/i18n/locales/pt.json
git commit -m "feat(ui): tarjeta para elegir entre claves de grupo distintas (T-136)

Tocar el aviso group_key_conflict abre GroupKeyConflictCard: un ActionButton
por remitente en ButtonRack, confirmación destructiva y «Decidir después» que
deja el aviso pendiente. Textos del spec en es/en/pt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Ataque de punta a punta, mutaciones, docs y cierre

**Files:**
- Test: `src/sync/__tests__/contactChannel.test.ts` (imports + tres `it` dentro del describe T-136)
- Modify (temporal, se revierte): `src/sync/contactChannel.ts`, `src/services/elegirClaveDeGrupo.ts`, `src/sync/groupKeyOffers.ts`
- Modify: `src/store/groupKeyStore.ts:64-72` (comentario)
- Modify: `docs/ARCHITECTURE.md` (sección `## Invitación a grupos`, después de la «Nota sobre username sin servidor»)
- Modify (gitignored, no se commitea): `engram/05_handoff_log.md`, `engram/03_backlog.md`

**Interfaces:**
- Consumes: todo lo anterior. Produces: evidencia para QA Strong y el verificador ciego.

- [ ] **Step 1: Test de ataque de punta a punta**

En `src/sync/__tests__/contactChannel.test.ts`, después de `import { avisarConflictosDelDrenaje } from '../keyConflictNotice';` agregar:

```ts
import { estaPendienteDeDrenaje } from '../pendingDrain';
import { elegirClaveDeGrupo } from '@/src/services/elegirClaveDeGrupo';
import { useExpenseStore } from '@/src/store/expenseStore';
import { useGroupStore } from '@/src/store/groupStore';
```

y después del bloque `jest.mock('expo-notifications', …);` agregar:

```ts
const relayEngineMock = jest.requireMock('@/src/sync/relayEngine') as { drainNow: jest.Mock };
```

Dentro del `describe('T-136 · claves distintas para el mismo grupo', …)`, antes de su `});` de cierre, agregar:

```ts
  const GRUPO_FALSO = {
    id: 'g1', name: 'Viaje', memberIds: [ANA.id, MALLORY.id], currency: 'ARS',
    createdAt: 0, createdById: MALLORY.id, deletionVotes: [], updatedAt: 1, isDeleted: false,
  } as never;
  const GASTO_FALSO = {
    id: 'e-falso', groupId: 'g1', description: 'cargado sobre la clave falsa', amount: 1, currency: 'ARS',
    paidById: ANA.id, splitMode: 'equal', splits: [], category: 'other', date: 0,
    createdAt: 0, createdById: ANA.id, deletionVotes: [], updatedAt: 1, isDeleted: false,
  } as never;

  it('criterio 1 · dos lotes y elección de Beto: clave real con su época, nada del grupo falso, pendiente de drenaje', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    const r1 = await anaDrena(deAna, cursor);
    expect(r1.joinedGroups).toEqual(['g1']);

    // Ana drenó el topic de K' (el grupo falso de Mallory) y cargó algo encima.
    useGroupStore.setState({ groups: [GRUPO_FALSO] });
    useExpenseStore.setState({ expenses: [GASTO_FALSO] });

    const real = await betoEntrega();
    const r2 = await anaDrena(deAna, r1.cursor);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual({ groupId: 'g1', key: FALSA, epoch: 1e9 });
    expect(r2.joinedGroups).not.toContain('g1');
    const avisos = conflictosDe('g1');
    expect(avisos).toHaveLength(1);
    expect([...avisos[0]!.senderIds].sort()).toEqual([BETO.id, MALLORY.id].sort());

    expect(await elegirClaveDeGrupo('g1', BETO.id)).toBe(true);

    expect(useGroupKeyStore.getState().getKey('g1')).toEqual({ groupId: 'g1', key: real, epoch: 1 });
    expect(useGroupStore.getState().groups.filter(g => g.id === 'g1')).toEqual([]);
    expect(useExpenseStore.getState().expenses.filter(e => e.groupId === 'g1')).toEqual([]);
    expect(estaPendienteDeDrenaje('g1')).toBe(true);
    expect(relayEngineMock.drainNow).toHaveBeenCalledWith('g1');
  });

  it('criterio 2 · mismo lote y elección: se adopta la clave de Beto', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    const real = await betoEntrega();
    await anaDrena(deAna, cursor);

    expect(await elegirClaveDeGrupo('g1', BETO.id)).toBe(true);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(real);
  });

  it('criterio 4 · un remitente sin oferta no se puede elegir', async () => {
    const { deAna, cursor } = await anaTieneDosContactos();
    await malloryPlanta();
    const r1 = await anaDrena(deAna, cursor);
    await betoEntrega();
    await anaDrena(deAna, r1.cursor);

    expect(await elegirClaveDeGrupo('g1', 'u-nadie')).toBe(false);
    expect(useGroupKeyStore.getState().getKey('g1')?.key).toBe(FALSA);
  });
```

Run: `npx jest src/sync/__tests__/contactChannel.test.ts -t "T-136"`
Expected: PASS (9 tests).

- [ ] **Step 2: Commit del test de punta a punta**

```bash
git add src/sync/__tests__/contactChannel.test.ts
git commit -m "test(sync): ataque de clave plantada de punta a punta con elección (T-136)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Mutación M1 — adoptar la primera clave sin mirar conflictos**

En `src/sync/contactChannel.ts`, dentro de `resolverOfertas`, reemplazar temporalmente:

```ts
    if (est === 'conflicto') {
      conflictedGroups.push(groupId);
      continue;
    }
    if (est !== 'unanime' || local) continue;
```

por:

```ts
    if (local) continue;
```

Run: `npx jest src/sync/__tests__/contactChannel.test.ts -t "T-136"`
Expected: FAIL en «criterio 2 · mismo lote…» (se adopta la de Mallory) y «criterio 1 (sin elegir) · dos lotes…» (`conflictedGroups` vacío). Anotar cuáles. Revertir: `git checkout -- src/sync/contactChannel.ts`.

- [ ] **Step 4: Mutación M2 — `elegirClaveDeGrupo` sin purga**

En `src/services/elegirClaveDeGrupo.ts`, comentar temporalmente la línea `  purgarGrupoLocalmente(groupId);`.

Run: `npx jest src/services/__tests__/elegirClaveDeGrupo.test.ts src/sync/__tests__/contactChannel.test.ts -t "elegir|criterio 1"`
Expected: FAIL en «purga lo local del grupo, adopta la elegida…» (la clave sigue siendo la de época 1e9 y `e-falso` sigue) y en «criterio 1 · dos lotes y elección de Beto…». Revertir: `git checkout -- src/services/elegirClaveDeGrupo.ts`.

- [ ] **Step 5: Mutación M3 — elegir aunque la clave local no vino de contacto**

En `src/services/elegirClaveDeGrupo.ts`, borrar temporalmente la línea `  if (local && !claveLocalVinoDeContacto(groupId)) return false;`.

Run: `npx jest src/services/__tests__/elegirClaveDeGrupo.test.ts`
Expected: FAIL en «una clave local de ensureKey/QR/invitación (sin oferta adoptada) → false aunque haya ofertas». Revertir: `git checkout -- src/services/elegirClaveDeGrupo.ts`.

- [ ] **Step 6: Mutación M4 — sin dedupe por (grupo, remitente, clave)**

En `src/sync/groupKeyOffers.ts`, dentro de `aplicarOferta`, reemplazar temporalmente:

```ts
  const i = lista.findIndex(x => x.groupId === entrante.groupId && x.fromUserId === entrante.fromUserId);
```

por:

```ts
  const i = -1 as number;
```

Run: `npx jest src/sync/__tests__/groupKeyOffers.test.ts src/sync/__tests__/contactChannel.test.ts -t "T-136|aplicarOferta|registrar"`
Expected: FAIL en «la misma clave del mismo remitente es no-op», «registrar devuelve true la primera vez y false al repetir» y «criterio 3 · la misma clave del mismo remitente N veces en un lote deja UNA oferta y adopta». Revertir: `git checkout -- src/sync/groupKeyOffers.ts`.

- [ ] **Step 7: Árbol limpio**

Run: `git status --short` → Expected: vacío.

- [ ] **Step 8: Comentario de `groupKeyStore`**

En `src/store/groupKeyStore.ts`, reemplazar:

```ts
  /**
   * Regla de adopción: **nunca se pisa una clave que ya tenemos**.
   *
```

por:

```ts
  /**
   * Regla de adopción: **una clave que ya tenemos nunca se pisa
   * automáticamente**. Sólo por elección del usuario, sobre una clave que vino
   * de contacto, y previa purga del grupo (`services/elegirClaveDeGrupo.ts`,
   * ADR-013 · T-136). Ningún mensaje de red la sustituye solo (S3-A1).
   *
```

- [ ] **Step 9: `docs/ARCHITECTURE.md`**

En `docs/ARCHITECTURE.md`, después del párrafo que empieza con `**Nota sobre username sin servidor**:` y antes del `---` que cierra la sección, insertar:

```markdown
### Clave de grupo entregada por contacto (T-136 · ADR-013)

Crear un grupo con un contacto le entrega la clave por el buzón de contacto (`sendGroupKey`), firmada y envuelta para su X25519. La firma prueba **quién** manda, no que sea miembro: «contacto» es cualquiera que haya escaneado mi QR. Por eso una clave entregada no se adopta a ciegas:

- Cada entrega válida es una **oferta** por (grupo, remitente) en `src/sync/groupKeyOffers.ts` (bucket cifrado `groupkeys`, scopeado por cuenta, tope de 5 remitentes por grupo, dedupe del reenvío de cada arranque).
- Al final de cada drenaje (`drainContacts`), un grupo sin clave local cuyas ofertas coinciden se **adopta solo**: es el camino normal.
- Si las ofertas difieren —entre sí, o contra una clave local que vino de contacto— **no se adopta ni se sustituye nada**. Se avisa `group_key_conflict` (un solo aviso sin leer por grupo) y el usuario elige un remitente en `GroupKeyConflictCard`. Lo mismo si un grant de invitación choca con una clave de contacto (`inviteEngine.redeem`).
- Elegir (`services/elegirClaveDeGrupo.ts`) sólo es posible si la clave local, de existir, vino de una oferta adoptada. Purga la copia local del grupo (`purgarGrupoLocalmente`), adopta la elegida, marca el grupo pendiente de drenaje y drena el topic real. No publica nada.
- Las claves de `ensureKey`, del QR y de la invitación **nunca** son sustituibles por este camino: S3-A1 sigue cerrado.

Residual (ADR-013): atar el `groupId` a su creador con firma daría un árbitro criptográfico y haría innecesaria la elección manual; un usuario engañado puede elegir mal, y el aviso aclara que el nombre del contacto no está verificado.
```

- [ ] **Step 10: Suite completa, tipos y lint**

Run: `npx jest 2>&1 | grep -E "^Tests:|failed"` → Expected: sin fallos.
Run: `npx tsc --noEmit` → Expected: sin salida.
Run: `npm run lint 2>&1 | grep problems` → Expected: `127 problems (0 errors, 127 warnings)`.

Si el lint sube, correr `npx eslint <archivos tocados en este plan>` y corregir lo nuevo (no tocar los 127 de base).

- [ ] **Step 11: Commit de docs**

```bash
git add src/store/groupKeyStore.ts docs/ARCHITECTURE.md
git commit -m "docs(sync): regla de adopción de claves y entrega por contacto con ofertas (T-136)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 12: Handoff y backlog (engram, gitignored — no se commitea)**

Agregar arriba de `engram/05_handoff_log.md` (después de `# Handoff Log — splitp2p` y su línea en blanco) una entrada con esta forma, completando cada línea con los datos reales de la corrida:

```markdown
### [2026-09-14] RETURN nerv-mobile → Orq · T-136
**Status:** código completo en `fix/T-136-conflicto-clave`, En revisión QA (Strong + verificador ciego).
**Spec / plan:** `docs/superpowers/specs/2026-09-14-t136-conflicto-clave-grupo-design.md` · `docs/superpowers/plans/2026-09-14-t136-conflicto-clave-grupo.md`.
**Files:** `src/sync/groupKeyOffers.ts` (nuevo), `src/sync/keyConflictNotice.ts` (nuevo), `src/services/elegirClaveDeGrupo.ts` (nuevo), `src/components/GroupKeyConflictCard.tsx` (nuevo), `contactChannel.ts`, `relayEngine.ts`, `inviteEngine.ts`, `salirDelGrupo.ts`, `syncNotices.ts`, `notifications.ts`, `TabHeader.tsx`, `accountLink.ts`, `groupKeyStore.ts` (comentario), locales es/en/pt, `docs/ARCHITECTURE.md`.
**Desvíos del spec (plan §Global Constraints):** oferta adoptada no se reemplaza; remitente de invitación `invite:<huella>`; `Notice.nombreVerificado`; `DrainContactsResult.nombresDeDrop`; elegir re-registra la elegida tras la purga y espera `marcarConTopic`; claves i18n extra `unknown_name`/`invite_sender`/`failed`; `sync/groupKeyOffers` excluido de la fusión.
**Riesgo para el PO:** con grupo local existente, el nombre se muestra como verificado aunque vino del topic de la clave en disputa (así lo pide el spec).
**Proof of red:** salida de Task 2 Step 2 (criterios 1 y 2 en rojo contra el `adoptDroppedKey` de `main`), Task 3 Step 1, Task 5 Step 4.
**Mutaciones:** M1 → tests caídos de Task 6 Step 3; M2 → Step 4; M3 → Step 5; M4 → Step 6.
**Verificación:** `npx jest` (total de tests), `npx tsc --noEmit` 0, `npm run lint` 127/0.
**Pendiente antes de Done:** verificación en aparato §5 de la spec (A, B, M). Si el paso 3 (clave falsa antes de la real) no es práctico en aparato, queda cubierto por los tests de integración de criterios 1–2 y se declara así.
```

En `engram/03_backlog.md`, fila `T-136`: estado → `En revisión QA (rama fix/T-136-conflicto-clave; verificador ciego + mutaciones M1–M4)`.

---

## Self-review

### Cobertura de criterios (spec §4)

| # | Criterio | Tarea / test |
|---|---|---|
| 1 | Ataque en dos lotes: K' queda, un aviso con dos remitentes, G fuera de `joinedGroups`; tras elegir, K con época de Beto, stores sin G previo, pendiente de drenaje | Task 2 «criterio 1 (sin elegir)» · Task 6 «criterio 1 · dos lotes y elección de Beto» · Task 4 «purga lo local del grupo…» |
| 2 | Mismo lote: no adopta, aviso, G fuera de `joinedGroups` | Task 2 «criterio 2 · mismo lote» · Task 6 «criterio 2 · mismo lote y elección» · Task 4 «criterio 2 · sin clave local…» |
| 3 | Caso feliz: un drop / misma clave adoptan; N reenvíos sin ofertas ni avisos; tests actuales verdes | Task 2 «criterio 3/6 · reenvíos», «criterio 3 · N veces en un lote», «criterio 3 · MISMA clave», Task 2 Step 6 (suite previa de `contactChannel.test.ts`) |
| 4 | S3-A1: clave local de `ensureKey`/QR/invitación sin oferta ni aviso; elegir `false` sin efectos; remitente sin oferta `false` | Task 2 «criterio 4 · S3-A1» · Task 4 «cuándo NO se puede elegir» (2 tests) · Task 6 «criterio 4 · remitente sin oferta» · Task 3 «S3-A1 · clave local que NO vino de contacto» |
| 5 | Invitación: oferta `origen:'invite'` + conflicto; misma clave como hoy | Task 3 (4 tests) |
| 6 | Topes: 5 remitentes, reemplazo propio, un aviso sin leer por grupo | Task 1 `aplicarOferta` (tope, reemplazo, adoptada) · Task 1 `announceKeyConflict` (4 tests) · Task 2 `avisarConflictosDelDrenaje` |
| 7 | Ofertas cifradas y scopeadas; guard de cuenta; borradas al elegir y al purgar | Task 1 «vive en un bucket CIFRADO», «scopeado por cuenta», Step 6 `accountCoverage` · Task 4 «queda sólo la oferta elegida», `purgaAlSalir` T-136 |
| 8 | Mutaciones M1–M4 | Task 6 Steps 3–6 (cada una con test que cae y `git checkout --`) |
| 9 | UI: botón por remitente; confirmar llama `elegirClaveDeGrupo(groupId, userId)`; cancelar no; «Decidir después» no resuelve; i18n es/en/pt | Task 5 `GroupKeyConflictCard.test.tsx` + `TabHeader.test.tsx` T-136 |
| 10 | `npx jest`, `tsc`, lint 127/0 | Task 6 Step 10 (y `tsc` en cada tarea) |

### Placeholders

Búsqueda de `TBD`, `TODO`, «agregar validación», «similar a Task», «tests para lo anterior»: no hay. La entrada de handoff de Task 6 Step 12 se completa con salidas reales de la corrida; cada línea dice de qué paso sale el dato.

### Consistencia de nombres y firmas

- `registrarOferta(o: KeyOffer): boolean` — definida en Task 1; usada en Tasks 2 (`registrarDropComoOferta`), 3 (`redeem`), 4 (`elegirClaveDeGrupo`), tests de 3/4/5.
- `ofertasDe`, `estado`, `marcarAdoptada`, `olvidarOfertas`, `claveLocalVinoDeContacto`, `idDeOfertaDeInvitacion`, `esOfertaDeInvitacion` — Task 1; consumidas con la misma firma en 2/3/4/5.
- `KeyConflictNotice`, `nombreDeGrupoEnConflicto` — Task 1 (`syncNotices.ts`); usadas en `notifications.ts`, `keyConflictNotice.ts`, `GroupKeyConflictCard.tsx`, `TabHeader.tsx`.
- `announceKeyConflict(notice: KeyConflictNotice): Promise<number>` — Task 1; usada en Task 2. No coincide con la regex `announce\s*\(` del guard `inventarioDeAvisos`, que sigue listando sólo `services/notifications` y `sync/relayEngine`.
- `DrainContactsResult.conflictedGroups` / `nombresDeDrop` — Task 2; consumidas por `avisarConflictosDelDrenaje` (Task 2) y `relayEngine.drainContactsNow`.
- `avisarConflictoDeClave(groupId, nombreDelDrop)` — Task 2; usada en Task 3.
- `elegirClaveDeGrupo(groupId: string, fromUserId: string): Promise<boolean>` — contrato en Task 1, implementación en Task 4, consumida en Task 5 y Task 6.
- testIDs `key-conflict-card`, `key-conflict-sender-<id>`, `key-conflict-later` — definidos en Task 5 Step 3 y usados igual en los tests de Task 5.
- Mocks de `@/src/sync/relayEngine` en tests nuevos: `schedulePublish`, `deviceId`, `olvidarCursor`, `publishNow`, `drainNow`, `startRelay` — el mismo factory en todos los archivos.
