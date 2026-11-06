// Prueba de la página: letra grande, ayuda, resumen de errores, pantalla final y borrador.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Formulario.html'), 'utf8');
const stub = require('./servidor-simulado');
const OUT = path.join(__dirname, 'salida') + '/';
fs.mkdirSync(OUT, { recursive: true });
const pagina = (datos) => html.replace('<?!= datosJson ?>', JSON.stringify(datos)).replace('<script>', stub + '<script>');
const CATS = ['Evangelismo y misión', 'Planes y actividades del departamento', 'Otros asuntos'];
const datos = { clave: 'a'.repeat(32), general: false, nombre: 'Daniel Rivas', junta: 'jueves 26 de noviembre de 2026',
  departamentos: [{ valor: 'Escuela Sabática', texto: 'Escuela Sabática (Director)' }, { valor: 'Ancianos', texto: 'Ancianos (Anciano)' }],
  categorias: CATS, version: '1.6.0',
  ayuda: { nombre: 'Luis', url: 'https://wa.me/50760002222?text=Hola' } };

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => { fails++; console.log('ERROR JS', e.message); });
  page.on('dialog', d => d.accept());
  fs.writeFileSync(OUT + 'accesible.html', pagina(datos));
  await page.goto('file://' + OUT + 'accesible.html');

  // Tamaños: letra, botones y opciones grandes
  const tam = await page.evaluate(() => ({
    letra: parseFloat(getComputedStyle(document.body).fontSize),
    boton: document.getElementById('siguiente').getBoundingClientRect().height,
    radio: document.querySelector('input[name=tipo]').getBoundingClientRect().width,
    campo: document.getElementById('titulo').getBoundingClientRect().height,
    ayudaTexto: parseFloat(getComputedStyle(document.querySelector('.ayuda')).fontSize)
  }));
  check(tam.letra >= 18 && tam.ayudaTexto >= 15, 'letra de 18 px y ayudas de al menos 15 px (' + tam.letra + ' / ' + tam.ayudaTexto + ')');
  check(tam.boton >= 48 && tam.radio >= 26 && tam.campo >= 48, 'botones, opciones y campos grandes para tocar');
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  check(ancho <= 390, 'sin desplazamiento horizontal en el celular (' + ancho + ' px)');

  // Botón de ayuda
  check(await page.getAttribute('#ayuda', 'href') === datos.ayuda.url && (await page.textContent('#ayuda')).includes('Luis'),
    'botón "¿Necesita ayuda?" con WhatsApp');

  // A+ se recuerda
  await page.click('#letra');
  check(await page.evaluate(() => document.body.classList.contains('letra-grande')) && (await page.textContent('#letra')).includes('normal'),
    'A+ agranda la letra');

  // Resumen de errores
  await page.click('#siguiente');
  check(await page.isVisible('#resumen-errores') && (await page.textContent('#resumen-titulo')) === 'Faltan 5 respuestas por revisar',
    'resumen de errores arriba');
  await page.click('#resumen-lista li:nth-child(3) a');
  check(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'titulo', 'el enlace del resumen lleva a la pregunta');
  await page.screenshot({ path: OUT + 'a1-errores.png', fullPage: true });

  // Borrador: escribir y recargar
  await page.selectOption('#depto', 'Ancianos');
  await page.selectOption('#categoria', CATS[1]);
  await page.fill('#titulo', 'Vigilia de oración');
  await page.check('input[name=tipo][value="Informativo"]');
  await page.fill('#descripcion', 'Se informa la vigilia.');
  check(!(await page.isVisible('#resumen-errores')), 'el resumen se esconde cuando ya no falta nada');
  await page.waitForTimeout(600);
  await page.reload();
  check(await page.evaluate(() => document.body.classList.contains('letra-grande')), 'la letra grande se recuerda al volver');
  await page.waitForSelector('#borrador:not(.oculto)');
  check((await page.textContent('#borrador-texto')).includes('Vigilia de oración'), 'ofrece seguir con el borrador');
  await page.click('#borrador-recuperar');
  check(await page.inputValue('#titulo') === 'Vigilia de oración' && await page.inputValue('#depto') === 'Ancianos' &&
    await page.inputValue('#categoria') === CATS[1] && await page.isChecked('input[name=tipo][value="Informativo"]'),
    'recupera lo que había escrito');

  // Enviar: pantalla final con resumen y borrador borrado
  await page.click('#siguiente');
  await page.waitForSelector('#hecho:not(.oculto)');
  const resumen = await page.textContent('#resumen-envio');
  check((await page.textContent('#hecho-titulo')).startsWith('¡Listo!') && resumen.includes('Vigilia de oración') &&
    resumen.includes('Ancianos') && resumen.includes('Informativo'), 'pantalla final con ✓ y resumen de lo enviado');
  await page.screenshot({ path: OUT + 'a2-listo.png', fullPage: true });
  await page.reload();
  await page.waitForTimeout(300);
  check(!(await page.isVisible('#borrador')), 'después de enviar ya no ofrece el borrador');

  // Empezar de nuevo borra el borrador
  await page.fill('#titulo', 'Otro punto');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('#borrador:not(.oculto)');
  await page.click('#borrador-descartar');
  await page.reload();
  await page.waitForTimeout(300);
  check(!(await page.isVisible('#borrador')) && await page.inputValue('#titulo') === '', '"Empezar de nuevo" borra el borrador');

  // Sin contacto de ayuda, no hay botón
  const s = await browser.newPage();
  fs.writeFileSync(OUT + 'sin-ayuda.html', pagina({ ...datos, ayuda: null }));
  await s.goto('file://' + OUT + 'sin-ayuda.html');
  check(!(await s.isVisible('#ayuda')), 'sin contacto de ayuda no se muestra el botón');

  await browser.close();
  console.log(fails ? fails + ' FALLAS' : 'TODO OK');
  process.exitCode = fails ? 1 : 0;
})();
