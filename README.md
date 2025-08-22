# HelpMe Slack Bot

AI-powered course assistance directly in Slack. Ask the HelpMe course chatbot, browse your courses, view settings/models, upload files for AI analysis, and chat in threads — all from slash commands.

**High-level flow:** Slack → Bot → HelpMe Chatbot API → AI Response

---

## Table of Contents

- [Highlights](#highlights)
- [Quick Start](#quick-start)
- [Commands and Usage](#commands-and-usage)
- [Commands Deep Dive](#commands-deep-dive)
- [Linking Flow](#linking-flow)
- [Architecture](#architecture)
- [Data Model (SQLite)](#data-model-sqlite)
- [Chatbot API Contract](#chatbot-api-contract)
- [Configuration Reference](#configuration-reference)
- [Operational Notes](#operational-notes)
- [Testing & Verification](#testing--verification)
- [Project Structure](#project-structure)
- [Source Reference (src/)](#source-reference-src)
- [Demo GIFs](#demo-gifs)
- [Security](#security)
- [Deployment](#deployment)
- [Observability](#observability)
- [Privacy & Data Retention](#privacy--data-retention)
- [Known Limitations](#known-limitations)
- [FAQ](#faq)
- [Contributing & Dev Workflow](#contributing--dev-workflow)

---

## Highlights

- 🔗 Account linking with short-lived OAuth state and secure callbacks
- 🤖 AI Q&A via `/ask` with default and per-message course selection
- 🧵 Threaded conversations with contextual history (`/chatbot-thread`)
- 📁 File analysis (images/PDF) via `/upload-file` with graceful chat fallback
- 📚 Courses and preferences: `/courses`, `/default-course`
- 👤 User profile: `/about-me`
- ⚙️ Chatbot settings and models: `/chatbot-settings`, `/chatbot-models`
- 🧱 Solid ops: health checks, graceful shutdown, chunked messages with backoff, SQLite persistence

Design note: The bot prioritizes a chat-first experience, avoiding modals unless they clearly improve UX (file selection) and always providing a chat fallback.

---

## Quick Start

### 1) Create the Slack app from the manifest
- In Slack’s API dashboard choose “Create from manifest,” paste `manifest.json` from this repo, and install the app.

The manifest includes:
- All slash commands
- Necessary bot/user scopes
- Socket Mode enabled (HTTP Events mode also supported)

### 2) Configure environment
Create `.env` at the repository root and set required values. Minimal example:

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...  # required for SOCKET mode

# HelpMe + Chatbot API
HELPME_BASE_URL=http://localhost:3000
CHATBOT_API_URL=http://localhost:3003/chat
CHATBOT_API_KEY=dev-api-key

# App URLs
APP_BASE_URL=http://localhost:3109

# Delivery mode: SOCKET (default) or HTTP
DELIVERY_MODE=SOCKET
PORT=3109

# DB & logging
DATABASE_PATH=./data/data.db
LOG_LEVEL=info

# Optional org and link hardening
DEFAULT_ORG_ID=
LINK_SHARED_SECRET=dev-link-secret
```

Notes:
- Use `SLACK_APP_TOKEN` only in `SOCKET` mode. In `HTTP` mode it’s not required.
- The code checks `HELPME_BASE_URL` (or `HELP_ME_BASE_URL`) during OAuth exchange.
- `LINK_SHARED_SECRET` protects `POST /link/callback` for simulated or server-side linking.

### 3) Run locally
```bash
npm install
mkdir -p data
npm run dev
```

Visit `GET /healthz` → `{ ok: true }`.

### 4) Production (optional)
```bash
npm run build
npm start
```

- Set `DELIVERY_MODE=HTTP` if you prefer Events API over Socket Mode and expose `POST /slack/events` at `${APP_BASE_URL}/slack/events`.
- Ensure HTTPS and correct public URLs for OAuth callback: `${APP_BASE_URL}/link/callback`.

For deeper setup details, see [SETUP.md](./SETUP.md).

---

## Commands and Usage

- `/link` — Start OAuth linking to HelpMe
  - Generates a short-lived state, sends an authorization URL, and handles callback at `GET /link/callback`.

- `/ask [--course=ID|Name|Code] <question>` — Ask the AI chatbot
  - Uses your default course if `--course` is omitted.
  - Course resolution supports exact name, partial name, or numeric ID.
  - Example: `/ask When is Assignment 2 due? --course=COSC304`

- `/chatbot-thread <question>` — Ask in the current thread with context
  - Collects recent thread replies (filters bot/command, keeps last 10) and sends them as history.

- `/upload-file <question>` — Upload and analyze a file with AI
  - Opens a modal for file selection; if not available, posts clear chat instructions.
  - Supported: PNG, JPEG/JPG, GIF, PDF.

- `/courses` — Show your enrolled courses (cached locally)

- `/default-course <ID|Name|Code>` — Set your default course used by `/ask` and others

- `/about-me` — Show your HelpMe profile (name, email) and courses

- `/chatbot-settings [course]` — View AI settings (model, temperature, etc.) for a course; falls back to default course

- `/chatbot-models` — List available AI models reported by the API

- `/chatbot-history` — Show recent interactions (limited to avoid Slack message size limits)

All responses are ephemeral unless noted. Long messages are chunked (~3500 chars) and posted with exponential backoff to respect Slack rate limits.

---

## Commands Deep Dive

This section details command syntax, behaviors, and notable edge cases.

- `/link`
  - Syntax: `/link`
  - Behavior: Creates a short-lived OAuth `state`, returns an authorization URL to HelpMe, and expects a callback to `/link/callback`.
  - Success: You’ll see a success page with next steps; DB stores your HelpMe identity and chat token, optionally courses.
  - Errors: If already linked, the bot replies ephemerally that you are linked. Invalid/expired `state` leads to a friendly error page.

- `/ask`
  - Syntax: `/ask [--course=ID|Name|Code] <question>`
  - Examples:
    - `/ask When is the midterm?`
    - `/ask What is Big-O? --course=COSC304`
  - Behavior: Resolves course (default or override), validates linking and token presence, calls Chatbot API, persists interaction + question, and formats answer with optional sources.
  - Errors: Unlinked → prompt to `/link`; no default course → ask to set with `/default-course` or pass `--course`; unknown course → lists available courses.

- `/chatbot-thread`
  - Syntax: `/chatbot-thread <question>` (run inside a thread)
  - Behavior: Fetches recent thread messages (filters bot/command), keeps the last 10 as history, calls Chatbot API, and posts the answer in the same thread.
  - Errors: Unlinked/default-course issues behave like `/ask`. If posting fails (permissions), falls back to an ephemeral reply.

- `/upload-file`
  - Syntax: `/upload-file <question>` (modal-driven; has chat fallback)
  - Behavior: Opens a modal to input a question and select a file. On submit, downloads the file via Slack Web API, sends multipart data to Chatbot API, and posts an ephemeral analysis.
  - Supported types: PNG, JPEG/JPG, GIF, PDF.
  - Fallback: If modal cannot open, the bot posts step-by-step chat instructions to upload and re-run.

- `/courses`
  - Syntax: `/courses`
  - Behavior: Shows locally cached courses and last fetched date.
  - Errors: If unlinked or no cache exists, the bot explains how to link or refresh.

- `/default-course`
  - Syntax: `/default-course <ID|Name|Code>`
  - Behavior: Resolves the course from your enrolled list (exact, partial, or numeric match) and saves it in preferences for future `/ask` calls.
  - Errors: If resolution fails, it lists available courses.

- `/about-me`
  - Syntax: `/about-me`
  - Behavior: Displays your HelpMe name, email, and cached courses; prompts to `/link` if not linked.

- `/chatbot-settings`
  - Syntax: `/chatbot-settings [course]`
  - Behavior: Resolves course (argument or default) and displays settings such as model name, temperature, topK, similarity threshold, and a prompt preview when available.
  - Errors: Unlinked/default-course issues behave as above; 404 → not enrolled or course not found.

- `/chatbot-models`
  - Syntax: `/chatbot-models`
  - Behavior: Lists available models returned by the Chatbot API.
  - Errors: Unlinked → prompt to `/link`; other errors are shown ephemerally.

- `/chatbot-history`
  - Syntax: `/chatbot-history`
  - Behavior: Lists recent interactions (limited for Slack size), including timestamps and truncated Q/A.

Permissions and scopes:
- All commands require the bot to be installed and have `commands` and `chat:write` scopes. File-related commands rely on `files:read` and `files:write`.

Response types:
- Commands primarily use ephemeral responses to avoid channel noise; threaded answers use `chat.postMessage` in the relevant thread when permitted.

Rate limits:
- Long outputs are chunked with backoff; command handlers avoid flooding by summarizing and truncating where appropriate.

---

## Quick Cheat Sheet

Common tasks and one-liners.

- Link account: `/link`
- See who you are: `/about-me`
- List courses: `/courses`
- Set default course: `/default-course 304` or `/default-course "Course Name"`
- Ask with default course: `/ask What’s the rubric?`
- Ask with override: `/ask What’s the rubric? --course=COSC304`
- Ask in a thread: reply with `/chatbot-thread How do I cite?`
- Upload a file to analyze: `/upload-file What’s in this PDF?`
- See settings: `/chatbot-settings` or `/chatbot-settings COSC304`
- See models: `/chatbot-models`
- History: `/chatbot-history`

## Linking Flow

1. User runs `/link` in Slack.
2. Bot creates an expiring `state` and crafts a HelpMe authorization URL.
3. HelpMe redirects to `${APP_BASE_URL}/link/callback?state=...&code=...`.
4. Bot exchanges the `code` with HelpMe and stores the HelpMe identity and per-user chat token.

Security specifics:
- `state` is persisted to SQLite and expires after a configurable TTL (default up to 10 minutes).
- In Socket Mode, the callback verifies and consumes `state` before exchanging the code.
- In HTTP mode, the callback exchanges the code immediately and shows a success/failure page.
- A signed `POST /link/callback` exists for server-to-server linking; it requires header `X-HelpMe-Link-Secret: ${LINK_SHARED_SECRET}` and body `{ teamId, userId, helpmeUserToken }`.

Dev simulation of server-to-server linking (for visualisation):
```bash
curl -X POST http://localhost:3109/link/callback \
  -H 'Content-Type: application/json' \
  -H 'X-HelpMe-Link-Secret: dev-link-secret' \
  -d '{"teamId":"T_DEV","userId":"U_DEV","helpmeUserToken":"HMS_API_TOKEN_FOR_TEST"}'
```

### Sequence diagram

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant S as Slack
  participant B as Bot (Bolt)
  participant H as HelpMe
  participant DB as SQLite (TypeORM)

  U->>S: /link
  S->>B: Slash command payload
  B->>DB: Create OAuth state (TTL)
  B-->>U: Ephemeral auth URL
  U->>H: Authorize with HelpMe
  H->>B: GET /link/callback?state&code
  B->>DB: Consume/verify state
  B->>H: POST /api/v1/auth/slack/exchange { code }
  H-->>B: { user, email, chatToken, courses? }
  B->>DB: saveUserLink (+courses)
  B-->>U: Success page; use /ask, /courses
```

---

## Architecture

- Slack Bolt app bootstrap: `src/app.ts`
  - Socket Mode or HTTP Events receiver
  - Registers all slash commands
  - `GET /healthz`, `GET /link/callback`, `POST /link/callback`

- Domain service: `src/services/chatbot.service.ts`
  - Authenticated client to Chatbot
  - Standard headers, timeouts, and error handling
  - Persists interactions/questions via DB layer

- Persistence (SQLite via TypeORM)
  - Entities: `src/db/entities.ts`
  - Helpers: `src/db/index.ts` (init, CRUD for links, courses, prefs, interactions/questions)

- Slack utilities: `src/lib/slack.ts`
  - `safePostMessage` with message chunking and retry/backoff

Data flow for `/ask`:
```
Slack command → resolve course (default/override) → fetch user token →
ChatbotService.askQuestion(question, history, token, courseId) →
persist interaction + question → format answer (+sources) → ephemeral response
```


---

## Data Model (SQLite)

- `UserLinkEntity` — Slack user ↔ HelpMe identity and chat token
- `LinkStateEntity` — transient OAuth `state` entries (TTL enforced by app logic)
- `UserCoursesEntity` — cached enrolled courses per user
- `UserPrefsEntity` — default course per user
- `ChatbotInteractionEntity` — interaction record (per user, per course)
- `ChatbotQuestionEntity` — question + stored response, metadata, optional user score

All schemas are defined in `src/db/entities.ts`. Initialization happens in `ensureDb` (`src/db/index.ts`).

---

## Chatbot API Contract

Base URL: `${CHATBOT_API_URL}` (default `http://localhost:3003/chat`)

Standard headers:
- `HMS-API-KEY: ${CHATBOT_API_KEY}`
- `HMS_API_TOKEN: <per-user token from linking>`

---

## Configuration Reference

- `SLACK_BOT_TOKEN` — Bot token (required)
- `SLACK_SIGNING_SECRET` — Verifies request signatures (required)
- `SLACK_APP_TOKEN` — Socket Mode app token (SOCKET mode only)
- `APP_BASE_URL` — Public app URL for callbacks and Events API
- `DELIVERY_MODE` — `SOCKET` (default) or `HTTP`
- `PORT` — Port for aux server (and HTTP receiver when in HTTP mode)
- `DATABASE_PATH` — SQLite path (default `./data/data.db`)
- `LOG_LEVEL` — `debug`, `info`, `warn`, `error`
- `HELPME_BASE_URL` (or `HELP_ME_BASE_URL`) — HelpMe base used during OAuth exchange
- `LINK_SHARED_SECRET` — Required by `POST /link/callback`
- `CHATBOT_API_URL` — Chatbot API base (default `http://localhost:3003/chat`)
- `CHATBOT_API_KEY` — Shared API key sent as `HMS-API-KEY`

Scopes (from `manifest.json`):
- Bot: `commands`, `chat:write`, `files:read`, `files:write`, `channels:history`, `groups:history`, `im:history`, `mpim:history`
- User: `files:read`

---

## Operational Notes

- Health check: `GET /healthz` → `{ ok: true }`
- Graceful shutdown: SIGINT/SIGTERM handlers close Socket Mode cleanly
- Rate limits: messages chunked at ~3500 chars with exponential backoff
- Errors: user-facing errors are concise; server logs include context (pino)

---

## Testing & Verification

Manual checklist:
- `/link` → complete OAuth → `/about-me` shows your profile
- `/courses` lists your courses
- `/default-course 304` sets preference; `/ask What is the grading?` uses it
- `/ask ... --course=NAME/ID/CODE` overrides default
- `/chatbot-thread` uses thread history for context
- `/upload-file <question>` opens modal; fallback instructions appear if modal fails
- `/chatbot-settings` and `/chatbot-models` return data
- `/chatbot-history` shows recent interactions
- Health: `GET /healthz` → `{ ok: true }`

Enable debug logs during development:
```bash
LOG_LEVEL=debug npm run dev
```

---

## Project Structure

- `src/app.ts` — bootstrap, receivers, health + callbacks, command registration
- `src/commands/*` — each slash command
- `src/services/chatbot.service.ts` — Chatbot API client + persistence orchestration
- `src/db/*` — TypeORM entities and DB functions
- `src/lib/slack.ts` — Slack helpers (chunking + retry)

NPM scripts:
```bash
npm run dev     # development with nodemon (Socket Mode by default)
npm run build   # compile TypeScript
npm start       # run production build (not advised at the moment)
npm run lint    # lint (non-failing)
```

---

## Security

- OAuth state entries are short-lived and one-time consumable
- Slack request signing is enforced by Bolt
- Chat tokens are stored locally in SQLite; protect your `DATABASE_PATH`

For environment details and additional guidance, see [SETUP.md](./SETUP.md).

---

## Deployment

- Socket Mode (default):
  - Pros: No public ingress required; simpler local/dev.
  - Cons: Requires `SLACK_APP_TOKEN`; outbound connectivity to Slack required.

- HTTP Events mode (optional):
  - Set `DELIVERY_MODE=HTTP`, ensure `${APP_BASE_URL}/slack/events` is reachable by Slack.
  - Configure Event Subscriptions in Slack, verify with the signing secret.
  - Pros: Fits standard web infra; no app-level token.
  - Cons: Public endpoint, load balancer/retry considerations.


### Delivery mode nuances

- In SOCKET mode, the OAuth code exchange uses the HelpMe finish port adjustment in code. This avoids a race while HelpMe persists the temporary code.
- In HTTP mode, the exchange is direct against the configured `HELPME_BASE_URL`.
- Ensure your HelpMe environment matches these expectations or update `src/app.ts` accordingly.

---

## Observability

- Logging: pino structured logs at the level set by `LOG_LEVEL`.
- Health: `GET /healthz` for liveness.

---

## Privacy & Data Retention

- Stores minimal PII from HelpMe (name, email) strictly for UX; token stored for API auth.
- Course data is cached locally for user experience; you can clear `UserCoursesEntity` rows to force refresh.
- Interactions/questions are stored to power `/chatbot-history`; purge by deleting the corresponding tables if needed.

---

## Known Limitations

- Modal-based file upload relies on Ollama for image understanding on the chatbot backend until the production model update is deployed.
- History context for `/chatbot-thread` is limited to the last 10 non-bot messages to respect API constraints.

---

## FAQ

- Q: Can we restrict commands to specific channels?
  - A: Use Slack admin policies or add channel checks in command handlers.

- Q: How to refresh courses?
  - A: Re-linking may populate courses; otherwise, extend the bot to fetch on demand and call `saveUserCourses`.

- Q: Why Socket Mode by default?
  - A: Simplifies local/dev and many deployments; HTTP mode is supported for standard web infra.

---

## Dev Workflow

- TypeScript, explicit types on public APIs, readable variable names.
- Development:
  - `npm run dev` with nodemon and Socket Mode by default.
  - Set `LOG_LEVEL=debug` when troubleshooting.
- Build & run:
  - `npm run build` 
- Lint & test:
  - `npm run lint` and `npm test` (tests are minimal; extend as needed).
- Coding guidelines:
  - Prefer early returns, shallow control flow, and clear naming.
  - Handle errors meaningfully; don’t swallow exceptions.
  - Keep messages concise for end users; add detail to logs.

---

## Performance & Scalability

- Slack rate limits: Outbound messages are chunked (~3500 chars) and retried with exponential backoff to avoid failures.
- Concurrency: Bolt handlers are stateless; SQLite writes are short-lived. If you expect high load, consider moving to a managed DB (e.g., Postgres) and adding job queues for heavy tasks.
- API calls: The Chatbot API calls are bounded by timeouts. Tune endpoint-specific timeouts if your upstream varies.
- Storage growth: `chatbot_interactions` and `chatbot_questions` grow with usage. Consider periodic pruning or archival if history isn’t required indefinitely.

---

## Error Handling & Resilience

- User-facing messaging is ephemeral and action-oriented (e.g., prompts to `/link` or to set a default course).
- Transient failures (Slack posting) are retried with backoff; OAuth state mismatches render human-friendly HTML pages.
- Chatbot API errors surface with concise summaries; server logs include details (status codes/messages).

---

## SQLite Storage & Backup

- DB location: `DATABASE_PATH` (default `./data/data.db`).
- Backups: Stop the process or use SQLite online-backup utilities; keep regular snapshots, especially before upgrades.
- Migrations: TypeORM `synchronize: true` creates/updates tables automatically in dev.

---

## Source Reference (src/)

Detailed explanations for each file under `src/`.

- `src/app.ts`
  - Application entry point. Initializes the database (`ensureDb`), configures Slack Bolt in either Socket Mode or HTTP Events mode, registers all commands, exposes health and OAuth callback endpoints, starts the app, and handles graceful shutdown.
  - HTTP endpoints: `GET /healthz`, `GET /link/callback`, `POST /link/callback`.
  - Registers command modules: `ask`, `link`, `aboutMe`, `defaultCourse`, `courses`, `unlink`, `chatbotHistory`, `chatbotSettings`, `chatbotModels`, `uploadFile`, `chatbotThread`.

- `src/lib/slack.ts`
  - `safePostMessage`: Posts long texts safely by chunking to ~3500 characters and retrying with exponential backoff in case of rate limits.

- `src/services/chatbot.service.ts`
  - Typed client and orchestrator for the HelpMe Chatbot API.
  - Adds headers: `HMS-API-KEY` and `HMS_API_TOKEN`, supports timeouts, and normalizes errors.
  - Persists interactions and questions locally via DB helpers for history features.
  - Key methods:
    - `askQuestion(...)`: Calls `POST chatbot/:courseId/ask`, creates interaction if needed, stores question/answer, returns response details.
    - `getAllInteractionsForUser(...)`, `getInteractionsAndQuestions(...)`: For history retrieval.
    - `getUserInfo(...)`, `validateUserToken(...)`, `getDefaultCourse(...)`: User/token validation and defaults.
    - Settings and content CRUD: `getChatbotSettings`, `updateChatbotSettings`, `resetChatbotSettings`, `getAllQuestions`, `addQuestion`, `updateQuestion`, `deleteQuestion`, `getModels`.

- `src/services/chat-token.entity.ts`
  - Optional TypeORM entity (`ChatTokenModel`) for managing shared chat tokens with usage counters (`used`, `max_uses`) and optional Slack association. Not required for core flows but useful for quota/pool scenarios.

- `src/db/entities.ts`
  - TypeORM entity definitions:
    - `UserLinkEntity`: HelpMe identity + per-user chat token linked to Slack `teamId`/`userId`.
    - `LinkStateEntity`: Short-lived OAuth `state` rows used during `/link`.
    - `UserCoursesEntity`: Cached enrolled courses JSON and fetch timestamp.
    - `UserPrefsEntity`: User preferences (e.g., `defaultCourseId`).
    - `ChatbotInteractionEntity`: Interaction records per user/course.
    - `ChatbotQuestionEntity`: Stored question and response with metadata and optional `userScore`.

- `src/db/index.ts`
  - Database bootstrap (`ensureDb`) for SQLite with TypeORM and convenience functions:
    - Linking: `saveUserLink`, `getUserLinkInfo`, `isUserLinked`, `deleteUserLink`.
    - OAuth state: `createLinkState`, `consumeLinkState` (one-time, TTL-checked).
    - Courses: `saveUserCourses`, `getUserCourses` (local cache for better UX).
    - Preferences: `setDefaultCourse`, `getDefaultCourse`.
    - Chatbot history: `createChatbotInteraction`, `createChatbotQuestion`, `getChatbotInteractionsForUser`, `getChatbotInteractionsForCourse`, `getChatbotQuestionsForInteraction`, `updateChatbotQuestionScore`.

- `src/commands/ask.ts`
  - Implements `/ask`. Parses `--course=...`, resolves course by name/partial/ID or uses the default course, validates linking, calls `ChatbotService.askQuestion`, formats sources, and replies ephemerally.

- `src/commands/chatbotThread.ts`
  - Implements `/chatbot-thread`. Gathers recent thread replies (filters out bot/command), keeps last 10 as history, calls `askQuestion`, and posts the answer in the thread (falls back to ephemeral on failure).

- `src/commands/uploadFile.ts`
  - Implements `/upload-file`. Tries to open a modal for question + file inputs; on submit downloads the file via Slack Web API, constructs multipart form-data, and calls the Chatbot API. Provides a chat-only fallback when modal isn’t available.

- `src/commands/courses.ts`
  - Implements `/courses`. Fetches the locally cached courses and renders them ephemerally with last-updated info.

- `src/commands/defaultCourse.ts`
  - Implements `/default-course`. Resolves a course by ID/name/code and sets it as the user’s `defaultCourseId` in preferences.

- `src/commands/aboutMe.ts`
  - Implements `/about-me`. Shows the linked HelpMe profile (name, email) plus the cached course list.

- `src/commands/chatbotSettings.ts`
  - Implements `/chatbot-settings`. Resolves course (argument or default), fetches settings (model, temperature, topK, similarity threshold, prompt preview) from the API, and displays them.

- `src/commands/chatbotModels.ts`
  - Implements `/chatbot-models`. Retrieves and displays available AI models from the API.

- `src/commands/chatbotHistory.ts`
  - Implements `/chatbot-history`. Summarizes recent interactions (limited for Slack message size) with dates and truncated Q/A.

- `src/commands/link.ts`
  - Implements `/link`. Generates and stores an OAuth `state`, crafts the HelpMe start URL (optionally includes organization), and sends it ephemerally.

- `src/commands/unlink.ts`
  - Implements `/unlink`. Deletes the user link from local DB and confirms success.

- `src/types/shims.d.ts`
  - Minimal TS module shims for `*.js` and `typeorm` to satisfy the TypeScript compiler under ESM.

- `src/utils/`
  - Placeholder for shared helpers. Currently empty.
