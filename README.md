# Tipline — BIOBUZZ match scorer

Upload FTC **BIOBUZZ** (2026–27) match video and get:

- **The score**, computed from the Competition Manual (Table 10-2 points, Table 10-3 ranking points), split into AUTO / TELEOP / fouls, for your alliance and the opponent.
- **A shot count**: elements launched, how many landed in the CELL, misses, accuracy, POLLEN vs NECTAR, and a shot timeline with every HIVE TIP.
- **The field clock**: mark (or auto-detect) when robots start moving, and Tipline runs 0:30 AUTO → 0:08 transition → 2:00 TELEOP. Anything launched in the transition or after the buzzer is not scored.
- **Coaching** ranked by points per match, and a **subsystem playbook** (“weaponize”) built from what the AI sees on your robot.
- **A points planner** that projects score and RPs from cycle time, accuracy and endgame choices, and tells you which single upgrade is worth the most.

Settings: alliance (red/blue), match type (solo practice / 1v1 / 2v2), with or without AUTO.

## How it works

The video never leaves the browser. Frames inside the scoring window are extracted locally and sent in small batches to `/api/analyze`, a Vercel function that asks an OpenAI vision model to *report what it sees* (launches, tips, end-of-match state). All points are then computed deterministically in `public/js/scoring.js`. Every count is editable in the **Referee review** panel, so a wrong AI read is a one-click fix.

```
public/            static site (no build step)
  js/game.js       timing, point values, RP thresholds
  js/scoring.js    scoring engine (match clock rules, record → score)
  js/analyzer.js   frame sampling + batching
  js/strategy.js   tips, subsystem plays, planner model
api/analyze.js     OpenAI proxy (segment / checkpoint / robot / coach tasks)
api/health.js      reports whether analysis is configured
```

## Deploy on Vercel

1. Import this repository in Vercel. No framework preset or build command is needed (`vercel.json` sets `public/` as the output).
2. In **Settings → Environment Variables** add:
   - `OPENAI_API_KEY` — recommended (without it, each visitor must enter their own key).
   - `OPENAI_MODEL` — optional, defaults to `gpt-5` (falls back to `gpt-4.1`, then `gpt-4o`).
   - `ACCESS_CODE` — optional but recommended: visitors must enter it before the site spends API credits.
3. **Redeploy** (Deployments → ⋯ → Redeploy). Environment variables only reach deployments made after you save them.

Never commit a key. `.env` files are git-ignored.

If no server key is set, the page asks the visitor for their own OpenAI key instead. It is kept in that browser's local storage and sent only with analysis requests; the server never stores it. When OpenAI refuses a key, the page says why: invalid or revoked, no credit or billing, or the key's project isn't allowed to use the vision models. The server tries `OPENAI_MODEL` (default `gpt-5`), then `gpt-4.1`, then `gpt-4o`, until it finds one the key's project can use.

## Run locally

```bash
npm run dev:mock     # full UI with a fake AI, no key needed → http://localhost:3000
OPENAI_API_KEY=... npm run dev
npm test             # scoring engine checks
```

## Accuracy notes

- Use a steady, wide shot of the whole field. Higher “Thorough” depth samples 2 frames/s and catches fast volleys better.
- The number of elements needed to TIP a HIVE is not in the manual; the planner exposes it as a slider so you can set what you measure.
- Unofficial and not affiliated with *FIRST*®. The Head REFEREE and official scoring are authoritative; check the latest Team Update.
