const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { parse } = require('csv-parse/sync');
const QRCode = require('qrcode');
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
const seedGuest = db.prepare('INSERT OR IGNORE INTO guests (code, name) VALUES (?, ?)');
if (!process.env.RAILWAY_ENVIRONMENT_ID) {
  for (const [code, name] of Object.entries(sampleGuests)) seedGuest.run(code, name);
}

const addGuest = db.prepare('INSERT INTO guests (code, name) VALUES (?, ?)');
const findGuest = db.prepare('SELECT name FROM guests WHERE code = ?');
const listGuests = db.prepare(`
  SELECT guests.code, guests.name, checkins.time
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

function saveGuests(names) {
  db.exec('BEGIN');
  try {
    for (const name of names) addGuest.run(randomBytes(16).toString('hex'), name);
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
  if (req.method === 'GET' && req.url === '/guests') {
    return json(res, 200, listGuests.all());
  }
  if (req.method === 'POST' && req.url === '/guests') {
    const body = await readBody(req, 256_000);
    if (body === null) return json(res, 413, { error: 'Daftar terlalu besar.' });
    let names;
    try {
      const payload = JSON.parse(body);
      if (typeof payload.name === 'string') {
        names = [payload.name.trim()];
      } else if (typeof payload.csv === 'string') {
        const [header, ...rows] = parse(payload.csv, { bom: true, skip_empty_lines: true, trim: true });
        if (header?.length !== 1 || header[0].toLowerCase() !== 'nama') {
          return json(res, 400, { error: 'CSV harus memiliki satu kolom dengan judul nama.' });
        }
        names = rows.map(([name]) => name.trim());
      }
    } catch {
      return json(res, 400, { error: 'Format daftar tamu tidak valid.' });
    }
    if (!names?.length || names.length > 1000) {
      return json(res, 400, { error: 'Masukkan 1 sampai 1.000 tamu per pengiriman.' });
    }
    const invalid = names.findIndex(name => !name || name.length > 150);
    if (invalid !== -1) {
      return json(res, 400, { error: 'Nama tamu ke-' + (invalid + 1) + ' harus berisi 1 sampai 150 karakter.' });
    }
    saveGuests(names);
    return json(res, 201, { count: names.length });
  }
  if (req.method === 'POST' && req.url === '/verify') {
    const body = await readBody(req, 512);
    if (body === null) return json(res, 413, { error: 'Kode terlalu panjang.' });
    const code = body.trim();
    const guest = findGuest.get(code);
    if (!guest) return json(res, 200, { state: 'invalid' });
    const time = new Date().toISOString();
    const { changes } = checkIn.run(code, time);
    return json(res, 200, {
      state: changes ? 'approved' : 'duplicate',
      name: guest.name,
      time: changes ? time : findCheckIn.get(code).time,
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


