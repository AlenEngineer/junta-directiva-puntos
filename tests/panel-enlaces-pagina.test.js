// Prueba de la pestaña Enlaces del panel: estado por persona, filtros, WhatsApp, correos y cambio de enlace (datos ficticios).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Panel.html'), 'utf8');
const stub = require('./servidor-simulado');
const OUT = path.join(__dirname, 'salida') + '/';
fs.mkdirSync(OUT, { recursive: true });
const pagina = (datos) => html.replace('<?!= datosJson ?>', JSON.stringify(datos)).replace('<script>', stub + '<script>');

const CATS = ['Evangelismo y misión', 'Otros asuntos'];
const URL = 'https://script.google.com/macros/s/x/exec?t=';
const persona = (nombre, cargo, director, extra) => Object.assign({ nombre, cargos: [cargo], director, enlace: URL + nombre.length,
  whatsapp: 'https://wa.me/50761111111?text=hola', telefono: 'ok', correo: nombre.split(' ')[0].toLowerCase() + '@ejemplo.org',
  correoEstado: 'Pendiente', puntos: 0 }, extra);
const enlaces = {
  junta: { fecha: '26/11/2026', dia: 'jueves 26 de noviembre de 2026' },
  sinUrl: false,
  personas: [
    persona('Daniel Rivas', 'Anciano – Ancianos', true, { puntos: 2, correoEstado: 'Enviado 05/11 20:10' }),
    persona('Marta Ruiz', 'Directora – Jóvenes', true),
    persona('Pedro Gil', 'Asociado – Jóvenes', false, { telefono: 'sin teléfono', whatsapp: 'https://wa.me/?text=hola', correo: '', correoEstado: 'Sin correo' }),
    persona('Ana Soto', 'Asociada – Música', false, { correoEstado: 'Pendiente' })
  ],
  general: { enlace: URL + 'g', whatsapp: 'https://wa.me/?text=general', puntos: 1 }
};

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('pageerror', e => { fails++; console.log('ERROR JS', e.message); });
  const dialogos = [];
  page.on('dialog', d => { dialogos.push(d.message()); d.accept(); });
  await page.addInitScript(({ enlaces, CATS }) => {
    window.__correos = []; window.__cambiados = []; window.__sinJunta = false;
    window.__srvExtra = {
      panelDatos: () => ({ usuario: 'admin@ejemplo.org', version: '1.9.0', moneda: 'B/.', seleccionada: '26/11/2026',
        juntas: [{ fecha: '26/11/2026', dia: 'jueves 26', estado: 'Abierta' }], estados: ['Recibido', 'Por revisar', 'Aprobado', 'Rechazado'], categorias: CATS }),
      panelPuntos: () => [],
      panelEnlaces: () => {
        if (window.__sinJunta) return { junta: null };
        const e = JSON.parse(JSON.stringify(enlaces));
        e.personas.forEach((p) => { if (window.__correos.flat().includes(p.nombre)) p.correoEstado = 'Enviado 06/11 09:00'; });
        return e;
      },
      panelEnviarCorreos: (nombres) => { window.__correos.push(nombres); return { enviados: nombres.length, errores: [] }; },
      panelCambiarEnlace: (n) => { window.__cambiados.push(n); return { ok: true }; }
    };
  }, { enlaces, CATS });
  fs.writeFileSync(OUT + 'panel-enlaces.html', pagina({ usuario: 'admin@ejemplo.org', version: '1.9.0' }));
  await page.goto('file://' + OUT + 'panel-enlaces.html');
  await page.waitForSelector('#junta option', { state: 'attached' });
  await page.click('.pestana[data-vista="enlaces"]');
  await page.waitForSelector('.persona');

  check(!(await page.isVisible('#junta-grupo')) && !(await page.isVisible('#filtros')) && await page.isVisible('#enlaces-barra'),
    'la pestaña Enlaces oculta la junta y los filtros de puntos');
  const res = await page.textContent('#enlaces-resumen');
  check(res.includes('4 personas') && res.includes('1 enviaron puntos') && res.includes('3 aún no') && res.includes('2 correo(s) pendiente(s)'), 'resumen: quién envió y correos pendientes');
  check((await page.textContent('#enlaces-junta')).includes('jueves 26 de noviembre de 2026'), 'dice de qué junta son los enlaces');
  const secciones = await page.$$eval('.seccion-enlaces h2', (e) => e.map((x) => x.textContent));
  check(secciones.join('|') === 'Directores|Asociados y miembros|Enlace general (miembros de la iglesia)', 'directores, asociados y enlace general');
  const daniel = await page.textContent('.persona[data-nombre="Daniel Rivas"]');
  check(daniel.includes('2 puntos enviados') && daniel.includes('Correo enviado 05/11 20:10') && daniel.includes('Reenviar correo'), 'Daniel: puntos enviados y correo ya enviado');
  const pedro = await page.textContent('.persona[data-nombre="Pedro Gil"]');
  check(pedro.includes('Aún no envía puntos') && pedro.includes('Sin teléfono') && pedro.includes('WhatsApp (elegir contacto)') && !pedro.includes('Enviar correo'),
    'Pedro: sin teléfono ni correo');
  check((await page.getAttribute('.persona[data-nombre="Daniel Rivas"] a.btn-whatsapp', 'href')) === 'https://wa.me/50761111111?text=hola' &&
    (await page.getAttribute('.persona[data-nombre="Daniel Rivas"] a.btn-whatsapp', 'target')) === '_blank', 'botón de WhatsApp en otra pestaña');
  check((await page.textContent('.persona[data-nombre="GENERAL"]')).includes('1 punto recibido'), 'enlace general con sus puntos');
  await page.screenshot({ path: OUT + 'e1-enlaces.png', fullPage: true });

  // Filtros
  await page.selectOption('#e-filtro', 'sin-puntos');
  let nombres = await page.$$eval('.persona', (e) => e.map((x) => x.dataset.nombre));
  check(nombres.join() === 'Marta Ruiz,Pedro Gil,Ana Soto', 'filtro "Aún no envían puntos" (sin el enlace general)');
  await page.selectOption('#e-filtro', 'correo');
  nombres = await page.$$eval('.persona', (e) => e.map((x) => x.dataset.nombre));
  check(nombres.join() === 'Marta Ruiz,Ana Soto', 'filtro "Correo pendiente"');
  await page.selectOption('#e-filtro', '');
  await page.fill('#e-texto', 'musica');
  nombres = await page.$$eval('.persona', (e) => e.map((x) => x.dataset.nombre));
  check(nombres.join() === 'Ana Soto', 'buscar por departamento, sin tildes');
  await page.fill('#e-texto', '');

  // Enviar correos pendientes
  check((await page.textContent('#enlaces-correos')).includes('(2)'), 'botón con la cantidad de correos pendientes');
  await page.click('#enlaces-correos');
  await page.waitForFunction(() => window.__correos.length === 1);
  check((await page.evaluate(() => window.__correos[0])).join() === 'Marta Ruiz,Ana Soto' && dialogos.some((d) => d.includes('2 persona(s)')),
    'envía solo a los pendientes, después de confirmar');
  await page.waitForFunction(() => document.querySelector('#enlaces-correos').textContent !== 'Enviando…');
  check((await page.textContent('#enlaces-correos')) === 'No hay correos pendientes', 'al terminar ya no quedan pendientes');

  // Reenviar a una persona y cambiar un enlace
  await page.click('.persona[data-nombre="Daniel Rivas"] button:has-text("Reenviar correo")');
  await page.waitForFunction(() => window.__correos.length === 2);
  check((await page.evaluate(() => window.__correos[1])).join() === 'Daniel Rivas', 'reenviar el correo a una persona');
  await page.waitForSelector('.persona');
  await page.click('.persona[data-nombre="Ana Soto"] button:has-text("Cambiar enlace")');
  await page.waitForFunction(() => window.__cambiados.length === 1);
  check((await page.evaluate(() => window.__cambiados[0])) === 'Ana Soto' && dialogos.some((d) => d.includes('dejará de funcionar')),
    'cambiar un enlace pide confirmación');
  await page.waitForSelector('.persona');
  await page.click('.persona[data-nombre="GENERAL"] button:has-text("Cambiar enlace")');
  await page.waitForFunction(() => window.__cambiados.length === 2);
  check((await page.evaluate(() => window.__cambiados[1])) === 'GENERAL', 'cambiar el enlace general');

  // Celular
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForSelector('.persona');
  check(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, 'se ve bien en el celular');
  await page.screenshot({ path: OUT + 'e2-enlaces-movil.png', fullPage: true });

  // Sin junta abierta; y volver a Puntos muestra otra vez la junta
  await page.evaluate(() => { window.__sinJunta = true; });
  await page.click('.pestana[data-vista="puntos"]');
  check(await page.isVisible('#junta-grupo'), 'en Puntos vuelve a aparecer la junta');
  await page.click('.pestana[data-vista="enlaces"]');
  await page.waitForSelector('#enlaces .vacio');
  check((await page.textContent('#enlaces')).includes('No hay una junta abierta') && !(await page.isVisible('#enlaces-barra')), 'sin junta abierta lo explica');

  await browser.close();
  console.log(fails ? fails + ' FALLAS' : 'TODO OK');
  process.exitCode = fails ? 1 : 0;
})();
