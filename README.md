# Semilla Digital

Aplicacion web moderna de Semilla Digital para administrar y responder cuestionarios por categoria. Esta version reemplaza el runtime PHP/MySQL por Astro SSR, TypeScript, Tailwind CSS y SQLite local.

## Stack

- Astro SSR con adapter Node
- TypeScript estricto
- Tailwind CSS
- SQLite local en `data/app.db`
- Drizzle ORM para schema y queries
- Vitest para tests unitarios
- Playwright para tests end-to-end
- pnpm como unico package manager

## Requisitos

- Node.js 22 o superior
- pnpm 9 o superior

No necesitas XAMPP, Apache, PHP ni MySQL para correr esta version.

## Inicio Rapido

1. Instala dependencias.

   ```bash
   pnpm install
   ```

2. Crea o actualiza el schema SQLite.

   ```bash
   pnpm db:migrate
   ```

3. Carga datos iniciales.

   ```bash
   pnpm db:seed
   ```

   El seed crea:

   ```text
   Usuario admin: admin
   Password admin: admin
   Categoria demo: Razonamiento demo
   Preguntas demo: 3
   ```

4. Inicia el servidor de desarrollo.

   ```bash
   pnpm dev
   ```

5. Abre la app.

   ```text
   http://localhost:4321/
   http://localhost:4321/admin/login
   ```

## Scripts

```bash
pnpm dev          # servidor local
pnpm build        # build SSR para Node
pnpm preview      # preview del build
pnpm check        # astro check + TypeScript
pnpm db:generate  # genera migraciones Drizzle futuras
pnpm db:migrate   # crea/actualiza tablas SQLite
pnpm db:seed      # crea datos iniciales
pnpm test         # unit tests
pnpm test:e2e     # Playwright tests
```

## Estructura

```text
.
|-- src/
|   |-- db/                 # schema, cliente SQLite y migraciones
|   |-- layouts/            # layouts publico/admin
|   |-- lib/                # auth, juego, CRUD, uploads, validacion
|   `-- pages/              # rutas Astro
|-- scripts/                # migrate y seed
|-- tests/                  # Vitest y Playwright
|-- public/
|   |-- img/                # assets de marca/fondos
|   `-- demo/questions/     # imagenes demo versionadas
|-- data/
|   |-- app.db              # SQLite local ignorado por Git
|   `-- uploads/questions/  # imagenes subidas por el admin
`-- legacy/php-app/         # version PHP anterior como referencia
```

## Rutas Principales

- `/`: listado publico de categorias.
- `/jugar/[categoriaId]`: flujo del cuestionario.
- `/final`: resultado final.
- `/admin/login`: login administrador.
- `/admin`: dashboard.
- `/admin/preguntas`: listado y eliminacion de preguntas.
- `/admin/preguntas/nueva`: crear categoria y pregunta.
- `/admin/preguntas/[id]/editar`: editar pregunta.
- `/admin/configuracion`: usuario, password y preguntas por juego.

## Base de Datos

El archivo SQLite se crea en:

```text
data/app.db
```

Tablas principales:

- `settings`: credenciales admin hasheadas y preguntas por juego.
- `categories`: categorias.
- `questions`: preguntas, opciones, respuesta correcta e imagen.
- `stats`: visitas, respuestas y juegos completados.
- `admin_sessions`: sesiones admin y token CSRF.
- `game_sessions`: estado server-side de partidas.

`data/` esta ignorado por Git para no versionar datos locales. En esa carpeta viven la base SQLite y las imagenes subidas desde el admin, asi que debe respaldarse si quieres conservar datos reales.

## Seguridad Implementada

- Password admin con hash `scrypt`.
- Sesiones admin server-side en SQLite.
- CSRF en mutaciones del admin.
- Limite de intentos fallidos de login por usuario/IP.
- Invalidacion de sesiones antiguas cuando cambian usuario o password.
- Uploads de imagen fuera de `public/`, con validacion de tamano, extension y firma real.
- Proteccion contra doble envio de respuestas en el cuestionario.
- Validacion de formularios con Zod.
- Las operaciones destructivas del admin usan POST.

## Notas de Migracion

- El runtime PHP anterior fue movido a `legacy/php-app/`.
- Los assets publicos fueron movidos a `public/img/`.
- El logo activo de marca es `public/img/semilla-digital-logo.svg`.
- Las imagenes demo de preguntas fueron movidas a `public/demo/questions/`.
- Las imagenes subidas por el admin se guardan en `data/uploads/questions/` y se sirven desde `/uploads/questions/[archivo]`.
- No se migro MySQL porque el repositorio no tenia dump real.
- Para produccion, cambia el password `admin/admin` inmediatamente desde `/admin/configuracion`.
- El seed mantiene `admin/admin` para arrancar el proyecto; al cambiar el password desde el admin se exige minimo 8 caracteres.

## Verificacion

Antes de entregar cambios o desplegar:

```bash
pnpm check
pnpm test
pnpm build
pnpm test:e2e
```

Si Playwright fue instalado por primera vez y falta Chromium:

```bash
pnpm exec playwright install chromium
```
