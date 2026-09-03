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

/* ============================================================
   ACCESSIBILITY CHECKS (ROADMAP item 11)
   The full accessibility pass was verified with a jsdom + postcss harness of
   124 checks, which needs `npm install` and therefore can't run here. What
   moved into this file is the handful that (a) can be decided from the source
   text alone and (b) protect something that would otherwise come back quietly:
   a control written as a clickable div, an icon button with no name, a dialog
   that stops being a dialog, and a colour dialled back below AA.
   ============================================================ */
{
  // 1. A control the keyboard cannot reach. Every list in this app was written
  //    this way once, and the next one will be too unless something says so.
  const clickableNonButton = [];
  for (const [where, src] of [["index.html", html], ["app.js", js]]) {
    for (const m of src.matchAll(/<(div|span|td|tr|li|p|section|a)\b(?![^>]*\bhref=)[^>]*\bonclick=/g)) {
      clickableNonButton.push(where + ":<" + m[1] + ">");
    }
  }
  report("click handlers on elements a keyboard can't reach (use <button>)", clickableNonButton);

  // 2. An icon-only button with no accessible name announces as "button".
  //    A title attribute doesn't count: it needs a pointer to appear, and it is
  //    only a fallback name that some screen readers ignore outright.
  const unnamed = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const [, attrs, inner] = m;
    const visible = inner.replace(/<[^>]*>/g, "").replace(/&#?\w+;/g, "x").replace(/\s+/g, "").trim();
    const named = /\baria-label=/.test(attrs) || /\bdata-i18n-aria=/.test(attrs) ||
                  /\baria-labelledby=/.test(attrs) || /\bdata-i18n=/.test(inner) || visible.length > 0;
    if (!named) unnamed.push((attrs.match(/id="([^"]+)"/) || attrs.match(/class="([^"]+)"/) || [, "?"])[1]);
  }
  report("buttons with no accessible name", unnamed);

  // 3. Anything named by another element has to point at one that exists.
  const dangling = [];
  for (const m of html.matchAll(/(?:aria-labelledby|aria-describedby)="([^"]+)"/g))
    m[1].split(/\s+/).forEach(id => { if (!idsInHtml.has(id)) dangling.push(id); });
  for (const m of html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)) if (!idsInHtml.has(m[1])) dangling.push(m[1]);
  report("aria-labelledby / label-for pointing at ids that don't exist", dangling);

  // 4. Every sheet is a modal dialog, and the skip link has somewhere to go.
  //    The count comes from SHEET_IDS in app.js rather than being written here:
  //    a sheet added to the markup but not to the stack gets no focus trap, no
  //    Escape and no aria-hidden behind it, and looks perfectly fine on screen.
  const sheetIds = ((js.match(/const SHEET_IDS = \[([^\]]*)\]/) || [, ""])[1].match(/"([^"]+)"/g) || []).map(x => x.replace(/"/g, ""));
  const panels = (html.match(/class="match-panel glass-45"[^>]*>/g) || []);
  const notDialogs = panels.filter(p => !/role="dialog"/.test(p) || !/aria-modal="true"/.test(p) || !/aria-labelledby=/.test(p));
  console.log((panels.length === sheetIds.length && sheetIds.length > 0 && !notDialogs.length ? "✓ " : "✗ ") +
    "every sheet is a modal dialog: SHEET_IDS lists " + sheetIds.length + ", markup has " + panels.length + " panel(s), " + notDialogs.length + " incomplete");
  if (!sheetIds.length || panels.length !== sheetIds.length || notDialogs.length) problems++;
  report("sheets in SHEET_IDS with no element of that id in index.html", sheetIds.filter(id => !idsInHtml.has(id)));
  // closeTopSheet is what Escape reaches. A sheet missing from it is closed by
  // whatever the final `else` happens to be — which is another sheet's closer.
  const closeBody = (js.match(/function closeTopSheet\(\)\s*\{[\s\S]*?\n\}/) || [""])[0];
  const elseBranches = (closeBody.match(/else\s*\{?\s*close/g) || []).length;
  report("sheets Escape doesn't name explicitly in closeTopSheet (one may fall to the final else)",
    sheetIds.filter(id => closeBody.indexOf('"' + id + '"') === -1).slice(elseBranches ? 1 : 0));

  const landmarks = [
    ['skip link', /class="skip-link"[^>]*href="#main"/.test(html)],
    ['a <main id="main"> to skip to', /<main id="main" tabindex="-1">/.test(html)],
    ['a <nav> sidebar', /<nav id="sidebar"/.test(html)],
    ['the toast is a live region', /id="toast"[^>]*role="status"/.test(html)],
    ['an app-wide focus ring', /:focus-visible\{[^}]*outline:/.test(css.replace(/\s*\n\s*/g, ""))],
    ['a focus ring on the fields that set outline:none', /\.field input:focus-visible/.test(css)],
    ['a focus ring on the search box and message bar', /\.search-wrap:focus-within/.test(css) && /\.prompt-bar:focus-within/.test(css)],
    // The CSS boot lock is pointer-events only, which a keyboard ignores.
    ['a keyboard boot lock covering the nav', /BOOT_LOCK_SEL\s*=\s*"\.nav-item\[data-screen\]/.test(js) && /setBootLock\(true\)/.test(js) && /setBootLock\(false\)/.test(js)]
  ];
  landmarks.forEach(([what, present]) => { console.log((present ? "✓ " : "✗ ") + "present: " + what); if (!present) problems++; });
}

/* Contrast, recomputed rather than remembered. The reference surfaces below
   are the brightest 99.9th-percentile pixel of the six real backdrop photos in
   the band each surface sits over, already put through the #main::after scrim —
   measured once from assets/Backgrounds/*.jpg, which is why they are constants
   here and not something this script works out. Dialling any of these tokens
   back down is a silent regression otherwise: nothing about a low-contrast
   colour looks like a mistake. */
{
  const SCRIM_TOP = [242, 242, 238];       // under the top bar (scrim is weakest there)
  const SCRIM_BOTTOM = [116, 112, 100];    // under the dashboard panel
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (f, b) => { const [hi, lo] = [lum(f), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const over = (fg, a, bg) => [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a));
  const rgba = s => { const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/.exec(s || "");
    return m ? { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null; };
  const hex = s => { const m = /#([0-9a-f]{6})/i.exec(s || ""); return m ? [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16)) : null; };
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  const decl = (sel, prop) => { const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*?" + prop + ":\\s*([^;}]+)").exec(flat); return m ? m[1].trim() : null; };

  const ink70 = rgba(decl(":root", "--ink-70")), ink50 = rgba(decl(":root", "--ink-50"));
  const topbar = rgba(decl("#topbar", "background"));
  const navOpacity = parseFloat(decl(".nav-item", "opacity"));
  const warnText = hex(decl(".sync-warn", "color")), pillBlue = hex(decl(".pill-blue", "color"));
  const missing = [!ink70 && "--ink-70", !ink50 && "--ink-50", !topbar && "#topbar background",
                   !navOpacity && ".nav-item opacity", !warnText && ".sync-warn color", !pillBlue && ".pill-blue color"].filter(Boolean);
  report("contrast check couldn't read these values out of the CSS", missing);

  if (!missing.length) {
    const top = over(topbar.rgb, topbar.a, SCRIM_TOP);
    const panel = over([0, 0, 0], 0.45, SCRIM_BOTTOM);
    const chip = s => over([255, 255, 255], 0.15, s);
    const cases = [
      ["the farmer's name in the top bar", over([255, 255, 255], 1, top), top],
      ["the search placeholder in the top bar", over(ink50.rgb, ink50.a, top), top],
      ["the language toggle in the top bar", over(ink70.rgb, ink70.a, chip(top)), chip(top)],
      ["secondary text on a panel", over(ink50.rgb, ink50.a, panel), panel],
      ["chip text on a panel", over(ink70.rgb, ink70.a, chip(panel)), chip(panel)],
      ["inactive nav labels on the sidebar", over([255, 255, 255], navOpacity, [150, 37, 36]), [150, 37, 36]],
      ["the “not saved” chip", warnText, over([217, 164, 65], 0.16, top)],
      ["pill-blue on a panel", pillBlue, over([74, 134, 201], 0.22, panel)]
    ];
    const failed = cases.filter(([, f, b]) => ratio(f, b) < 4.5)
      .map(([label, f, b]) => label + " " + ratio(f, b).toFixed(2) + ":1");
    console.log("contrast, worst case over the six real backdrops: " +
      cases.map(([label, f, b]) => label.replace(/^the |^a /, "").split(" ")[0] + " " + ratio(f, b).toFixed(1)).join(" · "));
    report("text below WCAG AA (4.5:1) over the brightest backdrop", failed);
  }
}

/* ============================================================
   EXPORT CHECKS (ROADMAP item 12)
   A print stylesheet is invisible until someone prints, and this one is
   load-bearing: it is the whole PDF path. If it stops hiding the app, the
   "report" prints as a screenshot of a dark glass UI on white paper, and
   nothing on screen ever looks wrong.
   ============================================================ */
{
  const flatCss = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  const printBlock = (flatCss.match(/@media print\{([\s\S]*)/) || [, ""])[1];
  const checks = [
    ["a @media print block exists", /@media print\{/.test(flatCss)],
    ["print hides every other child of body", /body > \*\{ ?display:none ?!important/.test(printBlock)],
    ["...and puts #printReport back", /body > #printReport\{ ?display:block ?!important/.test(printBlock)],
    ["#printReport is hidden on screen", /#printReport\{ ?display:none/.test(flatCss)],
    // The rule above selects a DIRECT child of body. Nested one level deeper it
    // is hidden by its own ancestor and the printed page comes out blank.
    ["#printReport is a direct child of <body>", /<div id="printReport"[^>]*><\/div>\s*(<!--[\s\S]*?-->\s*)*<div id="toast"/.test(html) || /id="printReport"/.test(html.split(/<\/body>/)[0].split(/<div id="app"/).pop())],
    ["the CSV carries a UTF-8 BOM (Excel reads it as Latin-1 without one)", /\\uFEFF"? ?\+ lines\.join/.test(js)],
    ["the separator follows the UI language", /function csvSeparator\(\)[^\n]*currentLang\(\) === "it" \? ";" : ","/.test(js)],
    // A ";" file with "." decimals, or a "," file with "," decimals, is the same
    // broken column split the separator exists to avoid.
    ["decimals follow the separator", /csvSeparator\(\) === ";" \? s\.replace\("\.", ","\) : s/.test(js)],
    ["a cell that starts like a formula is neutralised", /FORMULA_START[\s\S]{0,200}"'" \+ s/.test(js)],
    ["the export button is in the keyboard boot lock", /BOOT_LOCK_SEL\s*=\s*"[^"]*#exportBtn/.test(js)]
  ];
  checks.forEach(([what, ok]) => { console.log((ok ? "✓ " : "✗ ") + "export: " + what); if (!ok) problems++; });

  // Every column key the export names has to exist in both dictionaries — a
  // missing one prints the key itself as a table header.
  const cols = [];
  for (const m of js.matchAll(/const (?:RESEARCH_COLS|OUTREACH_COLS) = \[([\s\S]*?)\]/g))
    for (const k of (m[1].match(/"([^"]+)"/g) || [])) cols.push("export.h." + k.replace(/"/g, ""));
  report("export column headers with no dictionary entry", cols.filter(k => !(k in i18n.STRINGS.en) || !(k in i18n.STRINGS.it)));
}

// Every DataStore.X( call in app.js must exist in supabase-client.js
const dsMethodsUsed = new Set();
for (const m of js.matchAll(/DataStore\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) dsMethodsUsed.add(m[1]);
const dsMethodsDefined = new Set();
for (const m of sbjs.matchAll(/^\s*(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm)) dsMethodsDefined.add(m[1]);
report("DataStore methods called from app.js but NOT defined in supabase-client.js", [...dsMethodsUsed].filter(m => !dsMethodsDefined.has(m)));

console.log("\n" + (problems === 0 ? "QA: PASS" : "QA: FAIL (" + problems + " issue(s) above)"));
process.exit(problems === 0 ? 0 : 1);
