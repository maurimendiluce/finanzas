# Finanzas personales (GitHub Pages + Supabase)

## 1. Supabase
1. Crear un proyecto en supabase.com.
2. **SQL Editor** → pegar y ejecutar `supabase/schema.sql`.
3. **Authentication → Users → Add user**: tu email y contraseña (marcar "Auto confirm").
4. **Authentication → Sign In / Providers → Email**: desactivar "Allow new users to sign up" (así nadie más puede registrarse).
5. **SQL Editor** → ejecutar `supabase/seed.sql` (carga jul–oct 2026 desde la planilla; cambiá el email dentro si usás otro).
6. **Project Settings → API**: copiar *Project URL* y *anon public key* a `config.js`.

## 2. GitHub Pages
1. Subir la carpeta a un repo (`seed.sql` está en `.gitignore`: tiene tus datos, no lo subas).
2. Settings → Pages → Deploy from branch → `main` / root.

## Actualizar desde la versión anterior
1. Supabase → SQL Editor → ejecutar `supabase/002_payments.sql` (tabla del calendario; se puede correr más de una vez).
2. Reemplazar los archivos del repo (conservá tu `config.js`).

## Alertas en el calendario del celular (una sola vez)
1. SQL Editor → ejecutar `supabase/003_calendar_feed.sql`.
2. Publicar la función `calendar`:
   - **Desde el panel**: Edge Functions → Deploy a new function → Via Editor → nombre `calendar` → pegar el contenido de `supabase/functions/calendar/index.ts` → Deploy. Después, en los ajustes de esa función, **desactivar la verificación de JWT** (los calendarios no pueden mandar credenciales; el acceso lo protege el token privado).
   - **Con la CLI**: `supabase functions deploy calendar --no-verify-jwt`.
3. En la app: pestaña Calendario → "Generar enlace" → suscribirlo en el celular (instrucciones en la misma pantalla).

Solo salen los vencimientos pendientes, con alerta a las 9:00 del día (y opcionalmente 1–3 días antes). Si regenerás el enlace, el anterior deja de funcionar.

## Pestañas
- **Panel**: mes en curso (o el que elijas con ◀ ▶ / selector) con ingresos, gastos, balance, comparación con el mes anterior, dónde se va la plata y tendencia de 6 meses.
- **Planilla**: todos los meses, editable. Con **+ agregar** en Ingresos, Gastos fijos y Facturas sumás filas nuevas (aparecen en todos los meses, cargás el monto de cada uno); las que agregaste tienen una **×** para quitarlas. Las filas de `config.js` no se pueden quitar desde la pantalla.
- **Calendario**: vencimientos de pago. Click en un día para agregar; se pueden repetir todos los meses (el 31 cae el último día de los meses más cortos), marcar como pagados y ver los próximos en el Panel. Los vencidos sin pagar se marcan en rojo.
- **Servicios**: montos y % que paga Sabri por servicio, y tu % de la parte de la casa. Un % nuevo vale desde ese mes en adelante.
- **Inflación**: ingresos vs IPC (INDEC, nivel general nacional). "Actualizar IPC desde INDEC" lo trae solo; también se edita a mano. Podés elegir qué ingresos contar (p. ej. sin "Extra").

No hace falta cambiar el esquema de Supabase: porcentajes e IPC se guardan en la misma tabla `entries`.

## Notas
- Seguridad: la anon key es pública; los datos quedan protegidos por RLS (cada usuario solo ve sus filas).
- La fila fija **Servicios** se calcula sola desde las Facturas (luz, agua, gas, ABL) con los porcentajes de `config.js`. Si escribís un valor a mano en esa celda, gana el manual (como en septiembre/octubre de tu planilla).
- **+ Mes** crea el mes siguiente y ofrece copiar ingresos, fijos y cuotas del anterior.
- Probar local: `python3 -m http.server` y abrir http://localhost:8000.
