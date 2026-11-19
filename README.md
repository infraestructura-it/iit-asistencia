# IIT Asistencia

Servidor de control de asistencia para biométricos **ZKTeco**, pensado como reemplazo liviano y confiable de ZK BioTime.

- **Cero dependencias**: Node.js ≥ 22.13 con SQLite integrado (`node:sqlite`). Nada que compilar en Windows.
- **Protocolo push ADMS ("iclock")**: el biométrico envía las marcaciones él solo, en tiempo real; si se cae la red, las guarda y las reenvía después.
- **Sin duplicados**: índice único `(equipo, código, fecha/hora)`. El equipo puede reenviar el mismo lote mil veces.
- **Nunca pierde datos**: cada petición del equipo queda en `raw_log` (30 días) para auditoría.
- **Panel web estilo BioTime** (HTML/CSS/JS vanilla): módulos Personal, Dispositivo, Asistencia, Reportes y Sistema.
- **Horarios** diurnos y nocturnos, tolerancia, descanso y días laborables; **festivos de Colombia** automáticos (Ley Emiliani).
- **Novedades**: vacaciones, incapacidad, permiso, licencia, calamidad, comisión. **Marcación manual** con motivo obligatorio.
- **8 reportes** con columnas elegibles y ordenables: asistencia diaria, primera/última, resumen para nómina, tardanzas,
  horas extra, ausencias, novedades y transacciones. Exporta a **Excel (.xlsx), PDF, TXT y CSV**.

## Arranque rápido

```bash
cp .env.example .env     # ajustar puerto/token si hace falta
npm start                # o: npm run dev
npm test                 # 47 pruebas (protocolo, cálculos, festivos, Excel, API, migración)
node scripts/seed-demo.js ./data/demo.db   # datos de prueba (BD aparte)
```

Panel: `http://<ip-del-servidor>:8090/`

## Configurar el biométrico

En el equipo: **Menú → Comunicación → Servidor en la nube / ADMS** (el nombre varía según el firmware):

| Campo | Valor |
|---|---|
| Modo de servidor | ADMS |
| Dirección del servidor | IP del PC/servidor donde corre IIT Asistencia |
| Puerto | `8090` (o el `PORT` del `.env`) |
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
| `src/attendance.js` | Deduplicación, jornadas, tardanzas, extras, nocturnos, ausencias, resumen |
| `src/reports.js` | Catálogo de reportes, columnas y exportación |
| `src/holidays-co.js` | Festivos de Colombia calculados por año |
| `src/xlsx.js` | Escritor .xlsx sin dependencias |
| `src/api.js` | API REST del panel |
| `public/` | Panel web |

### API (resumen)

`/api/dashboard` · `/api/devices` (CRUD + `/commands`) · `/api/employees` (CRUD + `/push`, `/sync`) · `/api/departments` ·
`/api/areas` · `/api/schedules` · `/api/incidents` · `/api/holidays` · `/api/punches` (manual) ·
`/api/reports` y `/api/reports/:tipo?from&to&department&pin&cols&format=xlsx|txt|csv`

Con `API_TOKEN` en `.env`, la API exige `Authorization: Bearer <token>`. Los endpoints del biométrico (`/iclock`) no usan token.

## Reglas de cálculo

- Marcaciones del mismo empleado a menos de `DEDUP_MINUTES` (2 por defecto) cuentan como una.
- Las marcaciones del día se emparejan en orden (1ª-2ª, 3ª-4ª…): soporta almuerzo sin depender del botón de estado del equipo.
- Si solo hay 2 marcaciones y la jornada pasa de 5 h, se descuenta el descanso del horario.
- Tardanza: minutos después de la entrada **solo si superan la tolerancia**.
- Horas extra: trabajado − (salida − entrada − descanso). En **festivos** todo lo trabajado es extra.
- Turno nocturno (salida < entrada): las marcaciones hasta 4 h después de la salida cuentan para el día de entrada.
- Ausencia: día laborable sin marcación, sin novedad, no festivo, posterior al ingreso y no futuro.
- Número impar de marcaciones → jornada **incompleta** (resaltada en el panel).

## Hoja de ruta

- [x] Horarios, tardanzas, extras, nocturnos, festivos de Colombia, novedades, reportes Excel/PDF/TXT
- [ ] Importar personal e historial exportados de BioTime
- [ ] Turnos rotativos y por ciclos
- [ ] Flujo de aprobación de permisos
- [ ] App móvil con geocerca (marcación remota)
- [ ] Recargos según legislación colombiana (nocturno, dominical/festivo)
- [ ] Usuarios y roles en el panel
- [ ] Servicio de Windows / PM2 y respaldo automático de la BD
- [ ] Modo *pull* (TCP 4370) para equipos sin ADMS
