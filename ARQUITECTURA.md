# Arquitectura

Cómo está hecha la aplicación, por qué se eligió así y cuándo convendría cambiarla. Está pensado para quien mantenga el código en el futuro.

## En una frase

Una **aplicación web de Google Apps Script** que usa una **hoja de Google Sheets como base de datos** y **Google Drive para los archivos**. El código vive en GitHub, se prueba con GitHub Actions y se publica en Apps Script con `clasp`.

```
 Hermanos (celular o computadora)            Secretaría / quien administra
          │ enlace personal ?t=clave                    │ menú "Junta" en la hoja
          ▼                                             ▼
 ┌──────────────────────── Google Apps Script ─────────────────────────┐
 │  WebApp.js  ── página (Formulario.html) ──┐        Menu.js           │
 │  Puntos.js · Archivos.js · Agenda.js · Enlaces.js · Correo.js ·      │
 │  Contactos.js · Esquema.js                │                          │
 │                     ▼                     ▼                          │
 │                 Datos.js  (única puerta a los datos)                 │
 └─────────────────────┬───────────────────────────────┬────────────────┘
                       ▼                               ▼
          Google Sheets (pestañas de datos)     Google Drive (cotizaciones y material)
```

## Por qué esta tecnología

Decisión tomada en noviembre de 2026, versión 1.2.0.

| A favor | En contra |
|---|---|
| Gratis, sin servidores ni nada que se caiga o venza | Límites de Google: 6 min por ejecución, ~100 correos/día, archivos de hasta ~50 MB |
| Los datos están en la cuenta de Google de la iglesia, en una hoja que la secretaría entiende | Sheets no es una base de datos: alguien puede mover o borrar columnas |
| Integración directa con Correo, Drive, Docs y Contactos | No hay inicio de sesión real: los permisos van en los enlaces |
| Otra iglesia puede copiarlo y usarlo sin depender de nadie | El código corre dentro de Google: se prueba con simulaciones |

Se evaluó Firebase, Supabase con Vercel y AppSheet (ver la sección *Cuándo migrar*). Para unas 20 personas y una junta al mes, lo que ofrecen no compensaba perder lo de la columna izquierda.

## Estructura del repositorio

```
src/
  servidor/          Código de Apps Script, un archivo por tema (se une en dist/Codigo.gs)
    00-Config.js     Versión, nombres de pestañas, columnas, listas fijas, cargos de ejemplo
    Menu.js          Menú "Junta" de la hoja: nueva junta, enlaces, URL, configuración
    WebApp.js        Puertas de entrada de la página: doGet, enviar, editar, mis puntos
    Puntos.js        Reglas de un punto: validar, guardar, quién puede editar
    Archivos.js      Cotizaciones y material de apoyo: tipos, tamaño, contenido real
    Agenda.js        Genera la pestaña de agenda de una junta (vista)
    Enlaces.js       Genera la pestaña Enlaces y los mensajes de WhatsApp (vista)
    Correo.js        Correo con el enlace e instrucciones
    Contactos.js     Importa teléfonos y correos de los contactos de Google
    Datos.js         CAPA DE DATOS: la única que lee o escribe las pestañas de datos
    Esquema.js       Migraciones de la estructura de la hoja
    Utilidades.js    Fechas y textos
  formulario/
    Formulario.html  Estructura de la página (se une con los dos de abajo en dist/)
    estilos.css      Apariencia (parecida a Google Forms)
    formulario.js    Lógica de la página: páginas, validación, archivos, edición
  appsscript.json    Configuración del proyecto de Apps Script
scripts/
  empaquetar.js      Une src/ en dist/ (lo que se prueba y se publica)
tests/               Pruebas automáticas (ver Pruebas)
dist/                Generado: Codigo.gs, Formulario.html, appsscript.json (no se sube a git)
```

**¿Por qué empaquetar?** Apps Script acepta varios archivos, pero empaquetados:
- se prueba **exactamente** lo que se publica;
- la instalación manual sigue siendo de dos archivos, que se descargan de cada *Release*.

## Reglas para mantener el orden

1. **Solo `Datos.js` toca las pestañas de datos** (*Puntos*, *Juntas*, *_Claves*, *Cargos*, *Contactos*, *Historial*, *Saldos*). El resto pide y entrega objetos, por ejemplo `puntosLeer_()`, `puntoReemplazar_(id, obj)` o `leerClaves_(junta)`. Las "vistas" (*Enlaces* y las *Agendas*) las escribe su propio módulo, porque nadie las lee de vuelta.
2. **Se lee y escribe por nombre de columna**, nunca por posición. Una columna nueva se agrega sola al final, y las filas viejas no se desordenan.
3. **Los cambios de estructura van en `Esquema.js`** como una migración numerada: agrega o completa, nunca borra. Se aplican solos, una vez y en orden. La hoja guarda su número de esquema en la propiedad `ESQUEMA`.
4. **Compatibilidad hacia atrás:** los enlaces ya enviados y los datos existentes deben seguir funcionando después de cada versión. Si no es posible, es una versión MAYOR y lo dice el CHANGELOG.
5. **Todo lo que llega de la página se valida otra vez en el servidor** (`validarPunto`, `guardarArchivo_`). La validación de la página es solo para comodidad.
6. **Ningún dato real en el repositorio:** nombres, teléfonos y correos viven solo en la hoja; los ejemplos y las pruebas usan nombres ficticios.

## Modelo de datos (pestañas)

| Pestaña | Una fila es | Columnas clave |
|---|---|---|
| **Cargos** | un cargo de una persona | Departamento, Nombre, Cargo, ¿Es director? |
| **Contactos** | una persona | Nombre, Teléfono, Correo |
| **Juntas** | una junta | Fecha (`dd/mm/aaaa`, texto), Día, Estado (*Abierta* o *Cerrada*) |
| **_Claves** (oculta) | el enlace de una persona para una junta | Clave (32 hex), Junta, Persona (o `GENERAL`), Correo enviado |
| **Puntos** | un punto, en su versión actual | ver `COLS_PUNTOS` y `COLS_CONTROL` en `00-Config.js`; ID, Enviado por, Código de edición, Ediciones |
| **Historial** | una versión anterior de un punto | Fecha de la edición + las mismas columnas de Puntos |
| **Saldos** | un fondo del reporte de tesorería | las 8 columnas del reporte (ver `COLS_SALDOS`), Departamento en Cargos, Periodo del reporte |

Las fechas se guardan como **texto** `dd/mm/aaaa` para que Sheets no las convierta según el idioma.

## Seguridad

- **Enlaces:** cada persona tiene una clave aleatoria de 128 bits por junta. La clave sirve solo mientras la junta está abierta y hasta el final de su día. *Nueva junta* reemplaza todas; *Cambiar el enlace* reemplaza una.
- **Editar:** con un enlace personal, solo los puntos propios de la junta abierta. Con el enlace general, solo con el *código de edición* que recibe la página que envió el punto.
- **Archivos:** se revisan la extensión, el tamaño y los primeros bytes (la "firma") del contenido.
- **Hoja:** los textos se guardan con `'` delante para que nunca se ejecuten como fórmulas. Las columnas internas tienen protección de advertencia.
- **Límite de envíos** por enlace cada 6 horas, contra abusos.
- **Credenciales:** en los secretos de GitHub (`CLASPRC_JSON`, `SCRIPT_ID`, `DEPLOYMENT_ID`), nunca en el código.

## Publicación

1. Un cambio llega a `main` por *pull request*, con la verificación `pruebas`.
2. GitHub Actions empaqueta y corre las pruebas.
3. Si `package.json` trae un número de versión sin etiqueta, Actions sube `dist/` con clasp, publica una nueva versión **en la misma implementación** (la URL no cambia), crea la etiqueta y la *Release* con los archivos adjuntos.

Ver *Versiones* en el README para publicar o volver atrás.

## Pruebas

`npm test` empaqueta y corre todo:

| Archivo | Qué prueba |
|---|---|
| `version.test.js` | La versión coincide en el código, `package.json` y el CHANGELOG |
| `validar.test.js` | Reglas de un punto, firmas de archivos y fechas |
| `mensajes.test.js` | Teléfonos, WhatsApp y correo |
| `contactos.test.js` | Búsqueda de personas en los contactos de Google |
| `datos.test.js` | Juntas, claves y validación de enlaces, con la hoja simulada |
| `agenda.test.js` | La agenda generada: orden, actividad, presupuesto y material |
| `edicion.test.js` | Enviar, editar, historial, permisos y migraciones, con la hoja simulada |
| `formulario.test.js`, `descripcion.test.js`, `edicion-pagina.test.js`, `saldo-pagina.test.js`, `categorias-pagina.test.js` | La página en un navegador real (Chromium), con el servidor simulado |

`tests/hoja-simulada.js` imita Google Sheets en memoria y `tests/servidor-simulado.js` imita `google.script.run`. **Lo que no se puede probar aquí** es lo que solo existe en Google: permisos, cuotas, la apariencia real de la hoja y el envío de correos.

## Agregar una función (lista de verificación)

1. ¿Agrega mucha complejidad? ¿Hay una forma más simple? Decídalo antes de programar.
2. Los datos nuevos se guardan a través de `Datos.js`. Si cambia la estructura, agregue una migración en `Esquema.js`.
3. Pruebas para el caso normal, los errores y la **compatibilidad** con datos y enlaces existentes.
4. Suba la versión (MENOR para funciones nuevas) en `00-Config.js`, `package.json` y `CHANGELOG.md`, con su sección **Qué hacer**.
5. Si pide un permiso nuevo de Google, avíselo en el CHANGELOG: hay que autorizarlo apenas se publique.

## Cuándo migrar a otra tecnología

Señales de que llegó el momento:

- Se necesita **inicio de sesión con roles** de verdad: secretaría, tesorería, pastor, miembros.
- **Varias iglesias** en una misma instalación central, en vez de una copia cada una.
- **Colaboración en vivo** durante la junta, con varias personas editando a la vez.
- Los datos crecen a **miles de filas** con búsquedas complejas.
- Los límites de Google (tiempo, correos, archivos) empiezan a molestar.

**Siguiente paso recomendado: Firebase** (Firestore, Authentication, Hosting y Functions). Sigue en el ecosistema de Google y tiene un nivel gratuito suficiente para esta escala, aunque algunas funciones exigen registrar una tarjeta.

**Cómo migrar:** reescribir `Datos.js` contra Firestore, conservando sus funciones (`puntosLeer_`, `puntoReemplazar_`, `leerClaves_`, …). El resto del servidor casi no cambia. Las pruebas de `datos.test.js` y `edicion.test.js` sirven para verificar la nueva capa, cambiando la hoja simulada por una base de datos simulada.

**Descartados por ahora:**
- *Supabase con Vercel*: los proyectos gratis se pausan tras una semana sin uso, y aquí se usa una vez al mes.
- *AppSheet*: poco personalizable y se paga por usuario.
