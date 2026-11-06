// Versión de la aplicación. Debe coincidir con package.json y con CHANGELOG.md (lo revisan las pruebas).
var VERSION = '1.4.0';

var REPOSITORIO = 'https://github.com/AlenEngineer/junta-directiva-puntos';

var HOJA_CARGOS = 'Cargos';

var HOJA_JUNTAS = 'Juntas';

var HOJA_PUNTOS = 'Puntos';

var HOJA_ENLACES = 'Enlaces';

var HOJA_CLAVES = '_Claves';

var HOJA_CONTACTOS = 'Contactos';

var HOJA_HISTORIAL = 'Historial';
var HOJA_SALDOS = 'Saldos';

// Pestaña Saldos: las columnas A–H son las del reporte de tesorería, en el mismo orden,
// para poder pegarlo tal cual. Las dos últimas las completa quien administra.
var COLS_SALDOS = ['Departamento (tesorería)', 'Saldo anterior', 'Ingresos por ofrenda', 'Ingresos directos',
  'Egresos', 'Transferencias entrantes', 'Transferencias salientes', 'Saldo a la fecha',
  'Departamento en Cargos', 'Periodo del reporte'];
var MONEDA = 'B/.'; // Balboa (Panamá). Solo se usa para mostrar los saldos.

var GENERAL = 'GENERAL';

var CODIGO_PAIS_INICIAL = '507'; // Panamá. Se cambia con Junta → Cambiar el código de país…

var CATEGORIAS = [
  'Evangelismo y misión',
  'Tesorería y finanzas',
  'Departamentos',
  'Feligresía (traslados, recepción de miembros)',
  'Asuntos generales'
];

var TIPOS = ['Para votación', 'Informativo'];

var MAX_ARCHIVO = 5 * 1024 * 1024;   // cotizaciones: 5 MB

var MAX_MATERIAL = 10 * 1024 * 1024; // material de apoyo: 10 MB (los videos van por enlace)

var TIPOS_ARCHIVO = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic'
};

var COLS_PUNTOS = [
  'Fecha de envío', 'Junta', 'Presenta', 'Departamento', 'Estado',
  'Categoría', 'Título', 'Descripción y propuesta', 'Tipo',
  'Material de apoyo (archivo)', 'Material de apoyo (enlace)',
  '¿Es actividad?', 'Fecha de la actividad', 'Fecha de término de la actividad', 'Hora de inicio', 'Hora de término',
  'Lugar', 'Responsable', 'Asistencia esperada',
  '¿Solicita dinero?', 'Costo total', 'Monto solicitado a la iglesia',
  'Estrategia para el resto', 'Descripción del costo', 'Enlace a la cotización',
  'Archivo de la cotización'
];

// Columnas para editar puntos: quién lo envió, su código y cuántas veces se editó.
var COLS_CONTROL = ['ID', 'Enviado por', 'Código de edición', 'Última edición', 'Ediciones'];

var ESTADOS = ['Recibido', 'Por revisar', 'Aprobado', 'Rechazado'];

// Lista de EJEMPLO con nombres ficticios: solo se usa para crear la pestaña "Cargos" la primera vez.
// Los nombres reales se escriben en la hoja, nunca aquí, para que no queden en el repositorio.
var CARGOS_INICIALES = [
  ['Ancianos', 'Luis Rivas', 'Primer anciano', 'Sí'],
  ['Ancianos', 'Mario Arango', 'Segundo anciano', 'No'],
  ['Ancianos', 'Daniel Rivas', 'Anciano', 'No'],
  ['Secretaría', 'Olga Nieto', 'Secretaria', 'Sí'],
  ['Secretaría', 'Ana Cedeño', 'Asociada', 'No'],
  ['Tesorería', 'Mario Arango', 'Tesorero', 'Sí'],
  ['Tesorería', 'Ernesto Molina', 'Asociado', 'No'],
  ['Diáconos', 'Raúl Gallardo', 'Jefe', 'Sí'],
  ['Diáconos', 'Ernesto Molina', 'Asociado', 'No'],
  ['Diaconisas', 'Irene de Arango', 'Jefa', 'Sí'],
  ['Diaconisas', 'Diana Robles', 'Asociada', 'No'],
  ['Diaconisas', 'Julia Guzmán', 'Asociada', 'No'],
  ['Diaconisas', 'Amalia Campos', 'Asociada', 'No'],
  ['Escuela Sabática', 'Daniel Rivas', 'Director', 'Sí'],
  ['Escuela Sabática', 'Zoila Mendoza', 'Asociada', 'No'],
  ['Escuela Sabática', 'Ernesto Molina', 'Secretario', 'No'],
  ['Escuela Sabática', 'Adriana Paredes', 'Primarios', 'No'],
  ['Escuela Sabática', 'Yolanda Valdés', 'Menores', 'No'],
  ['Ministerio Personal', 'Daniel Rivas', 'Director', 'Sí'],
  ['Ministerio Personal', 'Zoila Mendoza', 'Asociada', 'No'],
  ['Ministerio Infantil', 'Adriana Paredes', 'Directora', 'Sí'],
  ['Ministerio Infantil', 'Yolanda Valdés', 'Asociada', 'No'],
  ['Ministerio Infantil', 'Ana Cedeño', 'Asociada', 'No'],
  ['Ministerio de la Familia', 'Daniel Rivas', 'Director', 'Sí'],
  ['Ministerio de la Familia', 'Luis Rivas', 'Miembro', 'No'],
  ['Ministerio de la Familia', 'Yolanda Valdés', 'Miembro', 'No'],
  ['Ministerio de la Mujer', 'Julia Guzmán', 'Directora', 'Sí'],
  ['Ministerio de la Mujer', 'Irene de Arango', 'Asociada', 'No'],
  ['Mayordomía Cristiana', 'Daniel Rivas', 'Director', 'Sí'],
  ['Mayordomía Cristiana', 'Luis Rivas', 'Miembro', 'No'],
  ['Mayordomía Cristiana', 'Mario Arango', 'Miembro', 'No'],
  ['Mayordomía Cristiana', 'Olga Nieto', 'Miembro', 'No'],
  ['Mayordomía Cristiana', 'Raúl Gallardo', 'Miembro', 'No'],
  ['Ministerio de la Salud', 'Karla Nieto', 'Directora', 'Sí'],
  ['Ministerio de la Salud', 'Olga Nieto', 'Asociada', 'No'],
  ['Servicio de Canto', 'Luis Rivas', 'Director', 'Sí'],
  ['Servicio de Canto', 'Daniel Rivas', 'Asociado', 'No'],
  ['Servicio de Canto', 'Olga Nieto', 'Asociada', 'No'],
  ['Servicio de Canto', 'Julia Guzmán', 'Asociada', 'No'],
  ['Servicio de Canto', 'Helena Arango', 'Asociada', 'No'],
  ['Club de Conquistadores', 'Daniel Rivas', 'Director', 'Sí'],
  ['Club de Conquistadores', 'Luis Rivas', 'Subdirector', 'No'],
  ['Club de Conquistadores', 'Ernesto Molina', 'Asociado', 'No'],
  ['Acción Solidaria Adventista (Dorcas)', 'Yolanda Valdés', 'Directora', 'Sí'],
  ['Acción Solidaria Adventista (Dorcas)', 'Zoila Mendoza', 'Asociada', 'No'],
  ['Acción Solidaria Adventista (Dorcas)', 'Alicia Salas', 'Asociada', 'No'],
  ['Acción Solidaria Adventista (Dorcas)', 'Domingo Vidal', 'Asociado', 'No'],
  ['Ministerio de Publicaciones', 'Ernesto Molina', 'Director', 'Sí'],
  ['Ministerio de Publicaciones', 'Ana Cedeño', 'Asociada', 'No'],
  ['Educación', 'Daniel Rivas', 'Director', 'Sí'],
  ['Educación', 'Adriana Paredes', 'Miembro', 'No'],
  ['Ministerio Joven Adventista', 'Ernesto Molina', 'Director', 'Sí'],
  ['Ministerio Joven Adventista', 'Ana Cedeño', 'Asociada', 'No'],
  ['Ministerio Joven Adventista', 'Mario Arango', 'Asociado', 'No'],
  ['Ministerio Joven Adventista', 'Karla Nieto', 'Asociada', 'No'],
  ['Comunicación', 'Luis Rivas', 'Director', 'Sí'],
  ['Comunicación', 'Mario Arango', 'Asociado', 'No'],
  ['Comunicación', 'Julia Guzmán', 'Asociada', 'No'],
  ['Equipo de Sonido', 'Mario Arango', 'Director', 'Sí'],
  ['Equipo de Sonido', 'Daniel Rivas', 'Asociado', 'No'],
  ['Equipo de Sonido', 'Luis Rivas', 'Asociado', 'No'],
  ['Equipo de Sonido', 'Julia Guzmán', 'Asociada', 'No']
];
