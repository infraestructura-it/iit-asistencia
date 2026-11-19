'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/adms/parser');

test('parseAttlog: líneas válidas, CRLF y líneas basura', () => {
  const body = '1\t2026-11-19 07:58:12\t0\t1\t0\t0\r\n25\t2026-11-19 08:03:40\t0\t15\t\t0\n\nbasura\n7\tfecha-mala\t0\t1\n';
  const { punches, errors } = P.parseAttlog(body);
  assert.equal(punches.length, 2);
  assert.deepEqual(punches[0], {
    pin: '1', ts: '2026-11-19 07:58:12', status: 0, statusLabel: 'entrada', verify: 1, verifyLabel: 'huella', workcode: null,
  });
  assert.equal(punches[1].verifyLabel, 'rostro');
  assert.equal(errors.length, 2);
});

test('parseAttlog: cuerpo vacío no lanza', () => {
  assert.deepEqual(P.parseAttlog(''), { punches: [], errors: [] });
  assert.deepEqual(P.parseAttlog(undefined), { punches: [], errors: [] });
});

test('parseOperlog: usuarios, huellas y oplog', () => {
  const body = [
    'USER PIN=1\tName=Juan Pérez\tPri=14\tPasswd=\tCard=0\tGrp=1\tTZ=0000000000000000',
    'USER PIN=2\tName=Ana\tPri=0\tPasswd=\tCard=12345\tGrp=1',
    'FP PIN=1\tFID=6\tSize=1024\tValid=1\tTMP=abc',
    'OPLOG 4\t0\t2026-11-19 08:00:00\t0\t0\t0\t0',
  ].join('\n');
  const r = P.parseOperlog(body);
  assert.equal(r.users.length, 2);
  assert.deepEqual(r.users[0], { pin: '1', name: 'Juan Pérez', privilege: 14, card: null, groupId: '1' });
  assert.equal(r.users[1].card, '12345');
  assert.equal(r.templates.length, 1);
  assert.equal(r.oplogs.length, 1);
});

test('parseDeviceCmdResults', () => {
  const r = P.parseDeviceCmdResults('ID=3&Return=0&CMD=DATA\nID=4&Return=-1002&CMD=REBOOT\n');
  assert.deepEqual(r, [{ id: 3, ret: 0, cmd: 'DATA' }, { id: 4, ret: -1002, cmd: 'REBOOT' }]);
});

test('handshakeResponse incluye SN, stamps y zona horaria', () => {
  const s = P.handshakeResponse('ABC123', { attStamp: '9999', operStamp: 'None', tz: -5 });
  assert.match(s, /^GET OPTION FROM: ABC123\n/);
  assert.match(s, /ATTLOGStamp=9999/);
  assert.match(s, /TimeZone=-5/);
  assert.match(s, /Realtime=1/);
});

test('formatCommands', () => {
  assert.equal(P.formatCommands([]), 'OK');
  assert.equal(P.formatCommands([{ id: 1, command: 'INFO' }, { id: 2, command: 'CHECK' }]), 'C:1:INFO\nC:2:CHECK\n');
});

test('commands.upsertUser limpia tabs y saltos en el nombre', () => {
  const c = P.commands.upsertUser({ pin: '9', name: 'Ana\tMaría\n' });
  assert.ok(c.startsWith('DATA UPDATE USERINFO PIN=9\tName=Ana María \t'));
  assert.equal(c.split('\t').length, 7);
});
