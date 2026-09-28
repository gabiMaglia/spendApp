/**
 * T-147 (enmienda del PO) · el teléfono avisa cuando el buzón ESTÁ configurado
 * pero no consiguió abrir ninguna sesión de Supabase (captcha que nunca
 * resuelve, Auth caído): sin esto, después de 011b ese teléfono deja de
 * sincronizar en silencio.
 */
import { setUltimaSesionConocida, sinSesionDeSync, __resetSessionStatus } from '../sessionStatus';

beforeEach(() => __resetSessionStatus());

it('sin ningún resultado conocido todavía, no avisa (no es un fallo, es arranque)', () => {
  expect(sinSesionDeSync()).toBe(false);
});

it('con sesión (anonymous) no avisa', () => {
  setUltimaSesionConocida('anonymous');
  expect(sinSesionDeSync()).toBe(false);
});

it('sin sesión (none) avisa', () => {
  setUltimaSesionConocida('none');
  expect(sinSesionDeSync()).toBe(true);
});

it('se retira al recuperar sesión', () => {
  setUltimaSesionConocida('none');
  expect(sinSesionDeSync()).toBe(true);
  setUltimaSesionConocida('anonymous');
  expect(sinSesionDeSync()).toBe(false);
});
