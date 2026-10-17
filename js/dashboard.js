/* ============================================================
   FASTO INNOVA — the farmer's Dashboard home (requested by Yuvi, 2026-10-17)
   ------------------------------------------------------------
   Nine cards above the old Research Progress table:
     1 Needs your attention    2 Your shop            3 Your pipeline
     4 Latest conversations    5 Best buyers + map    6 This month
     7 Market gaps             8 Buyer interest       9 Recent activity + Document health

   What each card SAYS is decided by pure functions in core.js (buildAttention,
   buildShopTiles, ...), which are unit tested. This file only gathers the data
   (dashInput) and draws it. Every card is a real section with a heading, and
   every row you can press is a button.
   ============================================================ */

/* ---------- gathering the data ---------- */
function dashInput() {
  const month = new Date().getMonth() + 1;
  return {
    now: Date.now(), month,
    clients: (state.clients || []).map(c => ({ id: c.id, name: c.name, status: c.status, initiatedBy: c.initiatedBy, chatId: c.chatId, productId: c.productId,
      buyerId: c.buyerId, seenAt: c.seenAt, ts: c.ts, messages: c.messages || [] })),
    products: state.products || [], docCounts: state.productDocCounts || {}, docs: state.productDocs || {},
    chats: (state.chats || []).map(c => {
      // a chat that made a finished product only has `product` loaded once it has been opened, so look in the shop list too
      const prod = c.product || (state.products || []).filter(p => p.source_chat_id === c.id)[0];
      const packagedDone = !!prod && prod.kind === "packaged" && productCompleteness(prod, (state.productDocCounts || {})[prod.id] || 0).complete;
      return { id: c.id, title: c.title, ts: c.ts, hasWork: !!(c.profile || prod), matched: c.phase === "done" || packagedDone,
        months: (c.profile && c.profile.available_months) || [], items: ((c.profile && c.profile.products) || []).map(p => p.name).filter(Boolean) };
    }),
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
function dashCard(id, titleKey, body, cls) {
  return `<section class="dash-card glass-45 ${cls || ""}" aria-labelledby="dh-${id}"><h3 class="dash-h" id="dh-${id}">${esc(T(titleKey))}</h3>${body}</section>`;
}
function dashEmpty(key) { return `<p class="dash-empty">${esc(T(key))}</p>`; }
function dashRow(icon, text, go, extra) {
  return `<li><button type="button" class="dash-row" onclick="dashGo(${go})">${dashIcon(icon, 16)}<span class="dash-row-text">${text}</span>${extra || ""}${dashIcon("chevron-right", 14)}</button></li>`;
}
function dashGoArgs(g) { return "'" + esc(g.to) + "','" + esc(g.id || "") + "','" + esc(g.tab || "") + "'"; }

/* Where a row on the dashboard takes you. */
async function dashGo(to, id, tab) {
  if (to === "client") { state.activeClientId = id; switchScreen("clients"); return; }
  if (to === "shop") { switchScreen("products"); return; }
  if (to === "product") { await openProductChat(id); if (tab) setPanelTab(tab); }
}

/* ---------- the cards ---------- */
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
function dashAttentionHTML(d) {
  const items = buildAttention(d).slice(0, 6);
  const body = items.length
    ? `<ul class="dash-list">${items.map(it => dashRow(ATTENTION_ICON[it.k] || "circle-alert", attentionText(it), dashGoArgs(it.go), it.k === "unread" ? '<span class="dash-dot" aria-hidden="true"></span>' : "")).join("")}</ul>`
    : dashEmpty("dh.a.none");
  return dashCard("attention", "dh.title.attention", body, "dash-span-7");
}
function dashShopHTML(d) {
  const t = buildShopTiles(d);
  const tile = (n, key, extra) => `<button type="button" class="dash-tile" onclick="dashGo('shop')"><b>${esc(n)}</b><span>${esc(T(key))}</span>${extra || ""}</button>`;
  const body = t.total
    ? `<div class="dash-tiles">${tile(t.live, "dh.t.live")}${tile(t.draft, "dh.t.drafts")}${tile(t.ready, "dh.t.ready")}${tile(t.avgPct + "%", "dh.t.complete", `<i class="dash-mini"><i style="width:${t.avgPct}%"></i></i>`)}</div>` +
      (t.archived ? `<p class="dash-note">${esc(T("dh.t.archived", { n: t.archived }))}</p>` : "")
    : dashEmpty("dh.t.none");
  return dashCard("shop", "dh.title.shop", body, "dash-span-5");
}
function pipelineLabel(k) {
  switch (k) { case "chats": return T("dh.p.chats"); case "matched": return T("dh.p.matched"); case "sent": return T("dh.p.sent"); default: return T("dh.p.replied"); }
}
function dashPipelineHTML(d) {
  const p = buildPipeline(d);
  if (!p.steps[0].n) return dashCard("pipeline", "dh.title.pipeline", dashEmpty("dh.p.none"), "dash-span-5");
  const rows = p.steps.map(s => `<div class="dash-step"><span class="dash-step-label">${esc(pipelineLabel(s.k))}</span><span class="dash-step-bar" aria-hidden="true"><i style="width:${s.pct}%"></i></span><b>${s.n}</b></div>`).join("");
  return dashCard("pipeline", "dh.title.pipeline", rows + (p.byBuyers ? `<p class="dash-note">${esc(T("dh.p.byBuyers", { n: p.byBuyers }))}</p>` : ""), "dash-span-5");
}
function dashConversationsHTML(d) {
  const rows = buildConversationPreview(d, 3);
  const body = rows.length ? `<ul class="dash-list">${rows.map(r => {
    const tick = r.who === "farmer" ? `<span class="dash-tick">${esc(T(r.seen ? "clients.tickSeen" : "clients.tickInbox"))}</span>` : "";
    const text = (r.who === "farmer" ? esc(T("dh.c.you")) : "") + esc(r.text);
    return `<li><button type="button" class="dash-row dash-conv" onclick="dashGo('client','${esc(r.id)}')" aria-label="${escAttr(T("dh.c.open", { name: r.name }))}">
      <span class="dash-row-text"><span class="dash-conv-top"><b>${esc(r.name)}</b>${r.what ? `<small>${esc(r.what)}</small>` : ""}<time>${esc(relDate(r.ts))}</time></span>
      <span class="dash-conv-msg">${text}</span>${tick}</span>${r.unread ? '<span class="dash-dot" aria-hidden="true"></span>' : ""}${dashIcon("chevron-right", 14)}</button></li>`;
  }).join("")}</ul>` : dashEmpty("dh.c.none");
  return dashCard("convs", "dh.title.convs", body, "dash-span-7");
}
function dashBestHTML(subjects) {
  const best = buildBestBuyers(subjects, 3);
  const rows = best.length ? `<ul class="dash-list">${best.map(b => {
    const km = isFinite(Number(b.distance_km)) ? " · " + Math.round(Number(b.distance_km)) + " km" : "";
    return `<li class="dash-best"><span class="dash-best-main"><b>${esc(b.name)}</b><small>${esc((b.type || "").replace(/_/g, " "))}${esc(km)} · ${esc(T("dh.b.for", { name: b.forName }))}</small></span><span class="pill ${scorePillClass(b.score)}">${b.score}/100</span></li>`;
  }).join("")}</ul>` : dashEmpty("dh.b.none");
  const map = best.length ? `<div class="dash-map-host" id="dashMapHost" role="group" aria-label="${escAttr(T("dh.b.mapAria"))}"></div><p class="dash-note" id="dashMapNote" hidden>${esc(T("dh.b.noMap"))}</p>` : "";
  return dashCard("best", "dh.title.best", rows + map, "dash-span-7");
}
function dashMonthHTML(d) {
  const m = buildMonthStrip(d), names = monthNames();
  if (!m.rows.length) return dashCard("month", "dh.title.month", dashEmpty("dh.m.none"), "dash-span-5");
  const head = `<div class="dash-month-head" aria-hidden="true"><span></span>${names.map((n, i) => `<i class="${i + 1 === m.month ? "now" : ""}">${esc(String(n).charAt(0).toUpperCase())}</i>`).join("")}</div>`;
  const rows = m.rows.map(r => `<div class="dash-month-row"><span>${esc(r.name)}</span>${r.flags.map((f, i) => `<i class="${f ? "on" : ""}${i + 1 === m.month ? " now" : ""}"></i>`).join("")}</div>`).join("");
  const nowTxt = m.now.length ? T("dh.m.now", { list: humanList(m.now) }) : T("dh.m.nothingNow");
  return dashCard("month", "dh.title.month", `<p class="dash-lead">${esc(nowTxt)}</p><div class="dash-month" role="img" aria-label="${escAttr(nowTxt)}">${head}${rows}</div>`, "dash-span-5");
}
function dashGapsHTML(subjects, d) {
  const gaps = buildGaps(subjects, d.clients);
  const body = gaps.length ? `<ul class="dash-list">${gaps.map(g => `<li class="dash-gap"><b>${esc(g.name)}</b><span>${esc(T("dh.g.row", { fit: g.fit, km: g.km, contacted: g.contacted }))}</span>
      <i class="dash-mini"><i style="width:${Math.round(g.contacted * 100 / g.fit)}%"></i></i></li>`).join("")}</ul>` : dashEmpty("dh.g.none");
  return dashCard("gaps", "dh.title.gaps", body, "dash-span-4");
}
function dashInterestHTML(d) {
  const rows = buildInterest(d);
  const body = rows.length ? `<ul class="dash-list">${rows.map(r => `<li class="dash-int"><b>${esc(r.name)}</b>
      <span><em>${r.last30}</em>${esc(T("dh.i.month"))}</span><span><em>${r.total}</em>${esc(T("dh.i.total"))}</span><span><em>${r.contacts}</em>${esc(T("dh.i.contacts"))}</span></li>`).join("")}</ul>
      <p class="dash-note">${esc(T("dh.i.note"))}</p>` : dashEmpty("dh.i.none");
  return dashCard("interest", "dh.title.interest", body, "dash-span-4");
}
function dashDocsHTML(d) {
  const h = buildDocHealth(d);
  if (h.ok) return dashCard("docs", "dh.title.docs", dashEmpty("dh.d.ok"), "dash-span-4");
  const go = (id, tab) => dashGoArgs({ to: "product", id, tab });
  const rows = [];
  h.expiring.forEach(e => rows.push(dashRow("circle-alert", esc(T(e.state === "expired" ? "dh.d.expired" : "dh.d.soon", { file: e.file, name: e.name, date: dashFmtDate(e.date) })), go(e.id, "documents"))));
  h.noDocs.forEach(e => rows.push(dashRow("file-text", esc(T("dh.d.nodocs", { name: e.name })), go(e.id, "documents"))));
  h.optional.slice(0, 4).forEach(e => rows.push(dashRow("check", esc(T("dh.d.optional", { name: e.name, doc: e.doc })), go(e.id, "roadmap"))));
  return dashCard("docs", "dh.title.docs", `<ul class="dash-list">${rows.slice(0, 7).join("")}</ul>`, "dash-span-4");
}
const TIMELINE_ICON = { created: "plus", launched: "rocket", withdrawn: "eye-off", archived: "archive", restored: "archive-restore", doc: "file-text", buyerMsg: "message-square", seen: "check", inquiry: "message-square" };
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
  const body = ev.length ? `<ul class="dash-timeline">${ev.map(e => `<li>${dashIcon(TIMELINE_ICON[e.k] || "check", 15)}<span>${esc(timelineText(e))}</span><time>${esc(relDate(e.ts))}</time></li>`).join("")}</ul>` : dashEmpty("dh.e.none");
  return dashCard("timeline", "dh.title.timeline", body, "dash-span-12");
}

/* ---------- the page ---------- */
function renderDashHome() {
  const host = $("dashHome"); if (!host) return;
  // While the account is still loading the cards would only say "nothing yet", which is not true.
  const app = $("app"); if (app && app.classList && app.classList.contains("booting")) { host.innerHTML = ""; return; }
  const d = dashInput(), subjects = dashSubjects();
  host.innerHTML = dashAttentionHTML(d) + dashShopHTML(d) + dashConversationsHTML(d) + dashPipelineHTML(d) + dashBestHTML(subjects) + dashMonthHTML(d) +
    dashGapsHTML(subjects, d) + dashInterestHTML(d) + dashDocsHTML(d) + dashTimelineHTML(d);
  paintDashMap(buildBestBuyers(subjects, 6));
}

/* The small map under "Best buyers right now". It is made once and moved into each new card, because the card is redrawn
   whenever the dashboard is; if the map cannot load, the list above it already says the same thing. */
let dashMapEl = null, dashMap = null, dashLayer = null;
async function paintDashMap(best) {
  const host = $("dashMapHost"); if (!host || typeof window === "undefined" || !best.length) return;
  const pts = best.map(b => ({ b, ll: dashBuyerPoint(b.id) })).filter(x => x.ll);
  if (!pts.length) { host.hidden = true; return; }
  try {
    const L = await loadLeaflet();
    if (!dashMapEl) { dashMapEl = document.createElement("div"); dashMapEl.className = "dash-map"; }
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
    host.hidden = true;
  }
}
