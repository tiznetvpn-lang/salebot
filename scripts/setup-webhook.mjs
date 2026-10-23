#!/usr/bin/env node
import { loadProjectEnvironment } from '../server/runtime.mjs';

function fail(message) {
  console.error(`[setup-webhook] ${message}`);
  process.exitCode = 1;
}

loadProjectEnvironment();

if (!process.argv.includes('--confirm-switch')) {
  console.error('This command changes the Telegram bot webhook to this server.');
  console.error('If this bot currently runs on Cloudflare or another host, it will stop receiving updates there.');
  console.error('After DNS, HTTPS, and the new service are verified, run again with --confirm-switch.');
  process.exitCode = 2;
} else {
  const token = String(process.env.BOT_TOKEN || '').trim();
  const secret = String(process.env.WEBHOOK_SECRET || '').trim();
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();

  if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
    fail('Set BOT_TOKEN and a WEBHOOK_SECRET of 32–256 letters/digits/underscore/hyphen in the environment file.');
  } else if (!publicBaseUrl) {
    fail('Set PUBLIC_BASE_URL to your HTTPS origin, such as https://bot.tiznet.site.');
  } else {
    let base;
    try { base = new URL(publicBaseUrl); }
    catch { base = null; }
    if (!base || base.protocol !== 'https:' || base.username || base.password || !['', '/'].includes(base.pathname) || base.search || base.hash) {
      fail('PUBLIC_BASE_URL must be a bare HTTPS origin without a path, query, or credentials.');
    } else {
      const webhookUrl = `${base.origin}/webhook`;
      const endpoint = `https://api.telegram.org/bot${token}`;
      const callTelegram = async (method, payload) => {
        const response = await fetch(`${endpoint}/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20_000)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.description || `${method} failed (HTTP ${response.status})`);
        return result.result;
      };

      try {
        const bot = await callTelegram('getMe', {});
        await callTelegram('setWebhook', {
          url: webhookUrl,
          secret_token: secret,
          allowed_updates: ['message', 'callback_query'],
          drop_pending_updates: false
        });
        console.log(`[setup-webhook] Webhook now points to ${webhookUrl}`);
        console.log(`[setup-webhook] Telegram bot verified: @${bot.username || '(username unavailable)'}`);
        console.log('[setup-webhook] Pending Telegram updates were retained. Send /start to the bot to verify the Mini App.');
      } catch (error) {
        fail(error?.message || 'Telegram request failed');
      }
    }
  }
}
