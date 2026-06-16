# AGENTS.md

Guia operativa para agentes que trabajen en este proyecto.

## Quickstart

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

App local:

```text
http://localhost:4321/
http://localhost:4321/admin/login
```

Credenciales de desarrollo:

```text
admin / admin
```

Mantener `admin/admin` disponible mientras el usuario lo pida para arrancar el proyecto. En produccion se debe cambiar desde `/admin/configuracion`.

## Package manager

Usar solo `pnpm` (`packageManager`: `pnpm@9.10.0`). No usar `npm` ni `yarn`.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server Astro SSR |
| `pnpm build` | Production build SSR |
| `pnpm preview` | Preview del build |
| `pnpm check` | `astro check && tsc --noEmit` |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright e2e tests |
| `pnpm db:generate` | Generar migraciones Drizzle futuras |
| `pnpm db:migrate` | Aplicar migraciones runtime |
| `pnpm db:seed` | Crear datos base |

Verificacion antes de entregar:

```bash
pnpm check
pnpm test
pnpm build
pnpm test:e2e
```

## Stack

- Astro SSR con adapter Node.
- TypeScript estricto.
- Tailwind CSS v4 por `@tailwindcss/vite`.
- SQLite local en `data/app.db`.
- Drizzle ORM + `better-sqlite3`.
- Vitest para unit tests.
- Playwright para E2E.

## Arquitectura

- `src/pages/`: rutas Astro.
- `src/components/`: componentes reutilizables.
- `src/layouts/`: layouts base y admin.
- `src/lib/`: auth, juego, store, uploads, validacion.
- `src/db/`: cliente SQLite, schema y migraciones runtime.
- `scripts/`: migrate y seed.
- `tests/`: Vitest y Playwright.
- `legacy/php-app/`: version PHP anterior, solo referencia.

Alias:

```text
@/* -> src/*
```

## Separacion publico/admin

No mezclar navegacion publica con navegacion administrativa.

Sidebars:

- Publico: `src/components/PublicSidebar.astro`
- Admin: `src/components/AdminSidebar.astro`

Reglas:

- `PublicSidebar` no debe tener enlaces `/admin`.
- `AdminSidebar` debe usar rutas `/admin/*`.
- Si dos modulos tienen el mismo nombre, deben tener paginas separadas.

Rutas publicas:

| Route | Purpose |
|---|---|
| `/` | Dashboard publico/inicio |
| `/categorias` | Categorias publicas para practicar |
| `/simulacros` | Simulacros publicos |
| `/jugar/[categoryId]` | Juego de preguntas |
| `/final` | Resultado |
| `/detalle-resultado` | Detalle completo de respuestas de una partida |
| `/repasar-errores` | Repaso de respuestas incorrectas |

Rutas admin:

| Route | Purpose |
|---|---|
| `/admin/login` | Login |
| `/admin/logout` | Logout POST |
| `/admin` | Dashboard admin |
| `/admin/categorias` | CRUD admin de categorias |
| `/admin/simulacros` | Gestion/resumen admin de simulacros |
| `/admin/preguntas` | CRUD/listado de preguntas |
| `/admin/preguntas/nueva` | Crear categoria y pregunta |
| `/admin/preguntas/[id]/editar` | Editar pregunta |
| `/admin/usuarios` | Vista admin de usuario/acceso |
| `/admin/importar` | Importacion CSV validada |
| `/admin/reportes` | Reportes admin persistidos |
| `/admin/configuracion` | Usuario, password y preguntas por juego |

## Estado actual de modulos

Implementado:

- Home publico.
- Categorias publicas.
- Simulacros publicos.
- Juego por categoria.
- Resultado.
- Detalle completo de resultado por partida completada.
- Repaso de errores por partida completada.
- Historial publico persistente por visitante anonimo.
- Login/logout admin.
- Dashboard admin.
- CRUD de categorias.
- CRUD de preguntas.
- Importador CSV admin con validacion previa.
- Reportes admin basados en intentos persistidos.
- Configuracion admin.
- Paginas admin separadas para categorias, simulacros, reportes, usuarios e importar.

Parcial o placeholder:

- `/admin/simulacros`: resumen administrativo, no configuracion avanzada.
- `/admin/usuarios`: muestra usuario admin, no multiusuario.
- `/admin/reportes`: resumen persistido basico, no analitica avanzada.

## Base de datos

Archivo local:

```text
data/app.db
```

Tablas principales:

- `settings`: usuario admin, password hasheado y preguntas por juego.
- `categories`: categorias.
- `questions`: preguntas, opciones A-D, respuesta correcta e imagen.
- `stats`: visitas, respondidas y completadas.
- `admin_sessions`: sesiones admin y CSRF.
- `game_sessions`: partidas server-side.
- `quiz_attempts`: intentos completados para historial y reportes.

Notas:

- `data/` esta ignorado por Git.
- `game_sessions.question_ids` guarda un JSON array de IDs.
- `game_sessions.answers` guarda un JSON array de respuestas para repasar errores.
- `runMigrations()` se ejecuta al importar `src/db/client.ts`.
- Drizzle kit sirve para generar SQL futuro, no para aplicar migraciones runtime.

## Seguridad

- Password con `scrypt` en `src/lib/password.ts`.
- Sesiones admin en SQLite.
- CSRF obligatorio en mutaciones admin.
- Rate limit para login.
- Invalidacion de sesiones al cambiar credenciales.
- Uploads fuera de `public/`, en `data/uploads/questions/`.
- Endpoint read-only para servir uploads: `/uploads/questions/[filename]`.
- Validacion con Zod usando `safeParse`.
- Mutaciones destructivas por POST.
- Proteccion contra doble envio en respuestas del juego.

## Conventions

- Texto visible para usuarios en Espanol.
- Formularios Astro con POST a la misma pagina cuando sea posible.
- Evitar client-side JS salvo que aporte una interaccion real.
- No crear API routes para mutaciones normales; la excepcion actual es el endpoint read-only de uploads.
- Usar componentes separados cuando el dominio sea distinto aunque el estilo sea parecido.
- Mantener PHP legacy como referencia, no modificarlo salvo pedido explicito.
- No tocar datos reales en `data/` salvo que la tarea lo requiera.

## Testing

Unit tests:

- `tests/**/*.test.ts`
- Entorno `node`.
- Usan SQLite temporal via `DATABASE_URL`.

E2E:

- `tests/e2e/*.spec.ts`
- Chromium, un worker.
- `webServer` ejecuta migrate, seed y dev server.

Los E2E actuales cubren:

- Completar quiz publico.
- Ver detalle completo desde el resultado.
- Repasar errores desde el resultado.
- Abrir `/simulacros` y empezar simulacro demo.
- Login admin con `admin/admin`.
- Separacion de rutas admin para categorias y simulacros.
- CRUD de categorias.
- CRUD de preguntas.

## Prioridades siguientes

1. Ampliar el historial persistente si se decide multiusuario real.
2. Redisenar `/jugar/[categoryId]` al mockup nuevo y revisar UX responsive.
3. Mejorar `/final` con mas comparativas por categoria.
4. Ampliar `/admin/importar` a Excel si hace falta.
5. Decidir si habra multiusuario real antes de ampliar `/admin/usuarios`.
6. Revisar accesibilidad completa: focus, contraste, labels y navegacion teclado.
7. Preparar modo produccion: cambio de credenciales, backups de `data/`, variables de entorno y despliegue Node.

## Skills

Para UI compleja usar `frontend-design`.
Para Astro usar `astro`.
Para Tailwind usar `tailwind-css-patterns`.
Para E2E usar `playwright-best-practices`.
