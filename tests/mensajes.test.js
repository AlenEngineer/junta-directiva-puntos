// Pruebas de teléfonos, mensajes de WhatsApp y correo.
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Codigo.gs'), 'utf8');
const g = new Function(code + '; return { telefonoWa_, linkWhatsApp_, mensajeWhatsApp_, mensajeGeneral_, ' +
  'correoValido_, correoTexto_, correoHtml_, escHtml_, CODIGO_PAIS_INICIAL };')();

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };

// Teléfonos
check(g.CODIGO_PAIS_INICIAL === '507', 'código de país predeterminado +507');
check(g.telefonoWa_('6123-4567', '507') === '50761234567', 'número local de Panamá');
check(g.telefonoWa_('+507 6123 4567', '507') === '50761234567', 'número con +507');
check(g.telefonoWa_('00507 6123 4567', '507') === '50761234567', 'número con 00507');
check(g.telefonoWa_('+1 (555) 123-4567', '507') === '15551234567', 'número de otro país con +');
check(g.telefonoWa_('50761234567', '507') === '50761234567', 'número con 507 sin + no repite el código');
check(g.telefonoWa_('507 6123-4567', '507') === '50761234567', 'número con 507 y espacio sin +');
check(g.telefonoWa_('61234567', '507') === '50761234567', 'número de 8 dígitos sin separador');
check(g.telefonoWa_('', '507') === '', 'teléfono vacío');
check(g.telefonoWa_('123', '507') === null, 'teléfono muy corto no es válido');

// WhatsApp
const junta = { fecha: '26/11/2026', dia: 'jueves 26 de noviembre de 2026' };
const enlace = 'https://script.google.com/macros/s/ABC/exec?t=' + 'a'.repeat(32);
const msg = g.mensajeWhatsApp_('Daniel Rivas', junta, enlace);
check(msg.startsWith('Hola, Daniel.') && msg.includes(enlace) && msg.includes('jueves 26 de noviembre'), 'mensaje personal de WhatsApp');
check(!msg.includes('correo'), 'sin correo: el WhatsApp no menciona el correo');
const msgCorreo = g.mensajeWhatsApp_('Daniel Rivas', junta, enlace, 'daniel@gmail.com');
check(msgCorreo.includes('daniel@gmail.com') && msgCorreo.includes('instrucciones') && msgCorreo.includes('spam'),
  'con correo: el WhatsApp pide revisar el correo con las instrucciones');
const wa = g.linkWhatsApp_('50761234567', msg);
check(wa.startsWith('https://wa.me/50761234567?text=') && decodeURIComponent(wa.split('text=')[1]) === msg, 'enlace wa.me con el mensaje codificado');
check(g.linkWhatsApp_('', 'hola').startsWith('https://wa.me/?text='), 'sin teléfono: WhatsApp deja elegir el contacto');
check(g.mensajeGeneral_(junta, enlace).includes('revisados'), 'mensaje del enlace general');

// Correo
check(g.correoValido_('ana@gmail.com') && !g.correoValido_('ana@') && !g.correoValido_(''), 'validación de correos');
const director = { director: true, cargos: [
  { cargo: 'Director', departamento: 'Escuela Sabática' }, { cargo: 'Anciano', departamento: 'Ancianos' }] };
const asociado = { director: false, cargos: [{ cargo: 'Asociada', departamento: 'Secretaría' }] };
const texto = g.correoTexto_('Daniel Rivas', director, junta, enlace);
check(texto.includes('CUÁNDO DEJA DE FUNCIONAR') && texto.includes('26/11/2026') && texto.includes('incógnito'), 'correo explica cuándo vence y qué hacer si no abre');
check(texto.includes('más de un cargo') && !texto.includes('Como asociado'), 'correo de director con varios cargos');
const textoAsoc = g.correoTexto_('Ana Cedeño', asociado, junta, enlace);
check(textoAsoc.includes('Como asociado') && !textoAsoc.includes('más de un cargo'), 'correo de asociado con un cargo');
const html = g.correoHtml_('<script>x</script>', director, junta, enlace);
check(!html.includes('<script>') && html.includes('&lt;script&gt;'), 'el HTML del correo escapa los textos');
check((html.match(/href="https:\/\/script\.google\.com/g) || []).length === 2, 'el correo tiene el botón y el enlace de respaldo');

// Vista previa del correo para revisarlo en el navegador
const salida = path.join(__dirname, 'salida');
fs.mkdirSync(salida, { recursive: true });
fs.writeFileSync(path.join(salida, 'correo.html'),
  '<meta charset="utf-8"><body style="margin:24px">' + g.correoHtml_('Daniel Rivas', director, junta, enlace));

console.log(fails ? fails + ' FALLAS' : 'TODO OK');
process.exitCode = fails ? 1 : 0;
