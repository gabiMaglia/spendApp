import { digestOfJson, isManifest } from '../manifest';
import { armarManifiesto } from '@/src/test-utils/armarManifiesto';

describe('digestOfJson', () => {
  it('es determinístico y sensible al contenido', async () => {
    const a = await digestOfJson('{"x":1}');
    const b = await digestOfJson('{"x":1}');
    const c = await digestOfJson('{"x":2}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

// T-206-A (D4): acá había un describe('buildManifest', ...) que probaba la
// función directo (produce una entrada por ckey+digest; lista vacía no
// rompe). `buildManifest` se borró — sin consumidor de producción, sólo la
// usaban 5 archivos de test como fixture — y su reemplazo de test
// (`armarManifiesto`) es tan trivial que probarlo por separado sería probar
// el fixture, no el sistema; lo que sí importa —que un manifiesto armado así
// pasa `isManifest`— lo sigue cubriendo el describe de abajo.

describe('isManifest', () => {
  it('reconoce un manifiesto válido', async () => {
    const m = await armarManifiesto([{ ckey: 'ck1', json: '{}' }]);
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
