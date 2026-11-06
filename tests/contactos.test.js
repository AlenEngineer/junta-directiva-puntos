// Pruebas de la importación desde los contactos de Google (sin conectarse a Google).
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Codigo.gs'), 'utf8');
const g = new Function(code + '; return { prepararContactosGoogle_, buscarContacto_, tokensNombre_, ' +
  'mejorTelefono_, mejorCorreo_, telefonoWa_ };')();

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };

// Personas como las devuelve la API de Google (People API).
const persona = (nombre, telefonos = [], correos = []) => ({
  names: [{ displayName: nombre }],
  phoneNumbers: telefonos.map(([value, type, canonicalForm]) => ({ value, type, canonicalForm })),
  emailAddresses: correos.map(([value, primary]) => ({ value, metadata: { primary } }))
});
const google = g.prepararContactosGoogle_([
  persona('Hna. Irene Arango', [['6111-1111', 'mobile', '+50761111111']]),
  persona('Luis Rivas', [['6222-2222', 'home'], ['6333-3333', 'mobile', '+50763333333']], [['luis@gmail.com', true]]),
  persona('Daniel', [['6444-4444', 'mobile']]),
  persona('Mario Arango', [['6555-5555', 'mobile']]),
  persona('Mario Arango', [], [['mario@gmail.com', true]]),      // otro contacto con el mismo nombre (Gmail)
  persona('Ernesto Molina Trabajo', [['6666-6666', 'work']]),
  persona('Ernesto Molina', [['6777-7777', 'mobile']]),
  persona('Yolanda', [['6888-8888', 'mobile']]),
  persona('Yolanda Valdés', [['6999-9999', 'mobile']]),
  persona('Zoila M', [['6000-0001', 'mobile']]),
  persona('Zoila Mendoza Paredes', [['6000-0002', 'mobile']]),
  persona('Zoila Mendoza Gómez', [['6000-0003', 'mobile']]),
  persona('Adriana', [['6000-0004', 'mobile']]),
  persona('Adriana López', [['6000-0005', 'mobile']]),
  { names: [], phoneNumbers: [{ value: '6000-0000' }] }               // contacto sin nombre: se ignora
]);

check(JSON.stringify(g.tokensNombre_('Hna. Irene de Arango')) === '["irene","arango"]', 'ignora "Hna." y "de" y quita tildes');

let b = g.buscarContacto_('Irene de Arango', google);
check(b.tipo === 'seguro' && g.mejorTelefono_(b.contacto) === '+50761111111', 'Irene: encuentra "Hna. Irene Arango"');

b = g.buscarContacto_('Luis Rivas', google);
check(b.tipo === 'seguro' && g.mejorTelefono_(b.contacto) === '+50763333333' && g.mejorCorreo_(b.contacto) === 'luis@gmail.com',
  'Luis: prefiere el celular y toma el correo');

b = g.buscarContacto_('Daniel Rivas', google);
check(b.tipo === 'dudoso' && b.contacto.nombre === 'Daniel', 'Daniel guardado sin apellido: dudoso (para verificar)');

b = g.buscarContacto_('Mario Arango', google);
check(b.tipo === 'seguro' && g.mejorTelefono_(b.contacto) === '6555-5555' && g.mejorCorreo_(b.contacto) === 'mario@gmail.com',
  'Mario: junta el contacto con teléfono y el de Gmail con correo');

b = g.buscarContacto_('Ernesto Molina', google);
check(b.tipo === 'seguro' && b.contacto.nombre === 'Ernesto Molina', 'Ernesto: prefiere el nombre exacto sobre "… Trabajo"');

b = g.buscarContacto_('Yolanda Valdés', google);
check(b.tipo === 'seguro' && b.contacto.nombre === 'Yolanda Valdés', 'Yolanda: el nombre completo gana a "Yolanda" solo');

b = g.buscarContacto_('Zoila Mendoza', google);
check(b.tipo === 'varios' && b.candidatos.length === 2, 'Zoila: dos contactos posibles, no se adivina');

b = g.buscarContacto_('Adriana Paredes', google);
check(b.tipo === 'dudoso' && b.contacto.nombre === 'Adriana', 'Adriana Paredes: no confunde con "Adriana López"');

b = g.buscarContacto_('Raúl Gallardo', google);
check(b.tipo === 'ninguno', 'Raúl: no encontrado');

b = g.buscarContacto_('Helena Arango', google);
check(b.tipo === 'ninguno', 'Helena Arango: no se confunde con otros Arango');

check(g.telefonoWa_('+50761111111', '507') === '50761111111', 'el formato de Google sirve para WhatsApp');

console.log(fails ? fails + ' FALLAS' : 'TODO OK');
process.exitCode = fails ? 1 : 0;
