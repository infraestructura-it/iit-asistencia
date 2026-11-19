# Equipos compatibles

IIT Asistencia implementa el protocolo **T&A PUSH (ADMS / iclock)** de ZKTeco, el mismo que usa BioTime Cloud.
La lista se basa en *BioTime Cloud — Lista de Compatibilidad 2.0* (ZKTeco Colombia, V1.0, oct-2024).

## Requisitos (todos los equipos)

1. Función **ADMS / Servidor en la nube** habilitada.
2. Firmware **2019 o posterior**.
3. Equipos de **control de acceso**: primero *Sistema → Tipo de dispositivo → T&A PUSH* (el equipo se reinicia).
4. HTTPS: opcional. Si el firmware lo exige, genera un certificado con `scripts/gen-cert.sh` y configura `HTTPS_PORT`, `TLS_CERT`, `TLS_KEY` en `.env`.

## Qué soporta el servidor

| Función del protocolo | Soporte |
|---|---|
| Handshake `/iclock/cdata?options=all` (pushver 2.x y 3.x) | ✅ con parámetros por equipo |
| Marcaciones `ATTLOG` (huella, rostro, palma, tarjeta, contraseña) | ✅ sin duplicados |
| Usuarios `OPERLOG` / `USERINFO` (claves PIN/Pin/pin, Card/CardNo) | ✅ |
| Plantillas `FP`, `FACE`, `BIODATA` (rostro luz visible, palma) | ✅ se aceptan y cuentan |
| Fotos `ATTPHOTO`, `BIOPHOTO`, `USERPIC` | ✅ se aceptan (no se almacenan) |
| Info del equipo (`table=options`, `INFO=`): modelo, firmware, usuarios, huellas, rostros | ✅ |
| Comandos `/iclock/getrequest` + respuestas `/iclock/devicecmd` | ✅ |
| Respuestas de consulta `/iclock/querydata` (firmwares push ≥ 2.4) | ✅ |
| Rutas `.aspx`, nombres en Latin-1 (firmwares antiguos), relleno con bytes nulos | ✅ |
| HTTPS | ✅ opcional |
| Protocolo de control de acceso (`/iclock/registry`, `rtdata`) | ❌ — usar modo T&A PUSH |
| Modo pull TCP 4370 (equipos sin ADMS) | ❌ pendiente |

## Lista

| Modelo | Familia | Configuración | Nota |
|---|---|---|---|
| MB10-VL | MB | Directo (ADMS) |  |
| EMB10-VL | MB | Directo (ADMS) |  |
| MB20-VL | MB | Directo (ADMS) |  |
| MB160 | MB | Directo (ADMS) |  |
| MB360 | MB | Directo (ADMS) |  |
| MB460 | MB | Directo (ADMS) |  |
| MB560-VL | MB | Directo (ADMS) |  |
| Horus E1 | Horus | Directo (ADMS) |  |
| Horus E1-FP | Horus | Directo (ADMS) |  |
| Horus E1-RFID | Horus | Directo (ADMS) |  |
| Horus TL1 | Horus | Directo (ADMS) |  |
| Horus TL1 Pro | Horus | Directo (ADMS) |  |
| Horus TL2 | Horus | Directo (ADMS) |  |
| EFace10 | Rostro | Directo (ADMS) |  |
| SpeedFace-V3L | Rostro | Directo (ADMS) |  |
| SpeedFace-V3L-RF | Rostro | Directo (ADMS) |  |
| SpeedFace-V3L Lite | Rostro | Directo (ADMS) |  |
| S922 | Huella | Directo (ADMS) |  |
| UA760 | Huella | Directo (ADMS) |  |
| UA860 | Huella | Directo (ADMS) |  |
| IN05 | Huella | Directo (ADMS) |  |
| IN05-A | Huella | Directo (ADMS) |  |
| G3 Pro | G | Directo (ADMS) |  |
| G4 L | G | Directo (ADMS) |  |
| uFace (serie) | Rostro | Directo (ADMS) |  |
| M1 | M | Directo (ADMS) |  |
| M2 LR | M | Directo (ADMS) |  |
| M2F PRO-UD | M | Directo (ADMS) |  |
| M2F PRO-LR | M | Directo (ADMS) |  |
| M4F PRO | M | Directo (ADMS) |  |
| M4 PRO | M | Directo (ADMS) |  |
| M5F PRO | M | Directo (ADMS) |  |
| M6F PRO | M | Directo (ADMS) |  |
| M2 Pro | M | Directo (ADMS) | No está en la lista oficial; equipo de referencia de IIT (funciona con BioTime 8 por ADMS) |
| F22 | Acceso | **Cambiar a T&A PUSH** |  |
| MultiBio 800-H | Acceso | **Cambiar a T&A PUSH** |  |
| ProMA | Acceso | **Cambiar a T&A PUSH** |  |
| ProMA-RF | Acceso | **Cambiar a T&A PUSH** |  |
| ProFace-X (serie) | Acceso | **Cambiar a T&A PUSH** |  |
| SpeedFace-H5L | Acceso | **Cambiar a T&A PUSH** |  |
| SpeedFace-V4L (serie) | Acceso | **Cambiar a T&A PUSH** |  |
| SpeedFace-V5L | Acceso | **Cambiar a T&A PUSH** |  |
| FaceDepot-7BL | Acceso | **Cambiar a T&A PUSH** |  |
| SenseFace (serie) | Acceso | **Cambiar a T&A PUSH** |  |

Un equipo que no esté en la lista puede funcionar si tiene ADMS / Servidor en la nube.
El panel (Dispositivo → Equipos compatibles) muestra cuáles están conectados.

## Probados en equipo real

| Modelo | Firmware | Resultado |
|---|---|---|
| — | — | Pendiente: primera prueba con el M2 Pro (UFS2255100650) |

Las demás familias están cubiertas por pruebas automáticas que simulan su tráfico (`tests/compat.test.js`).
