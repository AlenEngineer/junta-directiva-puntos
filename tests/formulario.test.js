const fs = require('fs');
const { chromium } = require('playwright');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'Formulario.html'), 'utf8');
const CATS = ['Evangelismo y misión','Tesorería y finanzas','Departamentos','Feligresía (traslados, recepción de miembros)','Asuntos generales'];
const TIEMPOS = ['5 minutos','10 minutos','15 minutos','20 minutos','30 minutos o más'];
function pagina(datos) {
  const stub = `<script>window.__envios=[];window.google={script:{run:(function(){var s,f;var r={withSuccessHandler:function(x){s=x;return r;},withFailureHandler:function(x){f=x;return r;},enviarPunto:function(c,d){window.__envios.push(d);setTimeout(function(){s({ok:true});},30);}};return r;})()}};</script>`;
  return html.replace('<?!= datosJson ?>', JSON.stringify(datos)).replace('<script>', stub + '<script>');
}
const daniel = { clave: 'a'.repeat(32), general: false, nombre: 'Daniel Rivas', junta: 'domingo 14 de marzo de 2027',
  departamentos: [{valor:'Escuela Sabática',texto:'Escuela Sabática (Director)'},{valor:'Ancianos',texto:'Ancianos (Anciano)'}],
  categorias: CATS, tiempos: TIEMPOS };
const OUT = require('path').join(__dirname, 'salida') + '/'; fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => { fails++; console.log('ERROR JS', e.message); });
  fs.writeFileSync(OUT + 'p.html', pagina(daniel));
  await page.goto('file://' + OUT + 'p.html');
  await page.screenshot({ path: OUT + '1-inicio.png', fullPage: true });
  check(await page.isVisible('#q-depto'), 'muestra departamento si tiene varios');
  check(!(await page.isVisible('#q-nombre')), 'oculta nombre con enlace personal');
  // validación vacía
  await page.click('#siguiente');
  check(await page.locator('.pregunta.error').count() === 6, 'marca 6 preguntas obligatorias vacías');
  await page.screenshot({ path: OUT + '2-errores.png', fullPage: true });
  // informativo → enviar
  await page.selectOption('#depto', 'Escuela Sabática');
  await page.selectOption('#categoria', CATS[0]);
  await page.fill('#titulo', 'Informe de bautismos');
  await page.fill('#descripcion', 'Se informa que hubo 3 bautismos.');
  await page.check('input[name=tipo][value="Informativo"]');
  await page.selectOption('#tiempo', '5 minutos');
  check((await page.textContent('#siguiente')) === 'Enviar', 'informativo: el botón dice Enviar');
  check((await page.textContent('#pagina-texto')) === 'Página 1 de 1', 'informativo: Página 1 de 1');
  await page.click('#siguiente');
  await page.waitForSelector('#hecho:not(.oculto)');
  let env = await page.evaluate(() => window.__envios[0]);
  check(env.tipo === 'Informativo' && env.costo === undefined && env.departamento === 'Escuela Sabática', 'informativo enviado sin presupuesto');
  // votación con actividad y dinero
  await page.click('#otro');
  await page.selectOption('#depto', 'Ancianos');
  await page.selectOption('#categoria', CATS[2]);
  await page.fill('#titulo', 'Retiro de jóvenes');
  await page.fill('#descripcion', 'Votar el retiro de jóvenes.');
  await page.check('input[name=tipo][value="Para votación"]');
  await page.selectOption('#tiempo', '15 minutos');
  check((await page.textContent('#siguiente')) === 'Siguiente', 'votación: el botón dice Siguiente');
  await page.click('#siguiente');
  check(await page.isVisible('#pag2') && !(await page.isVisible('.actividad')), 'página 2 visible, actividad oculta');
  await page.check('input[name=esActividad][value="Sí"]');
  check(await page.isVisible('.actividad'), 'al marcar Sí aparecen los datos de la actividad');
  await page.fill('#actFecha', '2027-03-20');
  // Varios días: término antes del inicio se rechaza; luego un campamento de 3 días.
  await page.fill('#actFechaFin', '2027-03-18');
  await page.fill('#actInicio', '09:00');
  await page.fill('#actFin', '08:00');
  await page.fill('#lugar', 'Campamento');
  await page.fill('#responsable', 'Ernesto Molina');
  await page.check('input[name=dinero][value="Sí"]');
  await page.click('#siguiente');
  check((await page.textContent('[data-v=actFechaFin] .msg-error span')).includes('antes'), 'fecha de término antes del inicio rechazada');
  await page.fill('#actFechaFin', '2027-03-22');
  check(await page.isVisible('#ayuda-inicio') && await page.isVisible('#ayuda-fin'), 'varios días: aclara primer y último día');
  await page.fill('#actFechaFin', '');
  await page.click('#siguiente');
  check((await page.textContent('[data-v=actFin] .msg-error span')).includes('después'), 'un día: hora de término antes del inicio rechazada');
  await page.fill('#actFechaFin', '2027-03-22');
  check(!(await page.isVisible('[data-v=actFin].error')), 'al poner varios días se quita el error de la hora de término');
  await page.fill('#actInicio', '09:00');
  await page.fill('#lugar', 'Campamento');
  await page.fill('#responsable', 'Ernesto Molina');
  await page.check('input[name=dinero][value="Sí"]');
  await page.screenshot({ path: OUT + '3-actividad.png', fullPage: true });
  await page.click('#siguiente');
  check(await page.isVisible('#pag3'), 'página 3 presupuesto');
  check((await page.textContent('#pagina-texto')) === 'Página 3 de 3', 'Página 3 de 3');
  await page.fill('#costo', '500');
  await page.fill('#monto', '700');
  await page.click('#siguiente');
  check((await page.textContent('[data-v=monto] .msg-error span')).includes('mayor'), 'monto mayor que costo rechazado');
  check((await page.textContent('[data-v=cotizacion] .msg-error span')).includes('al menos una'), 'exige al menos una explicación');
  await page.fill('#monto', '200');
  check(await page.isVisible('#q-estrategia'), 'aparece estrategia cuando monto < costo');
  await page.fill('#estrategia', 'Venta de comida y aportes de los hermanos');
  // archivo: tipo inválido
  fs.writeFileSync(OUT + 'malo.exe', 'x');
  await page.setInputFiles('#archivo', OUT + 'malo.exe');
  check((await page.textContent('[data-v=cotizacion] .msg-error span')).includes('no permitido'), 'rechaza .exe');
  fs.writeFileSync(OUT + 'cotizacion.pdf', '%PDF-1.4 prueba de cotización');
  await page.setInputFiles('#archivo', OUT + 'cotizacion.pdf');
  await page.waitForSelector('#chip:not(.oculto)');
  await page.screenshot({ path: OUT + '4-presupuesto.png', fullPage: true });
  await page.click('#siguiente');
  await page.waitForSelector('#hecho:not(.oculto)');
  env = await page.evaluate(() => window.__envios[1]);
  check(env.archivo && env.archivo.nombre === 'cotizacion.pdf' && Buffer.from(env.archivo.base64, 'base64').toString().startsWith('%PDF'), 'archivo enviado en base64');
  check(env.monto === '200' && env.estrategia && env.actFecha === '2027-03-20', 'datos de presupuesto y actividad enviados');
  check(env.actFechaFin === '2027-03-22' && env.actFin === '08:00', 'fecha de término enviada');
  await page.screenshot({ path: OUT + '5-enviado.png', fullPage: true });
  // atrás desde página 3 vuelve a 2
  // enlace general en móvil
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  fs.writeFileSync(OUT + 'g.html', pagina({ ...daniel, general: true, nombre: '', departamentos: [] }));
  await m.goto('file://' + OUT + 'g.html');
  check(await m.isVisible('#q-nombre') && !(await m.isVisible('#q-depto')), 'enlace general pide nombre, no departamento');
  const ancho = await m.evaluate(() => document.documentElement.scrollWidth);
  check(ancho <= 390, 'sin scroll horizontal en móvil (' + ancho + 'px)');
  await m.screenshot({ path: OUT + '6-movil-general.png', fullPage: true });
  // enlace inválido
  fs.writeFileSync(OUT + 'i.html', pagina(null));
  await m.goto('file://' + OUT + 'i.html');
  check(await m.isVisible('#invalido') && !(await m.isVisible('#form')), 'enlace inválido muestra aviso');
  await browser.close();
  console.log(fails ? fails + ' FALLAS' : 'TODO OK'); process.exitCode = fails ? 1 : 0;
})();
