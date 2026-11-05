const fs = require('fs');
const { chromium } = require('playwright');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'Formulario.html'), 'utf8');
const datos = { clave: 'a'.repeat(32), general: false, nombre: 'Luis Rivas', junta: 'domingo 14 de marzo de 2027',
  departamentos: [{valor:'Ancianos',texto:'Ancianos (Primer anciano)'}], categorias: ['Asuntos generales'] };
const stub = require('./servidor-simulado');
const OUT = require('path').join(__dirname, 'salida') + '/'; fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + 'd.html', html.replace('<?!= datosJson ?>', JSON.stringify(datos)).replace('<script>', stub + '<script>'));
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  let errs = 0; p.on('pageerror', e => { errs++; console.log('ERROR', e.message); });
  await p.goto('file://' + OUT + 'd.html');
  const t = () => p.textContent('#desc-titulo');
  console.log('sin tipo:', await t());
  await p.check('input[name=tipo][value="Informativo"]'); console.log('informativo:', await t());
  await p.check('input[name=tipo][value="Para votación"]'); console.log('votación:', await t());
  // informativo sin descripción no se envía
  await p.check('input[name=tipo][value="Informativo"]');
  await p.selectOption('#categoria', 'Asuntos generales'); await p.fill('#titulo', 'X');
  await p.click('#siguiente');
  console.log('informativo sin descripción bloqueado:', await p.isVisible('[data-v=descripcion].error') && (await p.evaluate(() => window.__envios.length)) === 0);
  await p.fill('#descripcion', 'Informe'); await p.click('#siguiente');
  await p.waitForSelector('#hecho:not(.oculto)');
  console.log('con descripción se envía:', (await p.evaluate(() => window.__envios[0].descripcion)) === 'Informe', '| errores JS:', errs);
  await b.close();
})();
