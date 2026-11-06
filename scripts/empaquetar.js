// Une el código fuente de src/ en los archivos que se publican en Apps Script (dist/):
//   dist/Codigo.gs        ← todos los archivos de src/servidor/, en orden alfabético
//   dist/Formulario.html  ← src/formulario/Formulario.html con estilos.css y formulario.js adentro
//   dist/Panel.html       ← src/panel/Panel.html con panel.css y panel.js adentro
//   dist/appsscript.json  ← copia de src/appsscript.json
// Uso: node scripts/empaquetar.js   (npm test lo ejecuta antes de las pruebas)
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const src = path.join(raiz, 'src');
const dist = path.join(raiz, 'dist');
fs.mkdirSync(dist, { recursive: true });
const leer = (...p) => fs.readFileSync(path.join(src, ...p), 'utf8');

const version = (/var VERSION = '([^']+)'/.exec(leer('servidor', '00-Config.js')) || [])[1];

// ---- Codigo.gs ----
const archivos = fs.readdirSync(path.join(src, 'servidor')).filter((f) => f.endsWith('.js')).sort();
const encabezado = `/**
 * PUNTOS PARA LA JUNTA DIRECTIVA · versión ${version}
 * https://github.com/AlenEngineer/junta-directiva-puntos
 *
 * ARCHIVO GENERADO: no lo edite aquí. El código fuente está en src/servidor/
 * del repositorio, dividido por tema; este archivo los une (scripts/empaquetar.js).
 * Instalación y actualización: ver README.md.
 */
`;
const codigo = encabezado + archivos.map((f) =>
  `\n// ======================================================================\n// ${f}\n// ======================================================================\n\n` +
  leer('servidor', f).trim() + '\n').join('');
fs.writeFileSync(path.join(dist, 'Codigo.gs'), codigo);

// ---- Páginas: Formulario.html y Panel.html (con sus estilos y su lógica adentro) ----
const sangrar = (texto, n) => texto.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');
function pagina(carpeta, archivo) {
  const html = leer(carpeta, archivo).replace(/^@@INCLUIR (\S+)@@$/gm, (_, incluido) => {
    const contenido = leer(carpeta, incluido).trimEnd();
    return incluido.endsWith('.css') ? sangrar(contenido, 2) : contenido;
  });
  if (html.includes('@@INCLUIR')) throw new Error('Quedó un @@INCLUIR sin reemplazar en ' + archivo);
  fs.writeFileSync(path.join(dist, archivo), html);
}
pagina('formulario', 'Formulario.html');
pagina('panel', 'Panel.html');

// ---- appsscript.json ----
fs.copyFileSync(path.join(src, 'appsscript.json'), path.join(dist, 'appsscript.json'));

console.log(`dist/ listo (versión ${version}): Codigo.gs con ${archivos.length} archivos, Formulario.html, Panel.html, appsscript.json`);
