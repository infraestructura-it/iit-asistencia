'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { buildXlsx, crc32 } = require('../src/xlsx');

/** Lee un ZIP sencillo (sin data descriptors) → { nombre: contenido } */
function unzip(buf) {
  const files = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const comp = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString();
    const start = i + 30 + nameLen + extra;
    const data = zlib.inflateRawSync(buf.slice(start, start + comp));
    assert.equal(crc32(data), buf.readUInt32LE(i + 14), `CRC de ${name}`);
    files[name] = data.toString('utf8');
    i = start + comp;
  }
  return files;
}

test('crc32 conocido', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('xlsx: estructura válida, encabezados, tildes y escape XML', () => {
  const buf = buildXlsx({
    title: 'Resumen', sheetName: 'Resumen/Nov',
    columns: [{ key: 'pin', label: 'Código' }, { key: 'name', label: 'Nombre' }, { key: 'n', label: 'Días' }],
    rows: [{ pin: '1', name: 'José <Peña> & Cía', n: 20 }, { pin: '2', name: 'Ana', n: 0 }],
  });
  assert.equal(buf.slice(0, 2).toString(), 'PK');
  const f = unzip(buf);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(f[n], n);
  const sheet = f['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /Código/);
  assert.match(sheet, /José &lt;Peña&gt; &amp; Cía/);
  assert.match(sheet, /<c r="C4"><v>20<\/v><\/c>/); // número como número
  assert.match(sheet, /<c r="C5"><v>0<\/v><\/c>/);
  assert.doesNotMatch(f['xl/workbook.xml'], /Resumen\/Nov/); // caracteres inválidos en nombre de hoja
});
