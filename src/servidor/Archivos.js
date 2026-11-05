/** Tipos permitidos para el material de apoyo: los de la cotización más PowerPoint. */
function tiposMaterial_() {
  var t = {};
  Object.keys(TIPOS_ARCHIVO).forEach(function (k) { t[k] = TIPOS_ARCHIVO[k]; });
  t.ppt = 'application/vnd.ms-powerpoint';
  t.pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return t;
}

/**
 * Guarda un archivo enviado desde el formulario en la carpeta de Drive.
 * opc: { tipos, max, textoTipos, prefijo }
 */
function guardarArchivo_(a, junta, presenta, opc) {
  opc = opc || { tipos: TIPOS_ARCHIVO, max: MAX_ARCHIVO, textoTipos: 'PDF, Word o una imagen', prefijo: 'Cotización' };
  var mb = Math.round(opc.max / 1024 / 1024);
  var nombre = String(a.nombre || 'archivo').slice(0, 120).replace(/[\\\/:*?"<>|]/g, '_');
  var ext = nombre.indexOf('.') >= 0 ? nombre.split('.').pop().toLowerCase() : '';
  var mime = opc.tipos[ext];
  if (!mime) throw new Error('Tipo de archivo no permitido. Use ' + opc.textoTipos + '.');

  var base64 = String(a.base64 || '');
  if (base64.length > Math.ceil(opc.max / 3) * 4 + 8) throw new Error('El archivo pesa más de ' + mb + ' MB.');
  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > opc.max) throw new Error('El archivo pesa más de ' + mb + ' MB.');
  if (!firmaValida_(bytes, ext)) throw new Error('El archivo no parece ser un ' + ext.toUpperCase() + ' válido.');

  var carpeta = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('CARPETA'));
  var archivo = carpeta.createFile(Utilities.newBlob(bytes, mime,
    junta.replace(/\//g, '-') + ' – ' + opc.prefijo + ' – ' + presenta + ' – ' + nombre));
  return archivo.getUrl();
}

/** Revisa los primeros bytes para confirmar que el archivo es lo que dice ser. */
function firmaValida_(b, ext) {
  if (b.length < 12) return false;
  var es = function (bytes, desde) {
    return bytes.every(function (x, i) { return (b[(desde || 0) + i] & 0xff) === x; });
  };
  switch (ext) {
    case 'pdf': return es([0x25, 0x50, 0x44, 0x46]);
    case 'doc': return es([0xD0, 0xCF, 0x11, 0xE0]);
    case 'docx': case 'pptx': return es([0x50, 0x4B, 0x03, 0x04]);
    case 'ppt': return es([0xD0, 0xCF, 0x11, 0xE0]);
    case 'jpg': case 'jpeg': return es([0xFF, 0xD8, 0xFF]);
    case 'png': return es([0x89, 0x50, 0x4E, 0x47]);
    case 'webp': return es([0x52, 0x49, 0x46, 0x46]) && es([0x57, 0x45, 0x42, 0x50], 8);
    case 'heic': return es([0x66, 0x74, 0x79, 0x70], 4);
  }
  return false;
}
