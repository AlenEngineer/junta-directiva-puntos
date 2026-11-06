// Prueba de la página: el saldo de tesorería del departamento elegido (montos inventados).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Formulario.html'), 'utf8');
const stub = require('./servidor-simulado');
const OUT = path.join(__dirname, 'salida') + '/';
fs.mkdirSync(OUT, { recursive: true });
const CATS = ['Evangelismo y misión', 'Tesorería y finanzas', 'Departamentos', 'Feligresía (traslados, recepción de miembros)', 'Asuntos generales'];
const pagina = (datos) => html.replace('<?!= datosJson ?>', JSON.stringify(datos)).replace('<script>', stub + '<script>');
const saldos = { periodo: 'octubre 2026', moneda: 'B/.', porDepartamento: {
  'Escuela Sabática': [{ fondo: 'FONDO DE PRUEBA A', saldoAnterior: 10, ingresos: 2, egresos: 1.5, transferencias: 0, saldo: 10.5 }],
  'Ancianos': [{ fondo: 'FONDO DE PRUEBA B', saldoAnterior: 1000.25, ingresos: 0, egresos: 0, transferencias: 20, saldo: 1020.25 }]
} };
const base = { clave: 'a'.repeat(32), general: false, nombre: 'Daniel Rivas', junta: 'jueves 26 de noviembre de 2026',
  departamentos: [{ valor: 'Escuela Sabática', texto: 'Escuela Sabática (Director)' }, { valor: 'Ancianos', texto: 'Ancianos (Anciano)' },
    { valor: 'Educación', texto: 'Educación (Director)' }],
  categorias: CATS, saldos, version: '1.4.0' };

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };

async function hastaPresupuesto(page, depto) {
  await page.selectOption('#depto', depto);
  await page.selectOption('#categoria', CATS[2]);
  await page.fill('#titulo', 'Compra');
  await page.check('input[name=tipo][value="Para votación"]');
  await page.fill('#descripcion', 'Votar la compra.');
  await page.click('#siguiente');
  await page.check('input[name=esActividad][value="No"]');
  await page.check('input[name=dinero][value="Sí"]');
  await page.click('#siguiente');
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('pageerror', e => { fails++; console.log('ERROR JS', e.message); });
  fs.writeFileSync(OUT + 'saldo.html', pagina(base));
  await page.goto('file://' + OUT + 'saldo.html');

  await hastaPresupuesto(page, 'Ancianos');
  check(await page.isVisible('#saldo-depto'), 'muestra el fondo del departamento elegido');
  const texto = await page.textContent('#saldo-depto');
  check(texto.includes('FONDO DE PRUEBA B') && texto.includes('Saldo: B/. 1,020.25') && texto.includes('octubre 2026'),
    'saldo con moneda, separador de miles y periodo');
  check(texto.includes('Transferencias B/. 20.00') && !texto.includes('FONDO DE PRUEBA A'), 'solo el fondo de ese departamento, con su detalle');
  await page.screenshot({ path: OUT + 's1-saldo.png', fullPage: true });

  // Cambiar el departamento cambia el fondo
  await page.click('#atras'); await page.click('#atras');
  await page.selectOption('#depto', 'Escuela Sabática');
  await page.click('#siguiente'); await page.click('#siguiente');
  const t2 = await page.textContent('#saldo-depto');
  check(t2.includes('FONDO DE PRUEBA A') && t2.includes('Saldo: B/. 10.50') && !t2.includes('Transferencias'),
    'al cambiar de departamento, cambia el fondo (sin transferencias si son 0)');

  // Un departamento sin fondo no muestra la tarjeta
  await page.click('#atras'); await page.click('#atras');
  await page.selectOption('#depto', 'Educación');
  await page.click('#siguiente'); await page.click('#siguiente');
  check(!(await page.isVisible('#saldo-depto')), 'un departamento sin fondo no muestra la tarjeta');

  // Sin datos de saldos (enlace general o sin pestaña), tampoco
  const g = await browser.newPage();
  g.on('pageerror', e => { fails++; console.log('ERROR JS', e.message); });
  fs.writeFileSync(OUT + 'saldo-general.html', pagina({ ...base, general: true, nombre: '', departamentos: [], saldos: null }));
  await g.goto('file://' + OUT + 'saldo-general.html');
  await g.fill('#nombre', 'María Torres');
  await g.selectOption('#categoria', CATS[2]);
  await g.fill('#titulo', 'Compra');
  await g.check('input[name=tipo][value="Para votación"]');
  await g.fill('#descripcion', 'Votar.');
  await g.click('#siguiente');
  await g.check('input[name=esActividad][value="No"]');
  await g.check('input[name=dinero][value="Sí"]');
  await g.click('#siguiente');
  check(await g.isVisible('#pag3') && !(await g.isVisible('#saldo-depto')), 'el enlace general no muestra saldos');

  await browser.close();
  console.log(fails ? fails + ' FALLAS' : 'TODO OK');
  process.exitCode = fails ? 1 : 0;
})();
