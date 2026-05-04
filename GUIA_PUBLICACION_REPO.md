# Guia detallada para publicar en el repo y desplegar en Ubuntu

## 1) Objetivo
Esta guia te deja un flujo claro para:
- Trabajar cambios en tu PC.
- Subir cambios a GitHub.
- Publicar esos cambios en tu servidor Ubuntu con un solo comando.

## 2) Datos del proyecto (actual)
- Carpeta local de trabajo:
  - D:\BACKUP_GANTE\PROYECTO_GANTE_WORK
- Rama principal:
  - main
- Remoto:
  - origin = https://github.com/zndr1991/GanteParts.git
- Servidor:
  - ganteparts@192.168.100.23
- Script de deploy en servidor:
  - /home/ganteparts/deploy.sh
- Base local de desarrollo configurada:
  - gante_dev (PostgreSQL local)

## 3) Reglas importantes antes de empezar
1. Nunca trabajes directo en main para cambios grandes.
2. No subas secretos al repo (.env, passwords, tokens).
3. Siempre prueba en local antes de hacer push.
4. Publica solo desde una rama limpia y con commit claro.
5. Si algo sale mal en servidor, usa rollback (seccion 10).

## 4) Preparacion diaria (en tu PC)
Abre PowerShell en:
- D:\BACKUP_GANTE\PROYECTO_GANTE_WORK

Ejecuta:

```powershell
git checkout main
git pull origin main
git status
```

Resultado esperado:
- Debes estar en main.
- Sin conflictos.
- Working tree limpio antes de crear rama nueva.

## 5) Crear rama para tu cambio
Usa un nombre claro:

```powershell
git checkout -b feat/nombre-cambio
```

Ejemplos:
- feat/inventario-filtro-stock
- fix/error-fotos-public-inventory
- chore/ajuste-logs

## 6) Hacer cambios y validar local
1. Edita tu codigo.
2. Corre validaciones minimas.

Comandos sugeridos:

```powershell
npm install
npm run build
```

Si usas pruebas:

```powershell
npm test
```

Nota:
- Si npm install ya se corrio antes y no cambiaste dependencias, puedes usar npm run build directo.

## 6.1) Iniciar app en desarrollo y probar un cambio real
Usa este flujo para validar funcionalidad antes de publicar:

1. Asegura variables de entorno locales (solo la primera vez):

```powershell
Copy-Item .env.example .env
```

2. Instala dependencias:

```powershell
npm install
```

3. Levanta servidor de desarrollo:

```powershell
npm run dev
```

4. Abre la app en:
- http://localhost:3000

5. Haz un cambio pequeno para verificar (ejemplo):
- Edita un texto visible en una pagina, guarda el archivo y confirma que el navegador se actualiza.

6. Si todo bien, deten desarrollo con:
- Ctrl + C

7. Valida produccion localmente antes de subir:

```powershell
npm run build
```

Con esto confirmas que el cambio no solo funciona en dev, sino que tambien compila para produccion.

## 7) Preparar commit correcto
Revisa que vas a subir:

```powershell
git status
git diff --name-only
```

Agrega archivos:

```powershell
git add .
```

Crea commit:

```powershell
git commit -m "feat: descripcion corta y clara"
```

Ejemplos de commit:
- feat: agrega paginacion en inventario publico
- fix: corrige carga de fotos por id en api
- chore: limpia logs de debug

## 8) Subir tu rama al remoto

```powershell
git push -u origin feat/nombre-cambio
```

Despues:
1. Crea Pull Request en GitHub hacia main.
2. Revisa cambios en PR.
3. Haz merge a main.

Si trabajas solo y quieres merge local rapido:

```powershell
git checkout main
git pull origin main
git merge --ff-only feat/nombre-cambio
git push origin main
```

## 9) Publicar en Ubuntu (deploy)
Con main ya actualizado en remoto, publica asi:

```powershell
ssh ganteparts@192.168.100.23 "/home/ganteparts/deploy.sh"
```

Que hace el script:
1. Entra al proyecto en servidor.
2. Verifica repo limpio (evita sobrescribir cambios manuales).
3. Hace fetch/pull de main.
4. Ejecuta npm ci.
5. Ejecuta prisma migrate deploy.
6. Ejecuta npm run build.
7. Reinicia servicio ganteparts.
8. Verifica estado del servicio.

## 10) Verificacion post-deploy
### 10.1 Verificar servicio

```powershell
ssh ganteparts@192.168.100.23 "systemctl is-active ganteparts"
```

Resultado esperado:
- active

### 10.2 Verificar app publica

```powershell
curl -I https://gantepartsgdl.com
curl -I https://www.gantepartsgdl.com
```

Resultado esperado:
- HTTP/2 200

### 10.3 Ver logs rapidos si algo falla

```powershell
ssh ganteparts@192.168.100.23 "journalctl -u ganteparts -n 120 --no-pager"
```

## 11) Rollback rapido
Si un deploy rompe algo:

1. Ver commits recientes en servidor:

```powershell
ssh ganteparts@192.168.100.23 "cd /home/ganteparts/PROYECTO_GANTE && git log --oneline -n 10"
```

2. Regresar a commit estable (reemplaza HASH_BUENO):

```powershell
ssh ganteparts@192.168.100.23 "cd /home/ganteparts/PROYECTO_GANTE && git checkout HASH_BUENO && npm ci && npm run build && sudo systemctl restart ganteparts"
```

3. Validar de nuevo HTTP 200.

## 12) Errores comunes y solucion
### Error: Credenciales invalidas en local (localhost)
Causas comunes:
1. DATABASE_URL en .env apunta a una base local con credenciales incorrectas.
2. La base local existe, pero no hay usuarios en la tabla User.

Como diagnosticar rapido:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/login
```

Si la pagina carga pero no permite login, revisa .env:

```powershell
Get-Content .env | Select-String '^DATABASE_URL='
```

Solucion:
1. Corrige DATABASE_URL con usuario/password reales de tu PostgreSQL local.
2. Reinicia el servidor dev (Ctrl + C y luego npm run dev).
3. Crea un usuario local desde /registro o por API.

### Error Prisma P2021 (tabla User no existe)
Causa:
- Tu usuario de PostgreSQL puede conectarse, pero no tiene permisos para crear tablas en la base actual.
- Prisma busca la tabla User y falla en /api/register y /login.

Como detectarlo:
1. El registro local responde 500 en /api/register.
2. En consola de Next aparece: table `(not available)` does not exist in the current database.

Solucion recomendada:
1. Crear una base nueva local para desarrollo (gante_dev) con owner ravuser.
2. Actualizar DATABASE_URL en .env apuntando a gante_dev.
3. Ejecutar prisma db push para crear el esquema de la app en esa base limpia.

SQL para ejecutar como usuario administrador de PostgreSQL (postgres):

```sql
CREATE DATABASE gante_dev OWNER ravuser;
GRANT ALL PRIVILEGES ON DATABASE gante_dev TO ravuser;
```

Luego en .env:

```env
DATABASE_URL="postgresql://ravuser:gante675@localhost:5432/gante_dev"
```

Y finalmente:

```powershell
npx prisma db push
npm run dev
```

Despues entra a:
- http://localhost:3000/registro

y crea tu primer usuario local.

### Error: deploy bloqueado por repo sucio en servidor
Mensaje tipico:
- ERROR: hay cambios locales sin commit en servidor

Solucion:
1. Respaldar estado actual del servidor.
2. Limpiar repo contra origin/main.
3. Reintentar deploy.

### Error: Permission denied al hacer push
Mensaje tipico:
- Permission to <owner>/<repo>.git denied to <usuario>

Solucion:
1. Verifica a que cuenta GitHub te autenticas (ssh -T git@github.com o alias configurado).
2. Confirma que esa cuenta tenga permiso Write en el repo.
3. Si no tiene permiso, agrega colaborador o cambia origin a un repo donde tengas escritura.
4. Reintenta push.

### Error Prisma P3005 (schema no vacio)
Causa:
- Base restaurada desde dump sin baseline de migraciones.

Solucion (una sola vez):
- Marcar migraciones existentes como applied con prisma migrate resolve --applied <migration>.

### Error por permisos sudo en deploy
Causa:
- Comando de systemctl no permitido en sudoers o pide tty.

Solucion:
- Ajustar regla sudoers para ganteparts y comandos exactos usados en deploy.sh.

## 13) Checklist corto de publicacion
Antes del push:
- [ ] Estoy en rama correcta.
- [ ] npm run build pasa local.
- [ ] No hay secretos en cambios.
- [ ] Commit message claro.

Antes del deploy:
- [ ] main ya tiene el merge.
- [ ] deploy.sh existe en servidor.
- [ ] ssh al servidor funciona por llave.

Despues del deploy:
- [ ] systemctl is-active ganteparts = active.
- [ ] Dominio responde 200.

## 14) Comando unico del dia a dia
Cuando ya hiciste merge a main:

```powershell
ssh ganteparts@192.168.100.23 "/home/ganteparts/deploy.sh"
```

Eso es todo para publicar de forma segura y repetible.
