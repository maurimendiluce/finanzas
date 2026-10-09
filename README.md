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

## Notas
- Seguridad: la anon key es pública; los datos quedan protegidos por RLS (cada usuario solo ve sus filas).
- La fila fija **Servicios** se calcula sola desde las Facturas (luz, agua, gas, ABL) con los porcentajes de `config.js`. Si escribís un valor a mano en esa celda, gana el manual (como en septiembre/octubre de tu planilla).
- **+ Mes** crea el mes siguiente y ofrece copiar ingresos, fijos y cuotas del anterior.
- Probar local: `python3 -m http.server` y abrir http://localhost:8000.
