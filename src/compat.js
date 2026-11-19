'use strict';
/**
 * Equipos ZKTeco compatibles (basado en "BioTime Cloud — Lista de Compatibilidad 2.0", V1.0 oct-2024, ZKTeco Colombia).
 * Requisitos generales: ADMS habilitado y firmware 2019 o posterior.
 * access=true → equipo de control de acceso: antes hay que poner Sistema → Tipo de dispositivo → T&A PUSH.
 * tested → probado con IIT Asistencia en un equipo real.
 */
const S = (model, family, access = false, series = false, note = '') => ({ model, family, access, series, tested: false, note });

const DEVICES = [
  S('MB10-VL', 'MB'), S('EMB10-VL', 'MB'), S('MB20-VL', 'MB'), S('MB160', 'MB'), S('MB360', 'MB'), S('MB460', 'MB'), S('MB560-VL', 'MB'),
  S('Horus E1', 'Horus'), S('Horus E1-FP', 'Horus'), S('Horus E1-RFID', 'Horus'), S('Horus TL1', 'Horus'), S('Horus TL1 Pro', 'Horus'), S('Horus TL2', 'Horus'),
  S('EFace10', 'Rostro'), S('SpeedFace-V3L', 'Rostro'), S('SpeedFace-V3L-RF', 'Rostro'), S('SpeedFace-V3L Lite', 'Rostro'),
  S('S922', 'Huella'), S('UA760', 'Huella'), S('UA860', 'Huella'), S('IN05', 'Huella'), S('IN05-A', 'Huella'),
  S('G3 Pro', 'G'), S('G4 L', 'G'), S('uFace', 'Rostro', false, true),
  S('M1', 'M'), S('M2 LR', 'M'), S('M2F PRO-UD', 'M'), S('M2F PRO-LR', 'M'), S('M4F PRO', 'M'), S('M4 PRO', 'M'), S('M5F PRO', 'M'), S('M6F PRO', 'M'),
  S('M2 Pro', 'M', false, false, 'No está en la lista oficial; equipo de referencia de IIT (funciona con BioTime 8 por ADMS)'),
  // Control de acceso: requieren modo T&A PUSH
  S('F22', 'Acceso', true), S('MultiBio 800-H', 'Acceso', true), S('ProMA', 'Acceso', true), S('ProMA-RF', 'Acceso', true),
  S('ProFace-X', 'Acceso', true, true), S('SpeedFace-H5L', 'Acceso', true), S('SpeedFace-V4L', 'Acceso', true, true),
  S('SpeedFace-V5L', 'Acceso', true), S('FaceDepot-7BL', 'Acceso', true), S('SenseFace', 'Acceso', true, true),
];

const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-[\]()]/g, '').replace(/series$/, '');

/** Busca el modelo informado por el equipo en la lista (coincidencia exacta o por serie) */
function matchModel(reported) {
  const r = norm(reported);
  if (!r) return null;
  let best = null;
  for (const d of DEVICES) {
    const n = norm(d.model);
    if (r === n || (d.series && r.startsWith(n)) || (r.startsWith(n) && /^(\[?p\]?|\/.*)?$/.test(r.slice(n.length)))) {
      if (!best || n.length > norm(best.model).length) best = d;
    }
  }
  return best;
}

const SETUP = {
  general: [
    'Menú → Comunicación → Servidor en la nube (o "Configuración ADMS")',
    'Activar ADMS / Servidor en la nube',
    'Dirección del servidor: IP de este PC (no "localhost")',
    'Puerto: el que muestra IIT Asistencia al arrancar',
    'HTTPS: desactivado, salvo que el firmware lo exija (ver HTTPS_PORT)',
  ],
  access: 'Antes: Sistema → Tipo de dispositivo → T&A PUSH (el equipo se reinicia).',
};

module.exports = { DEVICES, matchModel, SETUP };
