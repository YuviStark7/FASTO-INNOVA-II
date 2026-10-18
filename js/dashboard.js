/* ============================================================
   FASTO INNOVA — the farmer's Dashboard home (requested by Yuvi, 2026-10-17)
   ------------------------------------------------------------
   A "bento" grid of seven tiles above the old Research Progress table:
     1 Needs your attention   2 Your shop (four small tiles)   3 Best buyers + map
     4 Buyer interest         5 Document health                6 Market gaps
     7 Recent activity
   (Latest conversations, Your pipeline and What you can sell this month were
   taken off the page at Yuvi's request, 2026-10-17.)

   What each tile SAYS is decided by pure functions in core.js (buildAttention,
   buildShopTiles, ...), which are unit tested. This file only gathers the data
   (dashInput) and draws it. Every tile is a real section with a heading, every
   row you can press is a button, and every icon is decoration (the words say it).
   ============================================================ */

/* ---------- gathering the data ---------- */
function dashInput() {
  return {
    now: Date.now(),
    clients: (state.clients || []).map(c => ({ id: c.id, name: c.name, status: c.status, initiatedBy: c.initiatedBy, chatId: c.chatId, productId: c.productId,
      buyerId: c.buyerId, seenAt: c.seenAt, ts: c.ts, messages: c.messages || [] })),
    products: state.products || [], docCounts: state.productDocCounts || {}, docs: state.productDocs || {},
    views: state.productViews || {}, events: state.productEvents || []
  };
}
// Everything the farmer sells, each with the buyers that fit it best (the same engines the chat uses).
function dashSubjects() {
  const out = [], month = new Date().getMonth() + 1;
  (state.products || []).forEach(p => {
    if (p.status === "archived" || !p.ai_category) return;
    out.push({ name: p.name, chatId: p.source_chat_id, rows: rankPackaged(p, DB) });
  });
  (state.chats || []).forEach(c => {
    if (!c.profile || !(c.profile.products || []).length) return;
    out.push({ name: c.title, chatId: c.id, rows: rankMatches(c.profile, DB, month) });
  });
  return out;
}
function dashBuyerPoint(id) {
  const all = (DB.buyers || []).concat(DB.channels || []);
  const b = all.filter(x => x.id === id)[0];
  return b && isFinite(Number(b.lat)) && isFinite(Number(b.lng)) ? [Number(b.lat), Number(b.lng)] : null;
}

/* ---------- small helpers ---------- */
function dashFmtDate(iso) {
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00");
  return isFinite(d) ? d.toLocaleDateString(T("date.locale"), { day: "2-digit", month: "short", year: "numeric" }) : String(iso);
}
function dashIcon(name, size) { return typeof lucide === "function" ? lucide(name, size || 16) : ""; }
// A rounded square holding one icon, tinted by tone: red, amber, green, blue, or plain.
function dashChip(icon, tone, size) { return `<span class="dash-ico t-${tone || "plain"}" aria-hidden="true">${dashIcon(icon, size || 18)}</span>`; }
/* One bento tile: an icon chip and a title across the top, then whatever the tile holds. */
function dashTile(id, icon, tone, titleKey, body, cls, badge) {
  return `<section class="dash-card glass-45 dash-bento ${cls || ""}" data-tile="${id}" aria-labelledby="dh-${id}"><header class="dash-head">${dashChip(icon, tone)}<h3 class="dash-h" id="dh-${id}">${esc(T(titleKey))}</h3>${badge || ""}</header>${body}</section>`;
}
function dashEmpty(key, icon, tone) {
  return `<div class="dash-empty">${icon ? dashChip(icon, tone || "plain", 26) : ""}<p>${esc(T(key))}</p></div>`;
}
function dashRow(icon, tone, text, go, extra) {
  return `<li><button type="button" class="dash-row" onclick="dashGo(${go})">${dashChip(icon, tone, 17)}<span class="dash-row-text">${text}</span>${extra || ""}${dashIcon("chevron-right", 14)}</button></li>`;
}
function dashGoArgs(g) { return "'" + esc(g.to) + "','" + esc(g.id || "") + "','" + esc(g.tab || "") + "'"; }

/* Where a row on the dashboard takes you. */
async function dashGo(to, id, tab) {
  if (to === "client") { state.activeClientId = id; switchScreen("clients"); return; }
  if (to === "shop") { switchScreen("products"); return; }
  if (to === "product") { await openProductChat(id); if (tab) setPanelTab(tab); }
}

/* ---------- the tiles ---------- */
function attentionText(it) {
  switch (it.k) {
    case "unread": return esc(T("dh.a.unread", { n: it.n }));
    case "awaiting": return esc(T("dh.a.awaiting", { n: it.n }));
    case "ready": return esc(T("dh.a.ready", { name: it.name }));
    case "almost": return esc(T("dh.a.almost", { name: it.name, done: it.done, total: it.total }));
    case "drafts": return esc(T("dh.a.drafts", { n: it.n }));
    case "expired": return esc(T("dh.a.expired", { file: it.file, name: it.name, date: dashFmtDate(it.date) }));
    default: return esc(T("dh.a.soon", { file: it.file, name: it.name, date: dashFmtDate(it.date) }));
  }
}
const ATTENTION_ICON = { unread: "message-square", awaiting: "clock", ready: "rocket", almost: "circle-alert", drafts: "pencil", expired: "circle-alert", soon: "clock" };
const ATTENTION_TONE = { unread: "blue", awaiting: "amber", ready: "green", almost: "green", drafts: "plain", expired: "red", soon: "amber" };
// The hero tile: brick-red glass, one row per thing that needs you.
function dashAttentionHTML(d) {
  const all = buildAttention(d), items = all.slice(0, 7);
  const body = items.length
    ? `<ul class="dash-list">${items.map(it => dashRow(ATTENTION_ICON[it.k] || "circle-alert", ATTENTION_TONE[it.k] || "plain", attentionText(it), dashGoArgs(it.go))).join("")}</ul>`
    : dashEmpty("dh.a.none", "circle-check", "green");
  return dashTile("attention", "bell", "plain", "dh.title.attention", body, "dash-span-6 dash-rows-2 dash-attn", all.length ? `<span class="dash-count" aria-hidden="true">${all.length}</span>` : "");
}
/* Your shop: four small tiles in a 2 x 2 block, each one a button into My shop. The block has no background of its own,
   so to the eye they are four separate bento tiles; to a screen reader they are one labelled group. */
function dashShopHTML(d) {
  const t = buildShopTiles(d);
  const label = `<h3 class="sr-only" id="dh-shop">${esc(T("dh.title.shop"))}</h3>`;
  if (!t.total) return `<section class="dash-shop dash-span-6 dash-rows-2" data-tile="shop" aria-labelledby="dh-shop">${label}<div class="dash-card glass-45 dash-bento dash-shop-empty">${dashEmpty("dh.t.none", "store")}</div></section>`;
  const tile = (icon, tone, n, key) => `<button type="button" class="dash-card dash-bento dash-stat" onclick="dashGo('shop')">${dashChip(icon, tone)}<b>${esc(n)}</b><span class="dash-stat-label">${esc(T(key))}</span></button>`;
  const ring = `<svg class="dash-ring" viewBox="0 0 36 36" aria-hidden="true" focusable="false"><circle class="bg" cx="18" cy="18" r="15.9155" pathLength="100"/><circle class="fg" cx="18" cy="18" r="15.9155" pathLength="100" stroke-dasharray="${t.avgPct} 100"/></svg>`;
  const gauge = `<button type="button" class="dash-card dash-bento dash-stat dash-gauge" onclick="dashGo('shop')"><span class="dash-ring-wrap">${ring}<b>${t.avgPct}%</b></span><span class="dash-stat-label">${esc(T("dh.t.complete"))}</span>` +
    (t.archived ? `<small>${esc(T("dh.t.archived", { n: t.archived }))}</small>` : "") + `</button>`;
  return `<section class="dash-shop dash-span-6 dash-rows-2" data-tile="shop" aria-labelledby="dh-shop">${label}${tile("rocket", "green", t.live, "dh.t.live")}${tile("pencil", "amber", t.draft, "dh.t.drafts")}${tile("circle-check", "blue", t.ready, "dh.t.ready")}${gauge}</section>`;
}
function dashBestHTML(subjects) {
  const best = buildBestBuyers(subjects, 3);
  const rows = best.length ? `<ul class="dash-list dash-best-list">${best.map((b, i) => {
    const km = isFinite(Number(b.distance_km)) ? " · " + Math.round(Number(b.distance_km)) + " km" : "";
    return `<li class="dash-best">${avatarHTML(b.name, i)}<span class="dash-best-main"><b>${esc(b.name)}</b><small>${esc((b.type || "").replace(/_/g, " "))}${esc(km)} · ${esc(T("dh.b.for", { name: b.forName }))}</small></span><span class="pill ${scorePillClass(b.score)}">${b.score}/100</span></li>`;
  }).join("")}</ul>` : dashEmpty("dh.b.none", "target");
  // The map host starts hidden; paintDashMap shows it (and widens the tile) once there is something to draw.
  const map = best.length ? `<div class="dash-map-host" id="dashMapHost" role="group" aria-label="${escAttr(T("dh.b.mapAria"))}" hidden></div>` : "";
  const note = best.length ? `<p class="dash-note" id="dashMapNote" hidden>${esc(T("dh.b.noMap"))}</p>` : "";
  return dashTile("best", "target", "red", "dh.title.best", `<div class="dash-best-grid" id="dashBestGrid"><div>${rows}${note}</div>${map}</div>`, "dash-span-7 dash-rows-2");
}
function dashInterestHTML(d) {
  const rows = buildInterest(d);
  if (!rows.length) return dashTile("interest", "eye", "blue", "dh.title.interest", dashEmpty("dh.i.none", "eye"), "dash-span-5");
  const month = rows.reduce((n, r) => n + r.last30, 0);
  const stat = (icon, n, key) => `<span class="dash-metric">${dashIcon(icon, 14)}<em>${n}</em><i>${esc(T(key))}</i></span>`;
  const list = rows.slice(0, 3).map(r => `<li class="dash-int"><b>${esc(r.name)}</b><span class="dash-metrics">${stat("eye", r.last30, "dh.i.month")}${stat("trending-up", r.total, "dh.i.total")}${stat("message-square", r.contacts, "dh.i.contacts")}</span></li>`).join("");
  const body = `<p class="dash-big"><b>${month}</b><span>${esc(T("dh.i.month"))}</span></p><ul class="dash-list dash-plain">${list}</ul><p class="dash-note">${esc(T("dh.i.note"))}</p>`;
  return dashTile("interest", "eye", "blue", "dh.title.interest", body, "dash-span-5");
}
function dashDocsHTML(d) {
  const h = buildDocHealth(d);
  if (h.ok) return dashTile("docs", "shield-check", "green", "dh.title.docs", dashEmpty("dh.d.ok", "shield-check", "green"), "dash-span-5");
  const go = (id, tab) => dashGoArgs({ to: "product", id, tab });
  const rows = [];
  h.expiring.forEach(e => rows.push(dashRow("circle-alert", e.state === "expired" ? "red" : "amber", esc(T(e.state === "expired" ? "dh.d.expired" : "dh.d.soon", { file: e.file, name: e.name, date: dashFmtDate(e.date) })), go(e.id, "documents"))));
  h.noDocs.forEach(e => rows.push(dashRow("file-text", "amber", esc(T("dh.d.nodocs", { name: e.name })), go(e.id, "documents"))));
  h.optional.slice(0, 4).forEach(e => rows.push(dashRow("check", "plain", esc(T("dh.d.optional", { name: e.name, doc: e.doc })), go(e.id, "roadmap"))));
  return dashTile("docs", "shield-check", "amber", "dh.title.docs", `<ul class="dash-list">${rows.slice(0, 6).join("")}</ul>`, "dash-span-5");
}
function dashGapsHTML(subjects, d) {
  // the three biggest gaps (good-fit businesses not yet written to) are enough for a tile
  const gaps = buildGaps(subjects, d.clients).sort((a, b) => (b.fit - b.contacted) - (a.fit - a.contacted)).slice(0, 3);
  const body = gaps.length ? `<ul class="dash-list dash-plain">${gaps.map(g => `<li class="dash-gap"><b>${esc(g.name)}</b>
      <span class="dash-gap-bar" aria-hidden="true"><i style="width:${Math.max(3, Math.round(g.contacted * 100 / g.fit))}%"></i></span>
      <span class="dash-metrics"><span class="dash-metric">${dashIcon("users", 14)}${esc(T("dh.g.near", { n: g.fit, km: g.km }))}</span><span class="dash-metric">${dashIcon("send", 14)}${esc(T("dh.g.sent", { n: g.contacted }))}</span></span></li>`).join("")}</ul>`
    : dashEmpty("dh.g.none", "map-pin");
  return dashTile("gaps", "map-pin", "amber", "dh.title.gaps", body, "dash-span-5");
}
const TIMELINE_ICON = { created: "plus", launched: "rocket", withdrawn: "eye-off", archived: "archive", restored: "archive-restore", doc: "file-text", buyerMsg: "message-square", seen: "check", inquiry: "message-square" };
const TIMELINE_TONE = { created: "plain", launched: "green", withdrawn: "plain", archived: "plain", restored: "plain", doc: "blue", buyerMsg: "blue", seen: "green", inquiry: "blue" };
function timelineText(e) {
  switch (e.k) {
    case "created": return T("dh.e.created", { name: e.name });
    case "launched": return T("dh.e.launched", { name: e.name });
    case "withdrawn": return T("dh.e.withdrawn", { name: e.name });
    case "archived": return T("dh.e.archived", { name: e.name });
    case "restored": return T("dh.e.restored", { name: e.name });
    case "doc": return T("dh.e.doc", { name: e.name, file: e.file });
    case "buyerMsg": return T("dh.e.buyerMsg", { buyer: e.buyer });
    case "seen": return T("dh.e.seen", { buyer: e.buyer });
    default: return T("dh.e.inquiry", { buyer: e.buyer });
  }
}
function dashTimelineHTML(d) {
  const ev = buildTimeline(d, 8);
  const body = ev.length ? `<ul class="dash-timeline">${ev.map(e => `<li>${dashChip(TIMELINE_ICON[e.k] || "check", TIMELINE_TONE[e.k] || "plain", 16)}<span class="dash-tl-text">${esc(timelineText(e))}</span><time>${esc(relDate(e.ts))}</time></li>`).join("")}</ul>` : dashEmpty("dh.e.none", "history");
  return dashTile("timeline", "history", "plain", "dh.title.timeline", body, "dash-span-7 dash-tl");
}

/* ---------- the page ---------- */
function renderDashHome() {
  const host = $("dashHome"); if (!host) return;
  // While the account is still loading the tiles would only say "nothing yet", which is not true.
  const app = $("app"); if (app && app.classList && app.classList.contains("booting")) { host.innerHTML = ""; return; }
  const d = dashInput(), subjects = dashSubjects();
  const parts = { attention: dashAttentionHTML(d), shop: dashShopHTML(d), best: dashBestHTML(subjects), interest: dashInterestHTML(d),
    docs: dashDocsHTML(d), gaps: dashGapsHTML(subjects, d), timeline: dashTimelineHTML(d) };
  dashOrder = dashTileOrder(dashOrderLoad());
  host.innerHTML = dashOrder.map(id => parts[id]).join("");
  dashDragSetup(host);
  paintDashMap(buildBestBuyers(subjects, 6));
}

/* The small map inside "Best buyers right now". It is made once and moved into each new tile, because the tile is redrawn
   whenever the dashboard is; if the map cannot load, the list beside it already says the same thing and the tile stays one column. */
let dashMapEl = null, dashMap = null, dashLayer = null;
async function paintDashMap(best) {
  if (!$("dashMapHost") || typeof window === "undefined" || !best.length) return;
  const pts = best.map(b => ({ b, ll: dashBuyerPoint(b.id) })).filter(x => x.ll);
  if (!pts.length) return;
  try {
    const L = await loadLeaflet();
    // The tile may have been redrawn (a language switch, a search) or left while Leaflet was loading: use the one on the page now.
    const host = $("dashMapHost"), grid = $("dashBestGrid");
    if (!host) return;
    host.hidden = false; if (grid && grid.classList) grid.classList.add("has-map");
    if (!dashMapEl) { dashMapEl = document.createElement("div"); dashMapEl.className = "dash-map"; dashMapEl.style.cssText = "position:absolute;inset:0"; }
    host.appendChild(dashMapEl);
    if (!dashMap) {
      dashMap = L.map(dashMapEl, { scrollWheelZoom: false }).setView([41.49, 13.83], 11);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: T("admin.map.attribution") }).addTo(dashMap);
      dashLayer = L.layerGroup().addTo(dashMap);
    }
    dashLayer.clearLayers();
    pts.forEach(({ b, ll }) => L.circleMarker(ll, { radius: 8, color: "#000", weight: 1, fillColor: "#d94a48", fillOpacity: 0.9 }).bindTooltip(esc(b.name)).addTo(dashLayer));
    setTimeout(() => { if (dashMap) { dashMap.invalidateSize(); dashMap.fitBounds(pts.map(x => x.ll), { padding: [24, 24], maxZoom: 13 }); } }, 0);
  } catch (e) {
    const n = $("dashMapNote"); if (n) n.hidden = false;
  }
}

/* ---------- drag to rearrange (plain-JS port of the idea in 21st.dev's "Draggable Widget Grid") ----------
   The tiles are the grid's children; their order in the DOM is the layout, so moving a tile means moving its element
   (the Leaflet map inside "Best buyers" travels with it). Mouse and pen drag after 6 px of movement; touch needs a long
   press so the page can still scroll; keyboard: focus a tile, hold Alt, press an arrow key. The order is kept on this
   device only (localStorage), because it is a view preference, not business data. */
const DASH_ORDER_KEY = "fasto_dash_order";
let dashOrder = DASH_TILE_IDS.slice();
let dashDrag = null;           // the drag in progress, if any
let dashSwallowUntil = 0;      // ignore the click that follows a drop

function dashOrderLoad() {
  try { return JSON.parse(localStorage.getItem(DASH_ORDER_KEY) || "null"); } catch (e) { return null; }
}
function dashOrderSave(order) {
  try {
    if (dashOrderIsDefault(order)) localStorage.removeItem(DASH_ORDER_KEY);
    else localStorage.setItem(DASH_ORDER_KEY, JSON.stringify(order));
  } catch (e) { /* private window or blocked storage: the order just lasts until the page is reloaded */ }
}
function dashTiles(host) { return Array.from((host && host.children) || []).filter(n => n.dataset && n.dataset.tile); }
function dashTileName(el) {
  const h = el.querySelector("h3,.dash-shop-label,[id^='dh-']"); return h ? h.textContent.trim() : (el.dataset.tile || "");
}
function dashReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function dashSay(text) { const n = $("dashLayoutLive"); if (n) n.textContent = text; }
function dashPaintLayoutBar() {
  const bar = $("dashLayoutBar"); if (!bar) return;
  const host = $("dashHome");
  bar.hidden = !host || !(host.children && host.children.length);
  const reset = $("dashResetBtn"); if (reset) reset.hidden = dashOrderIsDefault(dashOrder);
}

/* Put the tiles in `order`, sliding each one from where it was (FLIP). The tile being dragged is left alone. */
function dashApplyOrder(host, order, skip) {
  const tiles = dashTiles(host), before = new Map();
  tiles.forEach(t => before.set(t, { x: t.offsetLeft, y: t.offsetTop }));
  order.forEach(id => { const t = tiles.find(x => x.dataset.tile === id); if (t) host.appendChild(t); });
  dashOrder = order.slice();
  if (!dashReducedMotion()) tiles.forEach(t => {
    if (t === skip || !t.animate) return;
    const b = before.get(t), dx = b.x - t.offsetLeft, dy = b.y - t.offsetTop;
    if (dx || dy) t.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
  });
}

function dashDragSetup(host) {
  dashPaintLayoutBar();
  if (!host.addEventListener || !host.dataset) return;   // not a real element (a test double)
  if (host.dataset.dragReady) { dashTiles(host).forEach(t => { t.tabIndex = 0; }); return; }   // listeners live on the grid, which is never replaced
  host.dataset.dragReady = "1";
  dashTiles(host).forEach(t => { t.tabIndex = 0; });
  host.addEventListener("pointerdown", dashPointerDown);
  host.addEventListener("keydown", dashKeyDown);
  host.addEventListener("click", e => { if (performance.now() < dashSwallowUntil) { e.preventDefault(); e.stopPropagation(); } }, true);
  host.addEventListener("touchmove", e => { if (dashDrag && dashDrag.active) e.preventDefault(); }, { passive: false });
  host.addEventListener("contextmenu", e => { if (dashDrag) e.preventDefault(); });
  const reset = $("dashResetBtn");
  if (reset) reset.addEventListener("click", () => {
    dashOrder = DASH_TILE_IDS.slice(); dashOrderSave(dashOrder); dashApplyOrder(host, dashOrder, null);
    dashPaintLayoutBar(); dashSay(T("dh.drag.reset.done"));
  });
}

function dashKeyDown(e) {
  if (!e.altKey || e.target.closest("input,textarea,select")) return;
  const tile = e.target.closest("[data-tile]"); if (!tile || e.target !== tile) return;   // only when the tile itself has the focus
  const delta = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : (e.key === "ArrowLeft" || e.key === "ArrowUp") ? -1 : 0;
  if (!delta) return;
  e.preventDefault();
  const host = tile.parentNode, next = shiftDashTile(dashOrder, tile.dataset.tile, delta);
  if (next.join() === dashOrder.join()) return;
  dashApplyOrder(host, next, null); dashOrderSave(next); dashPaintLayoutBar();
  tile.focus();
  dashSay(T("dh.drag.moved", { name: dashTileName(tile), n: next.indexOf(tile.dataset.tile) + 1, total: next.length }));
  dashAfterMove();
}

function dashAfterMove() { if (dashMap) setTimeout(() => dashMap && dashMap.invalidateSize(), 300); }

function dashPointerDown(e) {
  if (dashDrag || e.button !== 0 || !e.isPrimary) return;
  const tile = e.target.closest("[data-tile]"); if (!tile || tile.parentNode !== e.currentTarget) return;
  if (e.target.closest(".leaflet-container,input,select,textarea")) return;   // the map pans, form fields type
  const host = e.currentTarget;
  const d = dashDrag = { tile, host, id: e.pointerId, sx: e.clientX, sy: e.clientY, touch: e.pointerType === "touch", active: false, timer: 0, lastSwap: 0, x: e.clientX, y: e.clientY };
  const move = ev => { if (ev.pointerId === d.id) dashPointerMove(ev); };
  const end = ev => { if (ev.pointerId === d.id) dashPointerEnd(ev); };
  d.off = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  if (d.touch) d.timer = setTimeout(() => dashLift(d), 350);
}

function dashLift(d) {
  if (!dashDrag || dashDrag !== d || d.active) return;
  d.active = true;
  d.ox = d.tile.offsetLeft; d.oy = d.tile.offsetTop;
  d.tile.classList.add("dash-lifted"); d.host.classList.add("dash-dragging");
  if (navigator.vibrate) navigator.vibrate(10);
  dashFollow(d);
}

/* The lifted tile follows the pointer: its layout slot may change while it is held, so the offset is measured from there. */
function dashFollow(d) {
  const dx = d.ox + (d.x - d.sx) - d.tile.offsetLeft, dy = d.oy + (d.y - d.sy) - d.tile.offsetTop;
  d.tile.style.transform = `translate(${dx}px,${dy}px) scale(1.02)`;
}

function dashPointerMove(e) {
  const d = dashDrag; if (!d) return;
  d.x = e.clientX; d.y = e.clientY;
  if (!d.active) {
    if (Math.hypot(d.x - d.sx, d.y - d.sy) <= (d.touch ? 8 : 6)) return;
    if (d.touch) { clearTimeout(d.timer); dashCancel(); return; }   // the finger moved before the long press: that is a scroll
    dashLift(d);
  }
  dashFollow(d);
  const now = performance.now();
  if (now - d.lastSwap < 160) return;                                  // let a swap settle before the next, so tiles don't flicker
  const hr = d.host.getBoundingClientRect(), px = d.x - hr.left, py = d.y - hr.top;
  const over = dashTiles(d.host).find(t => t !== d.tile && px >= t.offsetLeft && px <= t.offsetLeft + t.offsetWidth && py >= t.offsetTop && py <= t.offsetTop + t.offsetHeight);
  if (!over) return;
  const next = moveDashTile(dashOrder, d.tile.dataset.tile, over.dataset.tile);
  if (next.join() === dashOrder.join()) return;
  d.lastSwap = now; d.moved = true;
  dashApplyOrder(d.host, next, d.tile);
  dashFollow(d);
}

function dashCancel() {
  const d = dashDrag; if (!d) return;
  clearTimeout(d.timer); d.off();
  d.tile.classList.remove("dash-lifted"); d.host.classList.remove("dash-dragging"); d.tile.style.transform = "";
  dashDrag = null;
}

function dashPointerEnd() {
  const d = dashDrag; if (!d) return;
  const wasActive = d.active, tile = d.tile, moved = d.moved, held = tile.style.transform;
  dashCancel();
  if (!wasActive) return;
  dashSwallowUntil = performance.now() + 300;                          // the click fired on release must not open a row under the pointer
  if (!dashReducedMotion() && tile.animate && held) tile.animate([{ transform: held }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });   // settle into the slot
  if (moved) {
    dashOrderSave(dashOrder); dashPaintLayoutBar();
    dashSay(T("dh.drag.moved", { name: dashTileName(tile), n: dashOrder.indexOf(tile.dataset.tile) + 1, total: dashOrder.length }));
  }
  dashAfterMove();
}
