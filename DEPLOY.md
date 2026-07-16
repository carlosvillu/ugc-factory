# Despliegue en el VPS (T0.13)

Cómo corre UGC Factory en producción: topología, flujo de deploy, variables,
migraciones, backups y troubleshooting. La guía operativa de la **plataforma**
(multi-proyecto) vive en `~/AGENTS.md` del VPS y manda sobre este documento en
todo lo que sea del VPS (puertos, convenciones, Caddy central).

## Topología

```
Internet → Cloudflare (DNS + proxy, SSL Full (strict))
         → Caddy central del VPS (contenedor edge-caddy, ~/infra/caddy, TLS Let's Encrypt)
         → 127.0.0.1:3100  ← web (Next standalone, docker-compose.prod.yml)
                              ├─ postgres:16 (red interna del compose, SIN puerto publicado)
                              └─ worker (bundle tsup; comparte red y volumen de assets)
```

- El proyecto vive en `~/projects/ugc-factory` del VPS (usuario `developer`).
- El compose del proyecto (`docker-compose.prod.yml`) NO lleva reverse-proxy ni
  TLS: eso es del **Caddy central**, compartido por todos los proyectos del VPS.
  El site file del proyecto es `~/infra/caddy/sites/ugc.carlosvillu.dev.caddy`.
- `web` publica **solo** `127.0.0.1:3100` (bloque 3100–3109 reservado en el
  registro de puertos de `~/AGENTS.md` §3). Nada más se publica: un puerto en
  `0.0.0.0` saltaría UFW.
- Assets en el volumen nombrado `ugc-assets`, montado en `/data/assets`:
  worker **rw**, web **ro** (§18 del PRD).

### Site file de Caddy (SSE + trust boundary)

`~/infra/caddy/sites/ugc.carlosvillu.dev.caddy` hace dos cosas además del proxy:

1. **`flush_interval -1` en la ruta SSE** (`/api/runs/*/events`): sin él, Caddy
   bufferiza y los eventos del canvas llegan a ráfagas.
2. **Sobrescribe `x-forwarded-for`** con la IP del socket
   (`header_up X-Forwarded-For {client_ip}`): el header deja de ser
   client-controllable y el rate-limit del login no se puede bombear rotándolo.
   Es la mitad Caddy del trust boundary; la otra mitad es `TRUST_PROXY=1` en el
   entorno de web (la app toma la ÚLTIMA entrada del header y nunca el valor
   crudo del cliente ni `x-real-ip`).

Nota Cloudflare: con el proxy naranja delante, la IP que Caddy ve en el socket
es de Cloudflare y la IP real del cliente llega en `CF-Connecting-IP`. **No la
usamos** para el rate-limit: confiar en ese header exigiría validar que el
socket pertenece a los rangos IP de Cloudflare (lista a mantener = más
superficie de confianza), y un atacante que llegue directo al origen podría
falsificarlo. El bucket por IP-de-socket (edge de Cloudflare o IP directa) es
suficiente para un login mono-usuario.

Cambios al site file: editar, validar y recargar SIEMPRE desde `~/infra/caddy`:

```bash
cd ~/infra/caddy
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec caddy caddy reload   --config /etc/caddy/Caddyfile
```

## Flujo de deploy canónico

```bash
ssh developer@<vps>
cd ~/projects/ugc-factory
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

`up -d --build` reconstruye las imágenes que cambiaron y recicla solo esos
contenedores. Las migraciones corren solas en el arranque de web (ver abajo).

Ver estado y logs:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail 100 web worker
```

### Nota del bootstrap inicial (2026-07-14)

El primer deploy NO pudo hacerse con `git pull`: `origin/main` en GitHub iba por
detrás del árbol local (el bucle de agentes no puede pushear). El árbol se subió
por `rsync` desde la máquina de desarrollo (incluyendo `.git/`, excluyendo
`node_modules`, `.next`, `dist`, los `.env` gitignorados, artefactos de test y
`docs/verifications`). Eso deja el working tree del VPS con los cambios de
T0.13 SIN commitear sobre el HEAD rsyncado. **Primera reconciliación** (una vez
el commit de T0.13 esté pusheado a GitHub):

```bash
cd ~/projects/ugc-factory
git fetch origin
git reset --hard origin/main   # el contenido ya es el mismo; esto solo alinea el índice
```

Desde ahí, el flujo canónico (`git pull`) sin más ceremonias.

## Variables de entorno

Viven SOLO en `~/projects/ugc-factory/.env` del VPS (gitignored; jamás en el
repo — es público). Compose las interpola en `docker-compose.prod.yml`. Sin
valores aquí: los reales se leen en el propio VPS.

| Variable                                              | Quién la usa                        | Notas                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | postgres + DATABASE_URL interpolada | Obligatorias                                                                                                          |
| `APP_MASTER_KEY`                                      | web                                 | Obligatoria (fail-fast en el boot). Única credencial de cifrado (PRD §19.2); generada con `openssl rand -hex 32`      |
| `AUTH_BOOTSTRAP_PASSWORD`                             | web                                 | Password del login; se hashea y siembra en `app_setting` SOLO en el primer arranque (idempotente)                     |
| `LOG_LEVEL`                                           | web + worker                        | Default `info`                                                                                                        |
| `FAL_KEY` / `ANTHROPIC_API_KEY` / `FIRECRAWL_API_KEY` | web (seed first-boot)               | Opcionales: si están, se siembran CIFRADAS en `app_setting`; después la BD es la fuente y se editan desde `/settings` |
| `BUDGET_MONTHLY_LIMIT_CENTS`                          | web (seed first-boot)               | Opcional (T0.12)                                                                                                      |

Fijadas por el compose (no van al `.env`): `ASSETS_DIR=/data/assets`,
`TRUST_PROXY=1`, `DATABASE_URL` (host = servicio `postgres` del compose).
Fijada por la imagen de web: `UGC_DB_MIGRATIONS_DIR=/app/packages/db/drizzle`.

Las variables opcionales llegan al contenedor de web vía `env_file: .env`: una
variable que no esté en el `.env` queda **ausente** en el contenedor (no vacía).
Importa: los seeds first-boot distinguen ausente de vacío — un
`BUDGET_MONTHLY_LIMIT_CENTS` definido como cadena vacía sembraría un presupuesto
de 0 céntimos (`Number('') === 0`; pasó en el primer deploy y se corrigió).

## Migraciones (camino A: on-boot, con lock)

Se conserva la migración en el arranque de web con advisory lock (T0.3,
`instrumentation.ts` → `runMigrations` de `@ugc/db`): si dos procesos arrancan a
la vez, solo uno migra y el otro espera. El detalle que lo hace funcionar bajo
el bundle de Turbopack: `require.resolve('@ugc/db/package.json')` dentro del
bundle no devuelve una ruta real, así que la imagen de web **copia
`packages/db/drizzle` a `/app/packages/db/drizzle`** y fija
`UGC_DB_MIGRATIONS_DIR` (validado empíricamente en T0.14). No hay paso de
deploy separado: `up -d --build` migra solo. El worker no migra ni lo necesita
(pg-boss crea su propio schema y las tablas de la app las garantiza web, del
que depende su arranque en el compose).

## Backups

- **Qué**: `pg_dump -Fc` (formato custom, comprimido, legible con
  `pg_restore --list`) de la BD de producción, ejecutado DENTRO del contenedor
  postgres — el puerto no se publica.
- **Cuándo**: cron diario de `developer` a las 04:15 UTC
  (`crontab -l` para verlo):

  ```cron
  15 4 * * * /home/developer/projects/ugc-factory/scripts/vps-backup-db.sh >> /home/developer/backups/ugc-factory/backup.log 2>&1
  ```

- **Dónde**: `~/backups/ugc-factory/ugc-<UTC-timestamp>.dump`. Retención: 14 días
  (el propio script borra los más viejos).
- **Forzar a mano** (es lo que hace el verificador de T0.13):

  ```bash
  ~/projects/ugc-factory/scripts/vps-backup-db.sh
  pg_restore --list ~/backups/ugc-factory/ugc-<el-más-reciente>.dump | head
  ```

  (`pg_restore` del host si existe; si no:
  `docker compose -f ~/projects/ugc-factory/docker-compose.prod.yml exec -T postgres pg_restore --list < dump`.)

- **Restore** (probado en el cierre de T0.13):

  ```bash
  cd ~/projects/ugc-factory
  docker compose -f docker-compose.prod.yml exec -T postgres \
    sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
    < ~/backups/ugc-factory/ugc-<timestamp>.dump
  ```

  Para un ensayo sin tocar la BD real: restaurar sobre una BD scratch
  (`createdb` dentro del contenedor + `pg_restore -d scratch`).

- Los assets (`/data/assets`, volumen `ugc-assets`) NO entran en el pg_dump; su
  copia externa (restic/rsync) es una tarea futura del PRD §18.

## Troubleshooting

| Síntoma                                                                                                 | Causa                                                                                                                                                                                                                                                                                                                                                                                                                                               | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://ugc.carlosvillu.dev` entra en bucle de redirects 308                                           | La zona de Cloudflare está en SSL «Flexible»: CF habla HTTP con el origen y Caddy (o el propio CF) re-redirige a https en bucle                                                                                                                                                                                                                                                                                                                     | Poner la zona en **Full (strict)** en Cloudflare (es acción del humano; el origen ya sirve TLS válido). Mientras tanto, probar el origen directo: `curl --resolve ugc.carlosvillu.dev:443:<IP-VPS> https://ugc.carlosvillu.dev/api/health`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| El canvas no se actualiza en vivo (eventos SSE a ráfagas)                                               | Falta `flush_interval -1` en la ruta SSE del site file de Caddy                                                                                                                                                                                                                                                                                                                                                                                     | Restaurar el bloque `@sse` del site file y recargar Caddy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Web reinicia en bucle con `APP_MASTER_KEY no está definida`                                             | `.env` del VPS incompleto                                                                                                                                                                                                                                                                                                                                                                                                                           | Completar `.env` y `up -d`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Web arranca pero `/api/health` → `{"ok":true,"db":false}`                                               | Postgres caído o credenciales de `DATABASE_URL` no coinciden con el volumen existente                                                                                                                                                                                                                                                                                                                                                               | `docker compose ps` / logs de postgres; si se cambió el password en `.env` con volumen ya inicializado, el password REAL sigue siendo el del primer arranque                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Migración fallida en el boot                                                                            | SQL nuevo incompatible con datos                                                                                                                                                                                                                                                                                                                                                                                                                    | Logs de web (`phase: startup`); restaurar el último dump si hace falta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| El login devuelve 429 de inmediato                                                                      | Rate limit por IP compartida (todos los requests llegan con la IP del edge de Cloudflare)                                                                                                                                                                                                                                                                                                                                                           | Esperar la ventana (`LOGIN_WINDOW_MS`, default 15 min) o reiniciar web (contador en memoria)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Subir imágenes (assets/personas) da error en producción                                                 | Limitación conocida: web monta `/data/assets` en **ro** (literal a PRD §18/planning), pero los endpoints de upload de T1.5/T1.13 escriben desde web                                                                                                                                                                                                                                                                                                 | Decisión de producto pendiente (reportada en T0.13): o los uploads pasan por el worker, o el montaje de web pasa a rw                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `N4: no hay receta sembrada del tier "…"` (u otro nodo que lee `recipe`/`hook_line`/`cta_line`/galería) | La BD de prod tiene el schema pero **no los datos de referencia**. **Ya no debería ocurrir desde T3.9**: el arranque de web siembra librería/recetas/galería/personas de forma idempotente e insert-only (`instrumentation.ts`, tras `runMigrations`; datos bundleados en la imagen standalone — verificado en el artefacto). Si ves este error, es que corres una imagen ANTERIOR a T3.9, o el seed de boot falló (mira los logs `phase: startup`) | Redeploy a una imagen con T3.9 y arranca: siembra sola. **Fallback manual** (imagen pre-T3.9 o seed roto) — contenedor efímero que monta el árbol fuente rsync'd: `docker run --rm --network ugc-factory_default --user 1000:1000 -v ~/projects/ugc-factory:/src:ro -v ugc-assets:/data/assets -e HOME=/tmp -e DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB" -e ASSETS_DIR=/data/assets node:24 bash -c 'tar --exclude=.env --exclude=node_modules -C /src -cf - . \| (mkdir /tmp/b && tar -C /tmp/b -xf -); cd /tmp/b; printf "#!/bin/bash\nexec corepack pnpm@10.19.0 \"\$@\"" >/tmp/bin/pnpm; chmod +x /tmp/bin/pnpm; PATH=/tmp/bin:$PATH pnpm install --frozen-lockfile --ignore-scripts && pnpm seed && pnpm seed:gallery'`. Idempotente. Backup antes (`scripts/vps-backup-db.sh`) |

## Limitaciones conocidas / notas

- **ffmpeg/libass/c2patool NO están en la imagen del worker**: ningún executor
  de F0/F1 los usa. Se añadirán a la imagen en F5 (composición), que es cuando
  `test:media` pasará a correr dentro de la imagen.
- El contenedor de web corre `USER node`; el volumen de assets se inicializa
  con owner `node` desde las imágenes. Si el volumen `ugc-assets` ya existiera
  con owner root, el worker no podría escribir: `docker run --rm -v
ugc-assets:/a alpine chown 1000:1000 /a` lo corrige.
- El primer request tras recargar Caddy con un site file nuevo puede tardar
  (emisión de certificado); los siguientes no.
