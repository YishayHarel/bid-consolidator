// Realtime updates over WebSocket.
//
// Auth: the client opens /ws and sends {type:"auth", token} as its first
// message (tokens never go in URLs, which end up in proxy/access logs). Sockets
// that don't authenticate within 5s are closed.
//
// Fan-out: events are published with Postgres NOTIFY and every server instance
// LISTENs, delivering to its own connected sockets. So live updates keep
// working with several instances behind a load balancer — no Redis needed.
// Each event targets one user; nothing is broadcast to everyone.
import type { Server } from 'node:http';
import pg from 'pg';
import { WebSocketServer, type WebSocket } from 'ws';
import { connectionConfig, pool } from '../db/pool.js';
import { verifySession } from './auth.js';
import { logger } from './logger.js';

const CHANNEL = 'app_events';
const socketsByUser = new Map<number, Set<WebSocket>>();

export type AppEvent =
  | { type: 'quote:new'; projectId: number; projectName: string; factoryName: string }
  | { type: 'job:update'; job: { id: number; type: string; state: string; progress: number; message: string | null; projectId: number | null } };

/** Send an event to one user's open sessions, on whichever instance they're connected to. */
export async function publish(userId: number | null | undefined, event: AppEvent): Promise<void> {
  if (!userId) return;
  try {
    await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ u: userId, e: event })]);
  } catch (err) {
    logger.warn({ err }, 'realtime publish failed (non-fatal)');
  }
}

function deliverLocal(userId: number, event: AppEvent) {
  const set = socketsByUser.get(userId);
  if (!set) return;
  const msg = JSON.stringify(event);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(msg);
}

let listener: pg.Client | null = null;
let stopped = false;
async function startListener(attempt = 0): Promise<void> {
  if (stopped) return;
  const client = new pg.Client(connectionConfig());
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listener = client;
    client.on('notification', (n) => {
      try {
        const { u, e } = JSON.parse(n.payload ?? '{}') as { u: number; e: AppEvent };
        deliverLocal(u, e);
      } catch { /* ignore malformed */ }
    });
    client.on('error', (err) => {
      logger.warn({ err }, 'realtime listener lost — reconnecting');
      listener = null;
      client.end().catch(() => {});
      setTimeout(() => void startListener(0), 1000);
    });
  } catch (err) {
    client.end().catch(() => {});
    const delay = Math.min(30_000, 1000 * 2 ** attempt);
    logger.warn({ err, delay }, 'realtime listener connect failed — retrying');
    setTimeout(() => void startListener(attempt + 1), delay);
  }
}

export function attachRealtime(server: Server): () => Promise<void> {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

  wss.on('connection', (ws) => {
    let userId: number | null = null;
    const authTimer = setTimeout(() => { if (!userId) ws.close(4401, 'auth timeout'); }, 5000);
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on('pong', () => { (ws as WebSocket & { isAlive?: boolean }).isAlive = true; });

    ws.on('message', (raw) => {
      if (userId) return; // clients only send the auth message
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; token?: string };
        if (msg.type !== 'auth' || typeof msg.token !== 'string') throw new Error('expected auth');
        userId = verifySession(msg.token).id;
        clearTimeout(authTimer);
        if (!socketsByUser.has(userId)) socketsByUser.set(userId, new Set());
        socketsByUser.get(userId)!.add(ws);
        ws.send(JSON.stringify({ type: 'ready' }));
      } catch {
        ws.close(4401, 'unauthorized');
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      if (userId) {
        const set = socketsByUser.get(userId);
        set?.delete(ws);
        if (set && !set.size) socketsByUser.delete(userId);
      }
    });
    ws.on('error', () => {});
  });

  // Drop dead connections (laptops closing, proxies timing out).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<WebSocket & { isAlive?: boolean }>) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  stopped = false;
  void startListener();

  return async () => {
    stopped = true;
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.close(1001, 'server shutting down');
    await new Promise<void>((r) => wss.close(() => r()));
    await listener?.end().catch(() => {});
  };
}
