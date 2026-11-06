// Prueba de la página: la lista de categorías cambia según el departamento.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Formulario.html'), 'utf8');
const stub = require('./servidor-simulado');
const OUT = path.join(__dirname, 'salida') + '/';
fs.mkdirSync(OUT, { recursive: true });
const pagina = (datos) => html.replace('<?!= datosJson ?>', JSON.stringify(datos)).replace('<script>', stub + '<script>');

const EV = 'Evangelismo y misión', TES = 'Tesorería y finanzas', FEL = 'Feligresía (traslados, recepción de miembros)';
const PLA = 'Planes y actividades del departamento', OTR = 'Otros asuntos';
const comunes = [EV, PLA, OTR];
const varios = { clave: 'a'.repeat(32), general: false, nombre: 'Mario Arango', junta: 'jueves 26 de noviembre de 2026',
  departamentos: [{ valor: 'Tesorería', texto: 'Tesorería (Tesorero)' }, { valor: 'Ancianos', texto: 'Ancianos (Anciano)' },
    { valor: 'Escuela Sabática', texto: 'Escuela Sabática (Director)' }],
  categorias: comunes,
  categoriasPorDepartamento: { 'Tesorería': [EV, TES, PLA, OTR], 'Ancianos': [EV, FEL, PLA, OTR], 'Escuela Sabática': comunes },
  version: '1.5.0' };

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };
const opciones = (page) => page.$$eval('#categoria option', os => os.map(o => o.value).filter(Boolean));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => { fails++; console.log('ERROR JS', e.message); });
  page.on('dialog', d => d.accept());
  fs.writeFileSync(OUT + 'categorias.html', pagina(varios));
  await page.goto('file://' + OUT + 'categorias.html');

  check(JSON.stringify(await opciones(page)) === JSON.stringify(comunes), 'sin elegir departamento: solo las comunes');
  await page.selectOption('#depto', 'Tesorería');
  let o = await opciones(page);
  check(o.includes(TES) && !o.includes(FEL), 'Tesorería ve Tesorería y finanzas, no Feligresía');
  await page.selectOption('#categoria', TES);
  await page.selectOption('#depto', 'Ancianos');
  o = await opciones(page);
  check(o.includes(FEL) && !o.includes(TES), 'Ancianos ve Feligresía, no Tesorería y finanzas');
  check(await page.inputValue('#categoria') === '', 'al cambiar a un departamento sin esa categoría, se borra la elección');
  await page.selectOption('#categoria', PLA);
  await page.selectOption('#depto', 'Escuela Sabática');
  check(JSON.stringify(await opciones(page)) === JSON.stringify(comunes) && await page.inputValue('#categoria') === PLA,
    'Escuela Sabática: solo las comunes, y se conserva una elección válida');

  // Editar un punto de Feligresía presentado por Ancianos
  await page.addInitScript((p) => { window.__punto = p; window.__lista = [{ id: 'b'.repeat(32), titulo: 'Traslado', tipo: 'Informativo', departamento: 'Ancianos' }]; },
    { departamento: 'Ancianos', categoria: FEL, titulo: 'Traslado', descripcion: 'Carta de traslado.', tipo: 'Informativo' });
  await page.reload();
  await page.waitForSelector('#mis-puntos:not(.oculto)');
  await page.click('#mis-puntos-lista button');
  await page.waitForSelector('#banner-edicion:not(.oculto)');
  check(await page.inputValue('#depto') === 'Ancianos' && await page.inputValue('#categoria') === FEL, 'al editar, se carga la categoría del punto');

  // Un solo departamento: Tesorería ve sus cuatro categorías desde el inicio
  const t = await browser.newPage();
  fs.writeFileSync(OUT + 'categorias-tesoreria.html', pagina({ ...varios, departamentos: [varios.departamentos[0]] }));
  await t.goto('file://' + OUT + 'categorias-tesoreria.html');
  check(JSON.stringify(await opciones(t)) === JSON.stringify([EV, TES, PLA, OTR]), 'un solo cargo en Tesorería: sus cuatro categorías');

  // Enlace general
  const g = await browser.newPage();
  fs.writeFileSync(OUT + 'categorias-general.html', pagina({ ...varios, general: true, nombre: '', departamentos: [],
    categorias: [EV, OTR], categoriasPorDepartamento: null }));
  await g.goto('file://' + OUT + 'categorias-general.html');
  check(JSON.stringify(await opciones(g)) === JSON.stringify([EV, OTR]), 'enlace general: Evangelismo y Otros asuntos');

  await browser.close();
  console.log(fails ? fails + ' FALLAS' : 'TODO OK');
  process.exitCode = fails ? 1 : 0;
})();
