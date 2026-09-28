#!/usr/bin/env node
/**
 * Mudanza de src/sync/** a carpetas legibles (T-206-A, plan Task 1).
 *
 * Fuente de la asignación: docs/superpowers/specs/2026-09-28-sync-extraible-design.md
 * §3.1 (tabla de 88 archivos) + los ajustes y renombres del encabezado de
 * `engram/plans/T-206-A.md`. Este script:
 *
 *   1. Mueve los 88 archivos de producción con `git mv` (conserva historia).
 *   2. Mueve cada test de `src/sync/__tests__/**` a la carpeta `__tests__`
 *      de la carpeta que importa primero (spec §3.1 "Tests"), salvo las
 *      excepciones explícitas de EXCEPCIONES_TEST.
 *   3. Reescribe TODO especificador (`import`/`export … from`/`require(`/
 *      `import(`/`typeof import(`/`jest.mock(`/`jest.doMock(`/
 *      `jest.requireActual(`/`jest.requireMock(`) que resuelva a un
 *      archivo movido, en TODO `src/`, `app/`, `components/`, `hooks/`.
 *      Regla: alias `@/src/sync/<carpeta>/<archivo>` entre carpetas
 *      distintas de `src/sync`, relativo dentro de la misma carpeta top de
 *      `src/sync`. Fuera de `src/sync`, siempre alias.
 *
 * Sin fachadas en las rutas viejas (spec §3.3: la trampa de identidad de
 * `jest.mock`). Se corre UNA sola vez; queda en el repo como documentación
 * del mapa (plan Task 1).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC = 'src/sync';

// ---------------------------------------------------------------------
// 1) Mapa de PRODUCCIÓN — spec §3.1, 88 archivos, con los renombres y
//    ajustes del encabezado del plan (relayNetworkTimeout→sesion,
//    claveVigente→motor, derivedRecords→confianza, cederHilo→nucleo,
//    relayQueue→motor, turnstileHtml/captchaBridge→sesion, y los 5
//    renombres de archivo).
// ---------------------------------------------------------------------
const PRODUCCION = {
  nucleo: [
    'hexBytes.ts', 'envelopeCrypto.ts', 'envelopeSign.ts', 'manifest.ts',
    ['slices.ts', 'ckey.ts'],
    ['relay/cubos.ts', 'cubos.ts'],
    ['relay/sliceLedger.ts', 'sliceLedger.ts'],
    ['relay/appliedSlices.ts', 'appliedSlices.ts'],
    ['relay/publicarCubos.ts', 'publicarCubos.ts'],
    ['relay/relecturas.ts', 'relecturas.ts'],
    ['relay/cierreDeDrenaje.ts', 'cierreDeDrenaje.ts'],
    ['relay/drenarTypes.ts', 'drenarTypes.ts'],
    'cederHilo.ts', 'manifestHealth.ts', 'drainFailures.ts', 'topes.ts',
    ['relay/abrirSobre.ts', 'abrirSobre.ts'],
  ],
  motor: [
    'relayEngine.ts', 'relaySync.ts',
    ['relay/publicar.ts', 'publicar.ts'],
    ['relay/drenar.ts', 'drenar.ts'],
    ['relay/relectura.ts', 'relectura.ts'],
    ['relay/chequeoManifiesto.ts', 'chequeoManifiesto.ts'],
    ['relay/claveVigente.ts', 'claveVigente.ts'],
    ['relay/publish.ts', 'agendaDePublicacion.ts'],
    ['relay/drain.ts', 'agendaDeDrenaje.ts'],
    ['relay/poll.ts', 'poll.ts'],
    ['relay/cursor.ts', 'cursor.ts'],
    'relayQueue.ts', 'pendingDrain.ts', 'publishHealth.ts',
  ],
  'adaptadores/supabase': [
    'relay.ts', 'relayClient.ts', 'relaySend.ts', 'relayErrors.ts', 'ownerPledge.ts',
  ],
  'adaptadores/hushsplit': [
    ['relay/adaptadorHushSplit.ts', 'adaptadorHushSplit.ts'],
    ['relay/aplicarAcotado.ts', 'aplicarAcotado.ts'],
    'applyDelta.ts', 'acotarDeltaAlGrupo.ts', 'soloLocal.ts', 'avatarTopic.ts', 'sliceRenewal.ts',
  ],
  sesion: [
    'relaySession.ts', 'relaySessionStorage.ts', 'sessionStatus.ts',
    'relayNetworkTimeout.ts', 'directoryAuth.ts', 'accountEntry.ts',
    'captchaBridge.ts', 'turnstileHtml.ts',
  ],
  confianza: [
    'recordCore.ts', 'recordSign.ts', 'recordHealth.ts', 'recordHealthStore.ts',
    'verdictCache.ts', 'ratchet.ts', 'signOnWrite.ts', 'derivedRecords.ts',
    'trustCheck.ts', 'autoriaTrust.ts', 'authorHealth.ts', 'authorKeys.ts',
    'authorKeysCache.ts', 'authorKeysResolve.ts', 'authorKeysRefresh.ts',
    'leaveApprovalCore.ts', 'leaveApprovalSign.ts', 'deviceKeys.ts', 'devicePrivateKey.ts',
  ],
  contactos: [
    'contactChannel.ts', 'contactPeers.ts', 'contactTopic.ts', 'contactGroupKeyDrop.ts',
    'contactInvite.ts', 'contactInviteEngine.ts',
    ['relay/contactos.ts', 'motorDeContactos.ts'],
  ],
  invitaciones: [
    'groupInvite.ts', 'groupKeyWrap.ts', 'inviteEngine.ts', 'inviteAdmit.ts',
    ['relay/invitaciones.ts', 'suscripciones.ts'],
    'groupKeyOffers.ts', 'keyConflictNotice.ts',
  ],
  avisos: [
    'clockNotice.ts', 'syncDownNotices.ts', 'useManifestGap.ts', 'useSyncFailure.ts',
  ],
};

const FILE_MOVE = {}; // oldRepoPath -> newRepoPath (posix, sin ROOT)

for (const [carpeta, items] of Object.entries(PRODUCCION)) {
  for (const item of items) {
    const [oldRel, newName] = Array.isArray(item) ? item : [item, item.split('/').pop()];
    const oldPath = `${SYNC}/${oldRel}`;
    const newPath = `${SYNC}/${carpeta}/${newName}`;
    FILE_MOVE[oldPath] = newPath;
  }
}

if (Object.keys(FILE_MOVE).length !== 88) {
  console.error(`Mapa de producción tiene ${Object.keys(FILE_MOVE).length} entradas, se esperaban 88.`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// 2) Tests — heurística: cada test se muda a la __tests__ de la carpeta
//    del primer import de sync que tenga (spec §3.1 "Tests"), salvo
//    excepciones explícitas.
// ---------------------------------------------------------------------
const TEST_DIR = `${SYNC}/__tests__`;
const EXCEPCIONES_TEST = {
  // spec §3.1: "integration/relayRls.int.test.ts va a adaptadores/supabase/__tests__/integration/"
  [`${TEST_DIR}/integration/relayRls.int.test.ts`]: `${SYNC}/adaptadores/supabase/__tests__/integration/relayRls.int.test.ts`,
};

function primerImportDeSync(contenido) {
  const re = /(?:from|require\(|import\()\s*['"](\.\.?\/[^'"]+|@\/src\/sync\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(contenido))) {
    let spec = m[1];
    if (spec.startsWith('@/src/sync/')) return spec.slice('@/'.length); // 'src/sync/...'
    if (spec.startsWith('.')) {
      // relativo desde src/sync/__tests__/ (o .../integration/)
      const resuelto = resolvePath('/' + TEST_DIR, spec).slice(1);
      if (resuelto.startsWith(SYNC + '/')) return resuelto;
    }
  }
  return null;
}

function carpetaNuevaDeProduccion(oldSyncRelPath) {
  // oldSyncRelPath: 'src/sync/relay/publicar.ts' | 'src/sync/relayEngine.ts' (sin o con .ts)
  const conExt = oldSyncRelPath.endsWith('.ts') ? oldSyncRelPath : `${oldSyncRelPath}.ts`;
  const nuevo = FILE_MOVE[conExt];
  if (!nuevo) return null;
  // 'src/sync/<carpeta>/...' -> <carpeta> (puede tener sub-carpeta, p.ej. adaptadores/supabase)
  const rel = nuevo.slice(`${SYNC}/`.length);
  const partes = rel.split('/');
  partes.pop();
  return partes.join('/');
}

function planificarTests() {
  const archivos = readdirRecursivo(join(ROOT, TEST_DIR)).filter(f => /\.test\.tsx?$/.test(f));
  const plan = {};
  for (const abs of archivos) {
    const rel = relative(ROOT, abs).split('\\').join('/');
    if (EXCEPCIONES_TEST[rel]) {
      plan[rel] = EXCEPCIONES_TEST[rel];
      continue;
    }
    const contenido = readFileSync(abs, 'utf8');
    const primero = primerImportDeSync(contenido);
    if (!primero) {
      // sin import de sync detectable — se queda donde está (revisar a mano)
      continue;
    }
    const carpeta = carpetaNuevaDeProduccion(primero);
    if (!carpeta) continue; // import a algo no mapeado (p.ej. otro test) — se queda, revisar a mano
    const nombre = rel.split('/').pop();
    plan[rel] = `${SYNC}/${carpeta}/__tests__/${nombre}`;
  }
  return plan;
}

function readdirRecursivo(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...readdirRecursivo(p));
    else out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------
// 3) Ejecutar git mv
// ---------------------------------------------------------------------
function gitMv(oldRel, newRel) {
  const newAbs = join(ROOT, newRel);
  mkdirSync(dirname(newAbs), { recursive: true });
  execSync(`git mv "${oldRel}" "${newRel}"`, { cwd: ROOT, stdio: 'inherit' });
}

function ejecutarMudanza() {
  const testPlan = planificarTests();
  console.log(`Producción a mover: ${Object.keys(FILE_MOVE).length}`);
  console.log(`Tests a mover: ${Object.keys(testPlan).length}`);

  if (process.env.MUDANZA_DRY) {
    for (const [o, n] of Object.entries(testPlan)) console.log(`${o} -> ${n}`);
    const archivos = readdirRecursivo(join(ROOT, TEST_DIR)).filter(f => /\.test\.tsx?$/.test(f));
    const sinPlan = archivos
      .map(a => relative(ROOT, a).split('\\').join('/'))
      .filter(rel => !testPlan[rel]);
    console.log(`Tests SIN plan (se quedan donde están, revisar a mano): ${sinPlan.length}`);
    for (const s of sinPlan) console.log(`  ${s}`);
    process.exit(0);
  }

  for (const [oldRel, newRel] of Object.entries(FILE_MOVE)) gitMv(oldRel, newRel);
  for (const [oldRel, newRel] of Object.entries(testPlan)) gitMv(oldRel, newRel);

  return { ...FILE_MOVE, ...testPlan };
}

// ---------------------------------------------------------------------
// 4) Reescritura de especificadores en TODO el árbol
// ---------------------------------------------------------------------
const EXT_CODE = new Set(['.ts', '.tsx']);
function archivosDeCodigo(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === 'node_modules' || d.name === '.git') continue;
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...archivosDeCodigo(p));
    else if (EXT_CODE.has(p.slice(p.lastIndexOf('.')))) out.push(p);
  }
  return out;
}

function quitarExt(p) {
  return p.replace(/\.tsx?$/, '');
}

function carpetaTopSync(repoRelPath) {
  if (!repoRelPath.startsWith(`${SYNC}/`)) return null;
  return repoRelPath.slice(`${SYNC}/`.length).split('/')[0];
}

function reescribirEspecificadores(ALL_MOVES) {
  // ALL_MOVES: oldRepoRelPath ('src/sync/...') -> newRepoRelPath, ambos CON extensión .ts/.tsx
  const patrones = [
    /(\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?)(['"])([^'"]+)\2/g,
    /(\bexport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?)(['"])([^'"]+)\2/g,
    /(\brequire\(\s*)(['"])([^'"]+)\2(\s*\))/g,
    /(\bimport\(\s*)(['"])([^'"]+)\2(\s*\))/g,
    /(\btypeof\s+import\(\s*)(['"])([^'"]+)\2(\s*\))/g,
    /(\bjest\.mock\(\s*)(['"])([^'"]+)\2/g,
    /(\bjest\.doMock\(\s*)(['"])([^'"]+)\2/g,
    /(\bjest\.requireActual\(\s*)(['"])([^'"]+)\2/g,
    /(\bjest\.requireMock\(\s*)(['"])([^'"]+)\2/g,
  ];

  const DIRS = ['src', 'app', 'components', 'hooks'].map(d => join(ROOT, d));
  const archivos = DIRS.flatMap(archivosDeCodigo);
  let tocados = 0;

  for (const abs of archivos) {
    const relNew = relative(ROOT, abs).split('\\').join('/'); // ruta NUEVA del archivo (ya se hizo git mv)
    // ruta VIEJA del archivo (si el archivo mismo fue movido)
    const inv = Object.entries(ALL_MOVES).find(([, n]) => n === relNew);
    const relOld = inv ? inv[0] : relNew;

    let contenido = readFileSync(abs, 'utf8');
    let cambiado = false;

    for (const re of patrones) {
      contenido = contenido.replace(re, (match, pre, quote, spec, maybePost) => {
        const post = typeof maybePost === 'string' ? maybePost : '';
        // Resolver el spec contra la ubicación VIEJA del archivo
        let oldTargetNoExt = null;
        if (spec.startsWith('.')) {
          oldTargetNoExt = relative(ROOT, resolvePath(dirname(join(ROOT, relOld)), spec)).split('\\').join('/');
        } else if (spec.startsWith('@/')) {
          oldTargetNoExt = spec.slice(2);
        } else {
          return match; // bare package, no toca
        }
        // Resolver contra el MAPA, no contra el filesystem: al llegar acá el
        // árbol viejo ya no existe (el git mv ya corrió). Probar extensiones
        // tal como se resolvía antes de la mudanza.
        let oldTargetRel = null;
        for (const ext of ['.ts', '.tsx']) {
          if (ALL_MOVES[oldTargetNoExt + ext]) { oldTargetRel = oldTargetNoExt + ext; break; }
        }
        if (!oldTargetRel) {
          for (const ext of ['.ts', '.tsx']) {
            const conIndex = `${oldTargetNoExt}/index${ext}`;
            if (ALL_MOVES[conIndex]) { oldTargetRel = conIndex; break; }
          }
        }
        if (!oldTargetRel) return match; // no es un archivo que se mudó
        const newTargetRel = ALL_MOVES[oldTargetRel];

        // Decidir alias vs relativo
        const carpetaImportador = carpetaTopSync(relNew);
        const carpetaDestino = carpetaTopSync(newTargetRel);
        let nuevoSpec;
        if (carpetaImportador && carpetaDestino && carpetaImportador === carpetaDestino) {
          let rel = relative(dirname(join(ROOT, relNew)), join(ROOT, newTargetRel)).split('\\').join('/');
          rel = quitarExt(rel);
          if (!rel.startsWith('.')) rel = './' + rel;
          nuevoSpec = rel;
        } else {
          nuevoSpec = '@/' + quitarExt(newTargetRel);
        }
        cambiado = true;
        return `${pre}${quote}${nuevoSpec}${quote}${post}`;
      });
    }

    if (cambiado) {
      writeFileSync(abs, contenido);
      tocados++;
    }
  }
  console.log(`Archivos con especificadores reescritos: ${tocados}`);
}

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------
const ALL_MOVES = ejecutarMudanza();
reescribirEspecificadores(ALL_MOVES);
console.log('Mudanza terminada. Revisar a mano: tests que leen rutas, mocks virtuales de relayEngine (D15), guards.');
