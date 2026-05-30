# WhatsWatch Cheatcode

## Service management

```bash
systemctl --user daemon-reload
systemctl --user restart WhatsWatch.service
systemctl --user status WhatsWatch.service
```

## Useful commands

```bash
journalctl --user -u WhatsWatch.service -n 50 --no-pager
systemctl --user stop WhatsWatch.service
systemctl --user start WhatsWatch.service
```

## Current paths

```text
Project: /srv/apps/source/WhatsWatch
Unit: /home/fayaalink/.config/systemd/user/WhatsWatch.service
Auth data: /srv/apps/source/WhatsWatch/.wwebjs_auth
Log file: /srv/apps/source/WhatsWatch/messages.log
```
