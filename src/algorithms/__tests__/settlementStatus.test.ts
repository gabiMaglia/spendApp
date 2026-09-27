import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import {
  estadoDelSaldado, requiereConfirmacion, pagosQueCuentan,
  type ContextoDeAcuse,
} from '@/src/algorithms/settlementStatus';
import type { Group, Payment } from '@/src/types/models';

/** Ana le paga a Beto. Lo declara Ana, o sea el que PAGA. */
const pago = (over: Partial<Payment> = {}): Payment => ({
  id: 'p1', groupId: 'g1', fromUserId: 'ana', toUserId: 'beto',
  amount: 500_000, currency: 'ARS', date: 0, createdAt: 0,
  createdById: 'ana', updatedAt: 0, isDeleted: false, ...over,
} as Payment);

// T-186: el modo «con acuerdo» se sacó — ya no hay `deletionMode` en Group,
// así que este parámetro quedó sin efecto (ningún grupo pide acuse). Se
// mantiene la firma para no tocar cada llamador; Task 2 de la extracción
// termina de podar este archivo.
const grupo = (_mode: 'consensus' | 'open' = 'consensus'): Group => ({
  id: 'g1', name: 'Viaje', memberIds: ['ana', 'beto'], currency: 'ARS',
  miembros: {}, // T-182: placeholder de tipo (fixture no ejercita el roster)
  createdAt: 0, createdById: 'ana', updatedAt: 0, isDeleted: false,
} as Group);

/**
 * Estos tests son sobre la DERIVACIÓN del estado, no sobre la firma (eso es
 * `acuseSinFirma.test.ts`, T-145). Se inyecta un contexto donde todo acuse
 * verifica, para que sigan probando exactamente lo que probaban.
 */
const CONFIA: ContextoDeAcuse = { now: 10_000, veredicto: () => 'valida', nucleoDe: () => 'valida' };

describe('cuándo hace falta el acuse', () => {
  it('en un grupo abierto no hace falta: saldar nunca necesitó consenso', () => {
    expect(requiereConfirmacion(pago(), grupo('open'))).toBe(false);
    expect(estadoDelSaldado(pago(), grupo('open'), CONFIA)).toBe('efectivo');
  });

  it('sin grupo no se inventa una regla', () => {
    expect(requiereConfirmacion(pago(), undefined)).toBe(false);
  });

  // D3 del plan: es su propia declaración de haber recibido la plata.
  it('si lo declara el que COBRA, se efectiviza directo', () => {
    const p = pago({ createdById: 'beto' });
    expect(requiereConfirmacion(p, grupo(), { nucleoDe: () => 'valida' })).toBe(false);
    expect(estadoDelSaldado(p, grupo(), CONFIA)).toBe('efectivo');
  });

  /**
   * T-182: los pagos derivados de un cierre forzado —salida con absorción
   * (`leave:...`) o expulsión (`expel:...`)— no piden acuse ni en un grupo
   * `consensus`. No hay aprobaciones que juntar en una expulsión, y pedirle a
   * la otra parte que confirme dejaría la deuda `pendiente` para siempre
   * cuando esa otra parte es justo quien ya salió del grupo.
   */
  it('un pago `leave:` derivado, sin firma, no pide acuse aunque createdById≠toUserId', () => {
    const p = pago({ id: 'leave:g1:ana:1000:0', createdById: 'ana', toUserId: 'beto', k: undefined, s: undefined });
    expect(requiereConfirmacion(p, grupo(), { nucleoDe: () => 'no_verificable' })).toBe(false);
    expect(estadoDelSaldado(p, grupo(), CONFIA)).toBe('efectivo');
  });

  it('un pago `expel:` derivado, sin firma, no pide acuse aunque createdById≠toUserId', () => {
    const p = pago({ id: 'expel:g1:beto:1000:0', createdById: 'ana', toUserId: 'beto', k: undefined, s: undefined });
    expect(requiereConfirmacion(p, grupo(), { nucleoDe: () => 'no_verificable' })).toBe(false);
    expect(estadoDelSaldado(p, grupo(), CONFIA)).toBe('efectivo');
  });
});

// T-186 (Task 1): sin `deletionMode`, `requiereConfirmacion` quedó inerte —
// siempre `false` — así que todo saldado declarado es `efectivo` de una.
// Las ramas `pendiente`/`rechazado` de `estadoDelSaldado` y `saldadosPendientes`
// son código muerto hasta que el Task 2 de esta extracción borre el acuse
// entero (`settlementCore`/`settlementConfirm`/`SettlementAcuse`/etc.) y
// reduzca este archivo a `pagosQueCuentan`. Se prueba acá la superficie que
// sigue siendo verdad.
describe('el estado del saldado, ya sin acuse', () => {
  it('declarado por el que paga: efectivo de una', () => {
    expect(estadoDelSaldado(pago(), grupo(), CONFIA)).toBe('efectivo');
  });
});

describe('qué cuenta para el balance', () => {
  it('un saldado declarado cuenta', () => {
    expect(pagosQueCuentan([pago()], grupo(), CONFIA)).toHaveLength(1);
  });

  it('no se lleva pagos de otro grupo', () => {
    expect(pagosQueCuentan([pago({ id: 'p2', groupId: 'otro' })], grupo(), CONFIA)).toHaveLength(0);
  });

  it('sin grupo no cuenta nada', () => {
    expect(pagosQueCuentan([pago()], undefined)).toHaveLength(0);
  });
});

/**
 * **Guard de clase, no de estos casos.**
 *
 * Los seis lugares que calculaban balances repetían `payments.filter(p =>
 * p.groupId === g.id)` a mano. Esa forma —la misma lista mantenida en varios
 * lados— es la que produjo T-055, T-057 y T-060, tres veces el mismo bug. Un
 * `.filter` nuevo que se saltee `pagosQueCuentan` deja entrar al balance un
 * saldado que el cobrador rechazó: plata que nadie recibió, contada como
 * recibida.
 */
describe('nadie vuelve a filtrar los pagos a mano', () => {
  const RAIZ = join(__dirname, '..', '..', '..');

  /**
   * Los únicos lugares donde filtrar pagos por grupo a mano es correcto, **con
   * el motivo escrito**. Agregar una entrada acá es una decisión consciente:
   * quien la agregue tiene que poder explicar por qué ese filtro no alimenta un
   * balance. Todo lo demás va por `pagosQueCuentan`.
   */
  const PERMITIDOS: Record<string, string> = {
    [join('src', 'algorithms', 'settlementStatus.ts')]:
      'es la fuente única',
    [join('src', 'sync', 'relaySync.ts')]:
      'el sobre lleva el ESTADO COMPLETO del grupo (regla #8 / ADR-007): un ' +
      'pago rechazado tiene que viajar igual, o el rechazo no llega nunca al ' +
      'otro lado y cada teléfono deriva un estado distinto',
    [join('src', 'sync', 'acotarDeltaAlGrupo.ts')]:
      'mismo motivo que relaySync.ts, del lado receptor (T-132/S3-A1): recorta ' +
      'el delta del RELAY a lo que pertenece a `groupId` (aislamiento entre ' +
      'grupos), no a lo que cuenta para el balance — un pago rechazado tiene ' +
      'que seguir aplicándose vía LWW o el rechazo nunca llega al otro lado',
  };

  function archivos(dir: string, out: string[] = []): string[] {
    for (const nombre of readdirSync(dir)) {
      if (nombre === 'node_modules' || nombre === '__tests__' || nombre.startsWith('.')) continue;
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) archivos(ruta, out);
      else if (/\.tsx?$/.test(nombre)) out.push(ruta);
    }
    return out;
  }

  it('el filtro por groupId sobre pagos vive en un solo archivo', () => {
    const culpables: string[] = [];
    for (const ruta of [...archivos(join(RAIZ, 'src')), ...archivos(join(RAIZ, 'app'))]) {
      if (Object.keys(PERMITIDOS).some(ok => ruta.endsWith(ok))) continue;
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        if (/\bpayments?\b[\w.]*\.filter\(/.test(linea) && /\.groupId\s*===/.test(linea)) {
          culpables.push(`${ruta.slice(RAIZ.length + 1)}:${i + 1}`);
        }
      });
    }
    expect(culpables).toEqual([]);
  });
});
