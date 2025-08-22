# HelpMe Slack Bot — Setup & Operations Guide

This guide enables a new maintainer to set up, run, verify, and operate the bot end‑to‑end. It is grounded in the current codebase (`src/`) and mirrors real config names and flows.

---

## 1) Prerequisites

- Slack App admin access to your workspace.
- Node.js 18+ and npm.
- Outbound network access to Slack and the HelpMe backend.
- Optional: a public URL (only required if you run in HTTP Events mode).

---

## 2) Create the Slack App (manifest-first)

1. Open Slack API → Create App → From manifest → paste the `manifest.json` from this repo.
2. Install the app to your workspace.
3. Confirm slash commands and scopes were created by the manifest.

Scopes (from `manifest.json`):
- Bot: `commands`, `chat:write`, `files:read`, `files:write`, `channels:history`, `groups:history`, `im:history`, `mpim:history`
- User: `files:read`

Slash commands created by the manifest:
- `/link`, `/ask`, `/courses`, `/unlink`, `/about-me`, `/default-course`, `/chatbot-history`, `/chatbot-settings`, `/chatbot-models`, `/upload-file`, `/chatbot-thread`

---

## 3) Configure environment (.env)

Create a `.env` at the repo root. Minimal dev template:

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token # required for SOCKET mode

# HelpMe + Chatbot API
HELPME_BASE_URL=http://localhost:3000
CHATBOT_API_URL=http://localhost:3003/chat
CHATBOT_API_KEY=your-chatbot-api-key

# App URLs
APP_BASE_URL=http://localhost:3109

# Delivery
DELIVERY_MODE=SOCKET   # SOCKET (default) or HTTP
PORT=3109

# Database & logging
DATABASE_PATH=./data/data.db
LOG_LEVEL=info

# Optional
DEFAULT_ORG_ID=
LINK_SHARED_SECRET=dev-link-secret
```

Notes:
- Use `SLACK_APP_TOKEN` only in `SOCKET` mode; HTTP mode does not need it.
- The bot checks `HELPME_BASE_URL` during OAuth exchange; align with your HelpMe deployment.
- `LINK_SHARED_SECRET` protects the server‑to‑server linking endpoint `POST /link/callback`.

---

## 4) Run the bot (development)

```bash
npm install
mkdir -p data
npm run dev
```

Verify health:
```bash
curl http://localhost:3109/healthz
# { ok: true }
```

Link your account in Slack:
- Run `/link` and complete the HelpMe authorization.


---

## 5) Commands quick test

- `/about-me` → shows your HelpMe profile; if not linked, it prompts to `/link`.
- `/courses` → shows enrolled courses (cached locally after linking).
- `/default-course 304` → sets your default course.
- `/ask When is the midterm?` → uses default course.
- `/ask Explain Dijkstra --course=COSC304` → overrides course.
- `/chatbot-thread <question>` → run inside a thread; uses recent non‑bot messages as history.
- `/upload-file <question>` → opens a modal; fallback chat instructions if modal fails.
- `/chatbot-settings [course]` and `/chatbot-models` → visibility into configuration.
- `/chatbot-history` → recent interactions summary.

---

## 6) HTTP Events mode (optional)

If you prefer Events API over Socket Mode:

1. Set `DELIVERY_MODE=HTTP` and ensure `${APP_BASE_URL}/slack/events` is publicly reachable.
2. In Slack App settings → Event Subscriptions → enable and set the Request URL to `${APP_BASE_URL}/slack/events`.
3. Keep `SLACK_SIGNING_SECRET` up‑to‑date and verify the URL passes Slack’s challenge.
4. Keep the health and OAuth callback endpoints reachable: `${APP_BASE_URL}/healthz` and `${APP_BASE_URL}/link/callback`.

---

## 7) How linking works (what to expect)

1. `/link` creates a short‑lived `state` (stored in SQLite) and returns a HelpMe authorization URL.
2. User authorizes in HelpMe, which redirects to `GET /link/callback?state&code`.
3. The bot exchanges `code` with HelpMe and stores your HelpMe identity and per‑user chat token.
4. If courses are included in the response, they are cached locally.

Troubleshooting:
- “Invalid or expired state” → run `/link` again; states are one‑time and time‑limited.
- “Not linked” errors on commands → complete `/link` first.

---

## 8) Data & persistence

SQLite location: `DATABASE_PATH` (default `./data/data.db`).

Entities (`src/db/entities.ts`):
- `UserLinkEntity`, `LinkStateEntity`, `UserCoursesEntity`, `UserPrefsEntity`, `ChatbotInteractionEntity`, `ChatbotQuestionEntity`.

Helpers (`src/db/index.ts`):
- Linking (`saveUserLink`, `getUserLinkInfo`, etc.), OAuth state (`createLinkState`, `consumeLinkState`), courses cache, user prefs, interactions/questions CRUD.

Backups & migrations:
- Back up the DB file with the process stopped or use SQLite online backup.
- TypeORM `synchronize: true` is enabled here for convenience; for production, consider explicit migrations.

---

## 9) Observability & operations

- Health: `GET /healthz`.
- Logging: pino; set `LOG_LEVEL=debug` when troubleshooting.
- Rate limits: messages chunked and retried (see `src/lib/slack.ts`).
- Graceful shutdown: the app closes Socket Mode cleanly to avoid reconnect storms.

---

## 10) Security

- OAuth state entries are short‑lived and one‑time.
- Slack signing secret is enforced by Bolt.
- Chat tokens are stored locally; protect `DATABASE_PATH`.
- Use HTTPS and secure all environment secrets.

---

## 11) Advanced tips

- File analysis: `/upload-file` uses a modal; if the modal cannot open, the bot posts chat instructions. Supported mimetypes: PNG, JPEG/JPG, GIF, PDF.
- Threaded chat: `/chatbot-thread` uses up to the last 10 relevant messages as context to keep prompts efficient.
- Performance: For high usage, consider Postgres and move heavy operations to workers.

---

## 12) Complete test plan (manual)

- Link flow: `/link` → authorize → success page → `/about-me` shows profile.
- Courses: `/courses` lists; set default with `/default-course`.
- Q&A: `/ask` with and without `--course`; verify sources if returned.
- Threaded: `/chatbot-thread` inside a thread; confirm context improves answers.
- Files: `/upload-file` modal success + chat fallback path.
- Settings/models: `/chatbot-settings`, `/chatbot-models` return data.
- History: `/chatbot-history` shows recent interactions.
- Health: `GET /healthz` responds.

---

## 13) Troubleshooting

Common issues:
- Missing `APP_BASE_URL` (HTTP mode): set it and re‑deploy.
- “User not linked”: complete `/link`.
- “No chat token”: run `/link` again to refresh.
- OAuth callback fails: verify Slack redirect URL and that your `APP_BASE_URL` is correct and public (HTTP mode).

Logs:
- Set `LOG_LEVEL=debug` to increase verbosity during debugging.

---

You should now have everything needed to set up, run, and extend the HelpMe Slack bot.

---

## .env.sample

```bash
# --- Slack (from api.slack.com/apps) ---
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
# Required only for SOCKET mode
SLACK_APP_TOKEN=xapp-your-app-token

# --- Delivery mode ---
# SOCKET (dev) or HTTP (Events API)
DELIVERY_MODE=SOCKET
PORT=3109
# Helps avoid socket reconnect race during startup in dev
SOCKET_START_DELAY_MS=800

# --- App URLs ---
# Public base used for OAuth callback and, in HTTP mode, Events endpoint
APP_BASE_URL=http://localhost:3109
# Optional alias some setups use; code prefers APP_BASE_URL
PUBLIC_BASE_URL=http://localhost:3109

# --- HelpMe base ---
# Primary variable used by the app during OAuth exchange
HELPME_BASE_URL=http://localhost:3000
# Compatibility alias also checked by the app
HELP_ME_BASE_URL=http://localhost:3000
# Optional path hint (not used unless you adapt link.ts)
HELP_ME_SLACK_START_PATH=/api/v1/auth/slack/start

# --- Chatbot API ---
CHATBOT_API_URL=http://localhost:3003/chat
# Sent as HMS-API-KEY header by the app
CHATBOT_API_KEY=your-chatbot-api-key
# Legacy/alt key sometimes present; prefer CHATBOT_API_KEY
HELPME_CHATBOT_API_KEY=

# --- Integration/feature toggles (optional) ---
# Project-specific flag not consumed by current code paths
MODE=optionB
# Legacy local storage key (not used by current code); generate with: npm run keygen
ENCRYPTION_KEY=
# Some older flows used this to enforce linking; commands already enforce it
REQUIRE_LINKING=true

# --- Database & logging ---
DATABASE_PATH=./data/data.db
NODE_ENV=development
LOG_LEVEL=debug  # debug|info|warn|error

# --- Security ---
# Protects POST /link/callback for server-to-server linking
LINK_SHARED_SECRET=dev-link-secret

# --- Optional org hint for linking ---
DEFAULT_ORG_ID=
# HELPME_ORG_ID=

# --- Optional: HelpMe REST base (not directly used by code) ---
HELPME_API_BASE_URL=http://localhost:3000/api/v1
```

Notes:
- The app prefers `HELPME_BASE_URL` but will also check `HELP_ME_BASE_URL`.
- Use `APP_BASE_URL`; `PUBLIC_BASE_URL` is included for compatibility with older configs.
- `CHATBOT_API_KEY` is the active key; `HELPME_CHATBOT_API_KEY` is optional/legacy.
- `HELP_ME_SLACK_START_PATH` is provided only if you customize the path in `src/commands/link.ts`.
