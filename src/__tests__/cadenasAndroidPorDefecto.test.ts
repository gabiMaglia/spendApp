// eslint-disable-next-line @typescript-eslint/no-require-imports
const { agregarCadenasPorDefecto } = require('../../plugins/withCadenasAndroidPorDefecto');
import es from '../../locales/es.json';

/**
 * El build de producción de Android fallaba en `lintVitalRelease`
 * (ExtraTranslation): las cadenas de permisos de iOS (`expo.locales`) se
 * generan traducidas en `values-b+xx/strings.xml` pero no en el default.
 */
describe('withCadenasAndroidPorDefecto', () => {
  it('agrega cada cadena de locales/es.json al strings.xml por defecto', () => {
    const r = agregarCadenasPorDefecto({ resources: { string: [] } });
    const nombres = r.resources.string.map((s: { $: { name: string } }) => s.$.name);
    for (const clave of Object.keys(es)) expect(nombres).toContain(clave);
  });

  it('no duplica una cadena que ya existe', () => {
    const una = Object.keys(es)[0];
    const r = agregarCadenasPorDefecto({ resources: { string: [{ $: { name: una }, _: 'x' }] } });
    expect(r.resources.string.filter((s: { $: { name: string } }) => s.$.name === una)).toHaveLength(1);
  });
});
