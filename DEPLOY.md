# Deployment (Hetzner + Docker)

This setup runs everything on one server using Docker Compose:
- `backend` (FastAPI)
- `frontend` (built static site served by Nginx)
- `caddy` (HTTPS + reverse proxy)

If you do not have a domain yet, use the IP-only setup in `docker-compose.ip.yml`.
It serves the frontend on port 80 and the backend on port 8000 without HTTPS.

## 1) Create the server
- Provider: Hetzner Cloud
- Recommended image: Ubuntu 22.04 LTS
- Size: any CX/SX is fine for a small demo
- Add your SSH key

## 2) DNS
Create an `A` record for a subdomain, pointing to the server IP.
Example:
```
schedule.example.com -> <SERVER_IP>
```

## 3) Install Docker on the server
```
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```
Log out and back in so the group change applies.

## 4) Upload the repo
Option A: git clone
```
git clone <YOUR_REPO_URL>
cd ShiftSchedule
```

Option B: scp/rsync the folder to the server.

## 5) Configure environment
Copy the example file and set your domain/email:
```
cp .env.example .env
```
Edit `.env`:
```
DOMAIN=schedule.example.com
LETSENCRYPT_EMAIL=admin@example.com
```

## 6) Run the stack
```
docker compose up -d --build
```

## IP-only setup (no domain, no HTTPS)
1) Copy the example file and set your server IP:
```
cp .env.example .env
```
Edit `.env` to include:
```
APP_ORIGIN=http://SERVER_IP
VITE_API_URL=http://SERVER_IP:8000
```
2) Start the IP-only stack:
```
docker compose -f docker-compose.ip.yml up -d --build
```
3) Open the app:
```
http://SERVER_IP
```

## 7) Verify
Open:
```
https://schedule.example.com
```
Health check:
```
https://schedule.example.com/api/health
```

## Notes
- App data is stored in the `backend_data` Docker volume.
- CORS is set to `https://$DOMAIN`.
- If you change the domain, update `.env` and re-run `docker compose up -d --build`.
