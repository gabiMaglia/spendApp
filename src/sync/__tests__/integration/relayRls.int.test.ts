/**
 * T-147 · Integración contra Supabase LOCAL (nunca el proyecto real).
 *
 * Antes de correr: `scripts/supabase-int.sh <010|011a|011b>` y después
 * `npm run test:int`. Cada `describe` corre sólo en la etapa que describe: la
 * misma suite documenta el agujero (010), las piezas nuevas (011a) y el corte
 * (011b).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import WebSocket from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(join(__dirname, '../../../../tools/supabase-int/int.env'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)] as [string, string];
    }),
);
const URL = env.SUPA_INT_URL!;
const ANON = env.SUPA_INT_ANON!;
const SERVICE = env.SUPA_INT_SERVICE!;
const STAGE = env.SUPA_INT_STAGE as '010' | '011a' | '011b';
// Con la secret de prueba de Cloudflare, Turnstile valida cualquier token.
const CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX';

const clientes: SupabaseClient[] = [];
const nuevo = (): SupabaseClient => {
  const c = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  });
  clientes.push(c);
  return c;
};
const admin = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as never },
});

afterAll(async () => {
  for (const c of [...clientes, admin]) {
    await c.removeAllChannels();
    c.realtime.disconnect();
  }
});

async function anonimo(): Promise<SupabaseClient> {
  const c = nuevo();
  const { error } = await c.auth.signInAnonymously({ options: { captchaToken: CAPTCHA } });
  if (error) throw error;
  return c;
}
async function conCuenta(): Promise<SupabaseClient> {
  const email = `t${Date.now()}${Math.random().toString(36).slice(2)}@int.local`;
  await admin.auth.admin.createUser({ email, password: 'clave-de-prueba-1', email_confirm: true });
  const c = nuevo();
  const { error } = await c.auth.signInWithPassword({
    email,
    password: 'clave-de-prueba-1',
    options: { captchaToken: CAPTCHA },
  });
  if (error) throw error;
  return c;
}
const topic = () => `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fila = (t: string, sender = 'devA') => ({ topic: t, payload: 'x', sender, compactable: false });

const soloEn = (...etapas: string[]) => (etapas.includes(STAGE) ? describe : describe.skip);

soloEn('010')('010 · el agujero existe (línea de base)', () => {
  it('P1: la anon key lista el buzón sin filtro', async () => {
    const t = topic();
    await nuevo().from('envelopes').insert(fila(t));
    const { data, error } = await nuevo().from('envelopes').select('topic').limit(1000);
    expect(error).toBeNull();
    expect((data ?? []).some((r) => r.topic === t)).toBe(true);
  });
  it('P5: la anon key lista el directorio', async () => {
    const { error } = await nuevo().from('device_keys').select('account_id');
    expect(error).toBeNull();
  });
  it('los helpers del arnés andan (sesión anónima y con cuenta)', async () => {
    const a = await anonimo();
    const b = await conCuenta();
    expect((await a.auth.getUser()).data.user?.is_anonymous).toBe(true);
    expect((await b.auth.getUser()).data.user?.is_anonymous).toBe(false);
  });
  it('el arnés exige captcha como producción: sin token, no hay sesión anónima', async () => {
    const { error } = await nuevo().auth.signInAnonymously();
    expect(error).not.toBeNull();
  });
});
