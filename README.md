# WhatsWatch

Persistent WhatsApp Web watcher for Linux servers.

`WhatsWatch` runs a `whatsapp-web.js` client, prints a QR code on first login, logs inbound messages, and can forward inbound message payloads to a webhook such as n8n.

## Features

- Persistent local auth with `LocalAuth`
- QR-based WhatsApp Web login
- Inbound message logging to stdout and `messages.log`
- Optional webhook forwarding for inbound messages
- Optional allowlist-based sender filtering
- Optional local notification command execution
- Example systemd user service included

## Requirements

- Linux server or desktop
- Node.js 18+
- npm
- A Chromium environment supported by `whatsapp-web.js`

## Install

```bash
npm install
cp .env.example .env
```

Update `.env` with your own values.

## Run

```bash
npm start
```

On first run, scan the printed QR code with WhatsApp.

Auth session data is stored in `.wwebjs_auth/` by default.

## Environment Variables

Application config is read from environment variables.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `N8N_WEBHOOK_URL` | No | empty | Webhook URL for inbound message forwarding |
| `N8N_WEBHOOK_TOKEN` | No | empty | Bearer token sent as `Authorization` |
| `N8N_WEBHOOK_TIMEOUT_MS` | No | `10000` | Webhook request timeout |
| `INBOUND_FILTER_MODE` | No | `all` | `all` or `allowlist` |
| `INBOUND_ALLOWLIST` | No | empty | Comma-separated WhatsApp IDs or phone numbers |
| `HEADLESS` | No | `true` | Set to `false` to show the browser |
| `WWEBJS_DATA_PATH` | No | `.wwebjs_auth` | Session storage path |
| `LOG_FILE` | No | `messages.log` | Log file path |
| `NOTIFY_COMMAND` | No | empty | Local command to run on inbound message |
| `NOTIFY_ARGS` | No | `[]` | JSON array of args for `NOTIFY_COMMAND`; use `{message}` placeholder |
| `PUPPETEER_EXECUTABLE_PATH` | No | auto | Custom browser executable path |

## Webhook Payload

When webhook forwarding is enabled, `WhatsWatch` sends JSON like this:

```json
{
  "timestamp": "2026-05-30T03:19:52.648Z",
  "chatName": "Example Chat",
  "body": "hello",
  "line": "[2026-05-30T03:19:52.648Z] Example Chat: hello",
  "from": "9665XXXXXXXX@c.us",
  "fromNumber": "9665XXXXXXXX",
  "to": "9665ZZZZZZZZ@c.us",
  "type": "chat",
  "hasMedia": false,
  "messageId": "optional-whatsapp-message-id",
  "service": "WhatsWatch"
}
```

## Filtering

`INBOUND_FILTER_MODE=all` forwards every inbound message.

`INBOUND_FILTER_MODE=allowlist` forwards only messages whose sender matches a value in `INBOUND_ALLOWLIST`.

Allowlist values can be either:

- full WhatsApp IDs like `9665XXXXXXXX@c.us`
- normalized phone numbers like `9665XXXXXXXX`

## Systemd

An example user service file is included at `WhatsWatch.service.example`.

Typical setup:

```bash
mkdir -p ~/.config/systemd/user
cp WhatsWatch.service.example ~/.config/systemd/user/WhatsWatch.service
systemctl --user daemon-reload
systemctl --user enable --now WhatsWatch.service
```

The example service expects:

- the project directory to stay at its configured `WorkingDirectory`
- environment values to live in `.env`

If you place the project elsewhere, update the paths in the service file.

## Useful Commands

```bash
npm run check
journalctl --user -u WhatsWatch.service -f
systemctl --user restart WhatsWatch.service
```

## Local-Only Files

These should not be committed:

- `.env`
- `node_modules/`
- `.wwebjs_auth/`
- `.wwebjs_cache/`
- `messages.log`

They are already covered by `.gitignore`.

## Repo Files

- `watcher.js`: main application
- `.env.example`: example environment file
- `WhatsWatch.service.example`: example systemd user service
- `WhatsN8N.md`: integration notes for n8n webhook usage
- `cheatcode.md`: local service operation shortcuts

## License

No license file is included yet.
