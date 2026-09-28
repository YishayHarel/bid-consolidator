// Outbound email. Callers never pass raw recipient addresses from a request:
// services resolve recipients from server-side records (the factory
// directory), so this can't be used as an open relay.
//
// Each email goes out AS the signed-in buyer:
//  1. from their own Outlook mailbox when they've connected it (Microsoft
//     Graph; it lands in their Sent Items and replies come straight back), else
//  2. through the company SMTP account with Reply-To set to the buyer, when
//     one is configured, else
//  3. it's refused with a clear "connect your Outlook" message (the UI's Copy
//     button still works).
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { AppError } from './errors.js';
import { hasMailbox, sendAsUser } from './outlook.js';

export interface OutgoingMail { to: string[]; subject: string; text: string; replyTo?: string }
export interface Sender { id: number; email: string }
export type SentVia = 'outlook' | 'smtp' | 'test';

/** In tests, messages that don't go through Outlook are captured here instead of being sent. */
export const testOutbox: OutgoingMail[] = [];

const smtp = config.isTest
  ? nodemailer.createTransport({ jsonTransport: true })
  : config.smtpEnabled
    ? nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth: { user: config.SMTP_USER!, pass: config.SMTP_PASS! },
      })
    : null;

export async function sendAs(sender: Sender, msg: Omit<OutgoingMail, 'replyTo'>): Promise<SentVia> {
  if (await hasMailbox(sender.id)) {
    await sendAsUser(sender.id, msg);
    return 'outlook';
  }
  if (!smtp) {
    throw new AppError(409, 'Connect your Outlook in Settings to send email from the site — or use Copy to send it yourself.', 'mail_not_connected');
  }
  await smtp.sendMail({
    from: config.SMTP_FROM ?? config.SMTP_USER ?? 'no-reply@example.com',
    to: msg.to.join(', '),
    subject: msg.subject,
    text: msg.text,
    replyTo: sender.email,
  });
  if (config.isTest) { testOutbox.push({ ...msg, replyTo: sender.email }); return 'test'; }
  return 'smtp';
}
