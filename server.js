const express  = require('express');
const session  = require('express-session');
const sqlite3  = require('sqlite3').verbose();
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

const APP_PASSWORD = process.env.APP_PASSWORD || 'pogotour2024';

const DB_DIR  = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'vouchers.db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('DB error:', err.message);
  else console.log('DB conectat OK:', DB_PATH);
});

const run = (sql, p=[]) => new Promise((res,rej) => db.run(sql, p, function(e){ e?rej(e):res(this); }));
const get = (sql, p=[]) => new Promise((res,rej) => db.get(sql, p, (e,r) => e?rej(e):res(r)));
const all = (sql, p=[]) => new Promise((res,rej) => db.all(sql, p, (e,r) => e?rej(e):res(r)));

async function initDB() {
  await run(`CREATE TABLE IF NOT EXISTS vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_no TEXT NOT NULL UNIQUE, seq INTEGER NOT NULL,
    issued TEXT NOT NULL, name TEXT NOT NULL,
    phone TEXT, email TEXT, pax TEXT, type TEXT,
    car_seg TEXT, luggage TEXT, dir_val TEXT, dir_label TEXT,
    pickup_loc TEXT, drop_loc TEXT, pickup_addr TEXT, drop_addr TEXT,
    trip_date TEXT, trip_time TEXT, airline TEXT, flight TEXT,
    driver TEXT, driver_ph TEXT, plate TEXT, car TEXT,
    price_eur TEXT, price_ron TEXT, bnr_rate TEXT,
    pay_status TEXT, pay_method TEXT,
    c_phone TEXT, c_wa TEXT, c_email TEXT, c_web TEXT, notes TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await run(`CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY, val INTEGER NOT NULL DEFAULT 0)`);
  await run(`INSERT OR IGNORE INTO counter (id, val) VALUES (1, 0)`);
  console.log('DB initializat OK');
}
initDB().catch(console.error);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'pogo-secret-x9k2',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 10 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.status(401).json({ error: 'Neautorizat.' });
}

app.get('/login', (req, res) => {
  if (req.session.loggedIn) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  console.log('Login attempt:', !!password);
  if (!password) return res.status(400).json({ error: 'Parola lipsa.' });
  if (password === APP_PASSWORD) {
    req.session.loggedIn = true;
    console.log('Login SUCCESS');
    return res.json({ ok: true });
  }
  console.log('Login FAILED');
  res.status(401).json({ error: 'Parola incorecta.' });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get('/api/auth', (req, res) => { res.json({ loggedIn: !!req.session.loggedIn }); });

app.get('/api/counter', requireAuth, async (req, res) => {
  try { const r = await get('SELECT val FROM counter WHERE id=1'); res.json({ next: (r?.val||0)+1 }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vouchers', requireAuth, async (req, res) => {
  try {
    const d = req.body;
    await run('UPDATE counter SET val=val+1 WHERE id=1');
    const row = await get('SELECT val FROM counter WHERE id=1');
    const seq = row.val;
    const voucherNo = `POG-${String(seq).padStart(4,'0')}`;
    const now = new Date();
    const pad = x => String(x).padStart(2,'0');
    const issued = `${pad(now.getDate())}.${pad(now.getMonth()+1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    await run(`INSERT INTO vouchers (voucher_no,seq,issued,name,phone,email,pax,type,car_seg,luggage,dir_val,dir_label,pickup_loc,drop_loc,pickup_addr,drop_addr,trip_date,trip_time,airline,flight,driver,driver_ph,plate,car,price_eur,price_ron,bnr_rate,pay_status,pay_method,c_phone,c_wa,c_email,c_web,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [voucherNo,seq,issued,d.name,d.phone,d.email,d.pax,d.type,d.carSeg,d.luggage,d.dirVal,d.dirLabel,d.pickupLoc,d.dropLoc,d.pickupAddr,d.dropAddr,d.date,d.time,d.airline,d.flight,d.driver,d.driverPh,d.plate,d.car,d.priceEUR,d.price,d.bnrRate,d.paySt,d.payMeth,d.cPh,d.cWA,d.cEmail,d.cWeb,d.notes]);
    res.json({ ok: true, voucherNo, seq, issued });
  } catch(err) { console.error(err.message); res.status(500).json({ error: err.message }); }
});

app.get('/api/vouchers', requireAuth, async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q}%` : null;
    const rows = q
      ? await all(`SELECT * FROM vouchers WHERE name LIKE ? OR voucher_no LIKE ? OR phone LIKE ? OR flight LIKE ? ORDER BY seq DESC LIMIT 200`,[q,q,q,q])
      : await all('SELECT * FROM vouchers ORDER BY seq DESC LIMIT 200');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vouchers/:seq', requireAuth, async (req, res) => {
  try {
    const row = await get('SELECT * FROM vouchers WHERE seq=?',[req.params.seq]);
    if (!row) return res.status(404).json({ error: 'Negasit.' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vouchers/:seq', requireAuth, async (req, res) => {
  try { await run('DELETE FROM vouchers WHERE seq=?',[req.params.seq]); res.json({ ok: true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, () => {
  console.log(`POGO LINES pornit pe portul ${PORT}`);
  console.log(`Parola activa: ${APP_PASSWORD}`);
});
