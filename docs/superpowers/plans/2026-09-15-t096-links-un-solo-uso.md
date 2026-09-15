# T-096 — Links de un solo uso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La invitación a grupo y el link de contacto compartido ("Compartir") pasan a ser de un solo uso: el primer canje válido consume el link, y un segundo destinatario no entra ni queda agregado.

**Architecture:** La invitación a grupo suma un campo `claimedBy` persistido localmente por quien invita (sin tocar el formato del link). El link de contacto deja de llevar el secreto permanente de la cuenta: en su lugar se emite un token efímero de un solo uso con el mismo patrón claim/grant que ya usa la invitación a grupo, reutilizando la infraestructura de sellado existente (`envelopeCrypto`, `fingerprint`, Ed25519). El QR de contacto en persona no cambia.

**Tech Stack:** TypeScript estricto, Expo Router, `@noble/curves`/`@noble/hashes` para firma y derivación, MMKV cifrado vía `createSecureStorage`/`readScoped`/`writeScoped`, Jest.

**Spec:** `docs/superpowers/specs/2026-09-15-t096-links-un-solo-uso-design.md`

## Global Constraints

- Un uso = una persona (no "un uso por destinatario, mismo link reusable entre varios"): el primer reclamo válido consume el link para cualquier otra persona; el MISMO reclamante puede seguir reintentando.
- El QR de contacto en pantalla (`myQRData`, modo `my_qr` de `app/contact/add.tsx`) NO cambia: sigue con el secreto permanente y el alta instantánea del que escanea.
- Ningún campo de estado local (`claimedBy`) viaja codificado en ningún link — ni en el formato largo ni en el compacto.
- Ningún string visible al usuario va hardcodeado en JSX — todo pasa por `t()`, claves nuevas en `es.json` (fuente), `en.json` y `pt.json`, forma `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$` (snake_case, sin camelCase).
- Sin aviso explícito de "link ya usado": un segundo destinatario simplemente no recibe nada y su pedido expira solo a las 48hs, igual que cualquier invitación que nunca se completó.
- TTL de 48hs para el link de contacto por invitación, igual que la invitación a grupo (`INVITE_TTL_MS` ya existente en `groupInvite.ts`).
- No se toca el modelo "abierto" de quién puede generar una invitación (sigue siendo cualquier miembro del grupo).
- No se agrega confirmación del lado de quien comparte el link (el primer reclamo válido se admite automático).
- Tests: `npx jest`, `npx tsc --noEmit` y `npm run lint` sin regresiones contra el estado real de `main` al momento de implementar (base conocida al escribir este plan: 124 warnings / 0 errores, `main`@`2c761b5` — reverificar, puede haber avanzado).
- Nunca usar `Buffer` (no existe en React Native) ni `utils.randomPrivateKey()` de `@noble` — privadas siempre de `Crypto.getRandomBytes`.

---

### Task 1: Invitación a grupo — un solo uso (`claimedBy`)

**Files:**
- Modify: `src/sync/groupInvite.ts:52-60` (tipo `GroupInvite`)
- Modify: `src/store/identityStore.ts` (nueva función `markInviteClaimed`, cerca de `saveInvite`/`findInviteToken`)
- Modify: `src/sync/inviteEngine.ts:125-177` (`admit()`)
- Test: `src/sync/__tests__/inviteEngine.test.ts` (nuevos casos)
- Test: `src/store/__tests__/identityStore.test.ts` (si no existe, crear con ese nombre)

**Interfaces:**
- Consumes: nada de tareas anteriores (primera tarea).
- Produces:
  - `GroupInvite.claimedBy?: string` — campo nuevo, opcional, nunca codificado en el link.
  - `markInviteClaimed(groupId: string, token: string, userId: string): void`, exportada de `src/store/identityStore.ts`.
  - `admit()` (privada de `inviteEngine.ts`) ahora relee el invite persistido antes de admitir.

- [ ] **Step 1: Escribir el test que falla — dos reclamantes distintos, mismo link**

Agregar a `src/sync/__tests__/inviteEngine.test.ts`, reusando el helper `anaInvita()` que el archivo YA tiene (línea ~149: arma a Ana con el grupo `'g1'`, su `GroupKeyRecord` vía `useGroupKeyStore.getState().ensureKey('g1')`, identidad y una invitación guardada — devuelve `{ invite, clave, identidadDeAna }`):

```typescript
const MALLORY = usuario('u-mallory', 'Mallory');

it('un segundo reclamante distinto no se admite tras el primero (T-096, un solo uso)', async () => {
  relayMock.__reset();
  const { invite } = anaInvita();

  usar('beto', BETO);
  await publishClaim(invite, 'device-beto');

  usar('mallory', MALLORY);
  await publishClaim(invite, 'device-mallory');

  usar('ana', ANA);
  const adoptadosBeto = await processInvite(invite, 'device-ana');
  expect(adoptadosBeto).toEqual(['g1']);

  // El mismo lote ya tiene los dos reclamos (Beto y Mallory publicaron antes de
  // que Ana procesara): sólo Beto debe quedar admitido.
  expect(useGroupStore.getState().getById('g1')!.memberIds).toContain(BETO.id);
  expect(useGroupStore.getState().getById('g1')!.memberIds).not.toContain(MALLORY.id);

  usar('mallory', MALLORY);
  const adoptadosMallory = await processInvite(invite, 'device-mallory');
  expect(adoptadosMallory).toEqual([]);
});

it('el mismo reclamante puede reintentar después de haber sido admitido', async () => {
  relayMock.__reset();
  const { invite } = anaInvita();

  usar('beto', BETO);
  await publishClaim(invite, 'device-beto');

  usar('ana', ANA);
  await processInvite(invite, 'device-ana');

  // Beto reintenta (simula que la entrega anterior se perdió): sigue publicando
  // el mismo reclamo, y Ana lo debe seguir sirviendo.
  usar('beto', BETO);
  await publishClaim(invite, 'device-beto');

  usar('ana', ANA);
  const adoptados = await processInvite(invite, 'device-ana');
  // `admit` se re-ejecuta y vuelve a mandar la entrega — no debe tirar ni
  // bloquearse por el `claimedBy` ya seteado a Beto.
  expect(adoptados).toEqual(['g1']);
});
```

`anaInvita()` ya deja a Ana como dispositivo activo al terminar — no hace falta `usar('ana', ANA)` antes de usar su retorno.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx jest src/sync/__tests__/inviteEngine.test.ts -t "un solo uso"`
Expected: FAIL — hoy Mallory también queda admitida (no existe la guarda).

- [ ] **Step 3: Sumar `claimedBy` al tipo**

En `src/sync/groupInvite.ts`, en el tipo `GroupInvite` (línea ~52):

```typescript
export type GroupInvite = {
  groupId: string;
  groupName: string;
  token: string;
  inviterFingerprint: string;
  expiresAt: number;
  /**
   * Quién ya canjeó esta invitación (T-096 · ADR-015). Sólo en la copia
   * persistida de quien invita — nunca se codifica en el link.
   */
  claimedBy?: string;
};
```

- [ ] **Step 4: `markInviteClaimed` en `identityStore.ts`**

Agregar después de `findInviteToken` en `src/store/identityStore.ts`:

```typescript
/** Marca quién canjeó una invitación (T-096): un solo uso, un solo destinatario. */
export function markInviteClaimed(groupId: string, token: string, userId: string): void {
  const invite = findInviteToken(groupId, token);
  if (!invite) return;
  saveInvite({ ...invite, claimedBy: userId });
}
```

- [ ] **Step 5: Guarda de un solo uso en `admit()`**

En `src/sync/inviteEngine.ts`, importar `findInviteToken, markInviteClaimed` de `@/src/store/identityStore` (sumar a los imports existentes de esa línea) y modificar `admit`:

```typescript
async function admit(
  claim: InviteClaim,
  invite: GroupInvite,
  topic: string,
  deviceId: string,
  myUserId: string,
): Promise<void> {
  if (claim.groupId !== invite.groupId || claim.userId === myUserId) return;

  // Un solo uso (T-096 · ADR-015): el primer reclamo válido consume la
  // invitación para cualquier otra persona. El MISMO reclamante puede seguir
  // reintentando — es lo que ya hace resiliente el reintento existente. Se
  // relee el registro persistido, no el parámetro `invite`: dentro del mismo
  // lote una iteración anterior puede haberlo actualizado.
  const actual = findInviteToken(invite.groupId, invite.token);
  if (actual?.claimedBy && actual.claimedBy !== claim.userId) return;

  // Sólo puede admitir un miembro vivo que tenga la clave. Un tercero con el
  // link no puede fabricar una entrega válida porque no la tiene.
  const record = useGroupKeyStore.getState().getKey(claim.groupId);
  const group = useGroupStore.getState().getById(claim.groupId);
  if (!record || !group || group.isDeleted || !group.memberIds.includes(myUserId)) return;

  if (!actual?.claimedBy) markInviteClaimed(invite.groupId, invite.token, claim.userId);

  const users = useUserStore.getState();
  if (!users.getUserById(claim.userId)) {
    users.addOrUpdateUser({
      id: claim.userId,
      name: claim.displayName || 'Invitado',
      email: '',
      authProvider: 'google',
      createdAt: Date.now(),
      updatedAt: syncedNow(),
      isDeleted: false,
    });
  }

  if (!group.memberIds.includes(claim.userId)) {
    useGroupStore.getState().updateGroup(group.id, {
      memberIds: [...group.memberIds, claim.userId],
    });
  }

  try { await publishToGroup(group.id, myUserId, deviceId); } catch { /* se reintenta */ }

  const wrap = ensureWrapKeypair();
  const identity = ensureIdentity();

  const sealed = await sealGrant(invite.token, {
    groupId: group.id,
    forUserId: claim.userId,
    wrappedKey: wrapGroupKey(record.key, claim.wrapPublicKey, wrap.privateKey),
    senderWrapPublicKey: wrap.publicKey,
    grantedByIdentity: identity.publicKey,
    epoch: record.epoch,
    grantedAt: Date.now(),
  }, identity.privateKey);

  await sendEnvelope(topic, sealed, deviceId);
}
```

(El orden importa: la guarda de un solo uso va ANTES del chequeo de `record`/`group` para no gastar trabajo en un reclamo que de todos modos no se va a admitir, pero la marca `markInviteClaimed` va DESPUÉS de confirmar que se puede admitir de verdad — si `record`/`group` fallaran, no hay que marcar la invitación como consumida por nadie.)

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npx jest src/sync/__tests__/inviteEngine.test.ts`
Expected: PASS, incluidos los dos tests nuevos y todos los existentes.

- [ ] **Step 7: Test directo de `markInviteClaimed`/`findInviteToken`**

Si `src/store/__tests__/identityStore.test.ts` no existe, crearlo:

```typescript
import { createSecureStorage } from '@/src/utils/secureStorage';
import { useAuthStore } from '@/src/store/authStore';
import {
  saveInvite, findInviteToken, markInviteClaimed, listInvites,
} from '../identityStore';
import type { GroupInvite } from '@/src/sync/groupInvite';

const ME = {
  id: 'u-1', name: 'Ana', email: 'a@test.com', authProvider: 'google' as const,
  createdAt: 0, updatedAt: 0, isDeleted: false,
};

function invite(overrides: Partial<GroupInvite> = {}): GroupInvite {
  return {
    groupId: 'g1', groupName: 'Viaje', token: 'tok-1',
    inviterFingerprint: 'ff', expiresAt: Date.now() + 1000,
    ...overrides,
  };
}

beforeEach(() => {
  createSecureStorage('groupkeys').clearAll();
  useAuthStore.setState({ currentUser: ME });
});

describe('markInviteClaimed', () => {
  it('persiste quién canjeó la invitación', () => {
    saveInvite(invite());
    markInviteClaimed('g1', 'tok-1', 'u-beto');
    expect(findInviteToken('g1', 'tok-1')?.claimedBy).toBe('u-beto');
  });

  it('no rompe si el token no existe', () => {
    expect(() => markInviteClaimed('g1', 'no-existe', 'u-beto')).not.toThrow();
  });

  it('preserva el resto de los campos al marcar', () => {
    saveInvite(invite({ groupName: 'Casa' }));
    markInviteClaimed('g1', 'tok-1', 'u-beto');
    const guardada = findInviteToken('g1', 'tok-1')!;
    expect(guardada.groupName).toBe('Casa');
    expect(guardada.token).toBe('tok-1');
  });

  it('listInvites sigue devolviendo la invitación marcada mientras no venza', () => {
    saveInvite(invite());
    markInviteClaimed('g1', 'tok-1', 'u-beto');
    expect(listInvites().find(i => i.token === 'tok-1')?.claimedBy).toBe('u-beto');
  });
});
```

- [ ] **Step 8: Correr todos los tests nuevos**

Run: `npx jest src/store/__tests__/identityStore.test.ts src/sync/__tests__/inviteEngine.test.ts`
Expected: PASS

- [ ] **Step 9: `tsc` y `lint`**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 10: Commit**

```bash
git add src/sync/groupInvite.ts src/store/identityStore.ts src/sync/inviteEngine.ts \
        src/sync/__tests__/inviteEngine.test.ts src/store/__tests__/identityStore.test.ts
git commit -m "fix(sync): invitación a grupo de un solo uso — claimedBy (T-096, ADR-015)"
```

---

### Task 2: Huella del invitador en `join.tsx`

**Files:**
- Modify: `app/groups/join.tsx:128-136`
- Modify: `src/i18n/locales/es.json`, `en.json`, `pt.json` (namespace `join`)
- Test: `app/groups/__tests__/join.test.tsx` (buscar el archivo existente; si el nombre real difiere, seguir la convención ya usada para tests de pantallas en `app/`)

**Interfaces:**
- Consumes: nada de Task 1 (independiente).
- Produces: nada que otras tareas consuman — es terminal.

- [ ] **Step 1: Ubicar el test existente de la pantalla**

Run: `find app/groups -iname "*join*test*"`

Si existe, abrirlo y seguir su patrón de render (mock de `useLocalSearchParams`, `useAuthStore`, etc.). Si NO existe ningún test de esta pantalla, crear `src/screens/__tests__/joinGroup.test.tsx` con `@testing-library/react-native`, siguiendo el patrón de otro test de pantalla en `app/` (por ejemplo `src/screens/__tests__/contactAddCierra.test.tsx`, ya referenciado en el código de `contact/add.tsx`).

- [ ] **Step 2: Escribir el test que falla**

```typescript
it('muestra la huella del invitador antes de aceptar', () => {
  // params con inviterFingerprint = 'aa11bb22cc33dd44ee55ff6600112233'
  // (32 hex chars, como arma `fingerprint()` en groupInvite.ts)
  const { getByText } = render(<JoinGroupScreen />);
  // shortFingerprint corta a los primeros 16 chars en bloques de 4:
  // 'aa11 bb22 cc33 dd44'
  expect(getByText(/aa11 bb22 cc33 dd44/)).toBeTruthy();
});

it('no rompe cuando no hay huella (formato largo viejo sin ese parámetro)', () => {
  // invite con inviterFingerprint === ''
  const { queryByText } = render(<JoinGroupScreen />);
  expect(() => render(<JoinGroupScreen />)).not.toThrow();
});
```

Adaptar el mocking exacto de `useLocalSearchParams`/router al patrón que ya use el archivo de test elegido en el Step 1 — no inventar un mecanismo de mock nuevo.

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx jest <archivo del test> -t "huella"`
Expected: FAIL — el texto no existe todavía.

- [ ] **Step 4: Sumar las claves de i18n**

En `src/i18n/locales/es.json`, dentro del objeto `join` (junto a `intro`, `accept`, etc.):

```json
"inviter_fingerprint": "Invitación de alguien con huella {{fingerprint}}"
```

En `en.json`:

```json
"inviter_fingerprint": "Invitation from someone with fingerprint {{fingerprint}}"
```

En `pt.json`:

```json
"inviter_fingerprint": "Convite de alguém com impressão {{fingerprint}}"
```

- [ ] **Step 5: Mostrar la huella en la pantalla**

En `app/groups/join.tsx`, importar `shortFingerprint` desde `@/src/utils/keyFingerprint` (sumar a los imports), y en el bloque de contenido "listo" (línea ~128-136), después del `intro`:

```typescript
        <Text style={[Typography.h2, styles.centro, { color: c.text }]}>{invite.groupName}</Text>
        <Text style={[Typography.bodyS, styles.centro, { color: c.textSecondary }]}>
          {t('join.intro')}
        </Text>
        {invite.inviterFingerprint !== '' && (
          <Text style={[Typography.caption, styles.centro, { color: c.textSecondary }]}>
            {t('join.inviter_fingerprint', { fingerprint: shortFingerprint(invite.inviterFingerprint) })}
          </Text>
        )}
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx jest <archivo del test>`
Expected: PASS

- [ ] **Step 7: `tsc` y `lint`**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 8: Commit**

```bash
git add app/groups/join.tsx src/i18n/locales/es.json src/i18n/locales/en.json src/i18n/locales/pt.json <archivo de test>
git commit -m "feat(ui): mostrar la huella del invitador en join.tsx (T-096)"
```

---

### Task 3: Contact invite — módulo de sellado y persistencia

**Files:**
- Create: `src/sync/contactInvite.ts`
- Modify: `src/store/identityStore.ts` (nuevas claves y funciones)
- Modify: `src/store/accountLink.ts` (merge y purga de las dos claves nuevas)
- Test: `src/sync/__tests__/contactInvite.test.ts`
- Test: `src/store/__tests__/identityStore.test.ts` (sumar casos, mismo archivo de Task 1)
- Test: `src/store/__tests__/accountCoverage.test.ts` (correr, no modificar — es el guard)
- Test: `src/store/__tests__/accountLink.test.ts` (sumar casos si el archivo ya existe; buscarlo primero)

**Interfaces:**
- Consumes: `fingerprint`, `toHex`, `fromHex` de `src/sync/groupInvite.ts`/`src/sync/envelopeCrypto.ts` (ya existen); `ContactCard` de `src/sync/contactChannel.ts` (ya existe: `{ kind: 'contact'; userId; name; contactSecret; wrapPublicKey; identityPublicKey; avatar?; sentAt }`).
- Produces (usado por Task 4, 5, 6, 7):
  - `type ContactInvite = { fromName: string; token: string; inviterFingerprint: string; expiresAt: number; claimedBy?: string }`
  - `createContactInvite(fromName: string, identityPublicKey: string, now?: number): ContactInvite`
  - `isContactInviteExpired(invite: ContactInvite, now?: number): boolean`
  - `deriveContactInviteTopic(token: string): Promise<string>`
  - `sealContactClaim(token: string, card: ContactCard): Promise<string>`
  - `openContactClaim(token: string, sealed: string): Promise<ContactCard | null>`
  - `sealContactGrant(token: string, card: ContactCard, signingPrivateKey: string): Promise<string>`
  - `openContactGrant(token: string, sealed: string, expectedFingerprint: string): Promise<ContactCard | null>`
  - En `identityStore.ts`: `K_CONTACT_INVITES`, `K_CONTACT_PENDING` (exportadas), `saveContactInvite`, `listContactInvites`, `findContactInviteToken`, `markContactInviteClaimed`, `savePendingContactClaim`, `listPendingContactClaims`, `removePendingContactClaim` — mismas firmas que sus equivalentes de `GroupInvite`, con `ContactInvite`.

- [ ] **Step 1: Escribir los tests que fallan — round-trip de `contactInvite.ts`**

Crear `src/sync/__tests__/contactInvite.test.ts`:

```typescript
import {
  createContactInvite, isContactInviteExpired, deriveContactInviteTopic,
  sealContactClaim, openContactClaim, sealContactGrant, openContactGrant,
} from '../contactInvite';
import { generateIdentity } from '../groupInvite';
import type { ContactCard } from '../contactChannel';

function card(overrides: Partial<ContactCard> = {}): ContactCard {
  return {
    kind: 'contact', userId: 'u-ana', name: 'Ana',
    contactSecret: 'a'.repeat(64), wrapPublicKey: 'b'.repeat(64), identityPublicKey: 'c'.repeat(64),
    sentAt: 1000,
    ...overrides,
  };
}

describe('createContactInvite', () => {
  it('arma un token al azar, la huella de la identidad y el vencimiento a 48hs', () => {
    const id = generateIdentity();
    const now = 1_000_000;
    const invite = createContactInvite('Ana', id.publicKey, now);
    expect(invite.fromName).toBe('Ana');
    expect(invite.token).toMatch(/^[0-9a-f]{64}$/);
    expect(invite.inviterFingerprint).toHaveLength(32);
    expect(invite.expiresAt).toBe(now + 48 * 60 * 60 * 1000);
    expect(invite.claimedBy).toBeUndefined();
  });

  it('dos invitaciones seguidas tienen tokens distintos', () => {
    const id = generateIdentity();
    const a = createContactInvite('Ana', id.publicKey);
    const b = createContactInvite('Ana', id.publicKey);
    expect(a.token).not.toBe(b.token);
  });
});

describe('isContactInviteExpired', () => {
  it('vencida cuando "ahora" pasa expiresAt', () => {
    const invite = createContactInvite('Ana', 'aa', 1000);
    expect(isContactInviteExpired(invite, 1000 + 48 * 60 * 60 * 1000 + 1)).toBe(true);
    expect(isContactInviteExpired(invite, 1000)).toBe(false);
  });
});

describe('deriveContactInviteTopic', () => {
  it('el mismo token siempre da el mismo topic', async () => {
    const a = await deriveContactInviteTopic('tok-1');
    const b = await deriveContactInviteTopic('tok-1');
    expect(a).toBe(b);
  });

  it('tokens distintos dan topics distintos', async () => {
    const a = await deriveContactInviteTopic('tok-1');
    const b = await deriveContactInviteTopic('tok-2');
    expect(a).not.toBe(b);
  });
});

describe('sealContactClaim / openContactClaim', () => {
  it('ida y vuelta', async () => {
    const sealed = await sealContactClaim('tok-1', card());
    const abierto = await openContactClaim('tok-1', sealed);
    expect(abierto).toEqual(card());
  });

  it('con el token equivocado no abre', async () => {
    const sealed = await sealContactClaim('tok-1', card());
    expect(await openContactClaim('tok-2', sealed)).toBeNull();
  });

  it('basura no abre', async () => {
    expect(await openContactClaim('tok-1', 'no-es-un-sobre')).toBeNull();
  });

  it('un grant sellado con el mismo token no se confunde con un claim', async () => {
    const id = generateIdentity();
    const sealedGrant = await sealContactGrant('tok-1', card(), id.privateKey);
    expect(await openContactClaim('tok-1', sealedGrant)).toBeNull();
  });
});

describe('sealContactGrant / openContactGrant', () => {
  it('ida y vuelta, con la huella correcta', async () => {
    const id = generateIdentity();
    const { fingerprint } = await import('../groupInvite');
    const sealed = await sealContactGrant('tok-1', card(), id.privateKey);
    const abierto = await openContactGrant('tok-1', sealed, fingerprint(id.publicKey));
    expect(abierto).toEqual(card());
  });

  it('rechaza con la huella equivocada', async () => {
    const id = generateIdentity();
    const sealed = await sealContactGrant('tok-1', card(), id.privateKey);
    expect(await openContactGrant('tok-1', sealed, '0'.repeat(32))).toBeNull();
  });

  it('rechaza una firma que no corresponde (identidad distinta a la que firmó)', async () => {
    const firmante = generateIdentity();
    const impostor = generateIdentity();
    const { fingerprint } = await import('../groupInvite');
    const sealed = await sealContactGrant('tok-1', card(), firmante.privateKey);
    // Se manipula el sobre para decir que lo firmó "impostor" sin haber resellado:
    // alcanza con verificar que la huella esperada de un tercero no matchea.
    expect(await openContactGrant('tok-1', sealed, fingerprint(impostor.publicKey))).toBeNull();
  });

  it('un claim sellado con el mismo token no se confunde con un grant', async () => {
    const id = generateIdentity();
    const { fingerprint } = await import('../groupInvite');
    const sealedClaim = await sealContactClaim('tok-1', card());
    expect(await openContactGrant('tok-1', sealedClaim, fingerprint(id.publicKey))).toBeNull();
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx jest src/sync/__tests__/contactInvite.test.ts`
Expected: FAIL con "Cannot find module '../contactInvite'".

- [ ] **Step 3: Implementar `src/sync/contactInvite.ts`**

```typescript
import { ed25519 } from '@noble/curves/ed25519.js';
import * as Crypto from 'expo-crypto';
import { fingerprint } from './groupInvite';
import { sealEnvelope, openEnvelope, toHex, fromHex } from './envelopeCrypto';
import type { ContactCard } from './contactChannel';

/**
 * Link de contacto por invitación — token efímero de un solo uso (T-096 · ADR-015).
 *
 * Reemplaza al link de "Compartir" que llevaba el `contactSecret` PERMANENTE de
 * la cuenta directo en la URL: cualquiera que lo reenviara se volvía un contacto
 * mutuo en el acto, sin que el dueño se enterara. Acá en cambio se emite un
 * token de un solo uso; el secreto real viaja recién en la entrega (`grant`),
 * después de que el primer reclamo válido lo consuma — mismo patrón que
 * `groupInvite.ts`/`inviteEngine.ts` para la invitación a grupo.
 *
 * El QR de contacto en persona (`myQRData` en `app/contact/add.tsx`) NO usa este
 * módulo: sigue con el secreto permanente y el alta instantánea del que
 * escanea — su modelo de confianza es presencia física, no reenvío por canal.
 */

const CLAIM_DOMAIN = 'splitp2p/contact-invite/v1';
/** Dominio separado del de claim, igual razón que en `groupInvite.ts`: el topic
 * viaja en claro hasta el servidor, y si derivara igual que la clave el topic
 * SERÍA la clave. */
const TOPIC_DOMAIN = 'splitp2p/contact-invite/v1/topic';
/** Mismo TTL que la invitación a grupo (regla de negocio #9). */
const CONTACT_INVITE_TTL_MS = 48 * 60 * 60 * 1000;

export type ContactInvite = {
  /** Nombre de quien comparte: se muestra antes de cualquier red. */
  fromName: string;
  token: string;
  /** Huella de la identidad de quien comparte — se contrasta al abrir el grant. */
  inviterFingerprint: string;
  expiresAt: number;
  /** Quién ya lo canjeó. Sólo en la copia persistida de quien comparte — nunca viaja en el link. */
  claimedBy?: string;
};

export function createContactInvite(
  fromName: string,
  inviterIdentityPublicKey: string,
  now: number = Date.now(),
): ContactInvite {
  return {
    fromName,
    token: toHex(Crypto.getRandomBytes(32)),
    inviterFingerprint: fingerprint(inviterIdentityPublicKey),
    expiresAt: now + CONTACT_INVITE_TTL_MS,
  };
}

export function isContactInviteExpired(invite: ContactInvite, now: number = Date.now()): boolean {
  return now > invite.expiresAt;
}

async function inviteKey(token: string): Promise<Uint8Array> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${CLAIM_DOMAIN}:${token}`,
  );
  return fromHex(hex.slice(0, 64));
}

export async function deriveContactInviteTopic(token: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${TOPIC_DOMAIN}:${token}`,
  );
}

type ContactClaimMsg = { kind: 'claim'; card: ContactCard };
type ContactGrantMsg = { kind: 'grant'; card: ContactCard; signedBy: string; signature: string };
type ContactInviteMessage = ContactClaimMsg | ContactGrantMsg;

async function seal(token: string, msg: ContactInviteMessage): Promise<string> {
  return sealEnvelope(await inviteKey(token), JSON.stringify(msg));
}

async function open(token: string, sealed: string): Promise<ContactInviteMessage | null> {
  const plain = openEnvelope(await inviteKey(token), sealed);
  if (plain === null) return null;
  try {
    return JSON.parse(plain) as ContactInviteMessage;
  } catch {
    return null;
  }
}

function tarjetaValida(card: unknown): card is ContactCard {
  const c = card as ContactCard;
  return Boolean(c) && c.kind === 'contact' && Boolean(c.userId) && Boolean(c.name)
    && Boolean(c.contactSecret) && Boolean(c.wrapPublicKey) && Boolean(c.identityPublicKey);
}

/** Publica quién soy: mi propia `ContactCard`, sin firmar — el que comparte no tiene de antemano nada contra qué verificarla. */
export async function sealContactClaim(token: string, card: ContactCard): Promise<string> {
  return seal(token, { kind: 'claim', card });
}

export async function openContactClaim(token: string, sealed: string): Promise<ContactCard | null> {
  const msg = await open(token, sealed);
  if (msg === null || msg.kind !== 'claim') return null;
  return tarjetaValida(msg.card) ? msg.card : null;
}

/** Lo que se firma de una entrega: los campos que el que reclama va a confiar. */
function grantPayload(card: ContactCard): string {
  return [card.userId, card.contactSecret, card.wrapPublicKey, card.identityPublicKey].join('|');
}

function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

/** Entrega mi tarjeta real, firmada: el que reclama la va a contrastar contra la huella del link. */
export async function sealContactGrant(
  token: string,
  card: ContactCard,
  signingPrivateKey: string,
): Promise<string> {
  const signedBy = toHex(ed25519.getPublicKey(fromHex(signingPrivateKey)));
  const signature = toHex(ed25519.sign(utf8(grantPayload(card)), fromHex(signingPrivateKey)));
  return seal(token, { kind: 'grant', card, signedBy, signature });
}

/**
 * Abre una entrega y verifica que la mandó quien dice el link. La clave del
 * token sola no alcanza: cualquiera que lo haya reenviado la conoce también —
 * es justo lo que este mecanismo está cerrando. La huella ata la entrega a la
 * identidad que el link prometió, y la firma prueba que quien la mandó tiene
 * esa privada.
 */
export async function openContactGrant(
  token: string,
  sealed: string,
  expectedFingerprint: string,
): Promise<ContactCard | null> {
  const msg = await open(token, sealed);
  if (msg === null || msg.kind !== 'grant') return null;
  if (!tarjetaValida(msg.card) || !msg.signedBy || !msg.signature) return null;
  if (fingerprint(msg.signedBy) !== expectedFingerprint) return null;

  try {
    const ok = ed25519.verify(fromHex(msg.signature), utf8(grantPayload(msg.card)), fromHex(msg.signedBy));
    return ok ? msg.card : null;
  } catch {
    return null; // firma con formato inválido
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx jest src/sync/__tests__/contactInvite.test.ts`
Expected: PASS

- [ ] **Step 5: Persistencia en `identityStore.ts`**

Agregar a `src/store/identityStore.ts`, al lado de `K_INVITES`/`K_PENDING` (importar `ContactInvite` de `@/src/sync/contactInvite` junto al import de `GroupInvite`):

```typescript
import { generateIdentity, generateWrapKeypair, type GroupInvite } from '@/src/sync/groupInvite';
import type { ContactInvite } from '@/src/sync/contactInvite';
```

```typescript
export const K_CONTACT_INVITES = 'contact_invites_v1';
export const K_CONTACT_PENDING = 'contact_pending_claims_v1';
```

Y, cerca de `removePendingJoin` (al final del archivo):

```typescript
export function saveContactInvite(invite: ContactInvite): void {
  const all = readScopedJson<ContactInvite[]>(K_CONTACT_INVITES, []);
  const vivas = all.filter(i => i.expiresAt > Date.now() && i.token !== invite.token);
  writeScoped(storage, K_CONTACT_INVITES, JSON.stringify([...vivas, invite]));
}

export function listContactInvites(): ContactInvite[] {
  return readScopedJson<ContactInvite[]>(K_CONTACT_INVITES, []).filter(i => i.expiresAt > Date.now());
}

export function findContactInviteToken(token: string): ContactInvite | undefined {
  return listContactInvites().find(i => i.token === token);
}

/** Marca quién canjeó un link de contacto (T-096): un solo uso, un solo destinatario. */
export function markContactInviteClaimed(token: string, userId: string): void {
  const invite = findContactInviteToken(token);
  if (!invite) return;
  saveContactInvite({ ...invite, claimedBy: userId });
}

export function savePendingContactClaim(invite: ContactInvite): void {
  const all = readScopedJson<ContactInvite[]>(K_CONTACT_PENDING, []);
  const vivas = all.filter(i => i.expiresAt > Date.now() && i.token !== invite.token);
  writeScoped(storage, K_CONTACT_PENDING, JSON.stringify([...vivas, invite]));
}

export function listPendingContactClaims(): ContactInvite[] {
  return readScopedJson<ContactInvite[]>(K_CONTACT_PENDING, []).filter(i => i.expiresAt > Date.now());
}

export function removePendingContactClaim(token: string): void {
  const all = readScopedJson<ContactInvite[]>(K_CONTACT_PENDING, []);
  writeScoped(storage, K_CONTACT_PENDING, JSON.stringify(all.filter(i => i.token !== token)));
}
```

También sumar `K_CONTACT_INVITES, K_CONTACT_PENDING` al loop de `destruirIdentidadDelAparato` (donde hoy vacía `K_INVITES, K_PENDING`):

```typescript
  for (const k of [K_INVITES, K_PENDING, K_CONTACT_INVITES, K_CONTACT_PENDING]) {
    writeScoped(storage, k, '[]');
  }
```

- [ ] **Step 6: Tests de persistencia — sumar a `identityStore.test.ts`**

Agregar al archivo creado/editado en Task 1 (`src/store/__tests__/identityStore.test.ts`):

```typescript
import {
  saveContactInvite, findContactInviteToken, markContactInviteClaimed,
  listContactInvites, savePendingContactClaim, listPendingContactClaims,
  removePendingContactClaim,
} from '../identityStore';
import type { ContactInvite } from '@/src/sync/contactInvite';

function contactInvite(overrides: Partial<ContactInvite> = {}): ContactInvite {
  return { fromName: 'Ana', token: 'tok-c1', inviterFingerprint: 'ff', expiresAt: Date.now() + 1000, ...overrides };
}

describe('contact invites', () => {
  it('markContactInviteClaimed persiste quién canjeó', () => {
    saveContactInvite(contactInvite());
    markContactInviteClaimed('tok-c1', 'u-beto');
    expect(findContactInviteToken('tok-c1')?.claimedBy).toBe('u-beto');
  });

  it('no rompe si el token no existe', () => {
    expect(() => markContactInviteClaimed('no-existe', 'u-beto')).not.toThrow();
  });

  it('listContactInvites filtra las vencidas', () => {
    saveContactInvite(contactInvite({ token: 'viva', expiresAt: Date.now() + 10_000 }));
    saveContactInvite(contactInvite({ token: 'vencida', expiresAt: Date.now() - 1 }));
    const tokens = listContactInvites().map(i => i.token);
    expect(tokens).toContain('viva');
    expect(tokens).not.toContain('vencida');
  });

  it('savePendingContactClaim / listPendingContactClaims / removePendingContactClaim', () => {
    savePendingContactClaim(contactInvite({ token: 'pend-1' }));
    expect(listPendingContactClaims().map(i => i.token)).toContain('pend-1');
    removePendingContactClaim('pend-1');
    expect(listPendingContactClaims().map(i => i.token)).not.toContain('pend-1');
  });
});
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `npx jest src/store/__tests__/identityStore.test.ts`
Expected: PASS

- [ ] **Step 8: Registrar las dos claves nuevas en `accountLink.ts` (merge y purga)**

En `src/store/accountLink.ts`, importar `K_CONTACT_INVITES, K_CONTACT_PENDING` junto al import existente de `K_INVITES, K_PENDING` (línea ~6), y agregar las ranuras cerca de `kInvites`/`kPending` (línea ~126):

```typescript
const kContactInvites = ranura('groupkeys', K_CONTACT_INVITES);
const kContactPending = ranura('groupkeys', K_CONTACT_PENDING);
```

Sumar las dos funciones de merge cerca de `mergeInvites`/`mergePendingJoins` (línea ~265), reutilizando `mergeInviteList` (es genérica sobre `{token, expiresAt}`, y `ContactInvite` calza):

```typescript
function mergeContactInvites(fromAccountId: string, toAccountId: string): void {
  mergeInviteList(kContactInvites, fromAccountId, toAccountId);
}

function mergePendingContactClaims(fromAccountId: string, toAccountId: string): void {
  mergeInviteList(kContactPending, fromAccountId, toAccountId);
}
```

Nota: `mergeInviteList` está tipada sobre `GroupInvite[]` — generalizarla a un tipo genérico `<T extends { token: string; expiresAt: number }>` (cambiar la firma de la función y sus dos usos existentes) en vez de duplicarla.

Agregar las dos llamadas en `mergeAccounts` (línea ~147-148, junto a `mergeInvites`/`mergePendingJoins`):

```typescript
  mergeInvites(fromAccountId, toAccountId);
  mergePendingJoins(fromAccountId, toAccountId);
  mergeContactInvites(fromAccountId, toAccountId);
  mergePendingContactClaims(fromAccountId, toAccountId);
```

Y actualizar la nota de `COBERTURA_FUSION`/`EXCLUIDOS_FUSION` para `'store/identityStore'` (línea ~712), sumando las dos claves nuevas al texto existente:

```typescript
  'store/identityStore':  'aparte · mergeInvites/mergePendingJoins/mergeContactInvites/mergePendingContactClaims (invites_v1/pending_joins_v1/contact_invites_v1/contact_pending_claims_v1: unión por token, vencidas descartadas de los dos lados). Las privadas (identity_v1/owner_secret_v1/wrapkeys_v1) siguen siendo del APARATO y no pasan por writeScoped ni por ranura().',
```

- [ ] **Step 9: Correr el guard de cobertura de cuenta y los tests de `accountLink`**

Run: `npx jest src/store/__tests__/accountCoverage.test.ts`
Expected: PASS (el módulo `store/identityStore` ya estaba declarado; sólo cambió la nota, y el guard no exige que la nota mencione cada clave, sólo que exista y tenga sentido — releer el test si falla por longitud/contenido de la nota y ajustarla).

Si existe `src/store/__tests__/accountLink.test.ts` (buscar con `find src/store/__tests__ -iname "*accountLink*"`), sumar un caso de fusión para `contact_invites_v1`/`contact_pending_claims_v1` mirando cómo el archivo ya prueba `mergeInvites`/`mergePendingJoins` y replicando el mismo patrón con `ContactInvite`.

Run: `npx jest src/store/__tests__/accountLink.test.ts` (si existe)
Expected: PASS

- [ ] **Step 10: `tsc` y `lint`**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 11: Commit**

```bash
git add src/sync/contactInvite.ts src/store/identityStore.ts src/store/accountLink.ts \
        src/sync/__tests__/contactInvite.test.ts src/store/__tests__/identityStore.test.ts \
        src/store/__tests__/accountLink.test.ts
git commit -m "feat(sync): módulo de sellado y persistencia del link de contacto por invitación (T-096)"
```

---

### Task 4: Contact invite — motor (`contactInviteEngine.ts`)

**Files:**
- Create: `src/sync/contactInviteEngine.ts`
- Test: `src/sync/__tests__/contactInviteEngine.test.ts`

**Interfaces:**
- Consumes de Task 3: `ContactInvite`, `createContactInvite`, `isContactInviteExpired`, `deriveContactInviteTopic`, `sealContactClaim`, `openContactClaim`, `sealContactGrant`, `openContactGrant` (todo de `src/sync/contactInvite.ts`); `saveContactInvite`, `listContactInvites`, `findContactInviteToken`, `markContactInviteClaimed`, `savePendingContactClaim`, `listPendingContactClaims`, `removePendingContactClaim` (de `src/store/identityStore.ts`).
- Consumes ya existentes: `myContactCard`, `savePeerFromCard` (`src/sync/contactChannel.ts`); `sendEnvelope`, `fetchSince` (`src/sync/relay.ts`); `ensureIdentity` (`src/store/identityStore.ts`); `useAuthStore` (`src/store/authStore.ts`).
- Produces (usado por Task 6, 7):
  - `publishContactClaim(invite: ContactInvite, deviceId: string): Promise<boolean>`
  - `processContactInvite(invite: ContactInvite, deviceId: string): Promise<boolean>` — `true` si adoptó algo nuevo (yo como reclamante recibí el grant, o yo como quien comparte admití a alguien).
  - `activeContactInvites(): ContactInvite[]`
  - `processAllContactInvites(deviceId: string): Promise<boolean>`

- [ ] **Step 1: Escribir el test que falla — flujo completo con dos dispositivos**

Crear `src/sync/__tests__/contactInviteEngine.test.ts`, con el mismo estilo de mock de `../relay` y alternancia de dispositivos que `src/sync/__tests__/inviteEngine.test.ts` (Task 1 ya lo usó — copiar el bloque `jest.mock('../relay', ...)` y el helper `usar`/`capturar`, adaptando las claves de storage a `identity_v1`, `wrapkeys_v1`, `contact_invites_v1`, `contact_pending_claims_v1`, `device_id`, y agregando `contact_peers_v1`, `contact_secret_v1` a lo que se captura/restaura por dispositivo — son las que usa `contactChannel.ts`):

```typescript
import {
  publishContactClaim, processContactInvite, activeContactInvites, processAllContactInvites,
} from '../contactInviteEngine';
import { createContactInvite } from '../contactInvite';
import { ensureIdentity } from '@/src/store/identityStore';
import { getPeer } from '../contactChannel';
import { useAuthStore } from '@/src/store/authStore';

// ... setup de dos dispositivos (ANA, BETO, MALLORY), igual patrón que Task 1 ...

it('primer reclamo válido: los dos quedan agregados mutuamente', async () => {
  relayMock.__reset();

  usar('ana', ANA);
  const invite = createContactInvite('Ana', ensureIdentity().publicKey);
  saveContactInvite(invite); // desde identityStore, importado arriba

  usar('beto', BETO);
  const publicado = await publishContactClaim(invite, 'device-beto');
  expect(publicado).toBe(true);

  usar('ana', ANA);
  const adoptoAna = await processContactInvite(invite, 'device-ana');
  expect(adoptoAna).toBe(false); // Ana admite, pero no "adopta" nada nuevo para sí — ver Step 3
  expect(getPeer(BETO.id)).toBeDefined();

  usar('beto', BETO);
  const adoptoBeto = await processContactInvite(invite, 'device-beto');
  expect(adoptoBeto).toBe(true);
  expect(getPeer(ANA.id)).toBeDefined();
});

it('un segundo reclamante distinto no recibe grant', async () => {
  relayMock.__reset();

  usar('ana', ANA);
  const invite = createContactInvite('Ana', ensureIdentity().publicKey);
  saveContactInvite(invite);

  usar('beto', BETO);
  await publishContactClaim(invite, 'device-beto');
  usar('mallory', MALLORY);
  await publishContactClaim(invite, 'device-mallory');

  usar('ana', ANA);
  await processContactInvite(invite, 'device-ana');
  expect(getPeer(BETO.id)).toBeDefined();
  expect(getPeer(MALLORY.id)).toBeUndefined();

  usar('mallory', MALLORY);
  const adoptoMallory = await processContactInvite(invite, 'device-mallory');
  expect(adoptoMallory).toBe(false);
  expect(getPeer(ANA.id)).toBeUndefined();
});

it('activeContactInvites junta lo que emití y lo que estoy reclamando', () => {
  usar('ana', ANA);
  const invite = createContactInvite('Ana', ensureIdentity().publicKey);
  saveContactInvite(invite);
  expect(activeContactInvites().map(i => i.token)).toContain(invite.token);
});
```

(Ajustar exactamente los imports de `saveContactInvite` desde `@/src/store/identityStore` en el archivo de test.)

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx jest src/sync/__tests__/contactInviteEngine.test.ts`
Expected: FAIL con "Cannot find module '../contactInviteEngine'".

- [ ] **Step 3: Implementar `src/sync/contactInviteEngine.ts`**

```typescript
import { useAuthStore } from '@/src/store/authStore';
import { ensureIdentity } from '@/src/store/identityStore';
import {
  saveContactInvite, findContactInviteToken, markContactInviteClaimed,
  savePendingContactClaim, listContactInvites, listPendingContactClaims,
  removePendingContactClaim,
} from '@/src/store/identityStore';
import { sendEnvelope, fetchSince } from './relay';
import {
  deriveContactInviteTopic, sealContactClaim, openContactClaim,
  sealContactGrant, openContactGrant, isContactInviteExpired,
  type ContactInvite,
} from './contactInvite';
import { myContactCard, savePeerFromCard, type ContactCard } from './contactChannel';

/**
 * El encuentro entre quien comparte un link de contacto y quien lo abre
 * (T-096 · ADR-015). Mismo patrón que `inviteEngine.ts` para la invitación a
 * grupo, pero intercambiando `ContactCard` en vez de una clave de grupo.
 */

const MAX_ENVELOPES = 50;

/** Publica mi tarjeta como reclamo, en el buzón efímero del token. */
export async function publishContactClaim(invite: ContactInvite, deviceId: string): Promise<boolean> {
  const card = myContactCard();
  if (!card || isContactInviteExpired(invite)) return false;

  // Se guarda ANTES de mandar (mismo motivo que `publishClaim` de inviteEngine.ts):
  // si el envío falla por red, el pedido sigue pendiente y se reintenta solo.
  savePendingContactClaim(invite);

  try {
    const topic = await deriveContactInviteTopic(invite.token);
    const r = await sendEnvelope(topic, await sealContactClaim(invite.token, card), deviceId);
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Lado de quien comparte el link: admite el primer reclamo válido.
 *
 * Un solo uso (T-096): si ESTE dispositivo no fue quien generó la invitación
 * (`findContactInviteToken` no la encuentra), no hay nada que admitir — soy
 * sólo el reclamante. Si ya la admití para otra persona, un reclamante nuevo
 * se ignora sin efecto.
 */
async function admitContactClaim(
  claim: ContactCard,
  invite: ContactInvite,
  topic: string,
  deviceId: string,
  myUserId: string,
): Promise<boolean> {
  if (claim.userId === myUserId) return false;

  const actual = findContactInviteToken(invite.token);
  if (!actual) return false; // no soy quien la generó
  if (actual.claimedBy && actual.claimedBy !== claim.userId) return false;

  const me = myContactCard();
  if (!me) return false;

  if (!actual.claimedBy) markContactInviteClaimed(invite.token, claim.userId);

  // Guardo al que reclamó: nunca pisa una clave pinneada que ya tuviera
  // (mismo criterio que `savePeerFromCard` en cualquier tarjeta que llega por
  // relay, no por presencia física).
  savePeerFromCard(claim.userId, {
    secret: claim.contactSecret,
    wrapPublicKey: claim.wrapPublicKey,
    identityPublicKey: claim.identityPublicKey,
  });

  const identity = ensureIdentity();
  const sealed = await sealContactGrant(invite.token, me, identity.privateKey);
  await sendEnvelope(topic, sealed, deviceId);
  return true;
}

/**
 * Procesa el buzón efímero de una invitación de contacto, en los dos roles a
 * la vez — igual razón que `processInvite` de `inviteEngine.ts`: el rol lo
 * decide el contenido de cada sobre, no quién llama.
 *
 * Devuelve `true` si pasó algo nuevo: admití a alguien (quien comparte) o
 * recibí la tarjeta real de quien compartió (quien reclamó).
 */
export async function processContactInvite(invite: ContactInvite, deviceId: string): Promise<boolean> {
  const me = useAuthStore.getState().currentUser;
  if (!me || isContactInviteExpired(invite)) return false;

  let topic: string;
  try {
    topic = await deriveContactInviteTopic(invite.token);
  } catch {
    return false;
  }

  const r = await fetchSince(topic, 0, deviceId, MAX_ENVELOPES);
  if (!r.ok) return false;

  let huboNovedad = false;

  for (const envelope of r.envelopes) {
    try {
      const claim = await openContactClaim(invite.token, envelope.payload);
      if (claim) {
        if (await admitContactClaim(claim, invite, topic, deviceId, me.id)) huboNovedad = true;
        continue;
      }

      const grant = await openContactGrant(invite.token, envelope.payload, invite.inviterFingerprint);
      if (grant) {
        savePeerFromCard(grant.userId, {
          secret: grant.contactSecret,
          wrapPublicKey: grant.wrapPublicKey,
          identityPublicKey: grant.identityPublicKey,
        });
        removePendingContactClaim(invite.token);
        huboNovedad = true;
      }
    } catch { /* sobre inservible: se saltea */ }
  }

  return huboNovedad;
}

/** Invitaciones de contacto vivas de los dos lados: las que emití y las que estoy reclamando. */
export function activeContactInvites(): ContactInvite[] {
  const todas = [...listContactInvites(), ...listPendingContactClaims()];
  const porToken = new Map(todas.map(i => [i.token, i]));
  return [...porToken.values()];
}

/** Procesa todos los buzones de invitación de contacto. `true` si hubo alguna novedad. */
export async function processAllContactInvites(deviceId: string): Promise<boolean> {
  let algo = false;
  for (const invite of activeContactInvites()) {
    if (await processContactInvite(invite, deviceId)) algo = true;
  }
  return algo;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx jest src/sync/__tests__/contactInviteEngine.test.ts`
Expected: PASS

- [ ] **Step 5: `tsc` y `lint`**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add src/sync/contactInviteEngine.ts src/sync/__tests__/contactInviteEngine.test.ts
git commit -m "feat(sync): motor de reclamo/entrega del link de contacto (T-096)"
```

---

### Task 5: Formato compacto `i`, ruta nueva y AASA/abrir.html

**Files:**
- Modify: `src/utils/linkCompacto.ts`
- Modify: `src/utils/appLink.ts:35-49` (`TIPOS_COMPACTOS`, `RUTAS_ENLAZABLES`)
- Modify: `src/sync/contactInvite.ts` (wire del formato compacto en `contactInviteToLink`/`contactInviteFromParams`/`parseContactInviteLink` — funciones nuevas de este task)
- Modify: `docs/web/.well-known/apple-app-site-association`
- Modify: `docs/web/abrir.html`
- Test: `src/utils/__tests__/linkCompacto.test.ts` (buscar el archivo real; sumar casos)
- Test: `src/__tests__/universalLinks.test.ts` (correr, no debería requerir cambios — deriva de las constantes)
- Test: `src/__tests__/paginaAbrir.test.ts` (correr, no debería requerir cambios en el test — deriva de las constantes)

**Interfaces:**
- Consumes de Task 3: `ContactInvite`, `createContactInvite` (para los tests de round-trip).
- Produces (usado por Task 6, 7): `contactInviteToLink(invite: ContactInvite): string`, `contactInviteFromParams(params: Record<string, unknown>): ContactInvite | null`, `parseContactInviteLink(link: string): ContactInvite | null` — las tres en `src/sync/contactInvite.ts`. `RUTAS_ENLAZABLES` y `TIPOS_COMPACTOS` de `src/utils/appLink.ts` pasan a incluir `'contact/claim'` e `i`.

- [ ] **Step 1: Escribir los tests que fallan — formato compacto**

Ubicar el archivo de test real de `linkCompacto.ts`:

Run: `find src/utils/__tests__ -iname "*linkCompacto*" -o -iname "*link_compacto*"`

Agregar (siguiendo el mismo estilo que ya usan los casos de `codificarInvitacion`/`decodificarInvitacion` y `codificarContacto`/`decodificarContacto` en ese archivo):

```typescript
import { codificarInvitacionDeContacto, decodificarInvitacionDeContacto } from '../linkCompacto';
import type { ContactInvite } from '@/src/sync/contactInvite';

describe('codificarInvitacionDeContacto / decodificarInvitacionDeContacto', () => {
  const invite: ContactInvite = {
    fromName: 'Ana',
    token: 'a'.repeat(64),
    inviterFingerprint: 'b'.repeat(32),
    expiresAt: 1_800_000_000_000,
  };

  it('ida y vuelta exacta', () => {
    const codigo = codificarInvitacionDeContacto(invite);
    expect(codigo).not.toBeNull();
    expect(decodificarInvitacionDeContacto(codigo!)).toEqual(invite);
  });

  it('nombre vacío también calza (a diferencia de la de grupo, el nombre puede faltar)', () => {
    const sinNombre = { ...invite, fromName: '' };
    const codigo = codificarInvitacionDeContacto(sinNombre);
    expect(codigo).not.toBeNull();
    expect(decodificarInvitacionDeContacto(codigo!)).toEqual(sinNombre);
  });

  it('un token que no es hex de 64 no calza (usa el link largo)', () => {
    expect(codificarInvitacionDeContacto({ ...invite, token: 'no-hex' })).toBeNull();
  });

  it('decodificar basura da null', () => {
    expect(decodificarInvitacionDeContacto('***')).toBeNull();
  });

  it('decodificar una versión desconocida da null', () => {
    // Se decodifica a bytes, se pisa el primer byte (versión) con un valor que
    // nunca va a ser válido, y se re-codifica — mismo mecanismo que usa el
    // archivo para probar esto en `codificarInvitacion`/`codificarContacto`
    // (buscar `aBase64Url`/`desdeBase64Url` ya importados/exportados ahí).
    const codigo = codificarInvitacionDeContacto(invite)!;
    const bytes = desdeBase64Url(codigo)!;
    const mutado = Uint8Array.from(bytes);
    mutado[0] = 99; // versión inexistente
    expect(decodificarInvitacionDeContacto(aBase64Url(mutado))).toBeNull();
  });
});
```

(`aBase64Url`/`desdeBase64Url` ya están exportadas de `linkCompacto.ts` — sumarlas al import del test junto a `codificarInvitacionDeContacto`/`decodificarInvitacionDeContacto`.)

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx jest src/utils/__tests__/linkCompacto.test.ts -t "InvitacionDeContacto"`
Expected: FAIL — las funciones no existen todavía.

- [ ] **Step 3: Implementar el formato compacto en `linkCompacto.ts`**

Agregar al comment de cabecera del archivo (después de "## Cómo reconstruirlo — invitación (`g`)") la tabla nueva:

```
 * ## Cómo reconstruirlo — invitación de contacto (`i`, T-096)
 *
 * | bytes | contenido |
 * |---|---|
 * | 1 | versión = `1` |
 * | 32 | token |
 * | 16 | huella de quien invita |
 * | 6 | vencimiento en milisegundos, entero sin signo big-endian |
 * | resto | nombre de quien invita, UTF-8 (puede ser vacío) |
```

E implementar las dos funciones, siguiendo el mismo estilo de `codificarInvitacion`/`decodificarInvitacion` ya presentes en el archivo (reusar sus helpers internos de empaquetado de enteros/UTF-8/hex — leer el archivo completo antes de escribir esto, para no duplicar un helper que ya existe con otro nombre):

Reutiliza exactamente los helpers que ya usa `codificarInvitacion`/`decodificarInvitacion` (invitación a grupo, mismo archivo): `VERSION`, `MAX_UINT48`, `MAX_CODIGO`, `esHex`, `aBase64Url`, `desdeBase64Url`, `Lector`, `fromHex`/`toHex` (de `@/src/sync/hexBytes`, ya importados en el archivo), `utf8Bytes`/`utf8FromBytes`, `limpiarNombre`/`esNombreSeguro` (de `@/src/utils/nombreSeguro`, ya importados). Sin byte de flags — a diferencia de `c`/`g`, acá nada es opcional (token y huella siempre están):

```typescript
export function codificarInvitacionDeContacto(inv: ContactInvite): string | null {
  if (!esHex(inv.token, 32) || !esHex(inv.inviterFingerprint, 16)) return null;
  if (!Number.isInteger(inv.expiresAt) || inv.expiresAt < 0 || inv.expiresAt > MAX_UINT48) return null;

  const cuerpo: number[] = [...fromHex(inv.token), ...fromHex(inv.inviterFingerprint)];

  // 6 bytes big-endian sin operadores de bits: `<<` en JS trunca a 32 bits
  // (mismo motivo que en `codificarInvitacion`).
  let e = inv.expiresAt;
  const vence = new Array<number>(6);
  for (let i = 5; i >= 0; i--) { vence[i] = e % 256; e = Math.floor(e / 256); }
  cuerpo.push(...vence, ...utf8Bytes(limpiarNombre(inv.fromName ?? '')));

  const codigo = aBase64Url(Uint8Array.from([VERSION, ...cuerpo]));
  // Garantía 1 del encabezado: nunca se entrega un código que no se pueda leer.
  return decodificarInvitacionDeContacto(codigo) ? codigo : null;
}

export function decodificarInvitacionDeContacto(codigo: string): ContactInvite | null {
  if (codigo.length > MAX_CODIGO) return null;
  const bytes = desdeBase64Url(codigo);
  if (!bytes || bytes.length < 1 + 32 + 16 + 6) return null;
  try {
    const r = new Lector(bytes);
    if (r.byte() !== VERSION) return null;
    const token = toHex(r.bytes(32));
    const inviterFingerprint = toHex(r.bytes(16));
    let expiresAt = 0;
    for (const b of r.bytes(6)) expiresAt = expiresAt * 256 + b;
    const fromName = utf8FromBytes(r.resto());
    if (fromName !== '' && !esNombreSeguro(fromName)) return null;

    return { fromName, token, inviterFingerprint, expiresAt };
  } catch {
    return null;
  }
}
```

Sumar el import de `ContactInvite` al tope del archivo: `import type { ContactInvite } from '@/src/sync/contactInvite';` (junto al `import type { GroupInvite } from '@/src/sync/groupInvite';` ya existente).

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx jest src/utils/__tests__/linkCompacto.test.ts`
Expected: PASS

- [ ] **Step 5: Sumar la ruta y el tipo compacto en `appLink.ts`**

En `src/utils/appLink.ts`:

```typescript
export const TIPOS_COMPACTOS = { c: 'contact/add', g: 'groups/join', i: 'contact/claim' } as const;
```

```typescript
export const RUTAS_ENLAZABLES = ['contact/add', 'groups/join', 'contact/claim'] as const;
```

- [ ] **Step 6: Wire del formato compacto en `contactInvite.ts`**

Agregar a `src/sync/contactInvite.ts` (importar `codificarInvitacionDeContacto, decodificarInvitacionDeContacto` de `@/src/utils/linkCompacto`, y `enlaceCompacto, enlaceCompartible, rutaDeEnlace` de `@/src/utils/appLink`):

```typescript
import { enlaceCompacto, enlaceCompartible, rutaDeEnlace } from '@/src/utils/appLink';
import { codificarInvitacionDeContacto, decodificarInvitacionDeContacto } from '@/src/utils/linkCompacto';

/** Link para compartir por cualquier canal. Compacto si calza; si no, el largo. */
export function contactInviteToLink(invite: ContactInvite): string {
  const codigo = codificarInvitacionDeContacto(invite);
  if (codigo) return enlaceCompacto('i', codigo);

  const params = new URLSearchParams({
    n: invite.fromName,
    t: invite.token,
    f: invite.inviterFingerprint,
    e: String(invite.expiresAt),
  });
  return enlaceCompartible('contact/claim', params);
}

export function contactInviteFromParams(params: Record<string, unknown>): ContactInvite | null {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;

  const codigo = str(params.c);
  if (codigo !== undefined) return decodificarInvitacionDeContacto(codigo);

  const token = str(params.t), expiresAt = str(params.e);
  if (!token || !expiresAt) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(token)) return null;
  if (!/^\d{1,15}$/.test(expiresAt) || Number(expiresAt) > 2 ** 48 - 1) return null;
  const inviterFingerprint = str(params.f) ?? '';
  if (inviterFingerprint !== '' && !/^[0-9a-fA-F]{32}$/.test(inviterFingerprint)) return null;
  const fromName = str(params.n) ?? '';

  return { fromName, token, inviterFingerprint, expiresAt: Number(expiresAt) };
}

export function parseContactInviteLink(link: string): ContactInvite | null {
  const r = rutaDeEnlace(link);
  if (!r || r.ruta !== 'contact/claim') return null;
  return contactInviteFromParams(Object.fromEntries(r.params.entries()));
}
```

(Validar `fromName` con `esNombreSeguro`/`limpiarNombre` de `@/src/utils/nombreSeguro`, igual que hace `inviteFromParams`/`inviteToLink` con `groupName` — sumar el import y aplicar el mismo patrón: `limpiarNombre` al construir el link largo, `esNombreSeguro` al parsear.)

- [ ] **Step 7: Test directo de `contactInviteToLink`/`parseContactInviteLink`**

Sumar a `src/sync/__tests__/contactInvite.test.ts` (de Task 3):

```typescript
import { contactInviteToLink, parseContactInviteLink } from '../contactInvite';

describe('contactInviteToLink / parseContactInviteLink', () => {
  it('ida y vuelta, formato compacto', () => {
    const invite = createContactInvite('Ana', generateIdentity().publicKey, 1000);
    const link = contactInviteToLink(invite);
    expect(link).toContain('#i');
    const parsed = parseContactInviteLink(link);
    expect(parsed).toEqual(invite);
  });

  it('el link NUNCA contiene el secreto permanente de una cuenta (64 hex chars fuera del token)', () => {
    const invite = createContactInvite('Ana', generateIdentity().publicKey, 1000);
    const link = contactInviteToLink(invite);
    // El único bloque hex de 64 chars que puede aparecer es el token mismo.
    const hex64 = link.match(/[0-9a-f]{64}/gi) ?? [];
    expect(hex64.filter(h => h.toLowerCase() !== invite.token.toLowerCase())).toEqual([]);
  });
});
```

- [ ] **Step 8: Correr y verificar que pasan**

Run: `npx jest src/sync/__tests__/contactInvite.test.ts src/utils/__tests__/linkCompacto.test.ts`
Expected: PASS

- [ ] **Step 9: AASA y `abrir.html`**

En `docs/web/.well-known/apple-app-site-association`, agregar un componente nuevo al array `components` del primer (único) detail, con el mismo `"/": "/"` que los existentes y `"#": "i*"` y `"#": "contact/claim*"` (dos componentes nuevos, uno por cada entrada que generan `TIPOS_COMPACTOS`/`RUTAS_ENLAZABLES` — mirar el archivo real para copiar el formato exacto de los componentes existentes).

En `docs/web/abrir.html`:

```javascript
  var RUTAS = ['contact/add', 'groups/join', 'contact/claim'];
```
```javascript
  var TIPOS = { c: 'contact/add', g: 'groups/join', i: 'contact/claim' };
```

Y sumar la entrada de textos a los tres bloques `T` (es/en/pt, líneas ~105, ~118, ~131):

```javascript
      'contact/claim': ['Te invitan a agregarte como contacto', 'Abrí el link en spendApp para agregar a esta persona.'],
```
```javascript
      'contact/claim': ["You've been invited to add a contact", 'Open the link in spendApp to add this person.'],
```
```javascript
      'contact/claim': ['Te convidaram para adicionar um contato', 'Abra o link no spendApp para adicionar esta pessoa.'],
```

- [ ] **Step 10: Correr los tests que verifican consistencia AASA/abrir.html/appLink**

Run: `npx jest src/__tests__/universalLinks.test.ts src/__tests__/paginaAbrir.test.ts`
Expected: PASS — estos tests derivan sus valores esperados de `RUTAS_ENLAZABLES`/`TIPOS_COMPACTOS`, así que no necesitan tocarse: sólo van a fallar si el AASA o `abrir.html` quedaron desincronizados con `appLink.ts`.

- [ ] **Step 11: `tsc` y `lint`**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 12: Correr toda la suite de links para descartar regresiones cruzadas**

Run: `npx jest src/utils/__tests__/appLink.test.ts src/utils/__tests__/intencionNativa.test.ts 2>/dev/null; npx jest -t "enlace"`
Expected: PASS (si `appLink.test.ts`/`intencionNativa.test.ts` no existen con ese nombre exacto, `find src -iname "*appLink*test*" -o -iname "*intencionNativa*test*"` y correr los reales).

- [ ] **Step 13: Commit**

```bash
git add src/utils/linkCompacto.ts src/utils/appLink.ts src/sync/contactInvite.ts \
        docs/web/.well-known/apple-app-site-association docs/web/abrir.html \
        src/utils/__tests__/linkCompacto.test.ts src/sync/__tests__/contactInvite.test.ts
git commit -m "feat(links): formato compacto y ruta contact/claim para el link de contacto (T-096)"
```

---

### Task 6: Pantalla `app/contact/claim.tsx`

**Files:**
- Create: `app/contact/claim.tsx`
- Modify: `src/i18n/locales/es.json`, `en.json`, `pt.json` (namespace nuevo `contact.claim`)
- Test: `src/screens/__tests__/contactClaim.test.tsx`

**Interfaces:**
- Consumes de Task 3/4/5: `ContactInvite`, `contactInviteFromParams`, `isContactInviteExpired` (`src/sync/contactInvite.ts`); `publishContactClaim`, `processContactInvite` (`src/sync/contactInviteEngine.ts`).
- Consumes ya existentes: `deviceId`, `startRelay` (`src/sync/relayEngine.ts`); `esYo` (`src/store/identityAlias.ts`); `shortFingerprint` (`src/utils/keyFingerprint.ts`).
- Produces: pantalla terminal — nada que otra tarea de este plan consuma directamente (Task 7 sólo necesita que la RUTA exista, ya resuelto en Task 5).

- [ ] **Step 1: Escribir el test que falla**

Crear `src/screens/__tests__/contactClaim.test.tsx`, siguiendo el patrón de mocking de `useLocalSearchParams`/stores que ya usa `src/screens/__tests__/contactAddCierra.test.tsx` (leerlo primero):

```typescript
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ContactClaimScreen from '@/app/contact/claim';
// ... mocks de expo-router (useLocalSearchParams, router), useAuthStore,
//     src/sync/contactInviteEngine (publishContactClaim, processContactInvite),
//     src/sync/relayEngine (deviceId, startRelay) ...

it('muestra el nombre de quien comparte y la huella antes de aceptar', () => {
  // params: n=Ana, t=<64 hex>, f=<32 hex>, e=<epoch futuro>
  const { getByText } = render(<ContactClaimScreen />);
  expect(getByText(/Ana/)).toBeTruthy();
});

it('al tocar Agregar, publica el reclamo y queda esperando', async () => {
  // mock publishContactClaim -> resuelve true; processContactInvite -> resuelve false siempre
  const { getByText } = render(<ContactClaimScreen />);
  fireEvent.press(getByText(/Agregar/i));
  await waitFor(() => expect(getByText(/pendiente|esperando/i)).toBeTruthy());
});

it('si el grant llega mientras se espera, muestra éxito', async () => {
  // mock processContactInvite -> primera llamada false, segunda true
  const { getByText } = render(<ContactClaimScreen />);
  fireEvent.press(getByText(/Agregar/i));
  await waitFor(() => expect(getByText(/agregad/i)).toBeTruthy());
});

it('link vencido muestra el estado de vencido, no el de aceptar', () => {
  // params con e=epoch pasado
  const { getByText } = render(<ContactClaimScreen />);
  expect(getByText(/venci/i)).toBeTruthy();
});

it('link inválido (sin token) muestra el estado de inválido', () => {
  const { getByText } = render(<ContactClaimScreen />);
  expect(getByText(/inválid/i)).toBeTruthy();
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx jest src/screens/__tests__/contactClaim.test.tsx`
Expected: FAIL — el módulo `@/app/contact/claim` no existe.

- [ ] **Step 3: Sumar las claves de i18n**

En `es.json`, namespace nuevo `contact.claim` (junto al resto de `contact`, como un objeto anidado):

```json
"claim": {
  "invalid_title": "Link inválido",
  "invalid_body": "Este link de contacto está incompleto o mal copiado. Pedile a quien te lo mandó que te lo mande de nuevo.",
  "expired_title": "El link venció",
  "expired_body": "Estos links duran 48 horas. Pedile a quien te lo mandó que comparta uno nuevo.",
  "need_login_title": "Iniciá sesión primero",
  "need_login_body": "Entrá con tu cuenta y volvé a abrir el link para agregar el contacto.",
  "intro": "{{name}} te invita a agregarse como contacto.",
  "inviter_fingerprint": "Huella: {{fingerprint}}",
  "accept": "Agregar",
  "waiting_key": "Esperando confirmación…",
  "added_title": "Contacto agregado",
  "added_body": "Ya tenés a {{name}} en tus contactos.",
  "pending_title": "Tu pedido quedó enviado",
  "pending_body": "Falta que {{name}} abra la app para confirmar. Cuando pase, el contacto te va a aparecer solo."
}
```

En `en.json`:

```json
"claim": {
  "invalid_title": "Invalid link",
  "invalid_body": "This contact link is incomplete or was copied wrong. Ask whoever sent it to send it again.",
  "expired_title": "The link expired",
  "expired_body": "These links last 48 hours. Ask whoever sent it to share a new one.",
  "need_login_title": "Sign in first",
  "need_login_body": "Sign in with your account and reopen the link to add the contact.",
  "intro": "{{name}} is inviting you to add them as a contact.",
  "inviter_fingerprint": "Fingerprint: {{fingerprint}}",
  "accept": "Add",
  "waiting_key": "Waiting for confirmation…",
  "added_title": "Contact added",
  "added_body": "You now have {{name}} in your contacts.",
  "pending_title": "Your request was sent",
  "pending_body": "It's waiting for {{name}} to open the app to confirm. When that happens, the contact will just show up."
}
```

En `pt.json`:

```json
"claim": {
  "invalid_title": "Link inválido",
  "invalid_body": "Este link de contato está incompleto ou foi copiado errado. Peça para quem te mandou enviar de novo.",
  "expired_title": "O link venceu",
  "expired_body": "Esses links duram 48 horas. Peça para quem te mandou compartilhar um novo.",
  "need_login_title": "Entre primeiro",
  "need_login_body": "Entre com sua conta e reabra o link para adicionar o contato.",
  "intro": "{{name}} está te convidando para se adicionar como contato.",
  "inviter_fingerprint": "Impressão: {{fingerprint}}",
  "accept": "Adicionar",
  "waiting_key": "Esperando confirmação…",
  "added_title": "Contato adicionado",
  "added_body": "Agora você tem {{name}} nos seus contatos.",
  "pending_title": "Seu pedido foi enviado",
  "pending_body": "Falta {{name}} abrir o app para confirmar. Quando isso acontecer, o contato vai aparecer sozinho."
}
```

- [ ] **Step 4: Implementar `app/contact/claim.tsx`**

Mirror casi directo de `app/groups/join.tsx` — mismos estados (`listo`/`entrando`/`entre`/`esperando`), mismo patrón de espera con reintento, pero contra `ContactInvite`/`publishContactClaim`/`processContactInvite`:

```typescript
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Colors } from '@/src/constants/colors';
import { Radius, Spacing } from '@/src/constants/spacing';
import { Typography } from '@/src/constants/typography';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/src/store/authStore';
import { hapticLight, hapticSuccess } from '@/src/utils/haptics';
import { contactInviteFromParams, isContactInviteExpired } from '@/src/sync/contactInvite';
import { publishContactClaim, processContactInvite } from '@/src/sync/contactInviteEngine';
import { deviceId, startRelay } from '@/src/sync/relayEngine';
import { shortFingerprint } from '@/src/utils/keyFingerprint';

/**
 * Pantalla que recibe el link de contacto por invitación (T-096 · ADR-015):
 * `spendapp://contact/claim?...`. Mismo patrón que `app/groups/join.tsx`: no
 * es instantáneo, porque el secreto real recién llega cuando quien compartió
 * el link procesa mi reclamo — puede tener la app cerrada.
 */

const ESPERA_MS = 25_000;
const REINTENTO_MS = 3_000;

type Estado = 'listo' | 'entrando' | 'entre' | 'esperando';

export default function ContactClaimScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { t } = useTranslation();

  const params = useLocalSearchParams();
  const currentUser = useAuthStore(s => s.currentUser);

  const invite = useMemo(() => contactInviteFromParams(params as Record<string, unknown>), [params]);
  const [estado, setEstado] = useState<Estado>('listo');
  const vivo = useRef(true);

  useEffect(() => () => { vivo.current = false; }, []);

  async function handleAdd() {
    if (!invite || estado !== 'listo') return;
    hapticLight();
    setEstado('entrando');

    await publishContactClaim(invite, deviceId());
    void startRelay();

    const limite = Date.now() + ESPERA_MS;
    while (vivo.current && Date.now() < limite) {
      const huboNovedad = await processContactInvite(invite, deviceId());
      if (huboNovedad) {
        if (!vivo.current) return;
        hapticSuccess();
        setEstado('entre');
        return;
      }
      await new Promise(r => setTimeout(r, REINTENTO_MS));
    }

    if (vivo.current) setEstado('esperando');
  }

  function cerrar() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/friends');
  }

  const contenido = () => {
    if (!invite) return mensaje('alert-circle-outline', c.semantic.error, t('contact.claim.invalid_title'), t('contact.claim.invalid_body'));
    if (isContactInviteExpired(invite)) return mensaje('time-outline', c.semantic.error, t('contact.claim.expired_title'), t('contact.claim.expired_body'));
    if (!currentUser) return mensaje('person-outline', c.textSecondary, t('contact.claim.need_login_title'), t('contact.claim.need_login_body'));

    if (estado === 'entre') {
      return (
        <>
          {mensaje('checkmark-circle-outline', c.semantic.positive, t('contact.claim.added_title'), t('contact.claim.added_body', { name: invite.fromName }))}
          <Pressable accessibilityRole="button" onPress={cerrar} style={[styles.cta, { backgroundColor: c.brand.primary }]}>
            <Text style={[Typography.bodyM, styles.ctaText]}>{t('common.close')}</Text>
          </Pressable>
        </>
      );
    }

    if (estado === 'esperando') {
      return (
        <>
          {mensaje('hourglass-outline', c.textSecondary, t('contact.claim.pending_title'), t('contact.claim.pending_body', { name: invite.fromName }))}
          <Pressable accessibilityRole="button" onPress={cerrar} style={[styles.cta, { backgroundColor: c.brand.primary }]}>
            <Text style={[Typography.bodyM, styles.ctaText]}>{t('common.close')}</Text>
          </Pressable>
        </>
      );
    }

    return (
      <>
        <View style={[styles.icon, { backgroundColor: c.brand.primary + '1A' }]}>
          <Ionicons name="person-add-outline" size={32} color={c.brand.primary} />
        </View>
        <Text style={[Typography.h2, styles.centro, { color: c.text }]}>
          {t('contact.claim.intro', { name: invite.fromName })}
        </Text>
        {invite.inviterFingerprint !== '' && (
          <Text style={[Typography.caption, styles.centro, { color: c.textSecondary }]}>
            {t('contact.claim.inviter_fingerprint', { fingerprint: shortFingerprint(invite.inviterFingerprint) })}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={estado === 'entrando'}
          onPress={handleAdd}
          style={[styles.cta, { backgroundColor: c.brand.primary, opacity: estado === 'entrando' ? 0.6 : 1 }]}
        >
          {estado === 'entrando'
            ? <ActivityIndicator color="#fff" />
            : <Text style={[Typography.bodyM, styles.ctaText]}>{t('contact.claim.accept')}</Text>}
        </Pressable>

        {estado === 'entrando' && (
          <Text style={[Typography.caption, styles.centro, { color: c.textSecondary }]}>
            {t('contact.claim.waiting_key')}
          </Text>
        )}
      </>
    );
  };

  function mensaje(icon: keyof typeof Ionicons.glyphMap, color: string, titulo: string, cuerpo: string) {
    return (
      <>
        <View style={[styles.icon, { backgroundColor: color + '1A' }]}>
          <Ionicons name={icon} size={32} color={color} />
        </View>
        <Text style={[Typography.h3, styles.centro, { color: c.text }]}>{titulo}</Text>
        <Text style={[Typography.bodyS, styles.centro, { color: c.textSecondary }]}>{cuerpo}</Text>
      </>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={cerrar} hitSlop={12} accessibilityRole="button">
          <Ionicons name="close" size={24} color={c.text} />
        </Pressable>
      </View>
      <View style={styles.body}>{contenido()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  header:  { paddingHorizontal: Spacing.screenPad, height: 52, justifyContent: 'center' },
  body:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing[3], paddingHorizontal: Spacing[7] },
  icon:    { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  centro:  { textAlign: 'center' },
  cta:     {
    marginTop: Spacing[5], height: 52, paddingHorizontal: Spacing[7],
    borderRadius: Radius.lg, minWidth: 200,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx jest src/screens/__tests__/contactClaim.test.tsx`
Expected: PASS

- [ ] **Step 6: `tsc` y `lint`**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add app/contact/claim.tsx src/i18n/locales/es.json src/i18n/locales/en.json src/i18n/locales/pt.json \
        src/screens/__tests__/contactClaim.test.tsx
git commit -m "feat(ui): pantalla de reclamo del link de contacto (T-096)"
```

---

### Task 7: Enganchar "Compartir" y el motor de sync

**Files:**
- Modify: `app/contact/add.tsx` (construcción de `deepLink`)
- Modify: `src/utils/contactLink.ts` (borrar `buildContactDeepLink`, ya no se usa)
- Modify: `src/sync/relayEngine.ts` (enganchar `processAllContactInvites` en `doStartRelay` y `releerTodo`)
- Test: `src/screens/__tests__/contactAddCierra.test.tsx` o el que corresponda a `app/contact/add.tsx` (ajustar el caso del link compartido)
- Test: `src/utils/__tests__/contactLink.test.ts` (borrar los casos de `buildContactDeepLink`)
- Test: `src/sync/__tests__/relayEngine.test.ts` (sumar caso)

**Interfaces:**
- Consumes de Task 3/4: `createContactInvite` (`src/sync/contactInvite.ts`), `contactInviteToLink` (Task 5, mismo archivo), `processAllContactInvites` (`src/sync/contactInviteEngine.ts`).
- Produces: nada — última tarea funcional del plan.

- [ ] **Step 1: Ubicar y leer los tests existentes que van a cambiar**

Run: `grep -rln "buildContactDeepLink" src app --include="*.ts*"`

Leer cada archivo encontrado antes de tocar nada (probablemente `app/contact/add.tsx`, `src/utils/contactLink.ts`, y sus tests).

- [ ] **Step 2: Escribir el test que falla — `add.tsx` comparte un link de invitación, no el secreto**

En el test de `app/contact/add.tsx` (buscar el archivo real con `find src/screens/__tests__ app -iname "*contact*add*test*"`), agregar o ajustar el caso del botón "Compartir":

```typescript
it('el link de "Compartir" no lleva el secreto permanente de la cuenta', async () => {
  // mock de createContactInvite -> devuelve un ContactInvite fijo con token conocido
  // mock de Share.share para capturar el mensaje
  const { getByTestId } = render(<AddContactScreen />); // o el trigger real del share button
  fireEvent.press(/* botón compartir */);
  await waitFor(() => expect(Share.share).toHaveBeenCalled());
  const mensaje = (Share.share as jest.Mock).mock.calls[0][0].message as string;
  expect(mensaje).not.toContain(ensureContactSecret()); // el secreto real NUNCA aparece
  expect(mensaje).toContain('#i'); // formato compacto del link de invitación
});
```

Adaptar el mock exacto de `Share`/testID al patrón que ya use el archivo real (`app/contact/add.tsx` usa `Share.share` de `react-native`, y probablemente el test ya lo mockea para el caso existente de compartir — reusar ese mock).

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx jest <archivo del test> -t "no lleva el secreto"`
Expected: FAIL — hoy `deepLink` sí lleva el secreto.

- [ ] **Step 4: Cambiar `app/contact/add.tsx`**

Importar `createContactInvite` de `@/src/sync/contactInvite` y `contactInviteToLink` (mismo módulo, de Task 5) en vez de `buildContactDeepLink` de `@/src/utils/contactLink` (sacar ese import de la línea 24, que también importa `buildContactPayload, parseContactPayload, contactFromParams, parseContactLink` — dejar esos tres, que siguen usándose para el QR y para el parseo de links viejos por compatibilidad hacia atrás).

Cambiar (línea ~77-78):

```typescript
  const myQRData  = currentUser ? buildContactPayload(currentUser, misClaves) : '';
  const deepLink  = currentUser
    ? contactInviteToLink(createContactInvite(currentUser.name, ensureIdentity().publicKey))
    : '';
```

(`ensureIdentity` ya está importado en el archivo — de `@/src/store/identityStore`.)

**Nota de compatibilidad hacia atrás:** `parseContactLink`/`contactFromParams` (el parseo de links VIEJOS, con el secreto embebido) se dejan sin tocar — alguien que ya haya compartido un link viejo antes de este cambio tiene que poder seguir abriéndolo. Sólo la GENERACIÓN de links nuevos cambia. `buildContactDeepLink` (que sólo generaba, nunca parseaba) queda sin ningún llamador después de este cambio.

- [ ] **Step 5: Borrar `buildContactDeepLink` de `contactLink.ts`**

En `src/utils/contactLink.ts`, borrar la función `buildContactDeepLink` completa (líneas ~68-82) — queda muerta tras el Step 4. `parseContactLink`/`contactFromParams`/`buildContactPayload`/`parseContactPayload` quedan sin cambios.

En su archivo de test (`src/utils/__tests__/contactLink.test.ts` o el nombre real), borrar los casos que prueben `buildContactDeepLink` — buscarlos con `grep -n "buildContactDeepLink"` en ese archivo antes de borrar, para no llevarse de más.

- [ ] **Step 6: Correr el test de `add.tsx` y verificar que pasa**

Run: `npx jest <archivo del test de add.tsx>`
Expected: PASS

- [ ] **Step 7: Escribir el test que falla — motor de sync procesa contact invites**

En `src/sync/__tests__/relayEngine.test.ts` (buscar el archivo real: `find src/sync/__tests__ -iname "*relayEngine*"`), sumar:

```typescript
it('doStartRelay procesa las invitaciones de contacto pendientes', async () => {
  // mock de processAllContactInvites (jest.mock('../contactInviteEngine'))
  // ... arrancar el relay (startRelay()) con el resto de las dependencias mockeadas
  // como ya hace el archivo para processAllInvites ...
  await startRelay();
  expect(processAllContactInvitesMock).toHaveBeenCalled();
});
```

Adaptar exactamente al patrón de mocking que el archivo real ya usa para `processAllInvites` — mismo `jest.mock` shape, mismo setup de dependencias (`isRelayConfigured`, etc.).

- [ ] **Step 8: Correr y verificar que falla**

Run: `npx jest src/sync/__tests__/relayEngine.test.ts -t "invitaciones de contacto"`
Expected: FAIL

- [ ] **Step 9: Enganchar en `relayEngine.ts`**

Importar `processAllContactInvites` de `@/src/sync/contactInviteEngine` (sumar al import existente de `./inviteEngine` en la línea de arriba, o una línea nueva).

En `doStartRelay` (línea ~322), junto a la resolución de invitaciones de grupo:

```typescript
  const adoptados = await processAllInvites(deviceId()).catch(() => [] as string[]);
  await processAllContactInvites(deviceId()).catch(() => false);
```

En `releerTodo` (línea ~380-384):

```typescript
async function releerTodo(): Promise<void> {
  try {
    await drainContactsNow();
    await drainAll();
    await processAllContactInvites(deviceId());
  } catch { /* offline: se reintenta en la próxima vuelta */ }
}
```

- [ ] **Step 10: Correr y verificar que pasa**

Run: `npx jest src/sync/__tests__/relayEngine.test.ts`
Expected: PASS

- [ ] **Step 11: Suite completa, `tsc` y `lint`**

Run: `npx jest && npx tsc --noEmit && npm run lint`
Expected: todo verde, sin regresiones sobre la base conocida (124 warnings / 0 errores al momento de escribir este plan — reverificar contra `main` real).

- [ ] **Step 12: Commit**

```bash
git add app/contact/add.tsx src/utils/contactLink.ts src/sync/relayEngine.ts \
        src/screens/__tests__/ src/utils/__tests__/contactLink.test.ts src/sync/__tests__/relayEngine.test.ts
git commit -m "feat(sync): enganchar el link de contacto por invitación en Compartir y en el motor de sync (T-096)"
```

---

## Nota final para quien ejecute este plan (SDD)

Al terminar todas las tareas, antes del review final de rama completa:
- Verificar en `docs/web/abrir.html` que las tres i18n (es/en/pt) del texto `contact/claim` coinciden con el tono de las otras dos entradas (`contact/add`, `groups/join`) ya presentes en el mismo archivo.
- El sitio publicado (`spendapp.github.io`) NO se republica automáticamente — si este plan se mergea a `main`, republicar `docs/web/` es una escritura externa aparte (mismo script `scripts/publicar-sitio.sh` que usó T-097), y corresponde preguntarle al PO antes de correrlo, igual que se hizo en T-097.
- Este ticket está scopeado explícitamente como "antes del lanzamiento público, no de la beta" (backlog, `engram/03_backlog.md`) — no hace falta apurar el merge a `main` si la sesión que lo ejecuta es parte del trabajo pre-beta; confirmar con el orquestador/PO el momento de merge si no es obvio por el contexto de la sesión.
