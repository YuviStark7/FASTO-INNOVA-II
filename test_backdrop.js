/* FASTO INNOVA — backdrop cross-fade, checked against the REAL stylesheet.
   Optional dev tooling. Run: node test_backdrop.js [path]

   Unlike the hand-written fake DOM I used the first time (which is exactly why
   two bugs shipped), this loads css/app.css into jsdom and reads back COMPUTED
   opacity and z-index. That means the cascade decides the answers, not me — so
   a rule the browser would discard is discarded here too.

   What it cannot do: jsdom has no transitions, so it sees only the state before
   and after each step, never the dissolve itself. The mid-fade frame needs a
   real browser. Everything below is end-state.

   Requires jsdom:  npm install jsdom   (skips cleanly if it isn't there) */
const fs = require("fs");
const root = process.argv[2] || __dirname;

/* jsdom is the one piece of tooling here that needs installing, which is why
   this script is optional rather than part of the standard three. If it isn't
   there, say so plainly and stop — do NOT report a pass, and do not fail the
   build either. The structural half of what this checks (the stacking order,
   and that the stylesheet parses at all) is covered by qa_check.js, which
   needs nothing installed and runs every time. */
let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch (e) {
  try { ({ JSDOM } = require("/tmp/node_modules/jsdom")); }
  catch (e2) {
    console.log("SKIPPED — this one needs jsdom. Install it once with:  npm install jsdom");
    console.log("(qa_check.js still checks the backdrop stacking order and that the CSS parses.)");
    process.exit(0);
  }
}

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗ FAIL:", n, x === undefined ? "" : x));

const css = fs.readFileSync(root + "/css/base.css", "utf8") + "\n" + fs.readFileSync(root + "/css/app.css", "utf8");
const appjs = fs.readFileSync(root + "/js/app.js", "utf8");
const html = fs.readFileSync(root + "/index.html", "utf8")
  .replace(/<link[^>]*app\.css[^>]*>/, "<style>" + css + "</style>")
  .replace(/<link[^>]*base\.css[^>]*>/, "")
  .replace(/<script[^>]*><\/script>/g, "");

const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: "dangerously" });
const { window } = dom;
const doc = window.document;

// The real backdrop code, lifted out of app.js rather than retyped.
const s = appjs.indexOf("// Start somewhere random");
const r = appjs.indexOf("function rotateBackdrop()");
const code = appjs.slice(s, appjs.indexOf("}", appjs.indexOf("showBackdrop();", r)) + 1);
for (const t of ["settleBackdrop", "BACKDROP_FADE_MS", "classList.add(\"front\")"])
  if (!code.includes(t)) { console.log("extraction missed " + t); process.exit(1); }

/* jsdom does not fetch images, so a real `new Image()` never fires onload and
   showBackdrop would wait forever. This stands in for a photo that is already
   cached — the normal case in the app, since the next one is fetched a whole
   screen-visit ahead. Whether the waiting-for-the-file path works is a
   different question, and the real-browser test covers it. */
window.eval(`
  window.Image = class { set src(v) { this._src = v; this.complete = true; } get src() { return this._src; } };
  const $ = id => document.getElementById(id);
  const BACKDROPS = ["a.jpg","b.jpg","c.jpg","d.jpg","e.jpg","f.jpg"];
  ${code}
  window.__t = { showBackdrop, rotateBackdrop, BACKDROPS, idx: () => backdropIdx };
`);

const A = doc.getElementById("backdropA"), B = doc.getElementById("backdropB");
const topbar = doc.getElementById("topbar");
const cs = el => window.getComputedStyle(el);
const opacity = el => parseFloat(cs(el).opacity);
const zof = el => { const z = el.style.zIndex || cs(el).zIndex; return (!z || z === "auto") ? 0 : Number(z); };
const t = window.__t;

console.log("== the stylesheet is actually being applied (if this fails, nothing below means anything) ==");
check("both layers start transparent — the .backdrop-layer rule parsed and won",
  opacity(A) === 0 && opacity(B) === 0, "A=" + opacity(A) + " B=" + opacity(B));
// jsdom cannot compute pseudo-elements, so the scrim is read from the
// stylesheet text instead (qa_check.js checks the same numbers on every run).
check("the scrim overlay is above both layers",
  /#main::after\{[^}]*z-index:\s*2/.test(css.replace(/\s+/g, " ")));
check("the topbar is above the scrim", Number(cs(topbar).zIndex) === 3, cs(topbar).zIndex);

console.log("== one photo visible at a time, across a full cycle and beyond ==");
t.showBackdrop();
check("after the first reveal exactly one layer is opaque", (opacity(A) === 1) !== (opacity(B) === 1), "A=" + opacity(A) + " B=" + opacity(B));

// The cleanup that hides the outgoing layer runs on a timer; jsdom's clock is
// real, so step through with the same waits the browser would take.
const SETTLE = 1000;
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let n = 2; n <= 9; n++) {
    t.rotateBackdrop();
    await sleep(SETTLE);
    check("swap " + n + ": exactly one layer left opaque (the other is free to reuse)",
      (opacity(A) === 1) !== (opacity(B) === 1), "A=" + opacity(A) + " B=" + opacity(B));
    check("swap " + n + ": neither layer reaches the scrim's z-index of 2",
      Math.max(zof(A), zof(B)) < 2, "highest: " + Math.max(zof(A), zof(B)));
    check("swap " + n + ": the visible layer is the one in front",
      (opacity(A) === 1 ? A : B).classList.contains("front"));
    check("swap " + n + ": the visible layer carries the current photo",
      (opacity(A) === 1 ? A : B).style.backgroundImage.includes(t.BACKDROPS[t.idx()]),
      (opacity(A) === 1 ? A : B).style.backgroundImage + " vs " + t.BACKDROPS[t.idx()]);
  }

  console.log("== leaving and returning faster than the fade ==");
  t.rotateBackdrop(); await sleep(120);
  t.rotateBackdrop(); await sleep(120);
  t.rotateBackdrop(); await sleep(SETTLE + 200);
  check("three swaps inside one fade still settle to one opaque layer",
    (opacity(A) === 1) !== (opacity(B) === 1), "A=" + opacity(A) + " B=" + opacity(B));
  check("...and nothing has climbed above the scrim", Math.max(zof(A), zof(B)) < 2, "highest: " + Math.max(zof(A), zof(B)));
  check("...and the photo shown is the current one",
    (opacity(A) === 1 ? A : B).style.backgroundImage.includes(t.BACKDROPS[t.idx()]));

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
