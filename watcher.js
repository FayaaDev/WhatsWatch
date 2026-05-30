const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const dataPath = process.env.WWEBJS_DATA_PATH || path.join(__dirname, '.wwebjs_auth');
const logFile = process.env.LOG_FILE || path.join(__dirname, 'messages.log');
const headless = process.env.HEADLESS !== 'false';
const notifyCommand = process.env.NOTIFY_COMMAND || '';
const notifyArgs = process.env.NOTIFY_ARGS ? JSON.parse(process.env.NOTIFY_ARGS) : [];
const webhookUrl = process.env.N8N_WEBHOOK_URL || '';
const webhookToken = process.env.N8N_WEBHOOK_TOKEN || '';
const webhookTimeoutMs = Number(process.env.N8N_WEBHOOK_TIMEOUT_MS || 10000);
const inboundFilterMode = process.env.INBOUND_FILTER_MODE || 'all';
const inboundAllowlist = new Set(
  (process.env.INBOUND_ALLOWLIST || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => [value, normalizeWhatsAppNumber(value)]),
);

fs.mkdirSync(dataPath, { recursive: true });

function now() {
  return new Date().toISOString();
}

function appendLogLine(line) {
  fs.appendFileSync(logFile, `${line}\n`, 'utf8');
}

function normalizeWhatsAppNumber(value) {
  return (value || '').replace(/@c\.us$/, '');
}

function formatMessage(message) {
  const timestamp = now();
  const chatName = message._data.notifyName || message.from || 'Unknown chat';
  const body = (message.body || '').replace(/\s+/g, ' ').trim() || `[non-text ${message.type}]`;
  const from = message.from || '';
  const fromNumber = normalizeWhatsAppNumber(from);
  return {
    timestamp,
    chatName,
    body,
    line: `[${timestamp}] ${chatName}: ${body}`,
    from,
    fromNumber,
    to: message.to || '',
    type: message.type || 'unknown',
    hasMedia: Boolean(message.hasMedia),
    messageId: message.id?._serialized || message.id?.id || '',
    service: 'WhatsWatch',
  };
}

function shouldForwardMessage(details) {
  if (!details || !details.from || details.fromMe) {
    return false;
  }

  if (inboundFilterMode === 'all') {
    return true;
  }

  if (inboundFilterMode !== 'allowlist') {
    console.error(`[${now()}] unsupported INBOUND_FILTER_MODE: ${inboundFilterMode}`);
    return false;
  }

  return inboundAllowlist.has(details.from) || inboundAllowlist.has(details.fromNumber);
}

async function sendWebhook(payload) {
  if (!webhookUrl) {
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  if (webhookToken) {
    headers.Authorization = `Bearer ${webhookToken}`;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(webhookTimeoutMs),
    });

    if (!response.ok) {
      console.error(`[${now()}] webhook failed: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error(`[${now()}] webhook request failed: ${error.message}`);
  }
}

function runNotify(line) {
  if (!notifyCommand) {
    return;
  }

  const args = notifyArgs.map((arg) => arg === '{message}' ? line : arg);
  execFile(notifyCommand, args, (error) => {
    if (error) {
      console.error(`[${now()}] notify failed: ${error.message}`);
    }
  });
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath }),
  puppeteer: {
    headless,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log(`[${now()}] Scan this QR code with WhatsApp:`);
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log(`[${now()}] Authenticated`);
});

client.on('ready', () => {
  console.log(`[${now()}] Client is ready`);
});

client.on('auth_failure', (message) => {
  console.error(`[${now()}] Authentication failed: ${message}`);
});

client.on('disconnected', (reason) => {
  console.error(`[${now()}] Disconnected: ${reason}`);
});

client.on('message', async (message) => {
  if (message.fromMe) {
    return;
  }

  const details = {
    ...formatMessage(message),
    fromMe: Boolean(message.fromMe),
  };

  console.log(details.line);
  appendLogLine(details.line);
  runNotify(details.line);

  if (!shouldForwardMessage(details)) {
    return;
  }

  await sendWebhook(details);
});

client.initialize().catch((error) => {
  console.error(`[${now()}] Initialization failed: ${error.message}`);
  process.exitCode = 1;
});
