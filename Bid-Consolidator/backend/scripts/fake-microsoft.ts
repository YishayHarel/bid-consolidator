// Local dev only: a fake Microsoft (login + Graph) on :47811 so Outlook sending
// can be tried end to end without a real Microsoft 365 app. Pair it with the
// `backend-outlook-dev` launch config. Sent emails are logged, not delivered.
import { createFakeMicrosoft } from '../test/fakeMicrosoft.js';
import { logger } from '../src/lib/logger.js';

const { server } = createFakeMicrosoft((m) => logger.info({ from: m.from, to: m.to, subject: m.subject, text: m.text }, 'fake outlook: sent'));
server.listen(47811, '127.0.0.1', () => logger.info('fake Microsoft listening on http://127.0.0.1:47811'));
