# Milestone 9: Deploy to Hetzner

## OAuth auto-refresh (local, before deploy)
- [ ] Create `src/oauth-refresh.ts` — read/write `data/oauth.json`, refresh token on demand
- [ ] Update `src/auth.ts` — integrate oauth-refresh, make `getSecrets()` async, API key fallback
- [ ] Update callers (`cli.ts`, `index.ts`) for async `getSecrets()`
- [ ] Test locally: verify refresh works, verify fallback to keychain still works

## Systemd + deploy scripts (local)
- [ ] Create `kuchiclaw.service` systemd unit file
- [ ] Create `deploy/setup.sh` provisioning script

## Provision VPS
- [x] Create Hetzner CPX22 (Nuremberg), Ubuntu 24.04, SSH key, backups enabled
- [ ] SSH in, run `deploy/setup.sh`

## Configure
- [ ] Create `/opt/kuchiclaw/.env` with production secrets (chmod 600)
  - `TELEGRAM_BOT_TOKEN`
  - `FASTMAIL_API_TOKEN`
  - `MAIN_CHAT_ID` (e.g., `tg-402431039`)
  - `ALLOWED_SENDER_IDS`
- [ ] Export refresh token from Mac keychain → `data/oauth.json` on VPS
- [ ] Clone repo to `/opt/kuchiclaw`
- [ ] `npm install` + `docker build -t kuchiclaw-agent .`

## Deploy
- [ ] Install systemd service, enable and start
- [ ] Verify bot responds on Telegram
- [ ] Verify scheduled tasks fire on production
- [ ] Check logs: `journalctl -u kuchiclaw -f`

## Post-deploy
- [ ] Test reboot survival: `sudo reboot`, verify bot comes back
- [ ] Document deploy/update procedure in ARCHITECTURE.md

## Update procedure (future deploys)
```bash
cd /opt/kuchiclaw
git pull
npm install                        # if deps changed
docker build -t kuchiclaw-agent .  # if Dockerfile/container/ changed
sudo systemctl restart kuchiclaw
```
