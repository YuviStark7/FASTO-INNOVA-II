/* ============================================================
   Glass folder card (ROADMAP: My products look, requested by Yuvi 2026-10-12)
   ------------------------------------------------------------
   A plain-JS port of the "Glass Folder Cards" idea (the original was a React +
   Tailwind component, which this project cannot use: no framework, no build
   step). A folder is drawn as an object: a back panel, the files inside, and a
   frosted-glass front panel that leans toward you on hover or focus and falls
   forward when the folder is opened. The files are real buttons.

   2026-10-15 (Yuvi): the card shows a status pill level with the folder's top
   edge, the name in capitals, the kind of product, and icon buttons on the front
   instead of text lines and buttons underneath. (The front was made solid for one
   day and then put back to frosted glass, as before.)

   Differences from the original, on purpose: no React; the back panel is a CSS
   gradient chosen from the product's name (the original paints generated
   noise art into a canvas); no "+" key or "..." menu (the product card keeps
   its own buttons below the folder); no scroll-in entrance animation.

   Everything here is pure string-building plus one tiny toggle; the styles are
   in css/folder.css.
   ============================================================ */
const GF_W = 340, GF_H = 272, GF_HEADROOM = 54, GF_FRONT_TOP = 74, GF_FRONT_H = GF_H - GF_FRONT_TOP, GF_MAX_FILES = 4;
const GF_BACK_PATH = "M0 56A22 22 0 0 1 22 34L146 34C170 34 172 0 198 0L318 0A22 22 0 0 1 340 22L340 250A22 22 0 0 1 318 272L22 272A22 22 0 0 1 0 250Z";
const GF_FRONT_PATH = "M0 22A22 22 0 0 1 22 0L118 0C144 0 146 32 172 32L318 32A22 22 0 0 1 340 54L340 " + (GF_FRONT_H - 22) +
  "A22 22 0 0 1 318 " + GF_FRONT_H + "L22 " + GF_FRONT_H + "A22 22 0 0 1 0 " + (GF_FRONT_H - 22) + "Z";
// The five colour recipes of the original, trimmed to the stops a gradient needs.
const GF_ART = [
  ["#f4efe9", "#e9c2b8", "#c2433f", "#22395e", "#6f97c2"],   // aurora
  ["#16252c", "#3d5f68", "#a3201a", "#ef4a2b", "#ff8a5c"],   // ember
  ["#3e2850", "#8f6c9c", "#b3502f", "#eab08a", "#fbe7d2"],   // dusk
  ["#d9e2ea", "#9fb4c7", "#bccbd8", "#e8edf2", "#ffffff"],   // glacier
  ["#173024", "#4f7a5a", "#a7843a", "#e9cf87", "#fbf3d6"]    // verdant
];
/* The front panel's frosted glass has to stop exactly at the panel's outline. A plain clip-path did not stop
   the blur: in Chrome the blurred rectangle leaked past the rounded corners and showed as a ghost box when the
   folder leans. A mask of the same shape clips the blur properly. */
function gfFrontMask() {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + GF_W + " " + GF_FRONT_H + "'><path d='" + GF_FRONT_PATH + "' fill='black'/></svg>";
  const url = "url('data:image/svg+xml," + encodeURIComponent(svg).replace(/'/g, "%27") + "')";
  return "-webkit-mask-image:" + url + ";mask-image:" + url + ";-webkit-mask-size:" + GF_W + "px " + GF_FRONT_H + "px;mask-size:" + GF_W + "px " + GF_FRONT_H + "px;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;";
}
function gfHash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function gfEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
// A back-panel picture for a name: the same name always gets the same picture.
function gfArtStyle(seedText) {
  const h = gfHash(seedText), c = GF_ART[h % GF_ART.length], a = (h >> 3) % 360, x = 15 + ((h >> 7) % 70), y = 10 + ((h >> 11) % 60);
  return "background:radial-gradient(90% 80% at " + x + "% " + y + "%, " + c[4] + " 0%, transparent 62%)," +
    "radial-gradient(80% 90% at " + (100 - x) + "% " + (100 - y) + "%, " + c[2] + " 0%, transparent 66%)," +
    "linear-gradient(" + a + "deg, " + c[0] + ", " + c[1] + " 55%, " + c[3] + ")";
}

/* o: { id, label, meta, width, seed, openLabel, closeLabel, filesLabel,
        badge: { text, tone },                       a small status pill level with the folder's top edge
        blank: true, onclick: "..."                  a plain white "add" folder: no colour, no files; pressing it runs onclick
        actions: [{ icon, label, aria, onclick }],   icon buttons on the front; the label slides out on hover
        files: [{ id, name, meta, path, image (bool), onclick }] } */
function folderCardHTML(o) {
  const width = o.width || 300, k = width / GF_W, uid = String(o.id).replace(/[^a-z0-9]/gi, "");
  const files = (o.files || []).slice(-GF_MAX_FILES);
  const sheets = files.map((f, v) => {
    const depth = files.length - 1 - v;
    const slot = files.length <= 1 ? 0 : (v / (files.length - 1)) * 2 - 1;
    const j = gfHash(f.name + v);
    const jx = (((j % 1000) / 1000 - 0.5) * 10).toFixed(2) + "px", jr = ((((j >> 10) % 1000) / 1000 - 0.5) * 3.2).toFixed(2) + "deg";
    return '<div role="listitem" class="gf-sheet-slot"><button type="button" class="gf-sheet' + (f.image ? " gf-sheet--art" : "") + '"' +
      ' data-path="' + gfEsc(f.path || "") + '"' + (f.image ? ' data-image="1"' : "") + ' onclick="' + gfEsc(f.onclick || "") + '"' +
      ' aria-label="' + gfEsc(f.openLabel || f.name) + '"' +
      ' style="--gf-slot:' + slot + ";--gf-depth:" + depth + ";--gf-jx:" + jx + ";--gf-jr:" + jr + ";z-index:" + (v + 1) + '">' +
      (f.image ? '<span class="gf-sheet-art"></span>' :
        '<span class="gf-lines" aria-hidden="true"><i style="width:86%"></i><i style="width:92%"></i><i style="width:64%"></i><i style="width:88%"></i><i style="width:42%"></i></span>') +
      '<span class="gf-sheet-head"><span class="gf-sheet-name">' + gfEsc(f.name) + "</span>" + (f.meta ? '<span class="gf-sheet-meta">' + gfEsc(f.meta) + "</span>" : "") + "</span></button></div>";
  }).join("");
  const badge = o.badge ? '<span class="gf-badge gf-badge--' + gfEsc(o.badge.tone || "draft") + '" style="top:' + (GF_HEADROOM * k - 7).toFixed(1) + 'px">' + gfEsc(o.badge.text) + "</span>" : "";
  // The folder is drawn at 340 px and scaled down by k. Text and buttons must not shrink with it (an 8 px caption is unreadable),
  // so they are sized in screen pixels through --gf-k (see folder.css); icons are drawn bigger here for the same reason.
  const icon = n => (typeof lucide === "function" ? lucide(n, Math.round(16 / k)) : "");
  const actions = (o.actions || []).map(a => '<button type="button" class="gf-act" aria-label="' + gfEsc(a.aria || a.label) + '" onclick="' + gfEsc(a.onclick || "") + '">' +
    icon(a.icon) + '<span class="gf-act-label" aria-hidden="true">' + gfEsc(a.label) + "</span></button>").join("");
  const blank = !!o.blank;
  const hitClick = blank ? gfEsc(o.onclick || "") : "toggleFolder(this)";
  const plus = blank && typeof lucide === "function" ? '<div class="gf-actions"><span class="gf-act gf-plus" aria-hidden="true">' + lucide("plus", Math.round(16 / k)) + "</span></div>" : "";
  return '<div class="gf-root' + (blank ? " gf-root--blank" : "") + '" data-tone="dark" data-place="bottom-left" style="--gf-k:' + k.toFixed(4) + ";width:" + width + "px;height:" + ((GF_H + GF_HEADROOM) * k).toFixed(1) + 'px">' + badge +
    '<div class="gf-stage" style="transform:translateY(' + (GF_HEADROOM * k).toFixed(1) + "px) scale(" + k.toFixed(4) + ')"><div class="gf-tilt">' +
    '<div class="gf-shadow" aria-hidden="true"></div>' +
    '<div class="gf-back" style="clip-path:path(\'' + GF_BACK_PATH + "');" + (blank ? "" : gfEsc(gfArtStyle(o.seed || o.label))) + '" aria-hidden="true"><div class="gf-back-sheen"></div></div>' +
    '<svg class="gf-rim gf-back-rim" viewBox="0 0 ' + GF_W + " " + GF_H + '" aria-hidden="true"><path d="' + GF_BACK_PATH + '"/></svg>' +
    '<div class="gf-front" style="clip-path:path(\'' + GF_FRONT_PATH + '\');' + gfEsc(gfFrontMask()) + '"><div class="gf-tint" aria-hidden="true"></div><div class="gf-spec" aria-hidden="true"></div>' +
    '<svg class="gf-rim gf-front-rim" viewBox="0 0 ' + GF_W + " " + GF_FRONT_H + '" aria-hidden="true"><defs><linearGradient id="gf-rim-' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0.12"/></linearGradient></defs>' +
    '<path d="' + GF_FRONT_PATH + '" stroke="url(#gf-rim-' + uid + ')"/></svg>' +
    '<button type="button" class="gf-hit"' + (blank ? "" : ' aria-expanded="false" data-open-label="' + gfEsc(o.openLabel) + '" data-close-label="' + gfEsc(o.closeLabel) + '"') +
    ' aria-label="' + gfEsc(o.openLabel) + '" onclick="' + hitClick + '"></button>' +
    '<div class="gf-label"><span class="gf-title">' + gfEsc(o.label) + '</span><span class="gf-meta">' + gfEsc(o.meta || "") + "</span></div>" +
    (actions ? '<div class="gf-actions">' + actions + "</div>" : plus) + "</div>" +
    '<div class="gf-files" role="list" aria-label="' + gfEsc(o.filesLabel || "") + '" inert>' + sheets + "</div>" +
    "</div></div></div>";
}

// Open or close one folder in place (no re-render, so nothing flickers).
function toggleFolder(btn) {
  const root = btn.closest(".gf-root"); if (!root) return;
  setFolderOpen(root, !root.hasAttribute("data-open"));
}
function setFolderOpen(root, open) {
  const btn = root.querySelector(".gf-hit"), files = root.querySelector(".gf-files");
  root.toggleAttribute("data-open", open);
  if (btn) { btn.setAttribute("aria-expanded", open ? "true" : "false"); btn.setAttribute("aria-label", btn.getAttribute(open ? "data-close-label" : "data-open-label") || ""); }
  if (files) files.toggleAttribute("inert", !open);
  if (open && typeof window.onFolderOpened === "function") window.onFolderOpened(root);
}
// Escape closes an open folder; a press outside closes the others.
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".gf-root[data-open]").forEach(r => { setFolderOpen(r, false); const b = r.querySelector(".gf-hit"); if (b) b.focus(); });
  });
  document.addEventListener("pointerdown", e => {
    document.querySelectorAll(".gf-root[data-open]").forEach(r => { if (!r.contains(e.target)) setFolderOpen(r, false); });
  });
}
