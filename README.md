# Puntos para la Junta Directiva

Aplicación web hecha con Google Apps Script para que los oficiales de la iglesia envíen los puntos de la agenda de la Junta Directiva. Se ve como Google Forms. Las respuestas se guardan en una hoja de Google Sheets y las cotizaciones en una carpeta de Google Drive.

## Qué hace

- **Un enlace por persona y por junta.** En el menú **Junta → Nueva junta** se elige la fecha y se crean enlaces nuevos para cada persona de la pestaña *Cargos*, más un enlace general para miembros. Los enlaces de la junta anterior dejan de funcionar.
- **Pestaña "Enlaces":** primero aparecen los directores, después los asociados y miembros, y al final el enlace general.
- **El formulario se adapta a cada respuesta:**
  - *Informativo*: solo pide los datos del punto y la descripción del informe.
  - *Para votación*: pregunta si es una actividad (fecha, hora, lugar, responsable) y si se pide dinero de la iglesia.
  - *Presupuesto*: costo total y monto que se pide a la iglesia, que no puede ser mayor. Si no cubre todo, pregunta cómo se conseguirá el resto. El costo se explica con una descripción, un enlace o un archivo (PDF, Word o imagen de hasta 5 MB).
- **Agenda automática:** **Junta → Generar agenda** arma una pestaña con los puntos ordenados: devocional, evangelismo y misión, acta anterior, tesorería, departamentos, feligresía, asuntos generales y oración de clausura.
- **Puntos del enlace general:** llegan como *Por revisar* y entran en la agenda cuando su Estado se cambia a *Aprobado*.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `Codigo.gs` | El servidor: menú de la hoja, enlaces, validación, guardado y agenda |
| `Formulario.html` | La página que ven los hermanos |
| `tests/` | Pruebas automáticas (no se suben a Google) |

## Instalación

Se trabaja en dos lugares. Cada paso dice dónde:

- 📊 **La hoja de cálculo**, en Google Sheets: donde quedan los puntos, los enlaces y las agendas.
- 🛠️ **El editor de Apps Script**: donde va el código. **Siempre se abre desde la hoja**, con el menú **Extensiones → Apps Script**. No cree el proyecto en script.google.com ni en Drive: si el código no está dentro de la hoja, no funciona.

### Paso 1 · Crear la hoja (📊 Google Sheets)

1. Entre a [sheets.google.com](https://sheets.google.com) y cree una **hoja de cálculo en blanco**.
2. Póngale nombre arriba a la izquierda, por ejemplo **Junta Directiva**.

### Paso 2 · Pegar el código (🛠️ Apps Script)

1. 📊 En la hoja, vaya al menú **Extensiones → Apps Script**. Se abre el editor en otra pestaña.
2. 🛠️ A la izquierda, en *Archivos*, está `Código.gs`. Ábralo, borre todo lo que tenga y pegue el contenido de **`Codigo.gs`**.
3. 🛠️ Junto a *Archivos*, haga clic en **+ → HTML**. Escriba el nombre **`Formulario`**, exactamente así, sin `.html`. Borre lo que trae y pegue el contenido de **`Formulario.html`**.
4. 🛠️ Presione el ícono de **guardar** (💾) arriba.

### Paso 3 · Configurar (🛠️ Apps Script)

1. 🛠️ Arriba, al lado del botón **Ejecutar**, hay una lista con nombres de funciones. Elija **`configurar`**.
2. 🛠️ Presione **Ejecutar**.
3. La primera vez, Google pide permisos:
   - Presione **Revisar permisos** y elija su cuenta.
   - Aparecerá *"Google no ha verificado esta aplicación"*. Es normal en scripts propios: presione **Configuración avanzada → Ir a … (no seguro)**.
   - Presione **Permitir**. El acceso a Drive se usa para guardar las cotizaciones.
4. 🛠️ Abajo, en el *Registro de ejecución*, debe aparecer **"Configuración lista"** en pocos segundos.
5. 📊 En la hoja aparecen las pestañas **Cargos**, **Juntas** y **Puntos**. En su Google Drive aparece la carpeta **"Cotizaciones – Junta Directiva"**.

### Paso 4 · Publicar la aplicación (🛠️ Apps Script)

1. 🛠️ Arriba a la **derecha**, presione el botón azul **Implementar → Nueva implementación**.
2. 🛠️ Al lado de *"Seleccionar tipo"*, presione el **engranaje ⚙️** y elija **Aplicación web**.
3. 🛠️ Complete:
   - **Descripción:** por ejemplo *Versión 1*
   - **Ejecutar como:** *Yo (su correo)*
   - **Quién tiene acceso:** *Cualquier usuario*
4. 🛠️ Presione **Implementar**. Si pide permisos otra vez, acéptelos.
5. 🛠️ Copie la **URL de la aplicación web**, la que termina en `/exec`. Normalmente la hoja la detecta sola, pero téngala a mano por si la pide.

### Paso 5 · Crear la primera junta (📊 Google Sheets)

1. 📊 Vuelva a la pestaña de la hoja y **recárguela** (F5). Arriba aparece un menú nuevo: **Junta**.
2. 📊 Vaya a **Junta → Nueva junta…** y escriba la fecha, por ejemplo `14/03/2027`. Si pide la URL, pegue la del paso 4.
3. 📊 Se abre la pestaña **Enlaces** con el enlace de cada persona. Envíe cada uno **en privado** a su dueño.

## Uso diario (📊 Google Sheets)

Todo se hace desde el menú **Junta** de la hoja:

| Opción | Para qué sirve |
|---|---|
| **Nueva junta…** | Elegir la fecha de la próxima junta y crear enlaces nuevos. Los anteriores dejan de funcionar. |
| **Generar agenda…** | Crear la pestaña *Agenda dd-mm-aaaa* con los puntos ordenados. Se puede generar varias veces: se reemplaza. |
| **Cambiar el enlace de una persona…** | Si un enlace se filtró. Escriba el nombre, o `GENERAL` para el enlace general. |
| **Cerrar recepción de puntos** | Dejar de recibir puntos antes del día de la junta. |
| **Cambiar la URL de la aplicación…** | Solo si creó una implementación nueva en vez de actualizar la existente. |

**Puntos del enlace general:** en la pestaña **Puntos**, cambie su columna *Estado* de *Por revisar* a *Aprobado* (o *Rechazado*) y vuelva a generar la agenda.

## Cambiar los cargos (📊 Google Sheets)

Edite la pestaña **Cargos**: departamento, nombre, cargo y si es director (*Sí* o *No*). Agregue o borre filas según haga falta. Los cambios se aplican en la siguiente **Junta → Nueva junta**.

## Actualizar el código (🛠️ Apps Script)

Cuando haya una versión nueva de `Codigo.gs` o `Formulario.html`:

1. 📊 En la hoja, vaya a **Extensiones → Apps Script**.
2. 🛠️ Abra el archivo que cambió (`Código.gs` o `Formulario`), borre todo, pegue la versión nueva y presione **guardar** (💾).
3. 🛠️ Vaya a **Implementar → Gestionar implementaciones**.
4. 🛠️ Presione el **lápiz ✏️** (editar). En **Versión**, elija **Nueva versión** y presione **Implementar**.

> ⚠️ **No use "Nueva implementación" para actualizar.** Eso crea un enlace de aplicación distinto y los enlaces que ya envió dejarían de funcionar. Si ya lo hizo, use **Junta → Cambiar la URL de la aplicación…** y luego **Junta → Nueva junta**.

**No hace falta ejecutar `configurar` otra vez** al actualizar, salvo que el cambio lo indique. Si lo ejecuta, no pasa nada: no borra ni duplica pestañas ni la carpeta.

## Problemas comunes

| Mensaje | Causa y solución |
|---|---|
| *Este script no está dentro de una hoja de cálculo* o *Cannot read properties of null (reading 'getId')* | El proyecto se creó en script.google.com o en Drive. Créelo desde la hoja: **Extensiones → Apps Script** (paso 2). |
| *Excedió el tiempo máximo de ejecución* al ejecutar `configurar` | Pasaba con una versión anterior que esperaba un clic en la hoja. Actualice `Código.gs` y ejecute `configurar` de nuevo. |
| No aparece el menú **Junta** | Recargue la hoja (F5). Si sigue sin aparecer, revise que el código esté pegado en el editor que se abre desde **Extensiones → Apps Script**. |
| El enlace dice *"Este enlace no es válido"* | La junta ya pasó, se cerró la recepción o el enlace se cambió. Cree una junta nueva o cambie el enlace de esa persona. |
| Los cambios en el código no se ven en la página | Falta publicar la versión nueva: **Implementar → Gestionar implementaciones → ✏️ → Nueva versión**. |

## Seguridad

- Cada enlace lleva una clave aleatoria. Solo funciona para la junta abierta y vence al terminar el día de la junta.
- El servidor vuelve a revisar todos los datos: que el departamento sea de esa persona, los montos, el tipo de archivo (revisando su contenido, no solo la extensión) y el tamaño.
- La página solo envía datos: nadie puede ver los puntos de otros desde el enlace.
- Hay un límite de envíos por enlace para evitar abusos.
- Los textos se guardan de forma que la hoja no los interprete como fórmulas.

## Pruebas

Las pruebas revisan las reglas de validación del servidor y el comportamiento de la página en un navegador. No prueban la parte que corre dentro de Google: hoja, Drive y menú.

```bash
npm install
npx playwright install chromium
npm test
```
