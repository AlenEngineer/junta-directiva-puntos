// Prueba de la pestaña Agenda del panel: ordenar, tiempos, guardado automático, generar e imprimir (datos ficticios).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Panel.html'), 'utf8');
const stub = require('./servidor-simulado');
const OUT = path.join(__dirname, 'salida') + '/';
fs.mkdirSync(OUT, { recursive: true });
const pagina = (datos) => html.replace('<?!= datosJson ?>', JSON.stringify(datos)).replace('<script>', stub + '<script>');

const CATS = ['Evangelismo y misión', 'Tesorería y finanzas', 'Feligresía (traslados, recepción de miembros)', 'Planes y actividades del departamento', 'Otros asuntos'];
const p = (id, titulo, minutos) => ({ id: id.repeat(32), titulo, presenta: 'Daniel Rivas', departamento: 'Ancianos', tipo: 'Informativo', estado: 'Recibido', minutos });
const agenda = {
  junta: { fecha: '26/11/2026', dia: 'jueves 26 de noviembre de 2026' },
  fijos: { apertura: 'Devocional y oración de apertura', acta: 'Lectura y aprobación del acta anterior', cierre: 'Oración de clausura' },
  tiempos: [5, 10, 15, 20, 30, 45, 60],
  secciones: CATS.map((c) => ({ categoria: c, puntos: [] })),
  pendientes: [p('9', 'Propuesta de un miembro', 0)]
};
agenda.secciones[0].puntos = [p('1', 'Campaña de evangelismo', 15)];
agenda.secciones[3].puntos = [p('2', 'Campamento', 10), p('3', 'Retiro', 0), p('4', 'Feria', 5)];

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('pageerror', e => { fails++; console.log('ERROR JS', e.message); });
  await page.addInitScript(({ agenda, CATS }) => {
    window.__guardados = []; window.__generadas = 0; window.print = () => { window.__impreso = true; };
    window.__srvExtra = {
      panelDatos: () => ({ usuario: 'admin@ejemplo.org', version: '1.8.0', moneda: 'B/.', seleccionada: '26/11/2026',
        juntas: [{ fecha: '26/11/2026', dia: 'jueves 26', estado: 'Abierta' }, { fecha: '12/11/2026', dia: 'jueves 12', estado: 'Cerrada' }],
        estados: ['Recibido', 'Por revisar', 'Aprobado', 'Rechazado'], categorias: CATS }),
      panelPuntos: () => [],
      panelAgenda: (fecha) => (fecha === '26/11/2026' ? JSON.parse(JSON.stringify(agenda))
        : { ...JSON.parse(JSON.stringify(agenda)), junta: { fecha, dia: 'jueves 12' }, secciones: CATS.map((c) => ({ categoria: c, puntos: [] })), pendientes: [] }),
      panelGuardarAgenda: (fecha, cambios) => { window.__guardados.push({ fecha, cambios }); return { ok: true }; },
      panelGenerarAgendaHoja: () => { window.__generadas++; return { hoja: 'Agenda 26-11-2026', puntos: 4, pendientes: 1, minutos: 30 }; }
    };
  }, { agenda, CATS });
  fs.writeFileSync(OUT + 'panel-agenda.html', pagina({ usuario: 'admin@ejemplo.org', version: '1.8.0' }));
  await page.goto('file://' + OUT + 'panel-agenda.html');
  await page.waitForSelector('#junta option', { state: 'attached' });
  await page.click('.pestana[data-vista="agenda"]');
  await page.waitForSelector('.fila-agenda');

  check(!(await page.isVisible('#filtros')) && await page.isVisible('#agenda-barra'), 'la pestaña Agenda oculta los filtros y muestra sus botones');
  const textos = await page.$$eval('#agenda .tarjeta', (e) => e.map((x) => x.textContent));
  check(textos[0].startsWith('1. Devocional') && textos[1].includes('2.Campaña') && textos[2].startsWith('3. Lectura'),
    'numeración: devocional, evangelismo, acta…');
  check((await page.textContent('#agenda-total')).includes('4 puntos') && (await page.textContent('#agenda-total')).includes('30 min'), 'total de puntos y de tiempo');
  check((await page.textContent('#agenda')).includes('Propuesta de un miembro') && (await page.textContent('#agenda')).includes('apruébelo'),
    'los "Por revisar" aparecen aparte');
  await page.screenshot({ path: OUT + 'g1-agenda.png', fullPage: true });

  // Mover "Campamento" hacia abajo: se guarda la sección completa
  await page.click('.fila-agenda[data-id="' + '2'.repeat(32) + '"] button[aria-label^="Bajar"]');
  const orden = await page.$$eval('#agenda .seccion-agenda:nth-of-type(4) .fila-agenda b', (e) => e.map((x) => x.textContent));
  check(orden.join(',') === 'Retiro,Campamento,Feria', 'bajar un punto cambia el orden');
  await page.waitForFunction(() => window.__guardados.length === 1);
  const g = await page.evaluate(() => window.__guardados[0]);
  check(g.fecha === '26/11/2026' && g.cambios.map((c) => c.orden).join() === '1,2,3' && g.cambios.length === 3 &&
    g.cambios[1].id === '2'.repeat(32) && g.cambios[1].minutos === 10, 'guardado automático de la sección completa');
  check((await page.textContent('#agenda-estado')).includes('Guardado'), 'muestra "Guardado ✓"');
  check(await page.isDisabled('.fila-agenda[data-id="' + '3'.repeat(32) + '"] button[aria-label^="Subir"]'), 'el primero no se puede subir');

  // Cambiar el tiempo
  await page.selectOption('.fila-agenda[data-id="' + '3'.repeat(32) + '"] select', '20');
  check((await page.textContent('#agenda-total')).includes('50 min'), 'cambiar un tiempo actualiza el total');
  await page.waitForFunction(() => window.__guardados.length === 2);
  check((await page.evaluate(() => window.__guardados[1].cambios.find((c) => c.id === '3'.repeat(32)).minutos)) === 20, 'el tiempo se guarda');

  // Generar en la hoja e imprimir
  await page.click('#agenda-hoja');
  await page.waitForFunction(() => window.__generadas === 1);
  await page.waitForSelector('#aviso:not(.oculto)');
  check((await page.textContent('#aviso')).includes('Agenda 26-11-2026'), 'generar en la hoja avisa el nombre de la pestaña');
  await page.click('#agenda-imprimir');
  const imp = await page.textContent('#imprimible');
  check(await page.evaluate(() => window.__impreso) && imp.includes('jueves 26 de noviembre de 2026') && imp.includes('20 min') &&
    imp.indexOf('Retiro') < imp.indexOf('Campamento') && !imp.includes('Propuesta de un miembro'), 'versión para imprimir con orden y tiempos, sin los por revisar');
  await page.emulateMedia({ media: 'print' });
  check(await page.isVisible('#imprimible') && !(await page.isVisible('#panel')), 'al imprimir solo se ve la agenda');
  await page.screenshot({ path: OUT + 'g2-imprimir.png', fullPage: true });
  await page.emulateMedia({ media: 'screen' });

  // Un cambio pendiente se guarda antes de cambiar de junta
  await page.click('.fila-agenda[data-id="' + '4'.repeat(32) + '"] button[aria-label^="Subir"]');
  await page.selectOption('#junta', '12/11/2026');
  await page.waitForFunction(() => window.__guardados.length === 3);
  check((await page.evaluate(() => window.__guardados[2].fecha)) === '26/11/2026', 'al cambiar de junta se guarda lo pendiente de la anterior');
  await page.waitForSelector('.sin-puntos');

  // Celular
  await page.setViewportSize({ width: 390, height: 844 });
  await page.selectOption('#junta', '26/11/2026');
  await page.waitForSelector('.fila-agenda');
  check(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, 'se ve bien en el celular');
  await page.screenshot({ path: OUT + 'g3-agenda-movil.png', fullPage: true });

  await browser.close();
  console.log(fails ? fails + ' FALLAS' : 'TODO OK');
  process.exitCode = fails ? 1 : 0;
})();
