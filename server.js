const http = require('node:http');
const { randomBytes, randomInt } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { parse } = require('csv-parse/sync');
const QRCode = require('qrcode');
const { guestCards } = require('./guest-cards');
const cardCss = readFileSync(join(__dirname, 'guest-cards.css'), 'utf8');
const { headers, template, rowsFromExcel } = require('./guest-excel');
const { authenticated, credentialsMatch, signIn, signOut } = require('./auth');

const sampleGuests = JSON.parse(readFileSync(join(__dirname, 'guests.json'), 'utf8').replace(/^\uFEFF/, ''));
const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
if (process.env.RAILWAY_ENVIRONMENT_ID && !volume) {
  throw new Error('Attach a persistent Railway volume before starting.');
}
const db = new DatabaseSync(process.env.CHECKIN_DB ?? join(volume ?? __dirname, 'checkins.sqlite'));
db.exec(`
  CREATE TABLE IF NOT EXISTS guests (code TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS checkins (code TEXT PRIMARY KEY, time TEXT NOT NULL);
`);
const columns = new Set(db.prepare('PRAGMA table_info(guests)').all().map(column => column.name));
for (const column of headers.slice(1)) {
  if (!columns.has(column)) db.exec("ALTER TABLE guests ADD COLUMN " + column + " TEXT NOT NULL DEFAULT ''");
}
const seedGuest = db.prepare('INSERT OR IGNORE INTO guests (code, name) VALUES (?, ?)');
if (!process.env.RAILWAY_ENVIRONMENT_ID) {
  for (const [code, name] of Object.entries(sampleGuests)) seedGuest.run(code, name);
}

db.exec('BEGIN IMMEDIATE');
try {
  const fields = db.prepare('PRAGMA table_info(guests)').all();
  if (!fields.some(field => field.name === 'manual_code')) {
    db.exec('ALTER TABLE guests ADD COLUMN manual_code TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS guests_manual_code ON guests (manual_code)');
  const updateCode = db.prepare('UPDATE guests SET manual_code = ? WHERE code = ?');
  for (const { code } of db.prepare('SELECT code FROM guests WHERE manual_code IS NULL').all()) {
    updateCode.run(newManualCode(), code);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

function newManualCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const exists = db.prepare('SELECT 1 FROM guests WHERE manual_code = ?');
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('');
  } while (exists.get(code));
  return code;
}

const addGuest = db.prepare('INSERT INTO guests (code, name, tempat, no_whatsapp, notes, manual_code) VALUES (?, ?, ?, ?, ?, ?)');
const findGuest = db.prepare('SELECT code, name FROM guests WHERE code = ?');
const findByManualCode = db.prepare('SELECT code, name FROM guests WHERE manual_code = ?');
const listGuests = db.prepare(`
  SELECT guests.code, guests.manual_code, guests.name, guests.tempat, guests.no_whatsapp, guests.notes, checkins.time
  FROM guests LEFT JOIN checkins USING (code)
  ORDER BY guests.rowid
`);
const checkIn = db.prepare('INSERT OR IGNORE INTO checkins (code, time) VALUES (?, ?)');
const findCheckIn = db.prepare('SELECT time FROM checkins WHERE code = ?');

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/login', ['login.html', 'text/html; charset=utf-8']],
  ['/panitia', ['admin.html', 'text/html; charset=utf-8']],
  ['/login.js', ['login.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/admin.js', ['admin.js', 'text/javascript']],
  ['/jsqr.js', [require.resolve('jsqr'), 'text/javascript']],
]);

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req, limit) {
  let body = '';
  for await (const chunk of req.setEncoding('utf8')) {
    body += chunk;
    if (body.length > limit) return null;
  }
  return body;
}

function saveGuests(rows) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) addGuest.run(randomBytes(16).toString('hex'), ...row, newManualCode());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function handle(req, res) {
  if (req.method === 'POST' && req.headers['sec-fetch-site'] === 'cross-site') {
    return json(res, 403, { error: 'Permintaan harus berasal dari aplikasi ini.' });
  }
  if (req.method === 'POST' && req.url === '/login') {
    const body = await readBody(req, 2048);
    const fields = new URLSearchParams(body ?? '');
    if (!credentialsMatch(fields.get('username'), fields.get('password'))) {
      return res.writeHead(303, { Location: '/login?gagal=1' }).end();
    }
    signIn(req, res);
    return res.writeHead(303, { Location: '/panitia' }).end();
  }
  if (req.method === 'POST' && req.url === '/logout') {
    signOut(req, res);
    return res.writeHead(303, { Location: '/login' }).end();
  }
  const path = req.url.split('?')[0];
  const publicAsset = ['/login', '/style.css', '/login.js'].includes(path);
  if (!publicAsset && !authenticated(req)) {
    if (req.method === 'GET' && ['/', '/panitia'].includes(path)) {
      return res.writeHead(303, { Location: '/login', 'Cache-Control': 'no-store' }).end();
    }
    return json(res, 401, { error: 'Silakan masuk kembali.' });
  }
  if (req.method === 'GET' && req.url === '/kartu-tamu.html') {
    const html = await guestCards(listGuests.all(), cardCss);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'attachment; filename="kartu-tamu.html"',
      'Cache-Control': 'no-store',
    });
    return res.end(html);
  }
  if (req.method === 'GET' && req.url === '/guests') {
    return json(res, 200, listGuests.all());
  }
  if (req.method === 'GET' && req.url === '/template-daftar-tamu.xls') {
    const file = template();
    res.writeHead(200, {
      'Content-Type': 'application/vnd.ms-excel',
      'Content-Disposition': 'attachment; filename="template-daftar-tamu.xls"',
    });
    return res.end(file);
  }
  if (req.method === 'POST' && req.url === '/guests') {
    const body = await readBody(req, 350_000);
    if (body === null) return json(res, 413, { error: 'Daftar terlalu besar.' });
    let rows;
    try {
      const payload = JSON.parse(body);
      if (typeof payload.name === 'string') {
        rows = [[payload.name.trim(), '', '', '']];
      } else {
        const fromExcel = typeof payload.xls === 'string';
        const data = fromExcel
          ? rowsFromExcel(Buffer.from(payload.xls, 'base64'))
          : parse(payload.csv, { bom: true, skip_empty_lines: true, trim: true });
        const [header, ...records] = data;
        const columns = header?.map(cell => String(cell).trim().toLowerCase()) ?? [];
        const fullHeader = columns.length === headers.length && headers.every((key, index) => key === columns[index]);
        const legacyCsv = !fromExcel && columns.length === 1 && columns[0] === 'nama';
        if (!fullHeader && !legacyCsv) {
          return json(res, 400, { error: 'Gunakan kolom nama, tempat, no_whatsapp, dan notes dari template.' });
        }
        if (records.some(record => record.slice(headers.length).some(value => String(value).trim()))) {
          return json(res, 400, { error: 'Hapus data di luar empat kolom template.' });
        }
        rows = records.map(record => headers.map((_, index) => String(record[index] ?? '').trim()))
          .filter(row => row.some(Boolean));
      }
    } catch {
      return json(res, 400, { error: 'File tidak dapat dibaca. Gunakan template Excel .xls atau CSV.' });
    }
    if (!rows.length || rows.length > 1000) {
      return json(res, 400, { error: 'Masukkan 1 sampai 1.000 tamu per pengiriman.' });
    }
    const invalid = rows.findIndex(([name, place, phone, notes]) =>
      !name || name.length > 150 || place.length > 250 || phone.length > 40 || notes.length > 2000);
    if (invalid !== -1) {
      return json(res, 400, { error: 'Data tamu ke-' + (invalid + 1) + ' tidak valid. Nama wajib diisi. Batas karakter nama, tempat, nomor, dan notes adalah 150, 250, 40, dan 2.000.' });
    }
    saveGuests(rows);
    return json(res, 201, { count: rows.length });
  }
  if (req.method === 'POST' && req.url === '/verify') {
    const body = await readBody(req, 512);
    if (body === null) return json(res, 413, { error: 'Kode terlalu panjang.' });
    const code = body.trim();
    const guest = findGuest.get(code) ?? findByManualCode.get(code.toUpperCase());
    if (!guest) return json(res, 200, { state: 'invalid' });
    const time = new Date().toISOString();
    const { changes } = checkIn.run(guest.code, time);
    return json(res, 200, {
      state: changes ? 'approved' : 'duplicate',
      name: guest.name,
      time: changes ? time : findCheckIn.get(guest.code).time,
    });
  }
  const qr = req.method === 'GET' && /^\/qr\/([a-f0-9]{32}|DEMO-\d{3})\.png$/.exec(req.url);
  if (qr && findGuest.get(qr[1])) {
    const png = await QRCode.toBuffer(qr[1], { scale: 12, margin: 4 });
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Disposition': 'attachment; filename="undangan-' + qr[1] + '.png"',
      'Cache-Control': 'no-store',
    });
    return res.end(png);
  }
  const asset = req.method === 'GET' && assets.get(path);
  if (!asset) return res.writeHead(404).end();
  const [file, type] = asset;
  const content = readFileSync(resolve(__dirname, file));
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(content);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: 'Server gagal memproses permintaan.' });
    else res.destroy();
  });
});
const port = Number(process.env.PORT ?? 3000);
server.listen(port, process.env.RAILWAY_ENVIRONMENT_ID ? '0.0.0.0' : '127.0.0.1', () => {
  console.log('Verifikator tersedia di http://localhost:' + server.address().port);
});
