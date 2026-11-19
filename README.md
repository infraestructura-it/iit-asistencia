# IIT Asistencia

Servidor de control de asistencia para biométricos **ZKTeco**, pensado como reemplazo liviano y confiable de ZK BioTime.

- **Cero dependencias**: Node.js ≥ 22.13 con SQLite integrado (`node:sqlite`). Nada que compilar en Windows.
- **Protocolo push ADMS ("iclock")**: el biométrico envía las marcaciones él solo, en tiempo real; si se cae la red, las guarda y las reenvía después.
- **Sin duplicados**: índice único `(equipo, código, fecha/hora)`. El equipo puede reenviar el mismo lote mil veces.
- **Nunca pierde datos**: cada petición del equipo queda en `raw_log` (30 días) para auditoría.
- **Panel web** (HTML/CSS/JS vanilla): asistencia diaria, marcaciones, empleados, estado de equipos, exportar a CSV (Excel).

## Arranque rápido

```bash
cp .env.example .env     # ajustar puerto/token si hace falta
npm start                # o: npm run dev
npm test                 # 24 pruebas (parser, cálculo de asistencia, integración ADMS)
```

Panel: `http://<ip-del-servidor>:8081/`

## Configurar el biométrico

En el equipo: **Menú → Comunicación → Servidor en la nube / ADMS** (el nombre varía según el firmware):

| Campo | Valor |
|---|---|
| Modo de servidor | ADMS |
| Dirección del servidor | IP del PC/servidor donde corre IIT Asistencia |
| Puerto | `8081` (o el `PORT` del `.env`) |
| Proxy | Desactivado |
| HTTPS | Desactivado (usar en LAN o ZeroTier) |

A los pocos segundos el equipo aparece en la pestaña **Equipos**. Usa **Traer usuarios** para cargar los nombres y **Re-descargar marcaciones** para recuperar historial del rango elegido.

**Equipo de referencia:** ZKTeco **M2 Pro** (serie UFS2255100650), LAN 192.168.40.57, hoy conectado a BioTime 8.x. Los parámetros que IIT Asistencia le envía (intervalo de solicitud 10 s, transferencia 1 min, horas `00:00;14:05`) son los mismos que tiene configurados en BioTime.

> ⚠️ **Zona horaria:** en la notación IANA, `Etc/GMT-5` significa **UTC+5** (el signo va al revés). Colombia es `Etc/GMT+5` / `America/Bogota`. IIT Asistencia le envía al equipo `TimeZone=-5` y toma la hora tal como la marca el equipo, sin conversiones.

> Un equipo solo puede apuntar a un servidor push a la vez: al cambiarlo, BioTime deja de recibir. Probar primero con un solo equipo.

## Arquitectura

```
Biométrico ZK ──HTTP (ADMS)──▶ /iclock/*  ─┐
                                           ├─▶ SQLite (data/asistencia.db)
Panel web ──────HTTP/JSON────▶ /api/*     ─┘
```

| Archivo | Qué hace |
|---|---|
| `src/adms/parser.js` | Parser puro del protocolo: ATTLOG, OPERLOG/USERINFO, comandos, handshake |
| `src/adms/handler.js` | Endpoints `/iclock/cdata`, `/getrequest`, `/devicecmd` |
| `src/db.js` | Esquema y consultas SQLite |
| `src/attendance.js` | Deduplicación, reporte diario (entrada/salida/horas), CSV |
| `src/api.js` | API REST del panel |
| `public/` | Panel web |

### API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/devices` | Equipos con estado en línea |
| PATCH | `/api/devices/:sn` | `{ alias }` |
| POST | `/api/devices/:sn/commands` | `{ type: info \| check \| reboot \| queryUsers \| queryAttlog, from, to }` |
| GET | `/api/employees` | Empleados |
| PATCH | `/api/employees/:pin` | `{ name, department, active }` |
| POST | `/api/employees/:pin/push` | Envía el empleado a todos los equipos (o `{ sn }`) |
| GET | `/api/punches?from&to&pin[&format=csv]` | Marcaciones |
| GET | `/api/report/daily?from&to&pin[&format=csv]` | Asistencia diaria |

Con `API_TOKEN` en `.env`, la API exige `Authorization: Bearer <token>`. Los endpoints del biométrico (`/iclock`) no usan token.

## Reglas de cálculo

- Marcaciones del mismo empleado a menos de `DEDUP_MINUTES` (2 por defecto) cuentan como una.
- Las marcaciones del día se emparejan en orden (1ª-2ª, 3ª-4ª…): soporta almuerzo sin depender del botón de estado del equipo.
- Número impar de marcaciones → jornada **incompleta** (resaltada en el panel).

## Hoja de ruta

- [ ] Migración desde la base de datos de BioTime (empleados + historial)
- [ ] Modo *pull* (TCP 4370) para equipos sin ADMS
- [ ] Horarios/turnos, retardos, horas extra y festivos de Colombia
- [ ] Servicio de Windows / PM2 y respaldo automático de la BD
- [ ] Sincronización opcional a Supabase
