// La versión debe ser la misma en Codigo.gs, package.json y CHANGELOG.md.
// Si se ejecuta con una etiqueta (VERSION_ETIQUETA=v1.2.3), también debe coincidir con ella.
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

let fails = 0;
const check = (c, m) => { console.log((c ? 'OK    ' : 'FALLA ') + m); if (!c) fails++; };

const enCodigo = (/var VERSION = '([^']+)'/.exec(leer('Codigo.gs')) || [])[1];
const enPackage = JSON.parse(leer('package.json')).version;
const changelog = leer('CHANGELOG.md');
const enChangelog = (/^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog) || [])[1];
const semver = /^\d+\.\d+\.\d+$/;

check(semver.test(enCodigo || ''), 'Codigo.gs tiene una versión válida (' + enCodigo + ')');
check(enCodigo === enPackage, 'package.json tiene la misma versión (' + enPackage + ')');
check(enCodigo === enChangelog, 'la versión más reciente del CHANGELOG es la misma (' + enChangelog + ')');
check(changelog.includes('[' + enCodigo + ']: '), 'el CHANGELOG tiene el enlace de la versión ' + enCodigo);

const etiqueta = process.env.VERSION_ETIQUETA;
if (etiqueta) check(etiqueta === 'v' + enCodigo, 'la etiqueta ' + etiqueta + ' coincide con la versión del código');

console.log(fails ? fails + ' FALLAS' : 'TODO OK');
process.exitCode = fails ? 1 : 0;
