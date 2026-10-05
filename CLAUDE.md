# Fasto Innova: instructions for Claude Code

Fasto Innova (formerly Agri-Link AI) is an AI marketplace prototype that helps small farmers around Cassino (Lazio, Italy) sell directly to local buyers. It is Yuvi's internship project for R&S Management. Yuvi is a coding beginner: keep explanations plain, keep changes small and well commented, and be honest about anything you could not see or test.

README.md describes the product. It is partly out of date on buyers (it still says buyers have no accounts; they now do, see "Buyer side" below). Update the README when an item changes what it says.

## Hard constraints (do not relitigate)

- Plain HTML, CSS and JS. No build step, no framework, no npm dependencies for the app.
- Look: a direct implementation of the Figma file. Brick red `#962524`, translucent black glass panels, Roboto. Do not restyle.
- Every user-visible string goes through `T("key")` in `js/i18n.js`, with both English and Italian entries (the two dictionaries must have the same keys). Prefer literal `T("...")` calls; `qa_check.js` cannot see keys built from string pieces. Static `data-i18n` text in HTML must equal the English dictionary entry.
- Click handlers go only on keyboard-reachable elements (buttons). Everything interactive needs an accessible name. Escape all user-typed text before putting it into HTML.
- Standing product rule: **no buyer reply is ever simulated.** Every buyer message is typed by a real buyer. The app never sends anything on its own.
- Data honesty: buyer `needs`, `volume`, `quality_focus` are inferred guesses. Never present them as facts about a real business, and never publish them on `buyers.html`.

## Architecture

- `js/core.js`: Brain 2 (matching engine) and Brain 3 (Guardian). Pure functions, unit tested.
- `js/app.js`: state, screens, Brain 1 orchestration. `js/supabase-client.js`: `DataStore`, the only file that talks to Supabase. Every `DataStore.X()` used in `app.js` must exist there.
- `js/data.js`: the 36 buyers and 3 channels (also in the database `buyers` table). `js/i18n.js`: the IT/EN dictionary.
- Supabase project id: `asiuqyhlpnljhpcvkfaj`. The URL and publishable key in `supabase-client.js` are meant to be public; the database's Row Level Security is the lock.

## Database and security rules

- Use the Supabase MCP connector. Schema changes only through `apply_migration`, **additive only**. Never drop or destructively alter anything that could hold real data without first confirming by row count that it is empty.
- After EVERY migration, run `get_advisors` (security) and fix what it flags. Known and accepted: the `rls_auto_enable` function warnings and "leaked password protection disabled" (a dashboard setting for Yuvi).
- RLS house pattern: one policy per action; wrap `auth.uid()` as `(select auth.uid())`; admin check via `(select private.is_admin())`. Helper functions are SECURITY DEFINER in the non-exposed `private` schema (`private.is_admin`, `private.is_buyer`, `private.owns_buyer(text)`, `private.owns_outreach_as_farmer(uuid)`, `private.owns_outreach_as_buyer(uuid)`, `private.handle_new_user`).
- Column-level grants stop clients writing sensitive columns. `public.farmers` has table-level insert/update revoked; authenticated users may update only `farmer_name, company_name, vat_number, address, phone`. A past hole (farmers could set their own `is_admin`) was closed this way. Never widen it. If an admin needs to edit other columns, add an admin-only path, do not grant the columns to everyone.
- Postgres `numeric` reaches the browser as a string through PostgREST; coerce with `Number()`.

## Buyer side (items 24 to 31 of ROADMAP.md)

- Buyers use the same sign-up with a role chosen at sign-up (`options.data.role`, whitelisted by the trigger). The role lives in `farmers.role` and is read from the database after sign-in, never trusted from the browser.
- A buyer claims a business from the listed ones, or says theirs is not listed. Claims live in `buyer_claims` (pending, approved, rejected) and are **never self-service**: Yuvi approves them in the Admin screen. Until approved, RLS treats the buyer as owning nothing. One approved owner per business (unique index). Approving an unlisted business creates a low-confidence placeholder `buyers` row.
- `outreach_messages` holds the two-way thread on an outreach. Readable and writable only by the farmer who owns the outreach, the approved owner of the addressed business, and admins. No update or delete. A buyer sees an outreach row only once a message exists on it.
- The buyer app shell is `#app[data-role="buyer"]`: `.role-farmer` elements are hidden for buyers, `.role-buyer` elements for everyone else.
- The Admin "farmers" counts must exclude `role = 'buyer'` rows.

## Tests: run all of them before any change ships

```
node test_engine.js        19 passed, 0 failed
node test_data_layer.js    all pass (350 or so)
node qa_check.js           QA: PASS
node test_backdrop.js      only if jsdom is installed; skip otherwise
```

No install needed, none touch the real database. Add tests for whatever you build. `test_data_layer.js` loads the real js files into a `vm` sandbox with a fake Supabase and fake DOM; to test a new function, add it to the `globalThis.__t = {...}` export list at the end of the bundle it builds.

## Working method

- `ROADMAP.md` is the queue. "Approved (queue order)" is followed top to bottom, by file order, not item number. When an item ships, move it to "Done" with the date and a few honest sentences: what shipped, judgment calls, and what still needs Yuvi's eyes (you cannot see a rendered screen).
- Never touch anything outside the Approved queue. Ideas go under "Proposed" only.
- If a test fails and you cannot fix it, commit nothing, do not mark the item Done, and leave a dated note under the item.
- Git: work on `main`. Run `git pull --rebase origin main` first, commit with a clear message, then `git push origin main`.
