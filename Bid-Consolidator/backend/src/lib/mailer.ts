// Outbound email through the company SMTP account. Callers never pass raw
// recipient addresses from a request: services resolve recipients from
// server-side records (the factory directory), so this can't be used as an
// open relay to send arbitrary mail from the company domain.
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { unavailable } from './errors.js';

export interface OutgoingMail { to: string[]; subject: string; text: string; replyTo?: string }

/** In tests, messages are captured here instead of being sent. */
export const testOutbox: OutgoingMail[] = [];

const transport = config.isTest
  ? nodemailer.createTransport({ jsonTransport: true })
  : config.smtpEnabled
    ? nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth: { user: config.SMTP_USER!, pass: config.SMTP_PASS! },
      })
    : null;

export async function sendMail(msg: OutgoingMail) {
  if (!transport) throw unavailable('Email sending is not configured on the server (SMTP settings missing).');
  await transport.sendMail({
    from: config.SMTP_FROM ?? config.SMTP_USER ?? 'no-reply@example.com',
    to: msg.to.join(', '),
    subject: msg.subject,
    text: msg.text,
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
  });
  if (config.isTest) testOutbox.push(msg);
}
