// Prueba de la página del panel: lista, filtros, detalle y aprobar/rechazar (servidor simulado, datos ficticios).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Panel.html'), 'utf8');
const stub = require('./servidor-simulado');
const OUT = path.join(__dirname, 'salida') + '/';
fs.mkdirSync(OUT, { recursive: true });
const pagina = (datos) => html.replace('<?!= datosJson ?>', JSON.stringify(datos)).replace('<script>', stub + '<script>');

const CATS = ['Evangelismo y misión', 'Tesorería y finanzas', 'Feligresía (traslados, recepción de miembros)', 'Planes y actividades del departamento', 'Otros asuntos'];
const puntos = [
  { id: '1'.repeat(32), enviado: '05/11/2026 20:10', ultimaEdicion: '', ediciones: 0, presenta: 'Daniel Rivas', departamento: 'Ancianos',
    general: false, estado: 'Recibido', categoria: CATS[3], titulo: 'Campamento de jóvenes', descripcion: 'Votar el campamento.', tipo: 'Para votación',
    material: { archivo: '', enlace: 'https://youtu.be/x' },
    actividad: { inicio: '20/03/2027', fin: '22/03/2027', horaInicio: '09:00', horaFin: '12:00', lugar: 'Campamento', responsable: 'Ernesto', asistencia: '40' },
    dinero: { costo: 500, monto: 300, estrategia: 'Aportes', descripcion: 'Transporte', enlace: '', archivo: 'https://drive.google.com/archivo/x' } },
  { id: '2'.repeat(32), enviado: '05/11/2026 21:00', ultimaEdicion: '06/11/2026 08:00', ediciones: 1, presenta: 'María Torres', departamento: 'Miembro de la iglesia',
    general: true, estado: 'Por revisar', categoria: CATS[4], titulo: 'Propuesta de un miembro', descripcion: 'Detalle.', tipo: 'Informativo',
    material: { archivo: '', enlace: '' }, actividad: null, dinero: null },
  { id: '3'.repeat(32), enviado: '04/11/2026 10:00', ultimaEdicion: '', ediciones: 0, presenta: 'Luis Rivas', departamento: 'Comunicación',
    general: false, estado: 'Recibido', categoria: CATS[0], titulo: 'Campaña de evangelismo', descripcion: 'Plan.', tipo: 'Informativo',
    material: { archivo: '', enlace: '' }, actividad: null, dinero: null }
];

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('pageerror', e => { fails++; console.log('ERROR JS', e.message); });
  page.on('dialog', d => d.accept());
  await page.addInitScript(({ puntos, CATS }) => {
    window.__cambios = [];
    window.__srvExtra = {
      panelDatos: () => ({ usuario: 'admin@ejemplo.org', version: '1.7.0', moneda: 'B/.', seleccionada: '26/11/2026',
        juntas: [{ fecha: '26/11/2026', dia: 'jueves 26 de noviembre de 2026', estado: 'Abierta' }, { fecha: '12/11/2026', dia: 'jueves 12 de noviembre de 2026', estado: 'Cerrada' }],
        estados: ['Recibido', 'Por revisar', 'Aprobado', 'Rechazado'], categorias: CATS }),
      panelPuntos: (fecha) => (fecha === '26/11/2026' ? JSON.parse(JSON.stringify(puntos)) : []),
      panelCambiarEstado: (id, estado) => { window.__cambios.push([id, estado]); return { ok: true }; }
    };
  }, { puntos, CATS });
  fs.writeFileSync(OUT + 'panel.html', pagina({ usuario: 'admin@ejemplo.org', version: '1.7.0' }));
  await page.goto('file://' + OUT + 'panel.html');
  await page.waitForSelector('.punto');

  const titulos = await page.$$eval('.punto-titulo', (e) => e.map((x) => x.textContent));
  check(titulos.length === 3 && titulos[0] === 'Propuesta de un miembro' && titulos[1] === 'Campaña de evangelismo',
    'lista: primero los "Por revisar", luego por orden de agenda');
  check((await page.textContent('#resumen')).includes('3 puntos') && (await page.textContent('#resumen')).includes('1 por revisar'), 'resumen con conteos');
  check((await page.textContent('#usuario')) === 'admin@ejemplo.org', 'muestra quién está conectado');

  // Filtros
  await page.click('#resumen .chip.filtro');
  check((await page.$$('.punto')).length === 1, 'el botón "por revisar" filtra');
  await page.selectOption('#f-estado', '');
  await page.fill('#f-texto', 'campamento');
  check((await page.$$('.punto')).length === 1 && (await page.textContent('.punto-titulo')) === 'Campamento de jóvenes', 'buscar por texto');
  await page.fill('#f-texto', '');
  await page.selectOption('#f-depto', 'Comunicación');
  check((await page.$$('.punto')).length === 1, 'filtrar por departamento');
  await page.selectOption('#f-depto', '');

  // Detalle
  await page.click('.punto[data-id="' + '1'.repeat(32) + '"] .punto-cabeza');
  const det = await page.textContent('.punto[data-id="' + '1'.repeat(32) + '"] .punto-detalle');
  check(det.includes('20/03/2027 al 22/03/2027') && det.includes('B/. 300.00') && det.includes('Abrir el archivo') && det.includes('Material de apoyo'),
    'detalle con actividad, presupuesto y archivos');
  await page.screenshot({ path: OUT + 'p1-panel.png', fullPage: true });

  // Aprobar
  await page.click('.punto[data-id="' + '1'.repeat(32) + '"] .btn-aprobar');
  await page.waitForFunction(() => window.__cambios.length === 1);
  await page.waitForSelector('.punto[data-id="' + '1'.repeat(32) + '"] .chip.aprobado');
  check(JSON.stringify(await page.evaluate(() => window.__cambios[0])) === JSON.stringify(['1'.repeat(32), 'Aprobado']), 'aprobar llama al servidor');
  check(await page.isVisible('#aviso'), 'muestra un aviso de confirmación');

  // Rechazar el del enlace general (con confirmación)
  await page.click('.punto[data-id="' + '2'.repeat(32) + '"] .punto-cabeza');
  check((await page.textContent('.punto[data-id="' + '2'.repeat(32) + '"]')).includes('enlace general'), 'indica que vino del enlace general');
  await page.click('.punto[data-id="' + '2'.repeat(32) + '"] .btn-rechazar');
  await page.waitForFunction(() => window.__cambios.length === 2);
  await page.waitForSelector('.punto[data-id="' + '2'.repeat(32) + '"] .chip.rechazado');
  check((await page.textContent('#resumen')).indexOf('por revisar') < 0, 'al rechazarlo, ya no queda nada por revisar');

  // Otra junta sin puntos
  await page.selectOption('#junta', '12/11/2026');
  await page.waitForSelector('.vacio');
  check((await page.textContent('.vacio')).includes('Todavía no hay puntos'), 'otra junta sin puntos');

  // Celular sin desplazamiento horizontal
  await page.setViewportSize({ width: 390, height: 844 });
  await page.selectOption('#junta', '26/11/2026');
  await page.waitForSelector('.punto');
  check(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, 'se ve bien en el celular');
  await page.screenshot({ path: OUT + 'p2-panel-movil.png', fullPage: true });

  // Sin permiso
  const s = await browser.newPage();
  fs.writeFileSync(OUT + 'panel-sin.html', pagina(null));
  await s.goto('file://' + OUT + 'panel-sin.html');
  check(await s.isVisible('#sin-acceso') && !(await s.isVisible('#panel')), 'sin permiso muestra "No tiene acceso"');

  await browser.close();
  console.log(fails ? fails + ' FALLAS' : 'TODO OK');
  process.exitCode = fails ? 1 : 0;
})();
