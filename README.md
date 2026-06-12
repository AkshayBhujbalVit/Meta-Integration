# Vidushi Infotech — AI Calling Platform

## Prerequisites
- Python 3.10+
- Node.js 18+
- PostgreSQL running on port 5432

---

## Run the Project (3 Terminals)

### Terminal 1 — Backend (FastAPI)

```powershell
cd Main_Project_Livekit_Gemini\backend

.\venv\Scripts\activate

uvicorn main:app --host 0.0.0.0 --port 8009 --reload
```

Runs at: `http://localhost:8009`

---

### Terminal 2 — AI Voice Agent (LiveKit)

```powershell
cd Main_Project_Livekit_Gemini\backend

.\venv\Scripts\activate

python agent.py dev
```

---

### Terminal 3 — Frontend (Next.js)

```powershell
cd Main_Project_Livekit_Gemini\frontend

npm run dev
```

Runs at: `http://localhost:3000`

---

## First-Time Setup (run once)

If the database is empty or admin login fails, run this from the backend folder:

```powershell
cd Main_Project_Livekit_Gemini\backend

.\venv\Scripts\activate

python init_db.py
```

This creates all tables and the default admin account.

To seed demo data (leads, calls, appointments):

```powershell
python seed_demo.py
```

---

## Start Order

1. Start **Terminal 1** (backend) — wait for `Uvicorn running on http://0.0.0.0:8009`
2. Start **Terminal 2** (agent) — wait for `registered worker`
3. Start **Terminal 3** (frontend) — wait for `Ready in Xms`
4. Open `http://localhost:3000` in browser

---

## Ports

| Service  | Port |
|----------|------|
| Backend  | 8009 |
| Frontend | 3000 |
| PostgreSQL | 5432 |
