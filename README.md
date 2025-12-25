# ShiftSchedule

ShiftSchedule is a weekly clinician scheduling app with a React + Vite frontend and a FastAPI backend. It supports drag-and-drop scheduling, class qualification rules, vacations, and per-day slot overrides. A small OR-Tools solver can auto-fill required slots.

## Features
- Weekly schedule view with drag-and-drop within the same day
- Distribution pool, manual pool, and vacation pool
- Per-class minimum slots (weekday vs weekend) and per-day overrides
- Clinician qualifications and preferences
- Vacation tracking
- Auto-allocate day/week with a solver

## Tech Stack
- Frontend: React 18, TypeScript, Vite, Tailwind CSS
- Backend: FastAPI, OR-Tools, SQLite (single JSON state row)

## Local Development (Step-by-step)
Prereqs:
- Python 3.9+
- Node 18+

Auth setup (required for login):
```bash
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD=change-me
export JWT_SECRET=change-me-too
```
On first startup, the admin user is created if it doesn't already exist.
If the admin already exists, the password is not overwritten.

1) Install backend deps
```bash
python3 -m pip install -r backend/requirements.txt
```

2) Install frontend deps
```bash
npm install
```

3) Start backend (Terminal 1)
```bash
python3 -m uvicorn backend.main:app --host localhost --port 8000
```

4) Start frontend (Terminal 2)
```bash
npm run dev -- --host localhost --port 5173
```

5) Open the app
- http://localhost:5173

### If a port is already in use
Backend:
```bash
python3 -m uvicorn backend.main:app --host localhost --port 8001
VITE_API_URL=http://localhost:8001 npm run dev -- --host localhost --port 5173
```

Frontend:
```bash
npm run dev -- --host localhost --port 5175
```

### Troubleshooting
- Solver not responding:
  - Check backend health: `curl http://localhost:8000/health`
  - Ensure `VITE_API_URL` matches the backend host/port.
  - For non-localhost hosts (LAN/remote), set CORS explicitly:
```bash
CORS_ALLOW_ORIGINS=http://my-host:5173 python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## Deployment Notes
- Build frontend with `VITE_API_URL=https://your-api.example.com npm run build`, then serve `dist/`.
- Run the backend behind a reverse proxy (or public host) and set `CORS_ALLOW_ORIGINS` to your frontend origin.

## Repository Notes
- `node_modules/`, `dist/`, and local databases are ignored via `.gitignore`.
