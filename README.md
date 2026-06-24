# World Cup Prediction Pool

A free-first web app for the 2026 World Cup prediction pool. It reads the Excel workbook into static JSON, calculates leaderboard payouts in the browser, and can pull live match scores through a Cloudflare Pages Function without exposing an API key.

## What Is Included

- Public web dashboard with Overview, Leaderboard, Matches, Participants, Predictions, Scenario, and Setup tabs.
- Exact-score priority, correct-outcome fallback, prize splitting, and champion-fund rollover.
- Manual scenario mode for testing any match score.
- Local CSV export of the leaderboard.
- `scripts/export_workbook.py` to refresh `public/data/predictions.json` from the workbook.
- `functions/api/live.js` Cloudflare Pages Function for live scores, caching, and API-key hiding.

## Free Hosting Plan

Use Cloudflare Pages:

1. Push this folder to GitHub.
2. Create a Cloudflare Pages project from the repo.
3. Set the project root to `worldcup-live` if the repo has other folders.
4. Set the build command to empty.
5. Set the output directory to `public`.
6. Deploy.

The app is static and has no database requirement.

## Live Scores

The browser calls:

```text
/api/live
```

The included Pages Function supports these providers:

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

For a strictly free setup, start with API-Football's free tier and keep the refresh rate conservative. The app caches `/api/live` so many visitors share one provider request, but a provider's daily quota can still be exhausted if the site polls all day. Before the tournament, verify that the free tier covers the exact 2026 World Cup season and live-score endpoint you need.

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
