# VPS de proyectos personales — guía para agentes

> **Léelo entero antes de tocar nada.** Es la fuente de verdad operativa del VPS.
> Si cambias algo estructural (un puerto, un sitio, una convención), **actualiza
> este fichero en el mismo cambio**.

Servidor personal de Carlos Villuendas (`carlosvillu@gmail.com`) para alojar **N
proyectos personales**, cada uno bajo su subdominio de `carlosvillu.dev`. Los
despliegues los ejecutan agentes por SSH; el humano solo interviene donde dice §7.

**Si vienes a montar un proyecto nuevo**: lee §2 (cómo llega el tráfico), luego
§5 (el checklist) y §6 (las plantillas, ya probadas en producción). §8 son las
trampas que ya nos mordieron — te ahorrarán horas literales.

## 1. Acceso e inventario

- **SSH**: `ssh developer@80.190.75.149` (solo clave; password y root deshabilitados).
- **`sudo` pide una contraseña que los agentes NO tienen** ⇒ trabaja siempre sin
  sudo. Todo lo necesario para desplegar y operar funciona sin él.
- **Docker 29 + compose v5**: `developer` está en el grupo `docker` ⇒
  contenedores, redes, volúmenes y puertos 80/443, sin sudo.
- **Node v24 vía nvm** (en sesiones no interactivas: `source ~/.nvm/nvm.sh`),
  **pm2 7** (instalado; ver §6.4 antes de usarlo), **git 2.43**.
- Seguridad ya montada: UFW (22/80/443), fail2ban, unattended-upgrades.
- Recursos: 4 vCPU · 7,8 GB RAM · 145 GB disco. Ubuntu 24.04 LTS.
- Utilidades: `~/monitor.sh` (estado), `~/verify-setup.sh` (checklist del setup).

## 2. Cómo llega el tráfico

```
Internet → Cloudflare (DNS + proxy naranja, SSL Full strict)
         → Caddy central (contenedor edge-caddy, ~/infra/caddy, network host, TLS automático)
         → 127.0.0.1:<puerto del proyecto>
```

- **Caddy central** es el ÚNICO proceso escuchando en 80/443, y sirve a **todos**
  los proyectos. Vive en `~/infra/caddy/` (compose + `Caddyfile` que importa
  `sites/*.caddy`). **Los proyectos NO llevan su propio reverse proxy ni TLS.**
- **Un fichero por sitio**: `~/infra/caddy/sites/<dominio>.caddy`. El certificado
  es automático (HTTP-01 atraviesa el proxy de Cloudflare). No toques nada de certs.
- **La convención que lo sostiene todo**: cada proyecto publica su HTTP **solo en
  `127.0.0.1:<puerto>`**. Nunca en `0.0.0.0`: un puerto publicado por Docker en
  abierto **SE SALTA UFW** (Docker escribe sus propias reglas de iptables por
  debajo del firewall) y además saca la app de detrás de Caddy.
- Cloudflare proxied ⇒ el origen ve IPs de Cloudflare; la IP real del cliente
  llega en `CF-Connecting-IP`. Relevante para rate-limits y logs.

## 3. Registro de proyectos y puertos

Cada proyecto reserva un **bloque de 10 puertos** desde el 3100.

| Proyecto | Dominio | Bloque | Puerto web | Runtime | Ruta |
|---|---|---|---|---|---|
| ugc-factory | ugc.carlosvillu.dev | 3100–3109 | 3100 | docker compose (web + worker + postgres 16) | `~/projects/ugc-factory` |
| _(siguiente)_ | — | 3110–3119 | — | — | — |

**ugc-factory** (desde 2026-07-14): el repo trae una skill de deploy
(`.claude/skills/deploy/`) con scripts para redeploy, rollback, verificación y
backup — **úsala en vez de improvisar comandos**. Backups: cron diario 04:15 UTC
→ `~/backups/ugc-factory/`, retención 14 días. Su site file de Caddy lleva dos
cosas que **no** hay que simplificar al proxy mínimo de §6.3: `flush_interval -1`
en la ruta SSE, y la sobrescritura de `X-Forwarded-For` (sostiene el rate-limit
del login). Ojo: su bucle de desarrollo **no hace `git push`** ⇒ se despliega por
rsync, no por `git pull` (§8, trampa 3).

## 4. Operaciones frecuentes

```bash
~/monitor.sh                      # estado del sistema
docker ps                         # qué corre

# logs de un proyecto / del edge
docker compose -f ~/projects/<n>/docker-compose.prod.yml logs -f --tail 100 <svc>
cd ~/infra/caddy && docker compose logs -f --tail 100 caddy

# recargar Caddy tras tocar un site file (valida ANTES; no corta tráfico)
cd ~/infra/caddy
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose exec caddy caddy reload   --config /etc/caddy/Caddyfile
```

## 5. Añadir un proyecto nuevo — checklist

0. **Lee el repo del proyecto ANTES de escribir nada** y contesta a tres
   preguntas; las tres cambian lo que vas a escribir:
   - **¿Cómo se crea el schema de la BD?** Postgres arranca **vacío**. Si nadie
     crea las tablas, la app arranca y explota. Lo normal es que la app **migre al
     arrancar** (y entonces el `start_period` del healthcheck debe darle margen);
     si no lo hace, necesitas un paso de migración en el deploy. **Decide esto
     explícitamente**: es el agujero que se come a todo proyecto con estado.
   - **¿Expone `/api/health`?** El healthcheck de la plantilla lo asume (§6.1).
   - **¿Es Next?** Entonces necesita `output: 'standalone'` y la plantilla §6.2(a).
1. **Reserva el bloque de puertos**: rellena la fila `_(siguiente)_` de §3 con tu
   proyecto **y añade debajo una nueva fila `_(siguiente)_`** con el bloque
   posterior. El que venga detrás de ti merece el mismo regalo que tú acabas de
   recibir.
2. **Trae el código** a `~/projects/<nombre>`: `git clone` si el repo está
   **pusheado**; `rsync` desde la máquina local si no lo está (excluyendo `.env`,
   `.git`, `node_modules`, `dist`, `.next`). Pregunta al humano si no lo sabes: un
   `git pull` sobre un repo sin pushear despliega código viejo **en silencio**
   (§8, trampa 3).
3. **Escribe el compose y los Dockerfiles** con las plantillas de §6.
4. **Secretos**: un `.env` junto al compose, **en el VPS** (gitignored). Nunca en
   el repo. Y **jamás los sincronices desde local** — un rsync descuidado machaca
   las credenciales de producción con las de desarrollo.
5. **DNS (humano)**: A record `<sub>.carlosvillu.dev → 80.190.75.149`, proxied.
   La zona ya está en **SSL Full (strict)**; no la toques (§8, trampa 2).
6. **Site en Caddy** (§6.3) + validar + recargar.
7. **Levanta**: `docker compose -f docker-compose.prod.yml up -d --build`.
8. **Antes de tocar Caddy, comprueba el origen DESDE el VPS**:
   `curl -sS -o /dev/null -w '%{http_code}\n' localhost:<puerto>`. Separa «la app
   arranca» de «el proxy funciona»; si mezclas las dos, depuras a ciegas. Un
   contenedor `healthy` que no responde aquí = trampa 5.
9. **Verifica desde fuera** (§6.5). No des por bueno un deploy porque los
   contenedores estén verdes.
10. **Backups** si hay estado (§6.6). Elige una hora que **no se solape** con los
    crones ya existentes (ugc-factory usa las 04:15 UTC).
11. **Actualiza este fichero** (§3, §9 y lo que aplique). Si al desplegar
    aprendiste algo que no estaba aquí, **súbelo a §6 o §8 en el mismo cambio**:
    el conocimiento que se queda en el repo del proyecto no le sirve al siguiente.

## 6. Plantillas (probadas en producción)

### 6.1 `docker-compose.prod.yml`

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped              # se levanta solo si muere y al reiniciar el VPS
    environment:
      POSTGRES_USER: ${POSTGRES_USER:?falta en .env}   # `:?` = falla RUIDOSO si no está
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?falta en .env}
      POSTGRES_DB: ${POSTGRES_DB:?falta en .env}
      TZ: UTC                            # todo el sistema compara instantes
    volumes:
      - <proyecto>-pg-data:/var/lib/postgresql/data
    healthcheck:                         # el orden de arranque depende de esto
      test: ['CMD-SHELL', 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    logging: &logs                       # sin esto, los logs llenan el disco
      driver: json-file
      options: { max-size: '10m', max-file: '3' }
    # NO publica puerto: solo la red interna del compose lo alcanza.

  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    restart: unless-stopped
    ports:
      - '127.0.0.1:<puerto>:3000'        # SOLO loopback (§2)
    env_file: [.env]                     # las OPCIONALES van aquí (§8, trampa 1)
    environment:                         # las OBLIGATORIAS, explícitas
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    depends_on:
      postgres: { condition: service_healthy }
    healthcheck:
      # ⚠ CONTRATO: esto asume que tu app expone /api/health. Si no la tiene, el
      # contenedor NUNCA llega a `healthy`, el `depends_on` de abajo se queda
      # esperando para siempre y el deploy muere colgado. O añades la ruta, o
      # cambias el check (p.ej. una petición a `/`).
      # La imagen slim no trae curl/wget: usa el fetch de Node.
      test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      # `start_period` da margen al ARRANQUE, no crea tablas. Solo basta si tu app
      # se automigra al arrancar; si no, mira el servicio `migrate` de abajo.
      start_period: 30s
    logging: *logs

  # ⚠ ¿TU APP NO SE AUTOMIGRA? Entonces este servicio NO es opcional (§6.1b).
  # Postgres arranca VACÍO. Sin esto, la app sirve páginas, sale `healthy`, y
  # revienta con `relation "…" does not exist` al primer guardado. Verde y roto.
  migrate:
    build: { context: ., dockerfile: Dockerfile }
    command: ['npx', 'prisma', 'migrate', 'deploy']   # o drizzle-kit migrate, etc.
    env_file: [.env]
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
    depends_on:
      postgres: { condition: service_healthy }
    restart: 'no'                        # one-shot: corre, migra y termina

volumes:
  # ⚠ El nombre aparece DOS veces (aquí y en el `volumes:` de postgres). Cambia los
  # dos o Compose crea un volumen anónimo aparte y la BD "aparece vacía" tras un `down`.
  <proyecto>-pg-data: { name: <proyecto>-pg-data }
```

Y en `web`, para que no arranque antes de que existan las tablas:

```yaml
    depends_on:
      postgres: { condition: service_healthy }
      migrate:  { condition: service_completed_successfully }
```

*(¿Tienes procesos de fondo —un worker, un consumidor de cola—? Añádelo como un
servicio más, con `depends_on` sobre `migrate`. La mayoría de proyectos no lo
necesitan; ugc-factory sí, mira su compose.)*

### 6.1b El schema: la pregunta que se come a todo proyecto con estado

**Postgres arranca vacío.** Alguien tiene que crear las tablas, y hay dos caminos.
**Elige uno explícitamente** — el fallo de no elegir es silencioso:

| Camino | Cuándo | Qué implica |
|---|---|---|
| **La app migra al arrancar** | Tu código llama al migrador en el boot (con un lock, si hay varias réplicas) | No necesitas el servicio `migrate`. Dale margen en `start_period`. Es lo que hace ugc-factory |
| **Servicio `migrate` one-shot** | Todo lo demás (Prisma, Drizzle, Knex… ejecutados a mano) | El de §6.1. `web` espera con `service_completed_successfully` |

**Cómo saber en cuál estás**: busca en el repo si algo ejecuta migraciones al
arrancar (`instrumentation.ts` en Next, un `migrate()` en el bootstrap). Si no
encuentras nada, **estás en el segundo caso** y el servicio `migrate` es obligatorio.

**Los servicios se hablan por nombre** (`postgres:5432`) dentro de la red privada
que Docker crea sola. Solo `web` publica puerto, y solo en loopback.

### 6.2 `Dockerfile` — construcción por etapas

La idea: compilar en una imagen con todas las herramientas y copiar **solo el
resultado** a una imagen limpia. El contenedor final no lleva compilador, ni
dependencias de desarrollo, ni código fuente.

**Elige plantilla según lo que despliegas.** No son intercambiables: una app Next
NO produce un `dist/main.js`, y usar la plantilla equivocada da un contenedor que
sale **healthy con el sitio caído** (§8, trampa 5).

#### (a) App Next.js — la más común

Requiere `output: 'standalone'` en `next.config` (si no está, añádelo al repo).

**Ajusta la instalación a TU gestor de paquetes** (mira qué lockfile hay en el repo):

| Lockfile | Instalación |
|---|---|
| `package-lock.json` | `RUN npm ci --ignore-scripts` |
| `pnpm-lock.yaml` | `RUN npm install -g pnpm@<versión del packageManager> && pnpm install --frozen-lockfile --ignore-scripts` |
| `yarn.lock` | `RUN corepack enable && yarn install --immutable` |

(pnpm se instala vía `npm install -g`, **no con corepack**: corepack está deprecado
y desaparece de las imágenes oficiales de node. Y **no hay pnpm/yarn en el host** —
solo npm; da igual, porque construyes dentro de la imagen.)

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts          # ← ajusta según la tabla de arriba
COPY . .
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
# HOSTNAME=0.0.0.0 NO ES OPCIONAL: el server.js de Next escucha en localhost por
# defecto, o sea SOLO dentro del contenedor. Sin esta línea el healthcheck (que
# corre dentro) PASA, el contenedor sale `healthy`… y desde fuera no responde
# nadie. Contenedores verdes, sitio caído (§8, trampa 5).
# Esto NO contradice el "nunca 0.0.0.0" de §2: son dos capas distintas. Aquí
# hablamos de la interfaz DENTRO del contenedor; lo que jamás se publica en
# abierto es el puerto en el HOST (`ports: 127.0.0.1:<puerto>:3000`).
COPY --from=build /app/.next/standalone ./
# Los estáticos NO van dentro de standalone: se copian aparte o la web sale sin
# CSS ni JS. Gotcha clásico de Next.
COPY --from=build /app/.next/static ./.next/static
# Solo si el repo TIENE carpeta public/ — si no existe, este COPY revienta el build.
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

#### (b) Servicio Node genérico (worker, API, daemon)

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts && npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
CMD ["node", "dist/main.js"]
```

#### Reglas que valen para las dos

- **`USER node`**: si alguien ejecuta código dentro del contenedor, no es root.
- **`CMD ["node", …]` en exec-form**, nunca `CMD node …`: así el proceso es PID 1
  y **recibe la señal de apagado**. Con la forma shell se la come `sh` y el
  proceso muere de golpe a media faena en vez de cerrar limpiamente.
- **`--ignore-scripts`** en la instalación: los hooks de git (lefthook, husky)
  exigen un `.git` que la imagen no tiene y revientan el build.
- Un **`.dockerignore`** (`node_modules`, `.next`, `dist`, `.env*`, `.git`) evita
  que el contexto de build pese cientos de MB.
- **Monorepos** (pnpm workspaces): el layout cambia bastante (instalación filtrada
  con `--filter`, rutas `apps/<app>/…`). Mira `apps/web/Dockerfile` de
  ugc-factory como referencia — pero **no lo copies para una app simple**, tiene
  cosas propias de ese monorepo que te estrellarán.

### 6.3 Site file de Caddy — `~/infra/caddy/sites/<dominio>.caddy`

```
<dominio> {
    encode gzip
    reverse_proxy 127.0.0.1:<puerto>
}
```

Si la app usa **SSE / streaming**, esa ruta necesita trato aparte — sin
`flush_interval -1` Caddy bufferiza y los eventos llegan a ráfagas; y **no la
comprimas** (comprimir un `event-stream` también bufferiza):

```
<dominio> {
    @sse path /api/<ruta-de-eventos>
    handle @sse {
        reverse_proxy 127.0.0.1:<puerto> {
            flush_interval -1
            header_up X-Forwarded-For {client_ip}
        }
    }
    handle {
        encode gzip
        reverse_proxy 127.0.0.1:<puerto> {
            header_up X-Forwarded-For {client_ip}
        }
    }
}
```

**`header_up X-Forwarded-For {client_ip}` no es «cosa del SSE»: es un control de
seguridad aparte.** Sobrescribe la cabecera con la IP real del socket. **Si tu app
limita intentos de login (o cualquier cosa) por IP, la necesitas en TODAS las
rutas**, tengas SSE o no: sin ella la cabecera la controla el cliente, que la rota
en cada intento para saltarse el límite y probar contraseñas sin fin.

### 6.4 Docker o pm2 — cuándo cada uno

**Docker por defecto.** `restart: unless-stopped` ya hace lo que hace pm2
(reiniciar si cae, arrancar al reiniciar el VPS), y además aísla dependencias del
sistema. **No metas pm2 dentro de un contenedor**: son dos supervisores
discutiendo, y rompe el PID 1.

**pm2 solo** para un script Node suelto, sin base de datos ni dependencias de
sistema, donde montar una imagen es sobreingeniería: `pm2 start … --name <n> && pm2 save`.
Aun así publica **solo en loopback** (§2).

### 6.5 Verificar un deploy

Un deploy no está hecho porque los contenedores estén verdes, sino porque **la app
responde desde internet**. Comprueba las capas **por separado** — es lo que
convierte un síntoma en un diagnóstico:

```bash
curl -sS -o /dev/null -w '%{http_code} -> %{redirect_url}\n' https://<dominio>/     # dominio público
curl -sS --resolve <dominio>:443:80.190.75.149 -o /dev/null \
     -w 'origen: %{http_code} TLS=%{ssl_verify_result}\n' https://<dominio>/        # origen, saltándose Cloudflare
docker ps --format '{{.Names}} {{.Status}}'                                         # contenedores
```

**Si el origen responde bien y el dominio público no, el problema es de Cloudflare
y NO del servidor.** No toques el VPS (§8, trampa 2).

**Un 200 NO significa que funcione.** Con la base de datos vacía tu app sirve
páginas, sale `healthy` y pasa los tres checks de arriba — y muere al primer
guardado (§8, trampa 7). El único check que distingue «arrancó» de «funciona» es
**escribir y leer de verdad**:

```bash
# crea un recurso por la UI o la API, recárgalo, y comprueba que sigue ahí.
# Y que SOBREVIVE a un reinicio (prueba que el volumen persiste):
docker compose -f docker-compose.prod.yml restart && curl …   # ¿sigue tu dato ahí?
```

Hazlo siempre en un proyecto nuevo. Es el paso que separa un deploy verificado de
un deploy que **parece** verificado.

### 6.6 Backups

Cron de `developer` (`crontab -e`), volcado **desde dentro del contenedor** (así
Postgres no necesita publicar puerto ni el host tener `pg_dump`):

```bash
docker compose -f <compose> exec -T postgres \
  sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$TMP" && mv "$TMP" "$OUT"
```

Vuelca a temporal y **renombra al final**: un dump interrumpido no debe quedarse
como fichero válido. Retención con `find … -mtime +14 -delete`.

Y **prueba que se puede restaurar** (`pg_restore --list <dump>`): un backup que
nadie ha abierto no es un backup, es un fichero.

## 7. Qué requiere al humano

- Cualquier cosa con **sudo** (paquetes apt, UFW, `/etc/…`): deja el comando
  exacto preparado y pídeselo. No intentes rodearlo.
- **Cloudflare**: DNS nuevos y ajustes de zona.
- **Certificados no**: los gestiona Caddy solo.

## 8. Trampas que ya nos mordieron

**1. `VAR: ${VAR:-}` en compose no significa "sin valor": significa cadena vacía.**
La variable se define igualmente aunque no esté en el `.env`. Si tu código
distingue *ausente* de *vacío*, se rompe en silencio: `Number('') === 0` sembró un
presupuesto de **0 céntimos** en el primer deploy de ugc-factory. Las opcionales
van por `env_file` (solo llegan si existen); las obligatorias, con `${VAR:?...}`,
que **falla ruidosamente**.

**2. Un bucle de redirecciones (`too many redirections`) NO es culpa del servidor.**
Costó una hora el 2026-07-14: la zona estaba en SSL **«Flexible»**, así que
Cloudflare hablaba HTTP contra un origen que redirige a HTTPS, y el bucle lo creaba
el borde. El origen estaba perfecto. Diagnóstico: prueba el origen por separado
(§6.5). Arreglo (humano): **SSL/TLS → Overview → Full (strict)**.

**3. `git pull` en el VPS despliega código VIEJO si el repo no está pusheado.**
Y lo hace en silencio: verás un deploy "correcto" que no contiene tus cambios.
Comprueba qué commit corre de verdad, o despliega por `rsync` (excluyendo `.env`,
`.git`, `node_modules`, `dist`). Le pasa a ugc-factory, cuyo bucle no pushea.

**4. Publicar un puerto en `0.0.0.0` salta UFW.** Docker escribe iptables por
debajo del firewall. Siempre `127.0.0.1:<puerto>:<puerto-interno>`.

**5. Next standalone escucha en `localhost`: sin `HOSTNAME=0.0.0.0` el contenedor
sale VERDE y el sitio está CAÍDO.** El `server.js` de Next bindea a `localhost`
por defecto ⇒ solo escucha dentro del contenedor. El healthcheck corre **dentro**,
así que **pasa**, y `docker ps` dice `healthy`… pero el puerto publicado apunta a
la interfaz externa del contenedor, donde no hay nadie. Contenedores verdes, sitio
muerto — el fallo más traicionero de todos, porque desactiva tu escepticismo. La
plantilla de §6.2(a) ya lo trae. **Que sea `0.0.0.0` DENTRO del contenedor no
contradice la trampa 4**: lo que nunca se abre es el puerto en el HOST.

**7. Postgres arranca VACÍO: si nadie crea las tablas, el deploy sale VERDE y la app
muere al primer guardado.** Los contenedores están `healthy`, `/` devuelve 200, los
tres checks de §6.5 pasan… y al guardar el primer dato: `relation "…" does not exist`.
Es la misma patología que la trampa 5 —verde y roto— por otra causa. **Decide cómo
se crea el schema ANTES de desplegar** (§6.1b) y **verifica escribiendo un dato de
verdad** (§6.5), no mirando códigos HTTP.

**6. Verifica el origen ANTES de tocar Caddy.** Cuando montes un proyecto nuevo,
prueba primero `curl localhost:<puerto>` **desde el VPS**: separa "la app arranca"
de "el proxy funciona". Si mezclas las dos, depurarás a ciegas.

## 9. Historial de decisiones

- **2026-07-14 · Plataforma creada**: Caddy central, convención `127.0.0.1:puerto`,
  bloques de 10 puertos, este fichero.
- **2026-07-14 · ugc-factory desplegado**: compose de 3 servicios (web + worker +
  postgres), backup diario, site file con SSE + trust boundary. Cerró dos deudas
  del proyecto: producción nunca había arrancado (`require.resolve` roto bajo el
  bundler) y el rate-limit del login era falsificable rotando `X-Forwarded-For`.
  La zona de Cloudflare pasó de Flexible a **Full (strict)** (lo hizo el humano).
- **2026-07-14 · Esta guía ampliada** con las plantillas de §6 y las trampas de §8:
  la v1 explicaba dónde poner las cosas pero no cómo construirlas, así que el
  siguiente proyecto habría reinventado el Docker desde cero.
