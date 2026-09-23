const { withStringsXml, AndroidConfig } = require('@expo/config-plugins');

/**
 * `expo.locales` (app.json) sirve cadenas traducidas para iOS (InfoPlist:
 * NSCameraUsageDescription…) pero en Android las vuelca TAMBIÉN a
 * `values-b+es|en|pt/strings.xml`. Sin la cadena en el `values/strings.xml`
 * por defecto, `lintVitalRelease` falla el build de producción con
 * "ExtraTranslation … translated here but not found in default locale".
 *
 * Se agregan acá, con el texto en español (idioma por defecto de la app).
 * Un solo lugar de verdad para el texto: `locales/es.json`.
 */
const es = require('../locales/es.json');

function agregarCadenasPorDefecto(strings) {
  const items = Object.entries(es).map(([name, texto]) => ({ $: { name }, _: texto }));
  return AndroidConfig.Strings.setStringItem(items, strings);
}

module.exports = (config) =>
  withStringsXml(config, (c) => {
    c.modResults = agregarCadenasPorDefecto(c.modResults);
    return c;
  });
module.exports.agregarCadenasPorDefecto = agregarCadenasPorDefecto;
