/**
 * Guard de build (T-099): un build de EAS production/preview no sale sin las variables
 * que la app necesita. Sin las de Supabase la sync se apaga EN SILENCIO.
 *
 * Mira sólo PRESENCIA. Nunca imprime ni compara un valor.
 * Lo corre EAS como `eas-build-post-install` (package.json). Fuera de EAS no hace nada.
 */
const REQUERIDAS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB',
  'EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS',
];
const PERFILES_CHEQUEADOS = ['production', 'preview'];

function faltantes(env, perfil) {
  if (!PERFILES_CHEQUEADOS.includes(perfil)) return [];
  return REQUERIDAS.filter(nombre => typeof env[nombre] !== 'string' || env[nombre].trim() === '');
}

function main(env = process.env, log = console.error) {
  if (!env.EAS_BUILD) return 0;
  const perfil = env.EAS_BUILD_PROFILE;
  const lista = faltantes(env, perfil);
  if (lista.length === 0) return 0;
  log(`Build "${perfil}" sin configuración. Faltan en el entorno de EAS: ${lista.join(', ')}`);
  return 1;
}

module.exports = { REQUERIDAS, faltantes, main };

if (require.main === module) process.exitCode = main();
