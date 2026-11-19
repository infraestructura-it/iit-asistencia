'use strict';
/**
 * Festivos de Colombia (Ley 51 de 1983 "Ley Emiliani").
 * - Fijos: no se trasladan.
 * - Emiliani: se trasladan al lunes siguiente si no caen en lunes.
 * - Basados en Pascua: Jueves y Viernes Santo fijos; Ascensión, Corpus y Sagrado Corazón al lunes.
 */

function easter(year) {
  // Algoritmo anónimo gregoriano (Meeus/Jones/Butcher)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const nextMonday = (t) => {
  const wd = new Date(t).getUTCDay(); // 0 dom, 1 lun
  return t + ((8 - wd) % 7) * DAY;
};

function colombianHolidays(year) {
  const fixed = [
    [1, 1, 'Año Nuevo'], [5, 1, 'Día del Trabajo'], [7, 20, 'Día de la Independencia'],
    [8, 7, 'Batalla de Boyacá'], [12, 8, 'Inmaculada Concepción'], [12, 25, 'Navidad'],
  ];
  const emiliani = [
    [1, 6, 'Reyes Magos'], [3, 19, 'San José'], [6, 29, 'San Pedro y San Pablo'],
    [8, 15, 'Asunción de la Virgen'], [10, 12, 'Día de la Raza'], [11, 1, 'Todos los Santos'],
    [11, 11, 'Independencia de Cartagena'],
  ];
  const e = easter(year);
  const list = [
    ...fixed.map(([m, d, n]) => ({ date: iso(Date.UTC(year, m - 1, d)), name: n })),
    ...emiliani.map(([m, d, n]) => ({ date: iso(nextMonday(Date.UTC(year, m - 1, d))), name: n })),
    { date: iso(e - 3 * DAY), name: 'Jueves Santo' },
    { date: iso(e - 2 * DAY), name: 'Viernes Santo' },
    { date: iso(nextMonday(e + 39 * DAY)), name: 'Ascensión del Señor' },
    { date: iso(nextMonday(e + 60 * DAY)), name: 'Corpus Christi' },
    { date: iso(nextMonday(e + 68 * DAY)), name: 'Sagrado Corazón' },
  ];
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = { colombianHolidays, easter };
