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

1. Cree una hoja de cálculo nueva en Google Sheets, por ejemplo "Junta Directiva".
2. Vaya a **Extensiones → Apps Script**. En `Código.gs`, borre todo y pegue el contenido de `Codigo.gs`.
3. Haga clic en **+ → HTML**, nómbrelo exactamente `Formulario` y pegue el contenido de `Formulario.html`.
4. Guarde, elija la función `configurar` y presione **Ejecutar**. Acepte los permisos.
   - Google mostrará *"Google no ha verificado esta aplicación"*. Es normal en scripts propios: entre en *Configuración avanzada → Ir a…*.
   - Pide acceso a Drive para guardar las cotizaciones en la carpeta *"Cotizaciones – Junta Directiva"*.
5. Vaya a **Implementar → Nueva implementación → Aplicación web**, con *Ejecutar como: Yo* y *Quién tiene acceso: Cualquier usuario*.
6. Recargue la hoja y use **Junta → Nueva junta**.

### Actualizar el código

Pegue los archivos nuevos en Apps Script y vaya a **Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar**. Así el enlace de la aplicación no cambia.

### Cambiar los cargos

Edite la pestaña **Cargos** de la hoja: departamento, nombre, cargo y si es director. Los cambios se aplican en la siguiente **Nueva junta**.

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
