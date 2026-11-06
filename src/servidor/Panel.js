// =====================================================================
// PANEL DE ADMINISTRACIÓN
//
// Se abre con la URL de la implementación del panel + "?vista=panel".
// Esa implementación se publica como "Ejecutar como: usuario que accede" y
// "Acceso: cualquiera con cuenta de Google", así que Google exige iniciar sesión.
// Cada función revisa con exigirAdmin_() que la persona pueda editar la hoja.
// =====================================================================

/** Página del panel (la llama doGet). Sin permiso, muestra un aviso. */
function panelPagina_() {
  var usuario = null;
  try { usuario = usuarioAdmin_(); } catch (e) { usuario = null; }
  var t = HtmlService.createTemplateFromFile('Panel');
  t.datosJson = JSON.stringify(usuario ? { usuario: usuario, version: VERSION } : null).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle('Panel · Junta Directiva')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Datos iniciales: juntas (la más reciente primero), estados y categorías. */
function panelDatos() {
  var usuario = exigirAdmin_();
  asegurarEsquema_();
  var juntas = juntasLeer_().map(function (j) { return { fecha: j.fecha, dia: j.dia, estado: j.estado }; }).reverse();
  var actual = juntaActual_();
  return {
    usuario: usuario,
    version: VERSION,
    juntas: juntas,
    seleccionada: actual ? actual.fecha : (juntas[0] ? juntas[0].fecha : ''),
    estados: ESTADOS,
    categorias: CATEGORIAS,
    moneda: MONEDA
  };
}

/** Puntos de una junta, listos para mostrar en el panel. */
function panelPuntos(fecha) {
  exigirAdmin_();
  var tz = Session.getScriptTimeZone();
  var texto = function (x) { return x == null ? '' : String(x); };
  var fechaHora = function (x) { return x instanceof Date ? Utilities.formatDate(x, tz, 'dd/MM/yyyy HH:mm') : texto(x); };
  var hora = function (x) { return x instanceof Date ? Utilities.formatDate(x, tz, 'HH:mm') : texto(x); };
  return puntosLeer_().filter(function (p) {
    return p['ID'] && textoFecha_(p['Junta']) === String(fecha || '');
  }).map(function (p) {
    return {
      id: texto(p['ID']),
      enviado: fechaHora(p['Fecha de envío']),
      ultimaEdicion: fechaHora(p['Última edición']),
      ediciones: Number(p['Ediciones']) || 0,
      presenta: texto(p['Presenta']),
      departamento: texto(p['Departamento']),
      general: p['Enviado por'] === GENERAL,
      estado: texto(p['Estado']) || 'Recibido',
      categoria: categoriaVigente_(p['Categoría']),
      titulo: texto(p['Título']),
      descripcion: texto(p['Descripción y propuesta']),
      tipo: texto(p['Tipo']),
      material: { archivo: texto(p['Material de apoyo (archivo)']), enlace: texto(p['Material de apoyo (enlace)']) },
      actividad: p['¿Es actividad?'] === 'Sí' ? {
        inicio: textoFecha_(p['Fecha de la actividad']), fin: textoFecha_(p['Fecha de término de la actividad'] || ''),
        horaInicio: hora(p['Hora de inicio']), horaFin: hora(p['Hora de término']),
        lugar: texto(p['Lugar']), responsable: texto(p['Responsable']), asistencia: texto(p['Asistencia esperada'])
      } : null,
      dinero: p['¿Solicita dinero?'] === 'Sí' ? {
        costo: Number(p['Costo total']) || 0, monto: Number(p['Monto solicitado a la iglesia']) || 0,
        estrategia: texto(p['Estrategia para el resto']), descripcion: texto(p['Descripción del costo']),
        enlace: texto(p['Enlace a la cotización']), archivo: texto(p['Archivo de la cotización'])
      } : null
    };
  });
}

/** Cambia el estado de un punto: Recibido, Por revisar, Aprobado o Rechazado. */
function panelCambiarEstado(id, estado) {
  exigirAdmin_();
  if (ESTADOS.indexOf(estado) < 0) throw new Error('Estado no válido.');
  if (!/^[0-9a-f]{32}$/.test(String(id || ''))) throw new Error('Punto no válido.');
  puntoCambiarEstado_(String(id), estado);
  return { ok: true, id: id, estado: estado };
}
