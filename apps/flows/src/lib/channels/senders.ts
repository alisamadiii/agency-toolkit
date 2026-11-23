import { lookup } from 'node:dns/promises';

import nodemailer from 'nodemailer';

import { hmacHex } from '@/lib/crypto';
import { guardedRequest, isPublicAddress, type GuardedResponse } from '@/lib/net';

import { CHANNELS, type ChannelType } from './registry';

export type Message = {
  title: string;
  message: string;
  // Recipient override (email list, phone, chat id). Empty uses the channel default.
  to?: string;
  level?: 'info' | 'success' | 'error';
  // Deep link (e.g. the run page).
  url?: string;
};

export type SendResult = { ok: boolean; error?: string; to?: string };

const TIMEOUT = 15_000;
const LEVEL_COLOR = { info: 0x3b82f6, success: 0x10b981, error: 0xef4444 };
const LEVEL_ICON = { info: 'ℹ️', success: '✅', error: '❌' };

// POST to a channel-owned URL: its own host is allowed, private addresses never are.
async function post(url: string, body: string, headers: Record<string, string>): Promise<GuardedResponse> {
  return guardedRequest({
    url,
    method: 'POST',
    headers,
    body,
    allowedHosts: [new URL(url).hostname],
    timeoutMs: TIMEOUT,
  });
}

function check(res: GuardedResponse, name: string): SendResult {
  if (res.status >= 200 && res.status < 300) return { ok: true };
  const detail = res.body.slice(0, 300);
  return { ok: false, error: `${name} responded ${res.status}${detail ? `: ${detail}` : ''}` };
}

const json = (v: unknown) => JSON.stringify(v);
const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export async function sendToChannel(type: ChannelType, rawConfig: unknown, msg: Message): Promise<SendResult> {
  const parsed = CHANNELS[type].schema.safeParse(rawConfig);
  if (!parsed.success) return { ok: false, error: `Channel config is invalid: ${parsed.error.issues[0]?.message ?? ''}` };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = parsed.data as any;
  const level = msg.level ?? 'info';
  const text = msg.url ? `${msg.message}\n${msg.url}` : msg.message;

  try {
    switch (type) {
      case 'slack': {
        const title = msg.url ? `*<${msg.url}|${msg.title}>*` : `*${msg.title}*`;
        return check(await post(c.webhookUrl, json({ text: `${title}\n${msg.message}` }), { 'content-type': 'application/json' }), 'Slack');
      }

      case 'discord': {
        const body: Record<string, unknown> = {
          embeds: [
            {
              title: clamp(msg.title, 256),
              description: clamp(msg.message, 4000),
              url: msg.url,
              color: LEVEL_COLOR[level],
              timestamp: new Date().toISOString(),
            },
          ],
        };
        if (c.username) body.username = c.username;
        if (c.avatarUrl) body.avatar_url = c.avatarUrl;
        return check(await post(c.webhookUrl, json(body), { 'content-type': 'application/json' }), 'Discord');
      }

      case 'telegram': {
        const chatId = msg.to?.trim() || c.chatId;
        const res = await post(
          `https://api.telegram.org/bot${c.botToken}/sendMessage`,
          json({ chat_id: chatId, text: clamp(`${msg.title}\n\n${text}`, 4096), disable_web_page_preview: true }),
          { 'content-type': 'application/json' }
        );
        return { ...check(res, 'Telegram'), to: chatId };
      }

      case 'email': {
        const to = (msg.to?.trim() || c.defaultTo).split(/[,;]/).map((s: string) => s.trim()).filter(Boolean);
        if (!to.length) return { ok: false, error: 'No recipient: set "To" on the node or default recipients on the channel' };
        // Resolve first and refuse private addresses, then connect to that exact IP.
        const { address } = await lookup(c.host);
        if (!isPublicAddress(address)) return { ok: false, error: `Blocked: ${c.host} resolves to a private address` };
        const transport = nodemailer.createTransport({
          host: address,
          port: c.port,
          secure: c.encryption === 'ssl',
          ignoreTLS: c.encryption === 'none',
          requireTLS: c.encryption === 'tls',
          tls: { servername: c.host },
          auth: c.username ? { user: c.username, pass: c.password } : undefined,
          connectionTimeout: TIMEOUT,
          greetingTimeout: TIMEOUT,
          socketTimeout: TIMEOUT,
        });
        await transport.sendMail({ from: c.fromEmail, to, subject: msg.title, text });
        return { ok: true, to: to.join(', ') };
      }

      case 'sms':
      case 'whatsapp': {
        let to = (msg.to?.trim() || c.defaultTo).replace(/^whatsapp:/, '');
        if (!to) return { ok: false, error: 'No recipient phone number' };
        if (!/^\+[1-9]\d{6,14}$/.test(to)) return { ok: false, error: `"${to}" is not an E.164 phone number (e.g. +15555550123)` };
        const wa = type === 'whatsapp';
        const from = c.from.startsWith('MG') ? null : wa ? `whatsapp:${c.from.replace(/^whatsapp:/, '')}` : c.from;
        to = wa ? `whatsapp:${to}` : to;
        const form = new URLSearchParams({ To: to, Body: clamp(`${msg.title}\n${text}`, 1600) });
        if (from) form.set('From', from);
        else form.set('MessagingServiceSid', c.from);
        const res = await post(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, form.toString(), {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}`,
        });
        return { ...check(res, 'Twilio'), to: to.replace(/^whatsapp:/, '') };
      }

      case 'teams': {
        const body = {
          type: 'message',
          attachments: [
            {
              contentType: 'application/vnd.microsoft.card.adaptive',
              content: {
                $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                type: 'AdaptiveCard',
                version: '1.4',
                body: [
                  { type: 'TextBlock', text: msg.title, weight: 'Bolder', size: 'Medium', wrap: true },
                  { type: 'TextBlock', text: msg.message, wrap: true },
                ],
                actions: msg.url ? [{ type: 'Action.OpenUrl', title: 'Open', url: msg.url }] : [],
              },
            },
          ],
        };
        return check(await post(c.webhookUrl, json(body), { 'content-type': 'application/json' }), 'Teams');
      }

      case 'googlechat':
        return check(
          await post(c.webhookUrl, json({ text: `*${msg.title}*\n${text}` }), { 'content-type': 'application/json; charset=UTF-8' }),
          'Google Chat'
        );

      case 'ntfy': {
        const server = (c.serverUrl || 'https://ntfy.sh').replace(/\/$/, '');
        const headers: Record<string, string> = {
          'content-type': 'text/plain; charset=utf-8',
          // Header values must be ASCII; ntfy decodes RFC 2047.
          title: `=?UTF-8?B?${Buffer.from(clamp(msg.title, 200)).toString('base64')}?=`,
          priority: c.priority,
          tags: level === 'error' ? 'x' : level === 'success' ? 'white_check_mark' : 'bell',
        };
        if (msg.url) headers.click = msg.url;
        if (c.token) headers.authorization = `Bearer ${c.token}`;
        return check(await post(`${server}/${c.topic}`, msg.message, headers), 'ntfy');
      }

      case 'webhook': {
        const body = json({
          event: 'notification',
          title: msg.title,
          message: msg.message,
          level,
          to: msg.to || undefined,
          url: msg.url,
          sentAt: new Date().toISOString(),
        });
        const headers: Record<string, string> = { 'content-type': 'application/json', ...(c.headers ? JSON.parse(c.headers) : {}) };
        if (c.secret) headers['x-flows-signature'] = `sha256=${hmacHex(c.secret, body)}`;
        return check(await post(c.url, body, headers), 'Webhook');
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function levelIcon(level: Message['level']) {
  return LEVEL_ICON[level ?? 'info'];
}
