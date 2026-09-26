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

type Fila = { seq: number; payload: string; sender: string; created_at: string; ckey: string | null; more: boolean };
const rpcPub = (c: SupabaseClient, t: string, sender = 'devA', payload = 'x') =>
  c.rpc('publish_envelope', { p_topic: t, p_payload: payload, p_sender: sender });

/** Cambia la cuota para un caso y la devuelve como estaba, pase lo que pase. */
async function conCuota(cambio: Record<string, unknown>, cuerpo: () => Promise<void>) {
  const { data: antes, error } = await admin.from('relay_quota_config').select('enforce,per_minute').single();
  if (error) throw error;
  await admin.from('relay_quota_config').update(cambio).eq('id', true);
  try {
    await cuerpo();
  } finally {
    await admin.from('relay_quota_config').update(antes!).eq('id', true);
  }
}

soloEn('011a', '011b')('011a · piezas nuevas', () => {
  it('publish_envelope devuelve seq y created_at', async () => {
    const { data, error } = await rpcPub(await anonimo(), topic());
    expect(error).toBeNull();
    expect(data[0]).toEqual({ seq: expect.any(Number), created_at: expect.any(String) });
  });

  it('publish_envelope con topic vacío es rechazado', async () => {
    const { error } = await rpcPub(await anonimo(), '');
    expect(error).not.toBeNull();
  });

  it('fetch_since: tope de bytes, "more", progreso y cada sobre una sola vez', async () => {
    const c = await anonimo();
    const t = topic();
    const grande = 'y'.repeat(900_000);
    for (let i = 0; i < 10; i++) expect((await rpcPub(c, t, `dev${i}`, grande)).error).toBeNull();
    const leidos: number[] = [];
    let since = 0;
    let vueltas = 0;
    let more = true;
    while (more && vueltas++ < 20) {
      const { data, error } = await c.rpc('fetch_since', { p_topic: t, p_since: since, p_limit: 200 });
      expect(error).toBeNull();
      const filas = data as Fila[];
      const bytes = filas.reduce((s, r) => s + r.payload.length, 0);
      expect(filas.length === 1 || bytes <= 4_194_304).toBe(true);
      leidos.push(...filas.map((r) => r.seq));
      more = filas.length > 0 && filas[0].more;
      since = filas.length ? filas[filas.length - 1].seq : since;
    }
    expect(leidos).toHaveLength(10);
    expect(new Set(leidos).size).toBe(10);
    expect([...leidos].sort((a, b) => a - b)).toEqual(leidos); // cursor creciente
  });

  it('fetch_since: borde exacto del tope de bytes', async () => {
    const c = await anonimo();
    const t = topic();
    for (let i = 0; i < 5; i++) await rpcPub(c, t, 'devA', 'z'.repeat(1_000_000));
    const { data } = await c.rpc('fetch_since', { p_topic: t, p_since: 0, p_limit: 200 });
    expect((data as Fila[]).length).toBe(4); // 4 × 1.000.000 ≤ 4.194.304; la 5.ª queda para la próxima
    expect((data as Fila[])[0].more).toBe(true);
  });

  it('fetch_since: tope de filas y "more" falso al final', async () => {
    const c = await anonimo();
    const t = topic();
    for (let i = 0; i < 3; i++) await rpcPub(c, t);
    const p1 = (await c.rpc('fetch_since', { p_topic: t, p_since: 0, p_limit: 2 })).data as Fila[];
    expect(p1).toHaveLength(2);
    expect(p1[0].more).toBe(true);
    const p2 = (await c.rpc('fetch_since', { p_topic: t, p_since: p1[1].seq, p_limit: 2 })).data as Fila[];
    expect(p2).toHaveLength(1);
    expect(p2[0].more).toBe(false);
    const vacio = (await c.rpc('fetch_since', { p_topic: t, p_since: p2[0].seq })).data as Fila[];
    expect(vacio).toHaveLength(0);
  });

  it('fetch_since sin topic no lista nada (I1)', async () => {
    const c = await anonimo();
    await rpcPub(c, topic());
    for (const p_topic of ['', null]) {
      const { data, error } = await c.rpc('fetch_since', { p_topic, p_since: 0 });
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    }
  });

  it('fetch_since excluye el sender propio y no devuelve owner_tag', async () => {
    const c = await anonimo();
    const t = topic();
    await rpcPub(c, t, 'yo');
    await rpcPub(c, t, 'otro');
    const { data } = await c.rpc('fetch_since', { p_topic: t, p_since: 0, p_exclude_sender: 'yo' });
    expect((data as Fila[]).map((r) => r.sender)).toEqual(['otro']);
    expect(Object.keys((data as Fila[])[0])).not.toContain('owner_tag');
    expect(Object.keys((data as Fila[])[0])).not.toContain('topic');
  });

  it('cuota en modo observar: no rechaza y anota', async () => {
    await conCuota({ enforce: false, per_minute: 3 }, async () => {
      const c = await anonimo();
      const uid = (await c.auth.getUser()).data.user!.id;
      const t = topic();
      for (let i = 0; i < 4; i++) expect((await rpcPub(c, t)).error).toBeNull();
      const { count } = await admin
        .from('relay_quota_would_reject')
        .select('*', { count: 'exact', head: true })
        .eq('uid', uid);
      expect(count).toBeGreaterThan(0);
    });
  });

  it('cuota activada: rechaza con PT429 al uid que se pasa, no al vecino', async () => {
    await conCuota({ enforce: true, per_minute: 3 }, async () => {
      const a = await anonimo();
      const b = await anonimo();
      const t = topic();
      for (let i = 0; i < 3; i++) expect((await rpcPub(a, t)).error).toBeNull();
      const cuarto = await rpcPub(a, t);
      expect(cuarto.error?.code === 'PT429' || /relay_quota_exceeded/.test(cuarto.error?.message ?? '')).toBe(true);
      expect((await rpcPub(b, t)).error).toBeNull();
    });
  });

  it('cuota activada: también frena el insert directo de un authenticated', async () => {
    await conCuota({ enforce: true, per_minute: 1 }, async () => {
      const a = await anonimo();
      const t = topic();
      expect((await a.from('envelopes').insert(fila(t))).error).toBeNull();
      expect((await a.from('envelopes').insert(fila(t))).error).not.toBeNull();
    });
  });

  it('estadística por rol: el anon directo cuenta como anon', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    if (STAGE === '011a') await nuevo().from('envelopes').insert(fila(topic()));
    const { data } = await admin.from('relay_write_stats').select('role,n').eq('day', hoy);
    const roles = (data ?? []).map((r) => r.role);
    expect(roles).toContain('authenticated');
    if (STAGE === '011a') expect(roles).toContain('anon');
  });

  it('las tablas de cuota no se leen ni se escriben desde la app', async () => {
    const c = await anonimo();
    for (const t of ['relay_quota', 'relay_quota_would_reject', 'relay_write_stats', 'relay_quota_config']) {
      for (const cli of [c, nuevo()]) {
        const { data, error } = await cli.from(t).select('*');
        expect(error !== null || (data ?? []).length === 0).toBe(true);
      }
    }
    expect((await c.from('relay_quota_config').update({ enforce: false }).eq('id', true).select()).data ?? []).toHaveLength(0);
  });

  it('las funciones de trigger y la purga no se ejecutan desde la app', async () => {
    const c = await anonimo();
    for (const fn of ['purge_relay_quota', 'relay_enforce_quota', 'relay_notify_news']) {
      expect((await c.rpc(fn)).error).not.toBeNull();
    }
  });

  it('aviso en vivo por Broadcast privado; el cliente no puede publicar ahí', async () => {
    const oyente = await anonimo();
    const intruso = await anonimo();
    const t = topic();
    await oyente.realtime.setAuth((await oyente.auth.getSession()).data.session!.access_token);
    let avisos = 0;
    await new Promise<void>((ok, mal) =>
      oyente
        .channel(`envelopes:${t}`, { config: { private: true } })
        .on('broadcast', { event: 'news' }, () => {
          avisos++;
        })
        .subscribe((s, err) => {
          if (s === 'SUBSCRIBED') ok();
          else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') mal(err ?? new Error(s));
        }),
    );
    expect((await rpcPub(intruso, t)).error).toBeNull();
    await new Promise((r) => setTimeout(r, 3_000));
    expect(avisos).toBe(1);
    await intruso.realtime.setAuth((await intruso.auth.getSession()).data.session!.access_token);
    const ch = intruso.channel(`envelopes:${t}`, { config: { private: true } });
    await new Promise<void>((ok) => ch.subscribe(() => ok()));
    await ch.send({ type: 'broadcast', event: 'news', payload: {} });
    await new Promise((r) => setTimeout(r, 3_000));
    expect(avisos).toBe(1); // el falso no llegó
  });

  it('el aviso no se escucha sin sesión (anon puro)', async () => {
    const c = nuevo();
    const estado = await new Promise<string>((ok) =>
      c.channel(`envelopes:${topic()}`, { config: { private: true } }).subscribe((s) => ok(s)),
    );
    expect(estado).not.toBe('SUBSCRIBED');
  });

  it('account_keys (definer) devuelve las claves de una cuenta', async () => {
    const acc = `acc-${Date.now()}`;
    const { data: u } = await admin.auth.admin.createUser({ email: `k${Date.now()}@int.local`, email_confirm: true });
    const { error: e } = await admin.from('device_keys').insert([
      { account_id: acc, public_key: 'a'.repeat(64), owner: u.user!.id },
      { account_id: acc, public_key: 'b'.repeat(64), owner: u.user!.id },
    ]);
    expect(e).toBeNull();
    const { data, error } = await (await anonimo()).rpc('account_keys', { p_account_id: acc });
    expect(error).toBeNull();
    expect((data as { public_key: string }[]).map((r) => r.public_key).sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  });
});

soloEn('011a')('011a · compatibilidad: el camino viejo sigue andando', () => {
  it('anon inserta y lee directo como hoy', async () => {
    const t = topic();
    expect((await nuevo().from('envelopes').insert(fila(t)).select('seq').single()).error).toBeNull();
    const { data } = await nuevo().from('envelopes').select('seq').eq('topic', t);
    expect(data).toHaveLength(1);
  });
  it('anon sin sesión también usa las RPC nuevas (cliente nuevo en F2 sin sesión)', async () => {
    const t = topic();
    expect((await rpcPub(nuevo(), t)).error).toBeNull();
    expect((await nuevo().rpc('fetch_since', { p_topic: t, p_since: 0 })).data).toHaveLength(1);
  });
  it('compactación e I6: publish_envelope con prenda compacta como un insert directo', async () => {
    const c = await anonimo();
    const t = topic();
    const proof = 'c'.repeat(64);
    for (let i = 0; i < 2; i++) {
      await c.rpc('publish_envelope', {
        p_topic: t,
        p_payload: `v${i}`,
        p_sender: 'devA',
        p_compactable: true,
        p_owner_proof: proof,
        p_ckey: 'k1',
      });
    }
    const { data } = await c.rpc('fetch_since', { p_topic: t, p_since: 0 });
    expect((data as Fila[]).map((r) => r.payload)).toEqual(['v1']);
  });
});
