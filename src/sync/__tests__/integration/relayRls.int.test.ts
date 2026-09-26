/**
 * T-147 · Integración contra Supabase LOCAL (nunca el proyecto real).
 *
 * Antes de correr: `scripts/supabase-int.sh <010|011a|011b>` y después
 * `npm run test:int`. Cada `describe` corre sólo en la etapa que describe: la
 * misma suite documenta el agujero (010), las piezas nuevas (011a) y el corte
 * (011b).
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Node 20 no trae WebSocket global; Realtime usa `ws` (ya en node_modules, sin
// tipos instalados — y en este repo no se agregan dependencias por un test).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WebSocket = require('ws');

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
/** SQL como dueño, dentro del contenedor del arnés (el operador con el SQL editor). */
const psql = (sql: string): string =>
  execFileSync('docker', ['exec', 'supabase_db_splitp2p-int', 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', sql], {
    encoding: 'utf8',
  }).trim();
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

  it('cuota en modo observar: no rechaza y anota el día, sin hora', async () => {
    await conCuota({ enforce: false, per_minute: 3 }, async () => {
      const c = await anonimo();
      const uid = (await c.auth.getUser()).data.user!.id;
      const t = topic();
      for (let i = 0; i < 4; i++) expect((await rpcPub(c, t)).error).toBeNull();
      const { data } = await admin.from('relay_quota_daily').select('*').eq('uid', uid).single();
      expect(data!.rejects_per_minute).toBeGreaterThan(0);
      expect(data!.peak_per_minute).toBe(4);
    });
  });

  it('D1: el operador no puede unir la cuota con envelopes (PoC del verificador)', async () => {
    await conCuota({ enforce: false, per_minute: 1 }, async () => {
      const c = await anonimo();
      const uid = (await c.auth.getUser()).data.user!.id;
      const t = topic();
      for (const n of [1234, 567, 89]) expect((await rpcPub(c, t, 'devA', 'q'.repeat(n))).error).toBeNull();
      const cruces = psql(`
        with e as (select created_at, octet_length(payload) b from public.envelopes where topic = '${t}')
        select (select count(*) from public.relay_quota q join e on q.bucket = e.created_at)
             + (select count(*) from public.relay_quota_daily d join e on d.day::timestamptz = e.created_at)
             + (select count(*) from public.relay_quota q
                 where q.uid = '${uid}' and q.bytes > 0
                   and q.bytes in (select sum(b) from e group by date_trunc('minute', created_at)
                                   union all select sum(b) from e group by date_trunc('hour', created_at)))
             + (select count(*) from public.relay_quota_daily d
                 where d.uid = '${uid}'
                   and d.peak_mib_per_hour::bigint in (select sum(b) from e group by date_trunc('hour', created_at)))`);
      expect(cruces).toBe('0');
      // La única columna de tiempo en las tablas de cuota es la ventana truncada.
      expect(
        psql(`select string_agg(table_name || '.' || column_name, ',' order by 1) from information_schema.columns
               where table_schema = 'public' and table_name like 'relay_%' and data_type like 'timestamp%'`),
      ).toBe('relay_quota.bucket');
      // Y el minuto sólo cuenta sobres, no bytes.
      expect(psql(`select coalesce(sum(bytes), 0) from public.relay_quota where uid = '${uid}' and granularity = 'm'`)).toBe('0');
    });
  });

  it('D1: la purga deja sólo las ventanas vivas', async () => {
    const u = '00000000-0000-4000-8000-00000000d1d1';
    psql(`insert into public.relay_quota (uid, granularity, bucket, n, bytes) values
            ('${u}', 'm', date_trunc('minute', now()) - interval '1 minute', 1, 0),
            ('${u}', 'h', date_trunc('hour', now()) - interval '1 hour', 1, 10)
          on conflict do nothing`);
    psql('select public.purge_relay_quota()');
    expect(psql(`select count(*) from public.relay_quota where uid = '${u}'`)).toBe('0');
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

  it('cuota activada: también frena el insert directo de un authenticated (hasta 011b)', async () => {
    if (STAGE === '011b') return; // tras 011b no hay insert directo (D2)
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
    for (const t of ['relay_quota', 'relay_quota_daily', 'relay_write_stats', 'relay_quota_config']) {
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
    // Con Realtime recién levantado, el SUBSCRIBED llega antes de que el
    // servidor escuche `realtime.messages`: sin este respiro el primer aviso de
    // la suite se pierde (visto en stack recién reseteado).
    await new Promise((r) => setTimeout(r, 4_000));
    expect((await rpcPub(intruso, t)).error).toBeNull();
    for (let i = 0; i < 150 && avisos === 0; i++) await new Promise((r) => setTimeout(r, 100));
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

soloEn('011b')('011b · el buzón cerrado', () => {
  it('Gherkin «anónimo no escribe»: anon key sin sesión no inserta ni llama RPC', async () => {
    expect((await nuevo().from('envelopes').insert(fila(topic()))).error).not.toBeNull();
    expect((await rpcPub(nuevo(), topic())).error).not.toBeNull();
  });
  it('Gherkin «anónimo no lista»: GET directo rechazado, RPC también', async () => {
    for (const t of ['envelopes', 'device_keys']) {
      const { data, error } = await nuevo().from(t).select('*');
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
    expect((await nuevo().rpc('fetch_since', { p_topic: 'x', p_since: 0 })).error).not.toBeNull();
    expect((await nuevo().rpc('account_keys', { p_account_id: 'acc-1' })).error).not.toBeNull();
    expect((await nuevo().rpc('delete_my_envelopes', { p_topic: 'x', p_secret: 'd'.repeat(64) })).error).not.toBeNull();
    expect((await nuevo().rpc('purge_expired_envelopes')).error).not.toBeNull();
  });
  it('Gherkin «nadie lista aunque esté autenticado»', async () => {
    const t = topic();
    const c = await conCuenta();
    expect((await rpcPub(c, t)).error).toBeNull();
    for (const cli of [c, await anonimo()]) {
      for (const tabla of ['envelopes', 'device_keys']) {
        const { data } = await cli.from(tabla).select('*');
        expect(data ?? []).toHaveLength(0);
      }
    }
  });
  it('sesión anónima y con cuenta: publican y leen por RPC', async () => {
    for (const c of [await anonimo(), await conCuenta()]) {
      const t = topic();
      expect((await rpcPub(c, t, 'a')).error).toBeNull();
      const { data } = await c.rpc('fetch_since', { p_topic: t, p_since: 0 });
      expect(data).toHaveLength(1);
    }
  });
  it('D2: un authenticated no inserta directo (ni con seq/expires_at elegidos)', async () => {
    const c = await anonimo();
    const t = topic();
    expect((await c.from('envelopes').insert(fila(t))).error).not.toBeNull();
    const veneno = { ...fila(t), seq: 9223372036854775000, expires_at: '2099-01-01T00:00:00Z' };
    expect((await c.from('envelopes').insert(veneno)).error).not.toBeNull();
    expect((await c.from('envelopes').update({ expires_at: '2099-01-01' }).eq('topic', t).select()).data ?? []).toHaveLength(0);
  });
  it('D2: el cursor del grupo no se puede envenenar; seq/created_at/expires_at los pone el servidor', async () => {
    const atacante = await anonimo();
    const victima = await anonimo();
    const t = topic();
    await atacante.from('envelopes').insert({ ...fila(t, 'mal'), seq: 9223372036854775000, expires_at: '2099-01-01' });
    const pub = await rpcPub(victima, t, 'bien');
    expect(pub.error).toBeNull();
    const { data } = await victima.rpc('fetch_since', { p_topic: t, p_since: 0 });
    expect((data as Fila[]).map((r) => r.sender)).toEqual(['bien']);
    expect((data as Fila[])[0].seq).toBeLessThan(9e15);
    const fila0 = psql(
      `select (expires_at - created_at) = interval '30 days' and abs(extract(epoch from now() - created_at)) < 60
         from public.envelopes where topic = '${t}'`,
    );
    expect(fila0).toBe('t');
  });
  it('la cuota rechaza por defecto (enforce = true, retención 2 h)', async () => {
    const { data } = await admin.from('relay_quota_config').select('enforce,retention').single();
    expect(data!.enforce).toBe(true);
    expect(data!.retention).toBe('02:00:00');
  });
  it('delete_my_envelopes sigue andando para authenticated (I6)', async () => {
    const c = await anonimo();
    const t = topic();
    const secreto = 'd'.repeat(64);
    const proof = createHash('sha256').update(secreto).digest('hex');
    await c.rpc('publish_envelope', { p_topic: t, p_payload: 'x', p_sender: 'a', p_compactable: true, p_owner_proof: proof });
    const { data } = await c.rpc('delete_my_envelopes', { p_topic: t, p_secret: secreto });
    expect(data).toBe(1);
  });
  it('compactación sigue igual tras el corte (I6)', async () => {
    const c = await anonimo();
    const t = topic();
    for (let i = 0; i < 2; i++) {
      await c.rpc('publish_envelope', {
        p_topic: t, p_payload: `v${i}`, p_sender: 'devA', p_compactable: true, p_owner_proof: 'e'.repeat(64), p_ckey: 'k1',
      });
    }
    const { data } = await c.rpc('fetch_since', { p_topic: t, p_since: 0 });
    expect((data as Fila[]).map((r) => r.payload)).toEqual(['v1']);
  });
  it('postgres_changes ya no entrega filas de envelopes (P4)', async () => {
    // Testigo: el mismo oyente SÍ recibe por Broadcast, así el 0 de abajo no es
    // un oyente que no llegó a conectarse.
    const oyente = await anonimo();
    const t = topic();
    await oyente.realtime.setAuth((await oyente.auth.getSession()).data.session!.access_token);
    let filas = 0;
    let avisos = 0;
    const suscribir = (ch: ReturnType<SupabaseClient['channel']>) =>
      new Promise<void>((ok, mal) =>
        ch.subscribe((s, err) => {
          if (s === 'SUBSCRIBED') ok();
          else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') mal(err ?? new Error(s));
        }),
      );
    await suscribir(
      oyente
        .channel(`pgc-${t}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'envelopes' }, () => {
          filas++;
        }),
    );
    await suscribir(
      oyente.channel(`envelopes:${t}`, { config: { private: true } }).on('broadcast', { event: 'news' }, () => {
        avisos++;
      }),
    );
    await new Promise((r) => setTimeout(r, 4_000)); // postgres_changes arma su suscripción después del SUBSCRIBED
    await rpcPub(await anonimo(), t);
    for (let i = 0; i < 50 && (avisos === 0 || filas === 0); i++) await new Promise((r) => setTimeout(r, 100));
    expect(avisos).toBe(1);
    expect(filas).toBe(STAGE === '011b' ? 0 : 1);
  });

});
