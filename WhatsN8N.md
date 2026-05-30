# WhatsWatch to n8n Integration Plan

## Goal

Forward inbound WhatsApp messages from `WhatsWatch` to an n8n webhook as a one-way delivery flow.

The integration must support two modes:

1. Forward all inbound messages.
2. Forward only messages from one specific number, with room to expand to multiple numbers later.

## Current State

- App entrypoint: `/srv/apps/source/WhatsWatch/watcher.js`
- Service unit: `/home/fayaalink/.config/systemd/user/WhatsWatch.service`
- Incoming messages are already handled in `client.on('message', ...)`
- Current behavior:
  - ignore messages from self
  - format a log line
  - write to `messages.log`
  - optionally run `NOTIFY_COMMAND`
- n8n is available behind Caddy at `https://n8n.fayaa92.sa`
- Webhook routes are proxied through:
  - `/webhook/*`
  - `/webhook-test/*`

## Recommended Design

Add native webhook delivery inside `watcher.js` using Node's built-in `fetch`.

Reasoning:

- smallest code change
- no new npm dependencies
- avoids shell quoting issues from `curl`
- easier logging and error handling
- keeps service behavior self-contained

## Configuration

Add these environment variables to the user systemd unit.

Required:

- `N8N_WEBHOOK_URL`
  - Example: `https://n8n.fayaa92.sa/webhook/whatswatch-inbound`

Optional:

- `N8N_WEBHOOK_TOKEN`
  - Shared bearer token sent in the `Authorization` header
- `N8N_WEBHOOK_TIMEOUT_MS`
  - Default: `10000`
- `INBOUND_FILTER_MODE`
  - Allowed values: `all`, `allowlist`
  - Default: `all`
- `INBOUND_ALLOWLIST`
  - Comma-separated WhatsApp sender IDs or phone numbers
  - Examples:
    - `9665XXXXXXXX@c.us`
    - `9665XXXXXXXX`
    - `9665XXXXXXXX,9665YYYYYYYY`

## Filtering Rules

### Mode: `all`

Forward every inbound message except messages sent by this account.

### Mode: `allowlist`

Forward only if the sender matches one of the allowed values.

Matching should support both:

- raw WhatsApp IDs like `9665XXXXXXXX@c.us`
- normalized phone numbers like `9665XXXXXXXX`

Recommended normalization logic:

1. Read `message.from`
2. Strip the `@c.us` suffix for direct chats when building a comparable phone value
3. Compare both the full WhatsApp ID and normalized number against the allowlist

This keeps config simple for you while still matching WhatsApp's internal sender format.

## Payload Shape

Send structured JSON to n8n instead of a single text line.

Recommended payload:

```json
{
  "timestamp": "2026-05-30T03:19:52.648Z",
  "chatName": "AlFayaa",
  "body": "hello",
  "line": "[2026-05-30T03:19:52.648Z] AlFayaa: hello",
  "from": "9665XXXXXXXX@c.us",
  "fromNumber": "9665XXXXXXXX",
  "to": "9665ZZZZZZZZ@c.us",
  "type": "chat",
  "hasMedia": false,
  "messageId": "optional-whatsapp-message-id",
  "service": "WhatsWatch"
}
```

Minimum useful fields:

- `timestamp`
- `chatName`
- `body`
- `from`
- `fromNumber`
- `type`
- `line`

## HTTP Request Behavior

### Method

- `POST`

### Headers

- `Content-Type: application/json`
- `Authorization: Bearer <token>` only if `N8N_WEBHOOK_TOKEN` is set

### Timeout

- default 10 seconds

### Failure handling

- webhook errors must not crash `WhatsWatch`
- log non-2xx responses to journald
- log fetch/network failures to journald
- do not retry in the first version

Reason to avoid retries initially:

- simpler behavior
- avoids duplicate deliveries
- easier to observe first

If reliability becomes important later, retries can be added with an idempotency key.

## Code Changes

Update `watcher.js` in these areas.

### 1. Read webhook config from environment

Add env parsing near the top of the file for:

- `N8N_WEBHOOK_URL`
- `N8N_WEBHOOK_TOKEN`
- `N8N_WEBHOOK_TIMEOUT_MS`
- `INBOUND_FILTER_MODE`
- `INBOUND_ALLOWLIST`

### 2. Extend message formatting

Update `formatMessage(message)` to return structured fields needed by the webhook payload, not just `chatName`, `body`, and `line`.

Suggested additional derived field:

- `fromNumber`

### 3. Add sender filter helper

Add a helper like `shouldForwardMessage(messageDetails)` that:

- always ignores `fromMe`
- returns `true` for `INBOUND_FILTER_MODE=all`
- checks allowlist matches for `INBOUND_FILTER_MODE=allowlist`

### 4. Add webhook sender helper

Add a helper like `sendWebhook(payload)` that:

- returns early if `N8N_WEBHOOK_URL` is empty
- uses `fetch`
- uses `AbortSignal.timeout(...)`
- logs failures without throwing uncaught errors

### 5. Update message event flow

Current flow:

1. ignore self messages
2. build line
3. log to console
4. append to file
5. run notify command

Recommended new flow:

1. ignore self messages
2. build structured message details
3. log to console
4. append to file
5. run notify command
6. evaluate filter
7. if allowed and webhook configured, send webhook

This preserves existing behavior and adds webhook delivery as an extra action.

## Suggested Implementation Sketch

This is not final code, but the planned structure:

```js
const webhookUrl = process.env.N8N_WEBHOOK_URL || '';
const webhookToken = process.env.N8N_WEBHOOK_TOKEN || '';
const webhookTimeoutMs = Number(process.env.N8N_WEBHOOK_TIMEOUT_MS || 10000);
const inboundFilterMode = process.env.INBOUND_FILTER_MODE || 'all';
const inboundAllowlist = (process.env.INBOUND_ALLOWLIST || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function normalizeWhatsAppNumber(value) {
  return value.replace(/@c\.us$/, '');
}

function shouldForwardMessage(details) {
  if (inboundFilterMode === 'all') {
    return true;
  }

  if (inboundFilterMode !== 'allowlist') {
    return false;
  }

  return inboundAllowlist.some((allowed) => {
    return allowed === details.from || allowed === details.fromNumber;
  });
}

async function sendWebhook(payload) {
  if (!webhookUrl) {
    return;
  }

  const headers = { 'Content-Type': 'application/json' };

  if (webhookToken) {
    headers.Authorization = `Bearer ${webhookToken}`;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(webhookTimeoutMs),
  });

  if (!response.ok) {
    console.error(`webhook failed: ${response.status} ${response.statusText}`);
  }
}
```

## Systemd Changes

Update `/home/fayaalink/.config/systemd/user/WhatsWatch.service` to include webhook-related environment variables.

Example:

```ini
Environment=N8N_WEBHOOK_URL=https://n8n.fayaa92.sa/webhook/whatswatch-inbound
Environment=N8N_WEBHOOK_TOKEN=replace-with-shared-secret
Environment=N8N_WEBHOOK_TIMEOUT_MS=10000
Environment=INBOUND_FILTER_MODE=allowlist
Environment=INBOUND_ALLOWLIST=9665XXXXXXXX
```

After editing:

```bash
systemctl --user daemon-reload
systemctl --user restart WhatsWatch.service
systemctl --user status WhatsWatch.service
```

## n8n Workflow Plan

Create an n8n workflow with these steps.

### 1. Webhook node

- Method: `POST`
- Path: `whatswatch-inbound`

Resulting public URL:

```text
https://n8n.fayaa92.sa/webhook/whatswatch-inbound
```

### 2. Auth validation

Use one of these options:

1. Recommended: validate `Authorization` bearer token in workflow logic.
2. Alternative: use n8n's built-in auth features if already preferred in your setup.

### 3. Payload processing

Expected data:

- sender number
- message body
- chat name
- timestamp

### 4. Downstream actions

Possible actions:

- save to Google Sheets
- send to Telegram or Slack
- trigger an AI summarization workflow
- store in Postgres
- trigger email or notification logic

## Validation Plan

### App validation

1. Run syntax check:

```bash
npm run check
```

2. Restart service:

```bash
systemctl --user restart WhatsWatch.service
```

3. Watch logs:

```bash
journalctl --user -u WhatsWatch.service -f
```

### Delivery validation

Test case 1: `INBOUND_FILTER_MODE=all`

- send a WhatsApp message from any external number
- confirm it reaches the n8n webhook

Test case 2: `INBOUND_FILTER_MODE=allowlist`

- set `INBOUND_ALLOWLIST` to a test number
- send from allowed number and verify delivery
- send from a non-allowed number and verify no delivery

### Failure validation

1. Use an invalid webhook URL
2. Confirm service stays running
3. Confirm error is logged to journald
4. Confirm later valid messages still process normally

## Rollout Plan

1. Add code changes in `watcher.js`
2. Run `npm run check`
3. Update user unit environment variables
4. Reload and restart the user service
5. Create and enable the n8n webhook workflow
6. Test with `INBOUND_FILTER_MODE=all`
7. Switch to `allowlist` if you want restricted delivery

## Security Notes

- Do not leave the webhook unauthenticated if it triggers meaningful automation.
- Keep the token in the user unit or move it to an env file with restricted permissions later.
- Do not print secret values in logs.

## Future Extensions

Not part of the first version, but easy later:

- multiple allowlisted numbers
- per-chat routing
- media message metadata
- retry queue for temporary webhook failures
- deduplication using WhatsApp message IDs
- reply path from n8n back into WhatsApp

## Recommended First Version

Use this exact first-version behavior:

- one-way only
- native `fetch`
- `INBOUND_FILTER_MODE=all` or `allowlist`
- `INBOUND_ALLOWLIST` as comma-separated values
- bearer token auth
- no retry logic
- preserve current log file and notify-command behavior

This gives the smallest safe implementation with a clear path to expand later.
