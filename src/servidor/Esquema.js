// =====================================================================
// ESQUEMA: cambios ordenados en la estructura de la hoja
//
// La hoja guarda en qué versión de estructura está (propiedad ESQUEMA).
// Cuando una versión nueva del código necesita otra estructura, se agrega
// aquí una migración con el número siguiente. Se aplican una sola vez, en
// orden, la primera vez que se usa la aplicación o el menú.
//
// Reglas para una migración:
// - Debe poder correr sobre una hoja vieja sin perder datos.
// - No borra columnas ni filas: solo agrega o completa.
// - Usa las funciones tabla* de Datos.js, no puntoAgregar_ (ya está dentro del bloqueo).
// =====================================================================

var ESQUEMA_ACTUAL = 5;

var MIGRACIONES = {
  1: migracionColumnas_,
  2: migracionIdsAnteriores_,
  3: migracionProtecciones_,
  4: migracionSaldos_,
  5: migracionAgenda_
};

/** Aplica las migraciones pendientes. Es barato llamarlo seguido. */
function asegurarEsquema_() {
  var props = PropertiesService.getScriptProperties();
  if ((Number(props.getProperty('ESQUEMA')) || 0) >= ESQUEMA_ACTUAL) return;
  if (!libro_().getSheetByName(HOJA_PUNTOS)) return; // todavía no se ejecutó "configurar"
  conBloqueo_(function () {
    var actual = Number(props.getProperty('ESQUEMA')) || 0; // otra ejecución pudo adelantarse
    for (var v = actual + 1; v <= ESQUEMA_ACTUAL; v++) {
      MIGRACIONES[v]();
      props.setProperty('ESQUEMA', String(v));
    }
  });
}

/** Una pestaña, o null si no existe (las migraciones se saltan lo que falta, sin fallar). */
function hojaSiExiste_(nombre) {
  return libro_().getSheetByName(nombre);
}

/** 1 · Columnas de la versión 1.2.0 en Puntos y en _Claves. */
function migracionColumnas_() {
  asegurarColumnas_(hoja_(HOJA_PUNTOS), columnasPuntos_());
  var claves = hojaSiExiste_(HOJA_CLAVES);
  if (claves) asegurarColumnas_(claves, COLS_CLAVES);
}

/**
 * 2 · Puntos enviados antes de la versión 1.2.0, que no tienen ID: se les asigna uno
 * y se anota quién los envió, por su nombre. Los del enlace general quedan sin código
 * de edición, así que nadie puede editarlos.
 */
function migracionIdsAnteriores_() {
  puntosLeer_().forEach(function (p) {
    if (p['ID'] || !p['Presenta']) return;
    var cols = columnasPuntos_();
    var general = p['Departamento'] === 'Miembro de la iglesia';
    tablaCelda_(HOJA_PUNTOS, cols, p._fila, 'ID', nuevaClave_());
    tablaCelda_(HOJA_PUNTOS, cols, p._fila, 'Enviado por', general ? GENERAL : String(p['Presenta']));
    if (p['Ediciones'] === '' || p['Ediciones'] == null) tablaCelda_(HOJA_PUNTOS, cols, p._fila, 'Ediciones', 0);
  });
}

/**
 * 3 · Protege las columnas internas para que nadie las borre sin querer.
 * Es solo un aviso: quien edite esas celdas ve una advertencia y puede continuar.
 */
function migracionProtecciones_() {
  var h = hoja_(HOJA_PUNTOS);
  var enc = asegurarColumnas_(h, columnasPuntos_());
  ['ID', 'Enviado por', 'Código de edición'].forEach(function (col) {
    h.getRange(1, enc.indexOf(col) + 1, h.getMaxRows(), 1).protect()
      .setDescription('Columna interna: la usa la aplicación para editar puntos. No la cambie.')
      .setWarningOnly(true);
  });
  var claves = hojaSiExiste_(HOJA_CLAVES);
  if (claves) claves.protect().setDescription('Claves de los enlaces. No las cambie a mano.').setWarningOnly(true);
  var hist = hojaSiExiste_(HOJA_HISTORIAL);
  if (hist) hist.protect().setDescription('Historial de ediciones. No lo cambie a mano.').setWarningOnly(true);
}

/** 4 · Pestaña Saldos, para mostrar a cada departamento su saldo de tesorería (versión 1.4.0). */
function migracionSaldos_() {
  var ss = libro_();
  if (ss.getSheetByName(HOJA_SALDOS)) return;
  var h = crearHoja_(ss, HOJA_SALDOS, COLS_SALDOS, []);
  h.getRange(1, 2, h.getMaxRows(), 7).setNumberFormat('#,##0.00');
  h.getRange(1, 12).setValue('Cómo llenarla: copie la tabla del reporte de tesorería y péguela desde la celda A2 ' +
    '(columnas A a H, sin la fila de totales). En "Departamento en Cargos" escriba a qué departamento de la pestaña ' +
    'Cargos corresponde cada fila; si son varios, sepárelos con coma. Deje vacío lo que no es de un departamento. ' +
    'En "Periodo del reporte" escriba el periodo en la primera fila, por ejemplo: octubre 2026.').setFontColor('#5f6368');
  [240, 110, 110, 110, 110, 110, 110, 110, 260, 160].forEach(function (w, i) { h.setColumnWidth(i + 1, w); });
}

/** 5 · Columnas de orden y tiempo asignado en Puntos (versión 1.8.0). */
function migracionAgenda_() {
  asegurarColumnas_(hoja_(HOJA_PUNTOS), columnasPuntos_());
}
