import fs from 'fs';
import path from 'path';
import {
  CORE_VERSION, coreOf, canonicalCore, coreFieldsOf, slotsOf, CORE_KINDS,
} from '../recordCore';
import { canonical } from '@/src/store/lww';
import { EXPENSE, PAYMENT, RECURRING, GROUP, COMMENT, FIXTURES } from '@/src/test-utils/recordFixtures';

/**
 * S1 de T-041: qué se firma exactamente.
 *
 * El núcleo se enumera campo por campo, nunca "todo menos X". El §1 del §QUÉ da
 * la razón y es la que gobierna todo este archivo: el día que alguien agregue un
 * campo al modelo, las firmas viejas tienen que seguir validando. Con "todo
 * menos X" dejarían de validar EN SILENCIO.
 */

// ── Determinismo de la serialización ────────────────────────────────────────

describe('canonical() — serialización determinista', () => {
  it('dos objetos con las mismas claves en distinto orden firman igual', () => {
    const a = { z: 1, a: 2, m: { y: 3, b: 4 } };
    const b = { m: { b: 4, y: 3 }, a: 2, z: 1 };
    expect(canonical(a)).toBe(canonical(b));
  });

  it('un campo ausente y uno presente-como-undefined dan lo mismo', () => {
    expect(canonical({ a: 1 })).toBe(canonical({ a: 1, b: undefined }));
  });

  it('distinto contenido da distinto canónico', () => {
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it('el mismo registro con las claves en otro orden produce el mismo núcleo', () => {
    const alReves = Object.fromEntries(Object.entries(EXPENSE).reverse());
    expect(canonicalCore('expense', alReves as never))
      .toBe(canonicalCore('expense', EXPENSE));
  });
});

// ── El núcleo lleva versión y entidad ───────────────────────────────────────

describe('el payload firmado se identifica a sí mismo', () => {
  it('lleva la versión que congela el algoritmo', () => {
    expect(coreOf('expense', EXPENSE).v).toBe(CORE_VERSION);
  });

  /**
   * Sin la entidad adentro, un núcleo de `Payment` con los mismos valores que
   * uno de `Expense` produciría el mismo mensaje firmado y una firma valdría
   * para los dos. Es la misma clase de agujero que `zip215:false` cierra en la
   * curva ("una firma válida para dos transacciones"), pero en la capa de
   * arriba.
   */
  it('lleva la entidad, así una firma no vale para otra entidad', () => {
    const mismosCampos = { id: 'x', createdAt: 1, createdById: 'ana', rev: 2 };
    expect(canonicalCore('group', mismosCampos as never))
      .not.toBe(canonicalCore('expense', mismosCampos as never));
  });
});

// ── Qué entra y qué queda afuera, entidad por entidad ───────────────────────

describe('el núcleo de cada entidad', () => {
  it('Expense: plata, autoría y contenido del autor', () => {
    expect([...coreFieldsOf('expense')].sort()).toEqual([
      'amount', 'category', 'createdAt', 'createdById', 'currency', 'date',
      'description', 'groupId', 'id', 'note', 'paidById', 'payers', 'rev',
      'splitMode', 'splits',
    ]);
  });

  /** C.1e: el §1 se olvidó `note`. Es contenido del autor y nadie más lo escribe. */
  it('Payment: incluye `note`, que el §QUÉ había olvidado', () => {
    expect(coreFieldsOf('payment')).toContain('note');
    expect([...coreFieldsOf('payment')].sort()).toEqual([
      'amount', 'createdAt', 'createdById', 'currency', 'date', 'exchangeRate',
      'fromUserId', 'groupId', 'id', 'note', 'rev', 'targetCurrency', 'toUserId',
    ]);
  });

  it('ExpenseComment', () => {
    expect([...coreFieldsOf('comment')].sort()).toEqual([
      'authorId', 'createdAt', 'expenseId', 'id', 'rev', 'text',
    ]);
  });

  /**
   * C.1f: `lastMaterializedAt` lo escribe CUALQUIER device al materializar
   * (`materializeRecurring.ts` → `session.ts`). Adentro del núcleo, la primera
   * materialización de un tercero invalidaría la firma del autor.
   */
  it('RecurringExpense: `lastMaterializedAt` queda AFUERA', () => {
    expect(coreFieldsOf('recurring')).not.toContain('lastMaterializedAt');
    expect([...coreFieldsOf('recurring')].sort()).toEqual([
      'amount', 'category', 'createdAt', 'createdById', 'currency',
      'description', 'groupId', 'id', 'isActive', 'memberIds', 'paidById',
      'payers', 'rev', 'rule', 'splitMode', 'splitValues',
    ]);
  });

  /** §1/§8: la membresía no la puede firmar una sola persona. Ticket aparte. */
  it('Group: sólo la creación', () => {
    expect([...coreFieldsOf('group')].sort())
      .toEqual(['createdAt', 'createdById', 'id', 'rev']);
  });

  it.each(FIXTURES)('$kind: lo colaborativo queda afuera', ({ kind, record }) => {
    const fuera = ['updatedAt', 'isDeleted', 'deletionVotes', 'leaveRequest', 'receiptImageUri', 'k', 's'];
    for (const campo of fuera) {
      if (campo in record) expect(coreFieldsOf(kind)).not.toContain(campo);
    }
  });
});

// ── El guard de enumeración ─────────────────────────────────────────────────

/**
 * Extrae los campos declarados en `models.ts` LEYENDO EL ARCHIVO.
 *
 * Podría hacerse con tipos (`Record<keyof Expense, Slot>` ya obliga a
 * clasificar en tiempo de compilación) pero eso no es un test: `npx tsc` y
 * `npx jest` los corre gente distinta en momentos distintos. Acá el guard tiene
 * que fallar EN LA SUITE cuando alguien agrega un campo y no lo clasifica.
 */
function camposDeclarados(iface: string): string[] {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'types', 'models.ts'), 'utf8',
  );
  const cabecera = new RegExp(`export interface ${iface}\\b([^{]*)\\{`);
  const m = cabecera.exec(src);
  if (!m) throw new Error(`no encontré la interfaz ${iface} en models.ts`);

  const desde = m.index + m[0].length;
  const fin = src.indexOf('\n}', desde);
  if (fin < 0) throw new Error(`no encontré el cierre de ${iface}`);

  const cuerpo = src.slice(desde, fin)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const propios = [...cuerpo.matchAll(/^\s*([A-Za-z_]\w*)\??\s*:/gm)].map(x => x[1]!);

  const heredados = (m[1] ?? '')
    .replace('extends', '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .flatMap(camposDeclarados);

  return [...new Set([...heredados, ...propios])];
}

const DECLARADOS: Record<string, string> = {
  expense: 'Expense', payment: 'Payment', comment: 'ExpenseComment',
  recurring: 'RecurringExpense', group: 'Group',
};

describe('guard de enumeración: ningún campo del modelo queda sin clasificar', () => {
  /**
   * Un parser que no encuentra nada convierte el guard en decoración. Antes de
   * usarlo se verifica que ve lo que tiene que ver.
   */
  it('el parser lee models.ts de verdad', () => {
    const campos = camposDeclarados('Expense');
    expect(campos).toEqual(expect.arrayContaining([
      'id', 'updatedAt', 'isDeleted', 'amount', 'splits', 'deletionVotes', 'note',
    ]));
    expect(campos.length).toBeGreaterThan(15);
    expect(camposDeclarados('Group')).toContain('deletionMode');
  });

  it.each(CORE_KINDS)('%s: cada campo está adentro o afuera, explícito', (kind) => {
    const clasificados = Object.keys(slotsOf(kind));
    const sinClasificar = camposDeclarados(DECLARADOS[kind]!)
      .filter(c => !clasificados.includes(c));

    expect(sinClasificar).toEqual([]);
  });

  it.each(CORE_KINDS)('%s: no se clasifica nada que el modelo no tenga', (kind) => {
    const declarados = camposDeclarados(DECLARADOS[kind]!);
    const fantasmas = Object.keys(slotsOf(kind)).filter(c => !declarados.includes(c));

    expect(fantasmas).toEqual([]);
  });
});

// ── coreOf sólo mira el núcleo ──────────────────────────────────────────────

describe('coreOf ignora lo que no clasificó como núcleo', () => {
  it.each(FIXTURES)('$kind: tocar un campo de afuera no mueve el canónico', ({ kind, record }) => {
    const fuera = Object.entries(slotsOf(kind))
      .filter(([, slot]) => slot === 'fuera')
      .map(([campo]) => campo);

    expect(fuera.length).toBeGreaterThan(0);
    for (const campo of fuera) {
      const tocado = { ...record, [campo]: 'lo-que-sea' };
      expect(canonicalCore(kind, tocado as never)).toBe(canonicalCore(kind, record as never));
    }
  });

  it('un núcleo sin `rev` no incluye la clave (no la inventa en 0)', () => {
    const sinRev = { ...PAYMENT, rev: undefined };
    expect('rev' in coreOf('payment', sinRev as never)).toBe(false);
  });

  it('los fixtures cubren las cinco entidades', () => {
    expect(FIXTURES.map(f => f.kind).sort())
      .toEqual(['comment', 'expense', 'group', 'payment', 'recurring']);
    expect([COMMENT.id, GROUP.id, RECURRING.id]).toHaveLength(3);
  });
});
