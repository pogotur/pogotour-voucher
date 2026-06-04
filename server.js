const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── PAROLĂ (schimb-o după deployment!) ──
// Generată cu bcrypt.hashSync('parola_ta', 10)
// Implicit: parola = "pogotour2024"
const PASSWORD_HASH = process.env.PASSWORD_HASH ||
  '$2a$10$Nz8VhXKzJ2E5mR3QdL7Y8.6K1pOvWtHs4jBuGcMlIrNePfAxZqCde';
// ^^^ aceasta e hash-ul pentru "pogotour2024"
// Ca să schimbi parola, rulează în Node:
//   require('bcryptjs').hashSync('parola_noua', 10)
// și pune rezultatul în variabila de mediu PASSWORD_HASH pe Render

// ── DATABASE ──
const DB_DIR  = process.env.DB_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'vouchers.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS vouchers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_no TEXT    NOT NULL UNIQUE,
    seq        INTEGER NOT NULL,
    issued     TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    phone      TEXT,
    email      TEXT,
    pax        TEXT,
    type       TEXT,
    car_seg    TEXT,
    luggage    TEXT,
    dir_val    TEXT,
    dir_label  TEXT,
    pickup_loc TEXT,
    drop_loc   TEXT,
    pickup_addr TEXT,
    drop_addr  TEXT,
    trip_date  TEXT,
    trip_time  TEXT,
    airline    TEXT,
    flight     TEXT,
    driver     TEXT,
    driver_ph  TEXT,
    plate      TEXT,
    car        TEXT,
    price_eur  TEXT,
    price_ron  TEXT,
    bnr_rate   TEXT,
    pay_status TEXT,
    pay_method TEXT,
    c_phone    TEXT,
    c_wa       TEXT,
    c_email    TEXT,
    c_web      TEXT,
    notes      TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS counter (
    id  INTEGER PRIMARY KEY,
    val INTEGER NOT NULL DEFAULT 0
  );

  INSERT OR IGNORE INTO counter (id, val) VALUES (1, 0);
`);

// ── MIDDLEWARE ──
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'pogo-secret-2024-xK9m',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 ore
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── AUTH MIDDLEWARE ──
function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.status(401).json({ error: 'Neautorizat. Te rog autentifică-te.' });
}

// ── ROUTES ──

// Login page
app.get('/login', (req, res) => {
  if (req.session.loggedIn) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login API
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Parolă lipsă.' });

  const ok = bcrypt.compareSync(password, PASSWORD_HASH);
  if (!ok) return res.status(401).json({ error: 'Parolă incorectă.' });

  req.session.loggedIn = true;
  res.json({ ok: true });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// Check auth
app.get('/api/auth', (req, res) => {
  res.json({ loggedIn: !!req.session.loggedIn });
});

// Get next sequence number
app.get('/api/counter', requireAuth, (req, res) => {
  const row = db.prepare('SELECT val FROM counter WHERE id = 1').get();
  res.json({ next: (row?.val || 0) + 1 });
});

// Save voucher
app.post('/api/vouchers', requireAuth, (req, res) => {
  try {
    const d = req.body;

    // Increment counter
    db.prepare('UPDATE counter SET val = val + 1 WHERE id = 1').run();
    const row = db.prepare('SELECT val FROM counter WHERE id = 1').get();
    const seq = row.val;
    const voucherNo = `POG-${String(seq).padStart(4, '0')}`;

    const now = new Date();
    const pad = x => String(x).padStart(2, '0');
    const issued = `${pad(now.getDate())}.${pad(now.getMonth()+1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    db.prepare(`
      INSERT INTO vouchers (
        voucher_no, seq, issued, name, phone, email, pax, type,
        car_seg, luggage, dir_val, dir_label, pickup_loc, drop_loc,
        pickup_addr, drop_addr, trip_date, trip_time, airline, flight,
        driver, driver_ph, plate, car,
        price_eur, price_ron, bnr_rate, pay_status, pay_method,
        c_phone, c_wa, c_email, c_web, notes
      ) VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      )
    `).run(
      voucherNo, seq, issued,
      d.name, d.phone, d.email, d.pax, d.type,
      d.carSeg, d.luggage, d.dirVal, d.dirLabel, d.pickupLoc, d.dropLoc,
      d.pickupAddr, d.dropAddr, d.date, d.time, d.airline, d.flight,
      d.driver, d.driverPh, d.plate, d.car,
      d.priceEUR, d.price, d.bnrRate, d.paySt, d.payMeth,
      d.cPh, d.cWA, d.cEmail, d.cWeb, d.notes
    );

    res.json({ ok: true, voucherNo, seq, issued });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get all vouchers (with optional search)
app.get('/api/vouchers', requireAuth, (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  let rows;
  if (q) {
    rows = db.prepare(`
      SELECT * FROM vouchers
      WHERE name LIKE ? OR voucher_no LIKE ? OR phone LIKE ? OR flight LIKE ? OR trip_date LIKE ?
      ORDER BY seq DESC LIMIT 200
    `).all(q, q, q, q, q);
  } else {
    rows = db.prepare('SELECT * FROM vouchers ORDER BY seq DESC LIMIT 200').all();
  }
  res.json(rows);
});

// Get single voucher
app.get('/api/vouchers/:seq', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM vouchers WHERE seq = ?').get(req.params.seq);
  if (!row) return res.status(404).json({ error: 'Negăsit.' });
  res.json(row);
});

// Delete voucher
app.delete('/api/vouchers/:seq', requireAuth, (req, res) => {
  db.prepare('DELETE FROM vouchers WHERE seq = ?').run(req.params.seq);
  res.json({ ok: true });
});

// Catch-all → app (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`POGO LINES Voucher Server running on port ${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
