// Hoja de cálculo simulada en memoria, con solo lo que usa el código (para las pruebas del servidor).
// cargarServidor(exportar) evalúa dist/Codigo.gs con Google simulado y devuelve las funciones pedidas.
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Codigo.gs'), 'utf8');

class Hoja {
  constructor(nombre) { this.nombre = nombre; this.celdas = []; this.protecciones = []; }
  getLastRow() { return this.celdas.length; }
  getLastColumn() { return Math.max(0, ...this.celdas.map(f => f.length)); }
  appendRow(fila) {
    // Como Sheets: agrega después de la última fila con contenido.
    let ultima = this.celdas.length;
    while (ultima > 0 && this.celdas[ultima - 1].every(x => x === '' || x == null)) ultima--;
    this.celdas.splice(ultima, 0, fila.map(guardar));
    this.celdas.length = Math.max(this.celdas.length, ultima + 1);
  }
  getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
  getRange(fila, col, nf = 1, nc = 1) {
    if (typeof fila === 'string') {
      // Notación A1: "E1" (una celda) o "B:B" (una columna entera).
      const num = (letras) => letras.split('').reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0);
      const celda = /^([A-Z]+)(\d+)$/.exec(fila), columna = /^([A-Z]+):\1$/.exec(fila);
      if (celda) return this.getRange(Number(celda[2]), num(celda[1]));
      if (columna) return this.getRange(1, num(columna[1]), this.getMaxRows(), 1);
      throw new Error('Notación no soportada en la hoja simulada: ' + fila);
    }
    const h = this;
    return {
      getValues: () => Array.from({ length: nf }, (_, i) =>
        Array.from({ length: nc }, (_, j) => ((h.celdas[fila - 1 + i] || [])[col - 1 + j] ?? ''))),
      setValues(v) {
        v.forEach((f, i) => f.forEach((x, j) => {
          const r = fila - 1 + i; while (h.celdas.length <= r) h.celdas.push([]);
          h.celdas[r][col - 1 + j] = guardar(x);
        }));
        return this;
      },
      getDisplayValues() { return this.getValues().map(f => f.map(x => (x == null ? '' : String(x)))); },
      setValue(x) { return this.setValues([[x]]); },
      clearContent() {
        for (let i = 0; i < nf; i++) for (let j = 0; j < nc; j++) if (h.celdas[fila - 1 + i]) h.celdas[fila - 1 + i][col - 1 + j] = '';
        return this;
      },
      setFontWeight() { return this; }, setBackground() { return this; },
      setNumberFormat() { return this; }, setFontColor() { return this; }, setNote() { return this; },
      protect() { h.protecciones.push('columna ' + col); return proteccion; }
    };
  }
  getMaxRows() { return 1000; }
  protect() { this.protecciones.push('hoja'); return proteccion; }
  hideSheet() {}
  setColumnWidth() {}
  setFrozenRows() {}
}
const proteccion = { setDescription() { return this; }, setWarningOnly() { return this; } };
// Como Sheets: un texto que empieza con ' se guarda sin el apóstrofo.
const guardar = (x) => (typeof x === 'string' && x[0] === "'" ? x.slice(1) : x);

function cargarServidor(exportar, reemplazos = '') {
  const hojas = {};
  const propiedades = {};
  const libro = { getSheetByName: (n) => hojas[n] || null, insertSheet: (n) => (hojas[n] = new Hoja(n)) };
  const entorno = { __libro: libro, __propiedades: propiedades, __require: require };
  const api = new Function(...Object.keys(entorno), code + `;
  libro_ = function () { return __libro; };
  PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => __propiedades[k] ?? null, setProperty: (k, v) => { __propiedades[k] = v; } }) };
  limitar_ = function () {};
  LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  Session = { getScriptTimeZone: () => 'America/Panama' };
  Utilities = { getUuid: () => __require('crypto').randomUUID(),
                formatDate: (d) => d.toISOString().slice(0, 10) };
  guardarArchivo_ = function (a) { return 'https://drive.google.com/archivo/' + a.nombre; };
  ${reemplazos}
  return { ${exportar.join(', ')} };`)(...Object.values(entorno));
  return { api, hojas, libro, propiedades };
}

module.exports = { cargarServidor };
