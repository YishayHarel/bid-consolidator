require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');

// ---- Fail fast on missing critical config -----------------------------------
const onRender = !!process.env.RENDER || process.env.NODE_ENV === 'production';
const missing = ['JWT_SECRET'].filter(k => !process.env[k]);
// Without Supabase, uploads land on Render's ephemeral disk and vanish on deploy.
if (onRender) missing.push(...['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'DATABASE_URL'].filter(k => !process.env[k]));
if (missing.length) {
  console.error(`FATAL: missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const vendorRoutes = require('./routes/vendor');
const emailRoutes = require('./routes/emails');
const factoryRoutes = require('./routes/factories');

const app = express();
const server = http.createServer(app);

// Render terminates TLS at a proxy; trust it so rate limiting sees real client IPs.
app.set('trust proxy', 1);

// ---- Authenticated WebSocket: each socket belongs to one user, and events are
// delivered only to that user's sockets (never broadcast to everyone). --------
const wss = new WebSocketServer({ server, path: '/ws' });
const socketsByUser = new Map(); // userId -> Set<ws>
wss.on('connection', (ws, req) => {
  let userId;
  try {
    const token = new URL(req.url, 'http://x').searchParams.get('token');
    userId = jwt.verify(token, process.env.JWT_SECRET).id;
  } catch {
    ws.close(4401, 'Unauthorized');
    return;
  }
  if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
  socketsByUser.get(userId).add(ws);
  ws.on('close', () => {
    const set = socketsByUser.get(userId);
    if (set) { set.delete(ws); if (!set.size) socketsByUser.delete(userId); }
  });
  ws.on('error', () => {});
});
app.locals.notifyUser = (userId, data) => {
  const msg = JSON.stringify(data);
  (socketsByUser.get(userId) || []).forEach(client => { if (client.readyState === 1) client.send(msg); });
};

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (req, res) => {
  try {
    await require('./db/pool').query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/vendor', vendorRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/factories', factoryRoutes);

// Never leak internal error details (SQL, stack, file paths) to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: status < 500 && err.expose ? err.message : 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
