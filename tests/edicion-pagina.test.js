// Pruebas de la página: ver mis puntos, editar uno, conservar archivos y cancelar.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'Formulario.html'), 'utf8');
const stub = require('./servidor-simulado');
const OUT = path.join(__dirname, 'salida') + '/';
fs.mkdirSync(OUT, { recursive: true });
const CATS = ['Evangelismo y misión', 'Tesorería y finanzas', 'Departamentos', 'Feligresía (traslados, recepción de miembros)', 'Asuntos generales'];
const pagina = (datos) => html.replace('<?!= datosJson ?>', JSON.stringify(datos)).replace('<script>', stub + '<script>');
const personal = { clave: 'a'.repeat(32), general: false, nombre: 'Daniel Rivas', junta: 'jueves 26 de noviembre de 2026',
  departamentos: [{ valor: 'Escuela Sabática', texto: 'Escuela Sabática (Director)' }, { valor: 'Ancianos', texto: 'Ancianos (Anciano)' }],
  categorias: CATS, version: '1.2.0' };
const guardado = { departamento: 'Ancianos', categoria: CATS[2], titulo: 'Retiro de jóvenes', descripcion: 'Votar el retiro.',
  tipo: 'Para votación', materialEnlace: '', esActividad: 'Sí', actFecha: '2027-03-20', actFechaFin: '2027-03-22',
  actInicio: '09:00', actFin: '12:00', lugar: 'Campamento', responsable: 'Ernesto Molina', asistencia: '40',
  pideDinero: 'Sí', costo: '500', monto: '500', estrategia: '', descCosto: '', enlace: '', archivoActual: true, materialActual: false };

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  page.on('pageerror', e => { fails++; console.log('ERROR JS', e.message); });
  page.on('dialog', d => d.accept());
  fs.writeFileSync(OUT + 'edicion.html', pagina(personal));
  await page.addInitScript((datos) => {
    window.__lista = [{ id: 'b'.repeat(32), titulo: 'Retiro de jóvenes', tipo: 'Para votación', departamento: 'Ancianos', enviado: '05/11 20:10', ediciones: 1 }];
    window.__punto = datos;
  }, guardado);
  await page.goto('file://' + OUT + 'edicion.html');

  // 1. Lista de puntos enviados
  await page.waitForSelector('#mis-puntos:not(.oculto)');
  check((await page.textContent('#mis-puntos-lista')).includes('Retiro de jóvenes') &&
    (await page.textContent('#mis-puntos-lista')).includes('editado 1 vez'), 'muestra mis puntos enviados');
  await page.screenshot({ path: OUT + 'e1-mis-puntos.png', fullPage: true });

  // 2. Editar: el formulario se llena
  await page.click('#mis-puntos-lista button');
  await page.waitForSelector('#banner-edicion:not(.oculto)');
  check(await page.inputValue('#titulo') === 'Retiro de jóvenes' && await page.inputValue('#depto') === 'Ancianos' &&
    await page.isChecked('input[name=tipo][value="Para votación"]'), 'el formulario se llena con el punto');
  check(!(await page.isVisible('#mis-puntos')), 'la lista se oculta mientras edita');
  check((await page.evaluate(() => window.__abierto.id)) === 'b'.repeat(32), 'abre el punto correcto');
  await page.click('#siguiente');
  check(await page.inputValue('#actFechaFin') === '2027-03-22' && await page.inputValue('#lugar') === 'Campamento', 'página 2 con los datos de la actividad');
  await page.click('#siguiente');
  check((await page.textContent('#archivo-nombre')) === 'Archivo enviado anteriormente', 'muestra el archivo enviado antes');
  check((await page.textContent('#siguiente')) === 'Guardar cambios', 'el botón dice "Guardar cambios"');
  await page.screenshot({ path: OUT + 'e2-editando.png', fullPage: true });

  // 3. Quitar el archivo sin otra explicación: se pide al menos una
  await page.click('#archivo-quitar');
  await page.click('#siguiente');
  check((await page.textContent('[data-v=cotizacion] .msg-error span')).includes('al menos una'), 'quitar el archivo exige otra explicación');
  await page.fill('#descCosto', 'Transporte y comida');
  await page.fill('#monto', '300');
  await page.fill('#estrategia', 'Aportes de los jóvenes');
  await page.click('#siguiente');
  await page.waitForSelector('#hecho:not(.oculto)');
  let env = await page.evaluate(() => window.__envios[window.__envios.length - 1]);
  check(env.__edicion && env.__edicion.id === 'b'.repeat(32) && env.monto === '300' && env.mantenerArchivo === false,
    'guarda los cambios en el mismo punto');
  check((await page.textContent('#hecho-texto')).includes('Sus cambios se guardaron'), 'confirma que se guardaron los cambios');

  // 4. Editar conservando el archivo
  await page.click('#mis-puntos-lista button');
  await page.waitForSelector('#banner-edicion:not(.oculto)');
  await page.click('#siguiente'); await page.click('#siguiente');
  await page.click('#siguiente');
  await page.waitForSelector('#hecho:not(.oculto)');
  env = await page.evaluate(() => window.__envios[window.__envios.length - 1]);
  check(env.mantenerArchivo === true && env.archivo === null, 'sin tocar el archivo, se conserva');

  // 5. Enviar uno nuevo y editarlo desde la confirmación
  await page.click('#otro');
  check(!(await page.isVisible('#banner-edicion')) && await page.inputValue('#titulo') === '', 'enviar otro empieza vacío');
  await page.selectOption('#depto', 'Escuela Sabática');
  await page.selectOption('#categoria', CATS[0]);
  await page.fill('#titulo', 'Informe de bautismos');
  await page.check('input[name=tipo][value="Informativo"]');
  await page.fill('#descripcion', 'Hubo 3 bautismos.');
  await page.click('#siguiente');
  await page.waitForSelector('#hecho:not(.oculto)');
  check(await page.isVisible('#editar-ultimo'), 'después de enviar aparece "Editar este punto"');
  await page.evaluate(() => { window.__punto = { categoria: 'Evangelismo y misión', titulo: 'Informe de bautismos', descripcion: 'Hubo 3 bautismos.', tipo: 'Informativo', departamento: 'Escuela Sabática' }; });
  await page.click('#editar-ultimo');
  await page.waitForSelector('#banner-edicion:not(.oculto)');
  check((await page.textContent('#banner-titulo')) === 'Informe de bautismos' && (await page.textContent('#siguiente')) === 'Guardar cambios',
    'editar el último punto enviado');

  // 6. Cancelar edición
  await page.click('#cancelar-edicion');
  check(!(await page.isVisible('#banner-edicion')) && await page.inputValue('#titulo') === '' &&
    (await page.textContent('#siguiente')) === 'Siguiente', 'cancelar la edición vuelve a un formulario vacío');

  // 7. Enlace general: sin lista; editar usa el código de edición
  const g = await browser.newPage({ viewport: { width: 390, height: 844 } });
  g.on('pageerror', e => { fails++; console.log('ERROR JS', e.message); });
  fs.writeFileSync(OUT + 'edicion-general.html', pagina({ ...personal, general: true, nombre: '', departamentos: [] }));
  await g.addInitScript(() => { window.__lista = [{ id: 'x', titulo: 'No debe verse', tipo: '', departamento: '' }]; });
  await g.goto('file://' + OUT + 'edicion-general.html');
  await g.waitForTimeout(100);
  check(!(await g.isVisible('#mis-puntos')), 'el enlace general no muestra lista de puntos');
  await g.fill('#nombre', 'María Torres');
  await g.selectOption('#categoria', CATS[4]);
  await g.fill('#titulo', 'Propuesta de un miembro');
  await g.check('input[name=tipo][value="Informativo"]');
  await g.fill('#descripcion', 'Detalle.');
  await g.click('#siguiente');
  await g.waitForSelector('#hecho:not(.oculto)');
  await g.evaluate(() => { window.__punto = { nombre: 'María Torres', titulo: 'Propuesta de un miembro', tipo: 'Informativo', categoria: 'Asuntos generales', descripcion: 'Detalle.' }; });
  await g.click('#editar-ultimo');
  await g.waitForSelector('#banner-edicion:not(.oculto)');
  check((await g.evaluate(() => window.__abierto.codigo)) === 'c'.repeat(32) && await g.inputValue('#nombre') === 'María Torres',
    'general: edita con el código recibido al enviar');
  await g.screenshot({ path: OUT + 'e3-general-editando.png', fullPage: true });

  await browser.close();
  console.log(fails ? fails + ' FALLAS' : 'TODO OK');
  process.exitCode = fails ? 1 : 0;
})();
