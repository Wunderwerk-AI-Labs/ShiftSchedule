# Hetzner Deployment Notes

## Server access
- IP: 46.224.114.183
- SSH user: root
- Connect: `ssh root@46.224.114.183`

## Deployment variant used
IP-only setup (no domain, no HTTPS).
- Frontend: http://46.224.114.183
- Backend: http://46.224.114.183:8000
- Health: http://46.224.114.183:8000/health

Server `.env`:
```
APP_ORIGIN=http://46.224.114.183
VITE_API_URL=http://46.224.114.183:8000
```

## Server setup
- Docker installed via `curl -fsSL https://get.docker.com | sh`
- Project path: `/opt/shiftschedule`
- Upload via tarball to `/tmp/ShiftSchedule.tar.gz`, then:
  `tar -xzf /tmp/ShiftSchedule.tar.gz -C /opt/shiftschedule`

## Run commands
Start:
```
cd /opt/shiftschedule
docker compose -f docker-compose.ip.yml up -d --build
```

Stop:
```
cd /opt/shiftschedule
docker compose -f docker-compose.ip.yml down
```

## Repo files added for deployment
- `backend/Dockerfile`
- `Dockerfile.frontend`
- `nginx.conf`
- `docker-compose.yml` (domain + Caddy/HTTPS)
- `docker-compose.ip.yml` (IP-only)
- `Caddyfile`
- `.env.example`
- `.dockerignore`
- `DEPLOY.md`
