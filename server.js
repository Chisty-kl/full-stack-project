const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- tiny JSON "database" ----
const DB = path.join(__dirname, 'data.json');
const load = () => fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB)) : { users: [], products: [], orders: [] };
const save = (d) => fs.writeFileSync(DB, JSON.stringify(d, null, 2));
const uid = () => crypto.randomBytes(6).toString('hex');
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const sessions = {}; // token -> user

function auth(role) {
  return (req, res, next) => {
    const u = sessions[req.headers['x-token']];
    if (!u) return res.status(401).json({ error: 'Please log in first' });
    if (role && u.role !== role) return res.status(403).json({ error: 'Not allowed for your role' });
    req.user = u;
    next();
  };
}

// ---- auth ----
app.post('/api/register', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !['farmer', 'buyer'].includes(role))
    return res.status(400).json({ error: 'All fields are required' });
  const d = load();
  if (d.users.find(u => u.email === email.toLowerCase()))
    return res.status(400).json({ error: 'Email already registered' });
  const salt = uid();
  d.users.push({ id: uid(), name, email: email.toLowerCase(), role, salt, pw: hash(password, salt) });
  save(d);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const u = load().users.find(x => x.email === (email || '').toLowerCase());
  if (!u || u.pw !== hash(password || '', u.salt))
    return res.status(401).json({ error: 'Wrong email or password' });
  const token = uid() + uid();
  const user = { id: u.id, name: u.name, role: u.role };
  sessions[token] = user;
  res.json({ token, user });
});

// ---- products ----
app.get('/api/products', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const list = load().products.filter(p => p.quantity > 0 || req.headers['x-token']);
  res.json(list.filter(p => !q || (p.name + p.category + p.location).toLowerCase().includes(q)));
});

app.post('/api/products', auth('farmer'), (req, res) => {
  const { name, category, price, quantity, location } = req.body;
  if (!name || !(price > 0) || !(quantity > 0)) return res.status(400).json({ error: 'Enter valid name, price and quantity' });
  const d = load();
  d.products.push({ id: uid(), farmerId: req.user.id, farmerName: req.user.name, name, category, price: Number(price), quantity: Number(quantity), location });
  save(d);
  res.json({ ok: true });
});

app.delete('/api/products/:id', auth('farmer'), (req, res) => {
  const d = load();
  d.products = d.products.filter(p => !(p.id === req.params.id && p.farmerId === req.user.id));
  save(d);
  res.json({ ok: true });
});

// ---- market trends (average price per product) ----
app.get('/api/trends', (req, res) => {
  const g = {};
  load().products.forEach(p => {
    const k = p.name.trim().toLowerCase();
    (g[k] = g[k] || []).push(p.price);
  });
  res.json(Object.entries(g).map(([name, a]) => ({
    name, listings: a.length,
    avg: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2),
    min: Math.min(...a), max: Math.max(...a)
  })));
});

// ---- orders ----
app.post('/api/orders', auth('buyer'), (req, res) => {
  const d = load();
  const p = d.products.find(x => x.id === req.body.productId);
  const q = Number(req.body.quantity);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  if (!(q > 0) || q > p.quantity) return res.status(400).json({ error: 'Invalid quantity (available: ' + p.quantity + ')' });
  p.quantity -= q;
  d.orders.push({ id: uid(), productId: p.id, productName: p.name, farmerId: p.farmerId, buyerId: req.user.id,
    buyerName: req.user.name, quantity: q, total: q * p.price, status: 'Pending', date: new Date().toISOString() });
  save(d);
  res.json({ ok: true });
});

app.get('/api/orders', auth(), (req, res) => {
  const key = req.user.role === 'farmer' ? 'farmerId' : 'buyerId';
  res.json(load().orders.filter(o => o[key] === req.user.id).reverse());
});

app.patch('/api/orders/:id', auth('farmer'), (req, res) => {
  const d = load();
  const o = d.orders.find(x => x.id === req.params.id && x.farmerId === req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  o.status = 'Delivered';
  save(d);
  res.json({ ok: true });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`AgriConnect running at http://localhost:${PORT}`));