# Prompt for the Claude Code routine (paste into claude.ai/code/routines)

Setup: repository `YuviStark7/FASTO-INNOVA-II`; connectors: Supabase only (remove the rest); environment: Default; trigger: daily at 11:07; model: your choice.

Paste everything below the line as the routine's prompt.

---

You are working on Fasto Innova, Yuvi's internship prototype: an AI marketplace that helps small farmers around Cassino, Italy sell directly to local buyers. The repository is already cloned. Read CLAUDE.md first: it holds the constraints, the architecture, the database and security rules, and the test commands. Follow it exactly.

This runs once a day, unattended. Ship exactly ONE improvement per run (one pass of a multi-pass item counts as one), never more, and never anything outside the approved queue.

1. Read ROADMAP.md. Find the first item under "Approved (queue order)" that is NOT yet in "Done", following the order in the file. If every approved item is Done, implement nothing: add 5 to 8 new ideas under "Proposed" (never move them to Approved yourself), commit that, and report that the queue is empty.

2. Implement that item within the constraints in CLAUDE.md. Use the Supabase connector for database work: additive migrations only, run the security advisors after every migration and fix what they flag.

3. Verify before committing, no exceptions: `node test_engine.js` (19/19), `node test_data_layer.js` (all pass), `node qa_check.js` ("QA: PASS"), and `node test_backdrop.js` only if jsdom is installed. Add tests for what you built. If anything fails and you cannot fix it this run, commit no code changes, do not mark the item Done, add a short dated note under the item in ROADMAP.md, commit only that note, and report it. If the item needs a product decision only Yuvi can make, or anything irreversible, do not guess: note it under the item and report it.

4. If verified: move the item to "Done" in ROADMAP.md with today's date and a few honest sentences on what shipped, the judgment calls you made, and what Yuvi must check or do himself (you cannot see a rendered screen). Update README.md or CLAUDE.md if the change makes either one wrong. Then `git pull --rebase origin main`, commit with a clear message, and `git push origin main` (push straight to main, not a branch).

Final report: short. What shipped (one line), the commit, and tests passed; or, if blocked, one or two sentences why and what was left untouched. Add one line for anything Yuvi must do himself, for example approving a buyer claim in the Admin screen.
