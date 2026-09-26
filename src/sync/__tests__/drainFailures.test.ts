import {
  registrarFalloDeAplicacion, agotoReintentos, olvidarFallosDeAplicacion, DRAIN_MAX_REINTENTOS,
} from '../drainFailures';
import { listErrors, clearErrors } from '@/src/services/errorLog';

beforeEach(() => { olvidarFallosDeAplicacion(); clearErrors(); });

it('cuenta intentos por (topic, seq) y agota a los 3', () => {
  expect(agotoReintentos('t1', 7)).toBe(false);
  expect(registrarFalloDeAplicacion('t1', 7, new Error('boom'))).toBe(1);
  expect(registrarFalloDeAplicacion('t1', 7, new Error('boom'))).toBe(2);
  expect(agotoReintentos('t1', 7)).toBe(false);
  expect(registrarFalloDeAplicacion('t1', 7, new Error('boom'))).toBe(DRAIN_MAX_REINTENTOS);
  expect(agotoReintentos('t1', 7)).toBe(true);
});

it('otro seq u otro topic tienen su propio presupuesto', () => {
  registrarFalloDeAplicacion('t1', 7, new Error('a'));
  expect(registrarFalloDeAplicacion('t1', 8, new Error('b'))).toBe(1);
  expect(registrarFalloDeAplicacion('t2', 7, new Error('c'))).toBe(1);
});

it('deja rastro en el diagnóstico, no fatal, con topic recortado y seq', () => {
  registrarFalloDeAplicacion('abcdef0123456789resto', 42, new Error('memberIds.filter is not a function'));
  const [e] = listErrors();
  expect(e!.fatal).toBe(false);
  expect(e!.screen).toBe('sync');
  expect(e!.message).toContain('seq=42');
  expect(e!.message).toContain('intento=1');
  expect(e!.message).toContain('abcdef01');
  expect(e!.message).not.toContain('resto');           // el topic entero no se loguea
  expect(e!.message).toContain('memberIds.filter');
});

it('un error que no es Error también se anota', () => {
  registrarFalloDeAplicacion('t1', 1, 'texto');
  expect(listErrors()[0]!.message).toContain('texto');
});
