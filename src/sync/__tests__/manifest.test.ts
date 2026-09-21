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
