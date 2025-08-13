# HelpMe Slack Bot

Slack app to ask the university ChatBot from Slack.

**Flow:** Slack → Bot → ChatBot `/chat/chatbot/:courseId/ask`  
Per-user quotas enforced by `HMS_API_TOKEN` (stored encrypted after `/link`).

## 1) Setup

1. Create Slack app **from `manifest.json`** and install to your workspace.
2. Copy `.env.example` to `.env` and fill values (generate `ENCRYPTION_KEY` via `npm run keygen`).
3. Install & run:
   ```bash
   npm install
   mkdir -p data
   npm run dev
   ```

## 2) Commands

* `/link` – shows linking URL (your HelpMe page must POST to `/link/callback` with `X-HelpMe-Link-Secret`).
* `/ask [--course=ID] <question>` – bot posts the answer (auto-chunked, rate-limit safe).

## 3) Simulate linking (dev)

```bash
curl -X POST http://localhost:3109/link/callback \
  -H 'Content-Type: application/json' \
  -H 'X-HelpMe-Link-Secret: dev-link-secret' \
  -d '{"teamId":"T_DEV","userId":"U_DEV","helpmeUserToken":"HMS_API_TOKEN_FOR_TEST"}'
```

## 4) Manual test plan

* Happy path: `/link` → simulate callback → `/ask what is the assignment 2 deadline?`
* Quota: use low-limit token → hit 429 → bot shows reset info.
* Unlinked: delete row from DB → `/ask` prompts to link.
* Health: `GET /healthz` → `{ ok: true }`.

## 5) Switch to HTTP (later)

Set `DELIVERY_MODE=HTTP` and expose `POST /slack/events` at `${PUBLIC_BASE_URL}/slack/events`.