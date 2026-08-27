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
const path = process.argv[2] || __dirname;
const html = fs.readFileSync(path + "/index.html", "utf8");
const js = fs.readFileSync(path + "/js/app.js", "utf8");
const sbjs = fs.readFileSync(path + "/js/supabase-client.js", "utf8");
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
for (const m of js.matchAll(/(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) definedFns.add(m[1]);
report("onclick handlers referencing undefined functions", [...onclickFns].filter(f => !definedFns.has(f)));

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

for (const [name, src] of [["app.js", js], ["supabase-client.js", sbjs]]) {
  try { new Function(src); console.log("✓ " + name + ": syntax OK"); }
  catch (e) { console.log("✗ " + name + " SYNTAX ERROR: " + e.message); problems++; }
}

// Every DataStore.X( call in app.js must exist in supabase-client.js
const dsMethodsUsed = new Set();
for (const m of js.matchAll(/DataStore\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) dsMethodsUsed.add(m[1]);
const dsMethodsDefined = new Set();
for (const m of sbjs.matchAll(/^\s*(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm)) dsMethodsDefined.add(m[1]);
report("DataStore methods called from app.js but NOT defined in supabase-client.js", [...dsMethodsUsed].filter(m => !dsMethodsDefined.has(m)));

console.log("\n" + (problems === 0 ? "QA: PASS" : "QA: FAIL (" + problems + " issue(s) above)"));
process.exit(problems === 0 ? 0 : 1);
