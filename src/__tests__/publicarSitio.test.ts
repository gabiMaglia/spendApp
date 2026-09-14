import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * T-134 (SEC3 S3-B1) — `scripts/publicar-sitio.sh` publica el sitio público.
 *
 * El script clona y pushea a GitHub, así que no se puede correr en Jest: se guarda su
 * contrato leyendo la fuente. Lo que no puede volver es copiar desde el disco, porque así
 * salía un `abrir.html` que no había pasado sus tests.
 */
const script = readFileSync(join(__dirname, '..', '..', 'scripts', 'publicar-sitio.sh'), 'utf8');
const codigo = script.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

describe('publicar-sitio.sh (T-134)', () => {
  it('toma docs/web del commit (git archive HEAD), no del árbol de trabajo', () => {
    expect(codigo).toMatch(/git -C "\$RAIZ" archive HEAD docs\/web/);
    expect(codigo).not.toMatch(/WEB="\$RAIZ\/docs\/web"/);
  });

  it('se niega a publicar si docs/web tiene cambios sin commitear', () => {
    expect(codigo).toMatch(/status --porcelain -- docs\/web/);
    expect(codigo).toMatch(/exit 1/);
  });

  it('copia .well-known (AASA de Universal Links, T-097)', () => {
    expect(codigo).toMatch(/\.well-known/);
  });
});
