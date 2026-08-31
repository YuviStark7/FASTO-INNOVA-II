/* ============================================================
   FASTO INNOVA — static QA cross-reference
   ------------------------------------------------------------
   Run with `node qa_check.js` from inside this folder (or pass
   a path: `node qa_check.js /path/to/app`). Used by the daily
   improvement automation (see ROADMAP.md) as a regression check
   before any change is copied from a draft into this folder —
   alongside `node test_engine.js`, which tests the matching
   engine itself. Neither script ships as part of the app; both
   are dev tooling kept here for reuse.
   ============================================================ */
const fs = require("fs");
const path = require("path").resolve(process.argv[2] || __dirname);  // resolved: the i18n/core requires below need an absolute path
const html = fs.readFileSync(path + "/index.html", "utf8");
const js = fs.readFileSync(path + "/js/app.js", "utf8");
const sbjs = fs.readFileSync(path + "/js/supabase-client.js", "utf8");
const i18njs = fs.readFileSync(path + "/js/i18n.js", "utf8");
const corejs = fs.readFileSync(path + "/js/core.js", "utf8");
const css = fs.readFileSync(path + "/css/app.css", "utf8") + fs.readFileSync(path + "/css/base.css", "utf8");

let problems = 0;
function report(label, arr, expectEmpty = true) {
  const bad = expectEmpty ? arr.length > 0 : arr.length === 0;
  console.log((bad ? "✗ " : "✓ ") + label + ": " + JSON.stringify(arr));
  if (bad) problems++;
}

const idsUsedInJs = new Set();
for (const m of js.matchAll(/\$\(\s*"([^"]+)"\s*\)/g)) idsUsedInJs.add(m[1]);
const idsInHtml = new Set();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) idsInHtml.add(m[1]);
// Some ids are only created dynamically (inside innerHTML templates) — check manually if this list grows.
console.log("IDs referenced by JS ($(...)) but missing from static HTML (verify these are dynamically created):");
console.log(JSON.stringify([...idsUsedInJs].filter(id => !idsInHtml.has(id))));

const onclickFns = new Set();
for (const re of [js, html]) for (const m of re.matchAll(/onclick="([a-zA-Z_][a-zA-Z0-9_]*)\(/g)) onclickFns.add(m[1]);
const definedFns = new Set();
for (const src of [js, i18njs]) for (const m of src.matchAll(/(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) definedFns.add(m[1]);
report("onclick handlers referencing undefined functions", [...onclickFns].filter(f => !definedFns.has(f)));

/* ============================================================
   TRANSLATION CHECKS (ROADMAP item 10)
   Four things that fail silently in a browser and are therefore worth a
   script: a key that exists in one language and not the other (falls back to
   English with nothing said), a key used but never defined (renders as the key
   itself), the static English in index.html drifting away from the dictionary
   that replaces it, and — the one that matters most — js/core.js changing a
   sentence that js/i18n.js still thinks it knows how to translate.
   ============================================================ */
const i18n = require(path + "/js/i18n.js");
{
  const en = Object.keys(i18n.STRINGS.en), it = Object.keys(i18n.STRINGS.it);
  report("keys in English but missing from Italian", en.filter(k => it.indexOf(k) === -1));
  report("keys in Italian but missing from English", it.filter(k => en.indexOf(k) === -1));

  // Every key asked for, from either the markup or the code.
  const used = new Set();
  for (const m of html.matchAll(/data-i18n(?:-html|-ph|-title|-aria)?="([^"]+)"/g)) used.add(m[1]);
  // A literal ending in "." is the prefix half of T("phase." + p) and is
  // covered by the `built` list below, not a key in its own right.
  for (const m of js.matchAll(/\bT\(\s*"([^"]+)"/g)) if (!m[1].endsWith(".")) used.add(m[1]);
  // ...plus the ones built from a prefix and a variable, which the regex above
  // can't see. Each is listed with the suffixes it can take.
  const built = [
    ["cat.", require(path + "/js/core.js").CATEGORIES],
    ["month.", Array.from({ length: 12 }, (_, i) => String(i + 1))],
    ["phase.", ["interview", "matching", "done"]],
    ["band.", ["low", "medium", "high"]],
    ["profile.fld.", (js.match(/const PROFILE_FIELDS = \[([^\]]+)\]/) || [, ""])[1].split(",").map(x => x.trim().replace(/"/g, "")).filter(Boolean)],
    ["admin.stage.", ["started", "profile", "drafted", "sent"]],
    ["admin.hint.", ["started", "profile", "drafted", "sent"]],
    ["", (js.match(/const OFFLINE_SCRIPT_KEYS = \[([^\]]+)\]/) || [, ""])[1].split(",").map(x => x.trim().replace(/"/g, "")).filter(Boolean)]
  ];
  for (const [prefix, suffixes] of built) for (const sfx of suffixes) used.add(prefix + sfx);
  report("i18n keys used but not defined", [...used].filter(k => !(k in i18n.STRINGS.en)));

  // The English left in index.html is what a browser with JS off would show,
  // and what a reader of the file assumes is true. Only the plain-text ones are
  // compared; the two innerHTML strings carry markup and are skipped.
  const decode = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  const drifted = [];
  for (const m of html.matchAll(/<(\w+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)<\/\1>/g)) {
    const [, , key, text] = m;
    if (decode(text) !== decode(i18n.STRINGS.en[key] || "")) drifted.push(key);
  }
  report("static English in index.html out of step with the en dictionary", drifted);
}

/* The engine's own sentences. js/core.js is the tested engine and is not
   touched by the translation work, so its reasons and Guardian warnings are
   recognised and rewritten at the boundary by ENGINE_PATTERNS in js/i18n.js.
   That is exactly the arrangement that rots quietly: change a word in core.js
   and the Italian UI silently starts showing English again. So every string
   core.js pushes has to be claimed by a pattern. */
{
  const pushed = [];
  for (const m of corejs.matchAll(/(?:reasons|warnings|errors)\.push\(\s*"((?:[^"\\]|\\.)*)"/g)) pushed.push(m[1]);
  const unclaimed = pushed.filter(lit => !i18n.ENGINE_PATTERNS.some(p => p.re.test(lit) || p.re.source.slice(1).indexOf(lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) === 0));
  console.log("engine sentences found in core.js: " + pushed.length);
  report("core.js strings no ENGINE_PATTERNS entry claims", unclaimed);
}

const assetRefs = new Set();
for (const m of html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)) assetRefs.add(m[1]);
const re2 = new RegExp("[\"'`](assets/[^\"'`]+)[\"'`]", "g");
for (const m of js.matchAll(re2)) assetRefs.add(m[1]);
for (const m of css.matchAll(/url\(['"]?\.\.\/(assets\/[^'")]+)/g)) assetRefs.add(m[1]);
report("Asset paths referenced but missing from disk", [...assetRefs].filter(p => !fs.existsSync(path + "/" + p)));

const openDiv = (html.match(/<div/g) || []).length, closeDiv = (html.match(/<\/div>/g) || []).length;
const openSec = (html.match(/<section/g) || []).length, closeSec = (html.match(/<\/section>/g) || []).length;
console.log("<div> open=" + openDiv + " close=" + closeDiv + " balanced=" + (openDiv === closeDiv));
console.log("<section> open=" + openSec + " close=" + closeSec + " balanced=" + (openSec === closeSec));
if (openDiv !== closeDiv || openSec !== closeSec) problems++;

for (const [name, src] of [["app.js", js], ["supabase-client.js", sbjs], ["i18n.js", i18njs]]) {
  try { new Function(src); console.log("✓ " + name + ": syntax OK"); }
  catch (e) { console.log("✗ " + name + " SYNTAX ERROR: " + e.message); problems++; }
}

// CSS has no syntax error to throw — a browser silently discards whatever it
// cannot parse and carries on, so a broken rule looks like a styling bug
// rather than a mistake. This caught a real one on 2026-08-27: an edit left a
// stray comment-close marker between two rules, and the browser swallowed the
// .backdrop-layer rule that followed it as part of the garbage selector. Its
// opacity:0 never applied, both photo layers sat fully opaque, and the
// cross-fade stopped happening, with nothing anywhere reporting a problem.
// (Written with line comments on purpose: a block comment describing stray
// comment markers has to contain one, which ends the comment early — which is
// exactly the mistake this check exists to catch, and it happened here too.)
for (const [name, file] of [["app.css", "/css/app.css"], ["base.css", "/css/base.css"]]) {
  const src = fs.readFileSync(path + file, "utf8");
  const opens = (src.match(/\/\*/g) || []).length, closes = (src.match(/\*\//g) || []).length;
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const strays = (stripped.match(/\/\*|\*\//g) || []).length;
  let depth = 0, unbalanced = false;
  for (const ch of stripped) { if (ch === "{") depth++; else if (ch === "}" && --depth < 0) { unbalanced = true; break; } }
  const bad = opens !== closes || strays > 0 || unbalanced || depth !== 0;
  console.log((bad ? "✗ " : "✓ ") + name + ": comments " + opens + " open / " + closes + " close" +
    (strays ? ", " + strays + " STRAY marker(s) outside any comment" : "") +
    ", braces " + (unbalanced || depth !== 0 ? "UNBALANCED" : "balanced"));
  if (bad) problems++;
}

/* The cross-fade only works if the photo layers stay under the scrim, which
   in turn stays under the content. These three numbers are meaningless apart
   and easy to break one at a time, so they are checked together. */
{
  // Read from comment-STRIPPED css on purpose. A comment left unclosed swallows
  // every rule after it until the next close marker, and the open/close counts
  // still balance, so the marker check above can't see it — but the rules it ate
  // are simply gone from here, which shows up as a missing z-index.
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  const z = sel => { const m = flat.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*z-index:\\s*(\\d+)")); return m ? Number(m[1]) : null; };
  const layer = z(".backdrop-layer"), front = z(".backdrop-layer.front"), scrim = z("#main::after"), content = z("#main > #topbar, #main > .screen");
  const ok = layer === 0 && front === 1 && scrim === 2 && content === 3;
  console.log((ok ? "✓ " : "✗ ") + "backdrop stacking: layers " + layer + "/" + front + " < scrim " + scrim + " < content " + content);
  if (!ok) problems++;
  const fadeCss = (flat.match(/\.backdrop-layer\{[^}]*transition:opacity (\d+)ms/) || [])[1];
  const fadeJs = (js.match(/BACKDROP_FADE_MS\s*=\s*(\d+)/) || [])[1];
  const matched = fadeCss && fadeJs && fadeCss === fadeJs;
  console.log((matched ? "✓ " : "✗ ") + "fade length agrees: css " + fadeCss + "ms, js BACKDROP_FADE_MS " + fadeJs + "ms");
  if (!matched) problems++;
}

// Every DataStore.X( call in app.js must exist in supabase-client.js
const dsMethodsUsed = new Set();
for (const m of js.matchAll(/DataStore\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) dsMethodsUsed.add(m[1]);
const dsMethodsDefined = new Set();
for (const m of sbjs.matchAll(/^\s*(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm)) dsMethodsDefined.add(m[1]);
report("DataStore methods called from app.js but NOT defined in supabase-client.js", [...dsMethodsUsed].filter(m => !dsMethodsDefined.has(m)));

console.log("\n" + (problems === 0 ? "QA: PASS" : "QA: FAIL (" + problems + " issue(s) above)"));
process.exit(problems === 0 ? 0 : 1);
