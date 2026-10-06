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
- Column-level grants stop clients writing sensitive columns. `public.farmers` has table-level insert/update revoked; authenticated users may update only `farmer_name, company_name, vat_number, address, phone, nickname, first_name, last_name`. `first_name`/`last_name` are asked once at sign-up (copied from sign-up metadata by `private.handle_new_user`) and the trigger `farmers_lock_name` (`private.lock_name_once`) refuses any change once they are set, except by an admin; an older account with none may set them once from Edit profile. A past hole (farmers could set their own `is_admin`) was closed this way. Never widen it. If an admin needs to edit other columns, add an admin-only path, do not grant the columns to everyone.
- Postgres `numeric` reaches the browser as a string through PostgREST; coerce with `Number()`.

## Buyer side (items 24 to 31 of ROADMAP.md)

- Buyers use the same sign-up with a role chosen at sign-up (`options.data.role`, whitelisted by the trigger). The role lives in `farmers.role` and is read from the database after sign-in, never trusted from the browser.
- A buyer claims a business from the listed ones, or says theirs is not listed. Claims live in `buyer_claims` (pending, approved, rejected) and are **never self-service**: Yuvi approves them in the Admin screen. Until approved, RLS treats the buyer as owning nothing. One approved owner per business (unique index). Approving an unlisted business creates a low-confidence placeholder `buyers` row.
- `outreach_messages` holds the two-way thread on an outreach. Readable and writable only by the farmer who owns the outreach, the approved owner of the addressed business, and admins. No delete; the only update is the addressed business's approved owner setting `read_at` on the farmer's messages (column grant + policy `omsg mark read as buyer`). A buyer sees an outreach row only once a message exists on it. `outreach.farmer_summary` (jsonb: village, distance, organic, months, products; never name, phone, address or VAT) is written by the farmer when they press Mark as sent and is what the buyer sees beside the thread.
- The buyer app shell is `#app[data-role="buyer"]`: `.role-farmer` elements are hidden for buyers, `.role-buyer` elements for everyone else.
- The Admin "farmers" counts must exclude `role = 'buyer'` rows.
- `offers` (item 29): a farmer's opt-in snapshot per finished chat (village, distance, organic, months, products; never phone/address/VAT/name). Farmer reads/inserts/updates own (update limited to status + snapshot columns, never deleted); approved buyers read only `published`. A buyer starts a conversation from an offer: `outreach` row with `initiated_by='buyer'` and `offer_id` (unique per offer+business, policy `outreach insert buyer inquiry`), then a first message through the narrow policy `omsg insert first buyer message` (the normal message policy needs a message to exist already). Several tables now have two permissive policies for one action because `DROP POLICY` timed out in the migration tool; the performance advisor flags this and it is accepted.
- `buyers` UPDATE is column-granted: only `needs, volume, quality_focus, declared_by_buyer, declared_at`, and only by an admin or the business's approved owner (policy `buyers update admin or owner`; the older admin-only policy could not be dropped through the migration tool and is redundant). An admin editing other columns (item 31) needs a new admin-only path. Buyer-declared values are validated by `guardianValidateBuyerProfile` in `core.js`; `buyers.html` stays static and never shows them.

## Admin edits (item 31 pass A)

- `admin_audit` (admin read only, no direct writes) is filled solely by `public.admin_edit_buyer(p_id, p_patch)`, a SECURITY DEFINER function that checks `private.is_admin()`, allows only name/type/zone/distance_km/needs/volume/quality_focus/notes/source/confidence, and logs old/new values. Admin edits to `buyers` go through it (`DataStore.adminEditBuyer`), never through column grants. The advisor warning about it is accepted.

## Farmer chat (changed 2026-10-05)

- The farmer's name comes from the account, never from the conversation: Brain 1 is told it and told never to ask (`interviewSystem`), and `withAccountName` overrides whatever the model writes. Chats are titled by product (`chatTitle`), not by name.
- After matching, the best four buyers are cards under the chat (`matchCardsHTML`); a card opens the buyer sheet (`openBuyerCard`: details, map embed, every chip, a drafted message). The draft is made on demand for ONE buyer with the same Brain 2 call and Guardian check as the original (`draftFor`), with a plain template fallback. Send = create the outreach thread and `markSent` (posts to the buyer's inbox). There is no edit-details button: edits are asked for in the chat, Brain 1 re-calls `submit_farmer_profile`, and `onProfileRevised` runs `applyProfileEdit` (the profile-edit sheet code remains in app.js, unreachable from the UI, because its tests pin the rules `applyProfileEdit` still enforces).
- The avatar opens a menu (Edit profile, Log out). Edit profile is `#accountSheet`, the fifth sheet; `#dialogSheet` is the sixth: `showDialog()` replaces `alert`/`confirm`/`prompt` (the only remaining browser dialogs were the API-key alert and the price prompt). Never reintroduce a browser dialog. The top bar must stay above the screens (`#main > #topbar{z-index:30}`) or the avatar menu goes under them.
- There is no "Mark as sent" button: a draft is sent from its buyer's card (`reviewDraft` opens it; `sendCardMessage` -> `markSent`). The buyer inbox (`renderBuyerInbox`) mirrors the Clients layout, and the farmer's details open in a side panel from the chat's name bar.

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
