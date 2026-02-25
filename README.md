# Work.ai

AI workflow planner that turns brain-dumped tasks into a conflict-aware weekly schedule, then syncs approved blocks to Google Calendar.

Built with Next.js App Router, Tailwind, and OpenAI.

## Features

- AI task analysis:
  - effort estimate (`estimatedHours`)
  - urgency and priority scoring
  - split vs non-split recommendation
  - date gating (`notBeforeISO`) when work cannot start yet
- Conflict-aware scheduling against Google Calendar busy times
- Per-day scheduling windows (time preferences)
- Google Calendar conflict filters (ignore selected calendars)
- Live calendar week snapshot with overlap visualization
- One-click "Add to Google Calendar" links for planned blocks
- Persistent planner state:
  - local storage
  - optional cloud sync via Supabase (per Google user)
- Photo-to-task intake:
  - upload an image
  - AI extracts one or multiple tasks
  - auto-adds to queue
- Theme support: light, dark, pink
- Vercel Analytics integrated globally

## Tech Stack

- Next.js 16 (App Router)
- React 19
- Tailwind CSS 4
- OpenAI Chat Completions API (analysis + image extraction)
- Google OAuth + Google Calendar API
- Supabase REST API (optional persistence)
- Vercel Analytics (`@vercel/analytics`)

## Project Structure

- `src/app/page.tsx` - landing page
- `src/app/planner/page.tsx` - main planner UI
- `src/app/api/ai/analyze/route.ts` - AI analysis endpoint
- `src/app/api/ai/extract-task-image/route.ts` - photo task extraction endpoint
- `src/app/api/planner/schedule/route.ts` - Google conflict fetch endpoint
- `src/app/api/google/*` - calendar snapshot, calendar list, token helpers
- `src/lib/planner.ts` - scheduling engine + models
- `src/lib/google-auth.ts` - OAuth cookie/token handling
- `src/lib/cloud-state.ts` - Supabase cloud state helpers

## Environment Variables

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Required:

- `NEXT_PUBLIC_APP_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_OAUTH_COOKIE_SECRET` (>= 32 chars, random)
- `OPENAI_API_KEY`

Optional:

- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PLANNER_TABLE` (default: `planner_states`)

## Google Cloud Setup

1. Create/select a Google Cloud project.
2. Enable APIs:
   - Google Calendar API
3. Configure OAuth consent screen:
   - add test users while in Testing mode
4. Create OAuth 2.0 Client ID (Web application).
5. Add authorized origins:
   - `http://localhost:3000`
   - your production domain(s)
6. Add redirect URIs:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://<your-domain>/api/auth/google/callback`
7. Set env vars in `.env.local` and your deployment platform.

## Optional Supabase Setup (Cloud Sync)

If you want planner state shared across sessions/devices:

1. Create Supabase project.
2. Create table (default name `planner_states`) with:
   - `user_id text primary key`
   - `state jsonb not null`
   - `updated_at timestamptz default now()`
3. Put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in env.

If Supabase env vars are not set, app runs in local-only persistence mode.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build & Run Production

```bash
npm run build
npm run start
```

## Deploy to Vercel

1. Push repo to GitHub/GitLab/Bitbucket.
2. Import project in Vercel.
3. Add all environment variables in Vercel Project Settings.
4. Update Google OAuth authorized origin/redirect URI to your deployed domain.
5. Redeploy.

## How Scheduling Works (High Level)

1. Tasks are analyzed by AI.
2. Planner requests Google busy intervals from `/api/planner/schedule`.
3. Final schedule is generated client-side using:
   - AI analyses
   - busy intervals
   - user time preferences
4. Suggested blocks are added to Google via prefilled calendar links.
5. Live snapshot polling confirms additions and marks synced blocks.

## Troubleshooting

- `Error 403 access_denied` on Google login:
  - add your account as OAuth test user or publish app
- `Google Calendar API has not been used / disabled`:
  - enable Google Calendar API in the same GCP project
- Conflicts not detected:
  - ensure calendar is not in ignored filters
  - refresh snapshot and rerun Plan My Week
- Cloud sync says `cloud not configured`:
  - set Supabase env vars
- Photo upload extracts weak details:
  - use clearer image/crop and rerun upload

## Security Notes

- Never commit `.env.local`.
- Rotate exposed secrets immediately.
- `GOOGLE_OAUTH_COOKIE_SECRET` should be long random data.
- Supabase `SERVICE_ROLE` key must stay server-side only.

## License

Add your preferred license (MIT, Apache-2.0, proprietary, etc.).
