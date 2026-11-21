import { aplicarVariante } from '@/app.config';

const base = {
  name: 'HushSplit',
  slug: 'spendApp',
  scheme: 'hushsplit',
  ios: {
    bundleIdentifier: 'com.splitp2p.app',
    usesAppleSignIn: true,
    associatedDomains: ['applinks:hushsplit.github.io'],
  },
  android: { package: 'com.splitp2p.app', versionCode: 22 },
};

describe('aplicarVariante', () => {
  it('sin variante devuelve la config de producción intacta', () => {
    expect(aplicarVariante(base, undefined)).toEqual(base);
  });

  it('production y preview también quedan intactas', () => {
    expect(aplicarVariante(base, 'production')).toEqual(base);
    expect(aplicarVariante(base, 'preview')).toEqual(base);
  });

  it('development cambia nombre, identificadores y esquema para convivir con la productiva', () => {
    const dev = aplicarVariante(base, 'development');
    expect(dev.name).toBe('HushSplit Dev');
    expect(dev.scheme).toBe('hushsplit-dev');
    expect(dev.ios?.bundleIdentifier).toBe('com.splitp2p.app.dev');
    expect(dev.android?.package).toBe('com.splitp2p.app.dev');
  });

  it('development no reclama los universal links de producción y conserva el resto', () => {
    const dev = aplicarVariante(base, 'development');
    expect(dev.ios?.associatedDomains).toBeUndefined();
    expect(dev.ios?.usesAppleSignIn).toBe(true);
    expect(dev.android?.versionCode).toBe(22);
    expect(dev.slug).toBe('spendApp');
  });

  it('no muta la config que recibe', () => {
    aplicarVariante(base, 'development');
    expect(base.ios.bundleIdentifier).toBe('com.splitp2p.app');
    expect(base.ios.associatedDomains).toEqual(['applinks:hushsplit.github.io']);
  });

  it('tolera una config sin ios ni android', () => {
    const dev = aplicarVariante({ name: 'HushSplit', slug: 'spendApp' }, 'development');
    expect(dev.name).toBe('HushSplit Dev');
    expect(dev.ios?.bundleIdentifier).toBeUndefined();
  });
});
