function guardarPunto_(clave, d, edicion) {
  var ctx = contexto_(String(clave || ''));
  if (!ctx) throw new Error('Este enlace ya no es válido. Pida el enlace actualizado a la secretaría de la iglesia.');
  limitar_(clave, ctx.general ? 15 : 40);

  var anterior = null;
  if (edicion) {
    anterior = buscarPuntoEditable_(ctx, edicion.id, edicion.codigo);
    if (!anterior) throw new Error('No se encontró el punto, o ya no se puede editar.');
  }
  var archivoAnt = anterior ? String(anterior.valores['Archivo de la cotización'] || '') : '';
  var materialAnt = anterior ? String(anterior.valores['Material de apoyo (archivo)'] || '') : '';
  d.mantenerArchivo = !!(d.mantenerArchivo && archivoAnt);
  d.mantenerMaterial = !!(d.mantenerMaterial && materialAnt);

  var p = validarPunto(d, {
    general: ctx.general,
    departamentos: ctx.cargos.map(function (c) { return c.departamento; })
  });
  if (p.error) throw new Error(p.error);

  var presenta = ctx.general ? p.nombre : ctx.nombre;
  var departamento = ctx.general ? 'Miembro de la iglesia' : p.departamento;

  var archivoUrl = '';
  if (p.pideDinero === 'Sí') {
    if (d.archivo) archivoUrl = guardarArchivo_(d.archivo, ctx.junta.fecha, presenta);
    else if (d.mantenerArchivo) archivoUrl = archivoAnt;
  }
  var materialUrl = '';
  if (d.material) {
    materialUrl = guardarArchivo_(d.material, ctx.junta.fecha, presenta, {
      tipos: tiposMaterial_(), max: MAX_MATERIAL,
      textoTipos: 'PDF, PowerPoint, Word o una imagen', prefijo: 'Material'
    });
  } else if (d.mantenerMaterial) {
    materialUrl = materialAnt;
  }

  var valores = {
    'Fecha de envío': new Date(), 'Junta': ctx.junta.fecha, 'Presenta': presenta,
    'Departamento': departamento, 'Estado': ctx.general ? 'Por revisar' : 'Recibido',
    'Categoría': p.categoria, 'Título': p.titulo, 'Descripción y propuesta': p.descripcion,
    'Tipo': p.tipo,
    'Material de apoyo (archivo)': materialUrl, 'Material de apoyo (enlace)': p.materialEnlace,
    '¿Es actividad?': p.esActividad, 'Fecha de la actividad': p.actFecha,
    'Fecha de término de la actividad': p.actFechaFin,
    'Hora de inicio': p.actInicio, 'Hora de término': p.actFin, 'Lugar': p.lugar,
    'Responsable': p.responsable, 'Asistencia esperada': p.asistencia,
    '¿Solicita dinero?': p.pideDinero, 'Costo total': p.costo, 'Monto solicitado a la iglesia': p.monto,
    'Estrategia para el resto': p.estrategia, 'Descripción del costo': p.descCosto,
    'Enlace a la cotización': p.enlace, 'Archivo de la cotización': archivoUrl
  };
  if (anterior) {
    var a = anterior.valores;
    valores['Fecha de envío'] = a['Fecha de envío'];
    valores['ID'] = a['ID'];
    valores['Enviado por'] = a['Enviado por'];
    valores['Código de edición'] = a['Código de edición'];
    valores['Última edición'] = new Date();
    valores['Ediciones'] = (Number(a['Ediciones']) || 0) + 1;
    // Un punto del enlace general vuelve a revisión; los demás conservan su estado.
    if (!ctx.general && a['Estado']) valores['Estado'] = a['Estado'];
  } else {
    valores['ID'] = nuevaClave_();
    valores['Enviado por'] = ctx.general ? GENERAL : ctx.nombre;
    valores['Código de edición'] = nuevaClave_();
    valores['Ediciones'] = 0;
  }

  if (anterior) puntoReemplazar_(valores['ID'], valores);
  else puntoAgregar_(valores);
  return { ok: true, id: valores['ID'], codigo: valores['Código de edición'], titulo: p.titulo, editado: !!anterior };
}

/**
 * Busca un punto que esta persona puede editar en la junta abierta.
 * Enlace personal: el punto debe ser suyo. Enlace general: hace falta el código
 * de edición que recibió quien lo envió (solo lo tiene esa página).
 */
function buscarPuntoEditable_(ctx, id, codigo) {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  var v = puntoPorId_(id);
  if (!v || textoFecha_(v['Junta']) !== ctx.junta.fecha) return null;
  var dueno = String(v['Enviado por']);
  if (ctx.general) {
    if (dueno !== GENERAL || !codigo || String(v['Código de edición']) !== codigo) return null;
  } else if (dueno !== ctx.nombre) {
    return null;
  }
  return { valores: v };
}

/**
 * Revisa y limpia los datos enviados. Devuelve el punto limpio,
 * o { error: 'mensaje' } si algo no es válido.
 */
function validarPunto(d, opc) {
  var txt = function (v, max) { return String(v == null ? '' : v).trim().slice(0, max); };
  var err = function (m) { return { error: m }; };
  var p = {
    nombre: '', departamento: '', esActividad: '', actFecha: '', actFechaFin: '', actInicio: '', actFin: '',
    lugar: '', responsable: '', asistencia: '', pideDinero: '', costo: '', monto: '',
    estrategia: '', descCosto: '', enlace: '', materialEnlace: ''
  };

  if (opc.general) {
    p.nombre = txt(d.nombre, 100);
    if (p.nombre.length < 3) return err('Escriba su nombre completo.');
  } else {
    p.departamento = txt(d.departamento, 200);
    if (opc.departamentos.indexOf(p.departamento) < 0) return err('Elija el departamento por el que presenta el punto.');
  }

  p.categoria = txt(d.categoria, 100);
  if (CATEGORIAS.indexOf(p.categoria) < 0) return err('Elija la categoría del punto.');
  p.titulo = txt(d.titulo, 150);
  if (!p.titulo) return err('Escriba el título del punto.');
  p.descripcion = txt(d.descripcion, 5000);
  if (!p.descripcion) return err('Escriba la descripción y propuesta.');
  p.tipo = txt(d.tipo, 50);
  if (TIPOS.indexOf(p.tipo) < 0) return err('Indique si el punto es para votación o informativo.');

  // Material de apoyo (opcional, para cualquier tipo de punto): el archivo se revisa al guardarlo.
  p.materialEnlace = txt(d.materialEnlace, 1000);
  if (p.materialEnlace && !/^https?:\/\/\S+$/i.test(p.materialEnlace)) {
    return err('El enlace del material de apoyo debe empezar con https://');
  }

  // Un punto informativo no lleva actividad ni presupuesto.
  if (p.tipo === 'Informativo') return p;

  p.esActividad = txt(d.esActividad, 2);
  if (['Sí', 'No'].indexOf(p.esActividad) < 0) return err('Indique si el punto es una actividad.');
  if (p.esActividad === 'Sí') {
    var f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(d.actFecha, 10));
    if (!f) return err('Indique la fecha de inicio de la actividad.');
    p.actFecha = f[3] + '/' + f[2] + '/' + f[1];
    // Fecha de término: solo para actividades de varios días (campamentos, campañas…).
    var ff = txt(d.actFechaFin, 10);
    if (ff) {
      var g = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ff);
      if (!g) return err('La fecha de término no es válida.');
      if (ff < f[0]) return err('La fecha de término no puede ser antes de la fecha de inicio.');
      if (ff !== f[0]) p.actFechaFin = g[3] + '/' + g[2] + '/' + g[1];
    }
    var hora = /^([01]\d|2[0-3]):[0-5]\d$/;
    p.actInicio = txt(d.actInicio, 5);
    if (!hora.test(p.actInicio)) return err('Indique la hora de inicio de la actividad.');
    p.actFin = txt(d.actFin, 5);
    if (p.actFin && !hora.test(p.actFin)) return err('La hora de término no es válida.');
    if (!p.actFechaFin && p.actFin && p.actFin <= p.actInicio) {
      return err('La hora de término debe ser después de la hora de inicio.');
    }
    p.lugar = txt(d.lugar, 200);
    if (!p.lugar) return err('Indique el lugar de la actividad.');
    p.responsable = txt(d.responsable, 100);
    if (!p.responsable) return err('Indique el responsable de la actividad.');
    var asis = txt(d.asistencia, 6);
    if (asis) {
      if (!/^\d{1,5}$/.test(asis)) return err('La asistencia esperada debe ser un número.');
      p.asistencia = Number(asis);
    }
  }

  p.pideDinero = txt(d.pideDinero, 2);
  if (['Sí', 'No'].indexOf(p.pideDinero) < 0) return err('Indique si se solicita dinero de la iglesia.');
  if (p.pideDinero === 'Sí') {
    p.costo = monto_(d.costo);
    if (!(p.costo > 0)) return err('Escriba el costo total, solo con números.');
    p.monto = monto_(d.monto);
    if (!(p.monto > 0)) return err('Escriba el monto que se solicita a la iglesia, solo con números.');
    if (p.monto > p.costo) return err('Lo que se pide a la iglesia no puede ser mayor que el costo total.');
    if (p.monto < p.costo) {
      p.estrategia = txt(d.estrategia, 2000);
      if (!p.estrategia) return err('Explique cómo se conseguirá el resto del dinero.');
    }
    p.descCosto = txt(d.descCosto, 2000);
    p.enlace = txt(d.enlace, 1000);
    if (p.enlace && !/^https?:\/\/\S+$/i.test(p.enlace)) return err('El enlace a la cotización debe empezar con https://');
    if (!p.descCosto && !p.enlace && !d.archivo && !d.mantenerArchivo) {
      return err('Explique el costo: escriba una descripción, pegue un enlace o adjunte la cotización.');
    }
  }
  return p;
}

function monto_(v) {
  var s = String(v == null ? '' : v).trim().replace(/\s/g, '').replace(',', '.');
  return /^\d{1,9}(\.\d{1,2})?$/.test(s) ? Number(s) : NaN;
}
