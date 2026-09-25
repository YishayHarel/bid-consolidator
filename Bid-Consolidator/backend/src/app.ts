// The Express application: middleware, route table, and the central error
// handler. Kept separate from server.ts so tests can mount it without
// listening on a port or starting workers.
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { apiLimiter } from './lib/rateLimits.js';
import { authRouter } from './modules/auth/routes.js';
import { projectEmailsRouter, templatesRouter } from './modules/emails/routes.js';
import { factoriesRouter } from './modules/factories/routes.js';
import { filesRouter } from './modules/files/routes.js';
import { itemsRouter } from './modules/items/routes.js';
import { jobsRouter } from './modules/jobs/routes.js';
import { orgRouter } from './modules/org/routes.js';
import { portalRouter } from './modules/portal/routes.js';
import { projectFactoriesRouter } from './modules/projectFactories/routes.js';
import { projectsRouter } from './modules/projects/routes.js';
import { quotesRouter } from './modules/quotes/routes.js';
import { vendorLinksRouter } from './modules/vendorLinks/routes.js';
import { loadProject, requireAuth } from './middleware/auth.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render terminates TLS at one proxy hop

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin.replace(/\/+$/, ''))),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }));
  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const reqId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', reqId);
      return reqId;
    },
    autoLogging: { ignore: (req) => req.url === '/api/health' },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url?.replace(/\/(portal|files)\/[^/?]+/, '/$1/<token>') }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }));
  app.use(express.json({ limit: '1mb' }));

  // ---- Routes -------------------------------------------------------------------
  app.get('/', (_req, res) => res.json({ service: 'bid-consolidator-api', health: '/api/health' }));
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'unreachable' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/portal', portalRouter); // public: factory link token is the credential
  app.use('/api/files', filesRouter);   // public: signed URL is the credential

  const authed = express.Router();
  authed.use(apiLimiter, requireAuth);
  authed.use('/org', orgRouter);
  authed.use('/projects', projectsRouter);
  const projectScoped = express.Router({ mergeParams: true });
  projectScoped.use(loadProject);
  projectScoped.use(itemsRouter, quotesRouter, projectFactoriesRouter, projectEmailsRouter);
  authed.use('/projects/:projectId', projectScoped);
  authed.use('/factories', factoriesRouter);
  authed.use('/vendor-links', vendorLinksRouter);
  authed.use('/email-templates', templatesRouter);
  authed.use('/jobs', jobsRouter);
  app.use('/api', authed);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }));

  // ---- Errors ------------------------------------------------------------------
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}) });
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body', code: 'bad_request' });
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large', code: 'too_large' });
    req.log?.error({ err }, 'unhandled error');
    // Never leak internals (SQL, stack traces, file paths) to the client.
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.', code: 'internal', requestId: req.id });
  });

  return app;
}
