# World Cup Prediction Pool

A free-first web app for the 2026 World Cup prediction pool. It reads the Excel workbook into static JSON, calculates leaderboard payouts in the browser, and pulls live match scores automatically through Cloudflare without exposing an API key.

## What Is Included

- Public web dashboard with Overview, Leaderboard, Matches, Participants, Predictions, Scenario, and Setup tabs.
- Exact-score priority, correct-outcome fallback, prize splitting, and champion-fund rollover.
- Manual scenario mode for testing any match score.
- Local CSV export of the leaderboard.
- `scripts/export_workbook.py` to refresh `public/data/predictions.json` from the workbook.
- `functions/api/live.js` shared live-score handler for ESPN/API providers.
- `worker.js` and `wrangler.toml` Cloudflare Worker deployment that serves the app and `/api/live`.

## Free Hosting Plan

Use Cloudflare Workers with Static Assets:

1. Push this folder to GitHub.
2. In Cloudflare, create a Worker connected to the GitHub repo.
3. Set the project root to `worldcup-live` if the repo has other folders.
4. Make sure Cloudflare uses `wrangler.toml`.
5. Deploy.

The app uses Cloudflare Static Assets for the frontend and a Worker route for `/api/live`. There is no database requirement.

You can also deploy from this folder with Wrangler:

```bash
npx wrangler deploy
```

## Live Scores

The browser calls:

```text
/api/live
```

The included Worker defaults to ESPN's public FIFA World Cup scoreboard feed, which requires no API key:

```text
FOOTBALL_PROVIDER=espn
LIVE_CACHE_SECONDS=55
```

This is the free automatic option. It is public and currently returns the 2026 FIFA World Cup scoreboard, but it is not a paid SLA-backed data contract.

The function can also use API-Football if you later upgrade to a plan with 2026 season access:

```text
FOOTBALL_PROVIDER=api-football
API_FOOTBALL_KEY=your_key
API_FOOTBALL_LEAGUE=1
API_FOOTBALL_SEASON=2026
LIVE_CACHE_SECONDS=55
```

or:

```text
FOOTBALL_PROVIDER=football-data
FOOTBALL_DATA_TOKEN=your_token
FOOTBALL_DATA_COMPETITION=WC
LIVE_CACHE_SECONDS=55
```

Important: API provider fixture IDs may not match workbook match numbers. The frontend also matches live games by home and away team names.

API-Football's free tier currently blocks the 2026 season, so ESPN is the recommended free automatic source.

## Refresh Data From Excel

From this folder:

```bash
python3 scripts/export_workbook.py "/Users/kamalmoravej/Downloads/2026 FIFA World Cup.xlsx" --output public/data/predictions.json
```

The current export contains 104 matches and 33 participants.

## Run Locally

Static preview:

```bash
python3 -m http.server 8080 --directory public
```

Open:

```text
http://127.0.0.1:8080
```

The local static preview will use workbook/manual scores unless you run through Cloudflare Pages local development for `/api/live`.

## Scoring Rules

For each match:

1. Participants with the exact score split the match prize.
2. If there is no exact-score winner, participants with the correct outcome split the match prize.
3. If there is no winner, the match prize rolls into the champion fund.
4. Live/manual scores are shown as provisional. Final scores are shown as confirmed.

Prize values come from the workbook's stage prize table and are displayed without adding a currency symbol.
