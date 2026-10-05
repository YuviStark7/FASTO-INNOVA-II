/* ============================================================
   FASTO INNOVA — App (state, screens, Brain 1 orchestration)
   Engine (core.js / data.js) is unchanged from the tested v0.2
   build. Persistence is Supabase (see js/supabase-client.js):
   every farmer signs in, and their chats/messages/matches/
   outreach are saved to and loaded from the database, scoped to
   them by Row Level Security. The buyer database is fetched live
   from Supabase too (data.js's copy is kept only as an offline
   fallback if that fetch fails).
   No flow-diagram panel and no Guardian log sheet in this design
   — Brain 3 still validates every message and profile, just
   without a dedicated viewer (matches the Figma file exactly;
   check DevTools console for a live Guardian trace).
   ============================================================ */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/* Every visible string in this file goes through T() in js/i18n.js.
   THE ONE RULE TO KEEP: nothing that is looked up at load time may hold a
   translated string. A `const LABELS = { done: T("phase.done") }` at the top of
   this file would freeze whatever language the page opened in and never change
   again, and the mistake is invisible until someone presses the toggle. So
   anything that used to be a table of English words — the category labels, the
   month names, the funnel stages, the offline script — is a FUNCTION now, read
   at render time. */

let state = {
  apiKey: "", model: "claude-haiku-4-5-20251001", offline: true,
  farmerId: null, isAdmin: false,
  role: "farmer",       // "farmer" | "buyer" — read from the account row, never from the browser
  email: "",            // the signed-in address, used only to prefill a buyer's claim
  inbox: [],            // a buyer's conversations from farmers (item 27)
  openThreadId: null,
  claims: [],           // a buyer's own claims on listed businesses (buyer_claims)
  farmerProfile: {},    // the farmer's own `farmers` row — name + the business details the logistics form needs
  chats: [],           // {id,title,phase,pct,messages:[{role,text}],apiMessages,profile,candidates,recs,offlineStep,offlineReady,ts}
  activeChatId: null,
  clients: [],          // matched-buyer threads (Clients screen) — backed by the outreach table
  glog: [],
  screen: "dashboard",
  activeClientId: null,
  showAllResearch: false,
  adminStage: "started",  // which funnel stage the Admin table is filtered to
  search: ""              // the top-bar query — see SEARCH below. It lives in state, not in the DOM
};

/* ---------- Prompts / tool schemas (Brain 1 + Brain 2) ---------- */
const SYSTEM_INTERVIEW = `You are the friendly voice of Fasto Innova, a service that helps small farmers around Cassino (Lazio, Italy) sell directly to nearby buyers. You are Brain 1 of a three-brain system: you talk to people; Brain 2 matches them with buyers from a verified local database; Brain 3 supervises safety.

Rules:
- Mirror the user's language (Italian or English).
- Be warm and simple. No jargon, no forms. ONE question per message. Keep every reply under 65 words.
- Early on, ask the farmer's first name so we can personalise the dashboard — don't block on it if they skip it.
- Collect: (1) name (optional), (2) products grown, (3) roughly how many kg per WEEK of each, (4) months of availability, (5) village/area and rough km from Cassino, (6) organic certification: yes / no / partial.
- If something is vague, gently ask once, then accept an estimate.
- Never promise prices, never name specific buyers yourself — that is Brain 2's job with verified data only.
- If asked about transport: our logistics partner arranges pickup and delivery, the farmer does not need a van.
- When you have the key points, summarise them in one short message and ask "Shall I search for matches?" — when the farmer confirms, call submit_farmer_profile. Map each product to one category of: verdure, pomodori, frutta, legumi, olio, vino, uova, formaggi, carne, erbe, castagne, miele, conserve.`;

const TOOL_PROFILE = {
  name: "submit_farmer_profile",
  description: "Send the completed, farmer-confirmed profile to Brain 2 (matching engine).",
  input_schema: {
    type: "object",
    properties: {
      farmer_name: { type: "string", description: "Farmer's first name, if given" },
      village: { type: "string", description: "Village or area of the farm" },
      distance_km_from_cassino: { type: "number" },
      products: { type: "array", items: { type: "object", properties: {
        name: { type: "string" }, category: { type: "string", enum: CATEGORIES }, kg_per_week: { type: "number" } },
        required: ["name", "category", "kg_per_week"] } },
      organic: { type: "string", enum: ["yes", "no", "partial"] },
      available_months: { type: "array", items: { type: "integer", minimum: 1, maximum: 12 } }
    },
    required: ["village", "products", "organic"]
  }
};

const SYSTEM_MATCH = `You are the recommendation writer inside Brain 2 of Fasto Innova. You receive a farmer profile plus candidate buyers ALREADY retrieved and scored from our verified Cassino database. Your tasks:
1. Pick and rank the best 5 (you may reorder slightly if reasons justify it).
2. For each, write one plain-language sentence a farmer immediately understands (mention what they buy and why it fits).
3. Add 2-3 creative suggestions: seasonal angles, simple transformations (e.g. passata from surplus tomatoes), or channels from the list.
4. Draft ONE outreach message to the top buyer: Italian version + English translation, max 90 words each, warm and professional, from the farmer's perspective, mentioning product, weekly quantity and that Fasto Innova's logistics partner handles delivery.
STRICT: use ONLY the provided buyer_id values. Never invent buyers, prices, or certifications. Never claim organic unless profile organic is "yes". Answer ONLY by calling submit_recommendations.`;

const TOOL_RECS = {
  name: "submit_recommendations",
  description: "Return ranked recommendations, suggestions and one outreach draft.",
  input_schema: {
    type: "object",
    properties: {
      ranked: { type: "array", items: { type: "object", properties: {
        buyer_id: { type: "string" }, pitch_reason: { type: "string" } }, required: ["buyer_id", "pitch_reason"] } },
      creative_suggestions: { type: "array", items: { type: "string" } },
      outreach: { type: "object", properties: {
        buyer_id: { type: "string" }, message_it: { type: "string" }, message_en: { type: "string" } },
        required: ["buyer_id", "message_it", "message_en"] }
    },
    required: ["ranked", "creative_suggestions", "outreach"]
  }
};

/* ---------- small UI helpers ---------- */
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600); }
function setTyping(on) { const t = $("typingInd"); if (t) t.style.display = on ? "block" : "none"; const b = $("sendBtn"); if (b) b.disabled = on; }
function showErr(msg) { const b = $("errBanner"); if (!b) return; b.textContent = msg; b.style.display = "block"; }
function clearErr() { const b = $("errBanner"); if (b) b.style.display = "none"; }
function isLocalId(id) { return String(id).startsWith("local"); } // true when a DB write failed and we fell back to a client-only id

/* ================= LANGUAGE SWITCH =================
   The dictionary and T() live in js/i18n.js. This is the part that has to know
   about the app: what to redraw, and — more importantly — what NOT to redraw.

   Nothing here writes to Supabase. The language is a display preference kept
   in localStorage, so switching it never touches a farmer's row; the stored
   product categories, organic status and chat titles are untouched by design.
   ------------------------------------------------------------------------- */

// Things that must be redrawn on a switch but live inside a closure — the
// sign-in button's label is built by boot()'s own authLabel().
const langListeners = [];
function onLangChange(fn) { langListeners.push(fn); }

/* The sidebar mode pill is written here and NOWHERE else, deliberately. It
   carries an interpolated model name when live, which a data-i18n attribute
   cannot hold — and worse, an attribute has to name ONE key, so whichever was
   chosen would be wrong half the time: `data-i18n="pill.offline"` on a live
   session had applyI18n() quietly relabel it "Offline demo" on every language
   switch, telling the farmer their API key wasn't being used. */
function paintModePill() {
  const el = $("modePill"); if (!el) return;
  el.textContent = state.offline ? T("pill.offline")
    : T("pill.live", { model: state.model.includes("haiku") ? "Haiku 4.5" : "Sonnet 5" });
}

function setLang(lang) {
  if (!setLangValue(lang)) return;      // unknown code, or already the current one
  applyI18n(document);                  // static markup + <html lang>
  paintLangToggles();
  langListeners.forEach(fn => { try { fn(); } catch (e) { console.error("language switch hook failed", e); } });

  const app = $("app");
  if (!app || !app.classList.contains("ready")) return;   // still on the onboarding cards

  /* Mid-boot the shell is showing skeleton rows and loadFarmerData() is about
     to REPLACE state.chats wholesale. Re-rendering here would swap the
     placeholders for an empty table and then have that overwritten a moment
     later. The toggle is already pointer-events:none while #app.booting — this
     is the belt to that brace, and the same reasoning as every other control
     that is switched off during the boot sequence. */
  if (app.classList.contains("booting")) return;

  updateHeaderIdentity();
  paintModePill();
  renderBell();
  renderDashboard();
  renderChats();
  renderChatRail();
  renderTranscript();
  if (state.screen === "admin") paintAdmin();
  if (isBuyer()) renderBuyerScreens();

  /* The three sheets are deliberately NOT rebuilt. Two of them are forms, and
     redrawing one would throw away a half-typed logistics request or a
     half-corrected profile — the same thing the sheets already refuse to do on
     a stray backdrop click. Nothing has to guard against it: #matchSheet,
     #logisticsSheet and #profileSheet are fixed, inset:0 and z-index 120/130/
     140, so while any of them is open the topbar toggle is underneath them and
     cannot be clicked at all. */
}

/* ---------- background-save failures ----------
   Most Supabase writes here are deliberately fire-and-forget: the screen
   updates straight away and the write happens behind it, so the app never
   feels slow. The trade-off is that when a write fails, nothing on screen
   changes — the farmer keeps working happily and only finds out next visit,
   when a chat or a product list isn't where they left it.

   These helpers make that failure visible without making it annoying:
     - failures that land together (a dropped connection usually kills the
       chat update, the products and the name in the same instant) are
       grouped into ONE sentence instead of three toasts fighting over the
       same element;
     - repeats are throttled, so a long offline stretch doesn't interrupt
       every few seconds while someone is typing;
     - a small amber chip in the header stays put after the toast fades, so
       "my work isn't being saved" is still discoverable a minute later, and
       clears itself as soon as a write gets through again.
   The console lines are kept alongside, unchanged, for debugging. */
const SAVE_BURST_MS = 900;      // failures inside this window count as one event
const SAVE_REPEAT_MS = 30000;   // ...and we then stay quiet for this long
const saveState = { queue: [], failures: 0, lastFailure: 0, lastToast: 0, timer: null };

function noteSaveFailure(what, err) {
  console.error("Supabase save failed · " + what, err);
  saveState.failures++;
  saveState.lastFailure = Date.now();
  const el = $("syncWarn"); if (el) el.classList.add("show");
}

// A background write failed: record it, then tell the farmer once, grouped and throttled.
function saveFailed(what, err) {
  noteSaveFailure(what, err);
  if (saveState.queue.indexOf(what) === -1) saveState.queue.push(what);
  clearTimeout(saveState.timer);
  saveState.timer = setTimeout(flushSaveFailures, SAVE_BURST_MS);
}

// Same, but for a spot that already has a better, more specific sentence of its
// own — start the quiet period so the generic message doesn't pile on top of it.
function saveFailedWithOwnMessage(what, err, msg) {
  noteSaveFailure(what, err);
  saveState.queue.length = 0;
  clearTimeout(saveState.timer);
  saveState.lastToast = Date.now();
  toast(msg);
}

function flushSaveFailures() {
  const items = saveState.queue.splice(0);
  if (!items.length) return;
  if (Date.now() - saveState.lastToast < SAVE_REPEAT_MS) return; // told recently; the header chip carries it from here
  saveState.lastToast = Date.now();
  toast(T("save.couldnt", { what: humanList(items.map(T)) }));
}

// A write got through, so whatever was wrong has cleared up. Only stand down once
// nothing has failed for a moment, or one success inside a failing burst would
// wrongly switch the warning off.
function saveOk() {
  if (Date.now() - saveState.lastFailure < SAVE_BURST_MS) return;
  const el = $("syncWarn"); if (el) el.classList.remove("show");
}

/* Wraps a fire-and-forget Supabase write.
   IMPORTANT: Supabase RESOLVES with { error } instead of rejecting, so a plain
   .catch() never sees a row-level-security refusal, a constraint violation or an
   expired session — which is precisely how these writes used to fail in total
   silence. Both shapes have to be checked. */
function bgSave(promise, what) {
  return Promise.resolve(promise).then(
    res => { if (res && res.error) saveFailed(what, res.error); else saveOk(); return res; },
    err => { saveFailed(what, err); }
  );
}

// The header chip is clickable: it repeats what happened, whenever they look at it.
function explainSyncWarn() {
  toast(saveState.failures === 1 ? T("save.one") : T("save.many", { n: saveState.failures }));
}

function addLog(level, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  state.glog.push({ level, msg, t });
  if (state.glog.length > 200) state.glog.shift();
  if (level !== "info") console.debug("[Guardian]", level, msg);
}

/* ---------- Claude API ---------- */
async function callClaude(system, messages, tools, maxTokens, forceTool) {
  const body = { model: state.model, max_tokens: maxTokens, system, messages };
  if (tools) body.tools = tools;
  if (forceTool) body.tool_choice = { type: "tool", name: forceTool };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": state.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    const m = (data.error && data.error.message) || res.statusText;
    if (res.status === 401) throw new Error("Invalid API key (401). Check it in console.anthropic.com.");
    if (res.status === 400 && /credit/i.test(m)) throw new Error("No credits on this Anthropic account — add some in Billing.");
    throw new Error("API error " + res.status + ": " + m);
  }
  return data;
}

/* ================= SIGN-IN ERRORS =================
   Supabase's auth service answers in English and only in English —
   "Invalid login credentials", "User already registered" — and until
   now that text went straight into the error box under the sign-in
   form. So the very first screen a farmer sees was the one screen the
   IT/EN layer didn't cover, and it broke exactly when something had
   already gone wrong.

   Two things are matched, in this order, and the order matters:

     1. err.code — the stable, machine-readable identifier newer
        versions of Supabase's auth library set ("invalid_credentials").
        This is the one to trust: it is documented, and it does not
        change when someone rewords the English.
     2. err.message — a regex, because older versions of the library
        (and the raw REST errors) carry no code at all, only prose.
        A wording change upstream silently drops a rule back to the
        generic line, which is a blemish rather than a break; that is
        the deliberate trade for covering the older shape at all.

   Anything unrecognised falls through to the generic line rather than
   printing English at the farmer. The raw text is NOT thrown away —
   it goes to console.warn, because "Something went wrong" with no
   trace anywhere is unsupportable, and this is the one place where
   the person reading the screen and the person debugging it are
   different people.

   ADDING A RULE: put the key in the dictionary in BOTH languages.
   qa_check.js reads the keys straight out of the table below and
   fails both ways — a rule with no dictionary entry, and an
   auth.err.* string in the dictionary that no rule can ever reach. */
const AUTH_ERROR_RULES = [
  // Wrong email or wrong password. GoTrue deliberately does not say which,
  // so that an attacker can't use the form to find out which emails exist —
  // don't "improve" this by guessing at one or the other.
  { key: "auth.err.invalidCredentials", codes: ["invalid_credentials", "invalid_grant"],
    re: /invalid login credentials|invalid email or password/i },
  // Signed up, but never clicked the link in the email.
  { key: "auth.err.notConfirmed", codes: ["email_not_confirmed"], re: /email not confirmed/i },
  // Sign-up against an address that already has an account.
  { key: "auth.err.alreadyRegistered", codes: ["user_already_exists", "email_exists"],
    re: /user already registered|already been registered/i },
  // The server's own minimum, which can be stricter than the 6 characters
  // this form checks for before it sends anything.
  { key: "auth.err.weakPassword", codes: ["weak_password"], re: /password should be at least|password is too weak/i },
  { key: "auth.err.badEmail", codes: ["email_address_invalid", "validation_failed"],
    re: /unable to validate email address|invalid format/i },
  // 429. The message carries the number of seconds to wait; when it can be
  // read, waitKey says it, because "wait a moment" and "wait 51 seconds" are
  // different instructions.
  { key: "auth.err.rateLimit", waitKey: "auth.err.rateLimitWait",
    codes: ["over_request_rate_limit", "over_email_send_rate_limit"],
    re: /for security purposes|rate limit|too many requests/i },
  { key: "auth.err.signupsClosed", codes: ["signup_disabled", "email_provider_disabled"],
    re: /signups not allowed|signup is disabled/i },
  { key: "auth.err.banned", codes: ["user_banned"], re: /user is banned/i },
  // Not an auth failure at all — the request never arrived. Worth its own
  // line because the farmer's next move is different: check the connection,
  // not the password.
  { key: "auth.err.offline", codes: ["request_timeout"], names: ["AuthRetryableFetchError", "TypeError"],
    re: /failed to fetch|network ?error|load failed|networkrequestfailed/i }
];

/* Pure, and split from the DOM on purpose (same reason as buildLogisticsPayload
   and applyProfileEdit): the mapping is the part worth testing, and it can be
   driven with a plain object rather than a live sign-in failure. */
function authErrorInfo(err) {
  const code = String((err && err.code) || "");
  const name = String((err && err.name) || "");
  const msg = String((err && err.message) || "");
  for (const rule of AUTH_ERROR_RULES) {
    const byCode = code && rule.codes.indexOf(code) !== -1;
    const byName = !!(rule.names && name && rule.names.indexOf(name) !== -1 && rule.re.test(msg));
    const byText = !!(msg && rule.re.test(msg));
    if (!byCode && !byName && !byText) continue;
    if (rule.waitKey) {
      const secs = msg.match(/(\d+)\s*second/i);
      if (secs) return { key: rule.waitKey, vars: { seconds: secs[1] }, matched: true };
    }
    return { key: rule.key, vars: null, matched: true };
  }
  return { key: "auth.generic", vars: null, matched: false };
}

/* Unrecognised: the farmer gets the generic line, the console keeps the
   evidence — "Something went wrong" with nothing recoverable anywhere is
   unsupportable. Recognised ones are logged too, because the English original
   beside the key it was mapped to is the only way to spot a mis-mapped rule
   after the fact. */
function logAuthError(err, info) {
  console.warn("[auth] " + (info.matched ? "recognised as " + info.key : "UNRECOGNISED — showing the generic line") +
    " | code=" + ((err && err.code) || "-") + " | " + ((err && err.message) || err));
}

/* ================= ACCOUNT DATA (Supabase) ================= */
async function loadBuyers() {
  try {
    const { data, error } = await DataStore.listBuyers();
    if (error || !data || !data.length) throw error || new Error("empty buyers table");
    DB.buyers = data.filter(b => !b.is_channel);
    DB.channels = data.filter(b => b.is_channel);
  } catch (e) {
    console.warn("Using the bundled offline buyer copy — live fetch from Supabase failed:", e);
  }
}

async function loadFarmerData(uid) {
  const [{ data: farmer }, { data: chatRows }, { data: outreachRows }] = await Promise.all([
    DataStore.getMyFarmer(uid),
    DataStore.listMyChats(uid),
    DataStore.listMyOutreach(uid)
  ]);
  state.isAdmin = !!(farmer && farmer.is_admin);
  state.farmerProfile = farmer || {};

  state.chats = [];
  for (const row of (chatRows || [])) {
    const [{ data: msgs }, { data: prods }] = await Promise.all([
      DataStore.listMessages(row.id),
      DataStore.listProducts(row.id)
    ]);
    const hasProfile = !!(row.village || row.organic || (prods && prods.length));
    state.chats.push({
      id: row.id, title: row.title, phase: row.phase, pct: row.pct,
      messages: (msgs || []).map(m => ({ role: m.role, text: m.text, ts: new Date(m.created_at).getTime() })),
      apiMessages: [], // Claude's own conversation context resets each session — only the visible transcript persists
      profile: hasProfile ? {
        farmer_name: row.farmer_name, village: row.village,
        distance_km_from_cassino: row.distance_km_from_cassino != null ? Number(row.distance_km_from_cassino) : null, organic: row.organic,
        available_months: row.available_months || [],
        products: (prods || []).map(p => ({ name: p.name, category: p.category, kg_per_week: Number(p.kg_per_week) }))
      } : null,
      candidates: [], recs: null,
      offlineStep: (msgs || []).length, offlineReady: (msgs || []).length >= OFFLINE_SCRIPT_KEYS.length,
      ts: new Date(row.created_at).getTime()
    });
  }
  state.activeChatId = state.chats.length ? state.chats[0].id : null;

  const byId = {}; DB.buyers.concat(DB.channels).forEach(b => byId[b.id] = b);
  state.clients = (outreachRows || []).map(o => {
    const b = byId[o.buyer_id] || {};
    return { id: o.id, buyerId: o.buyer_id, chatId: o.chat_id, name: b.name || o.buyer_id, type: b.type || "", zone: b.zone || "",
      message_it: o.message_it, message_en: o.message_en, flagged: o.flagged, status: o.status,
      ts: new Date(o.created_at).getTime(), extra: [], messages: [] };
  });
  state.activeClientId = state.clients.length ? state.clients[0].id : null;
  /* The two-way thread (ROADMAP item 26 pass B). One read per conversation;
     RLS returns only this farmer's own threads. A failed read just leaves the
     thread showing the draft, as before, rather than blocking sign-in. */
  await Promise.all(state.clients.map(async c => {
    try {
      const res = await DataStore.listOutreachMessages(c.id);
      if (res && !res.error && res.data) c.messages = mapThreadMessages(res.data);
    } catch (e) { console.warn("couldn't load the messages of one conversation", e); }
  }));
}

/* ---------- Two-way thread helpers (pure, DOM-free) ---------- */
function mapThreadMessages(rows) {
  return (rows || []).map(m => ({ id: m.id, role: m.sender_role === "buyer" ? "buyer" : "farmer",
    text: String(m.body || ""), ts: new Date(m.created_at).getTime(), readAt: m.read_at || null }));
}
/* What the thread shows after the draft: persisted messages in order, then any
   local-only notes (offline mode, or a draft whose save failed). The first
   farmer message equal to the draft is the draft itself, posted by "Mark as
   sent", and is already drawn as the big bubble, so it is skipped once. */
function threadItems(c) {
  let skipped = false;
  const items = [];
  for (const m of (c.messages || [])) {
    if (!skipped && m.role === "farmer" && m.text === c.message_it) { skipped = true; continue; }
    items.push({ who: m.role, text: m.text, readAt: m.readAt, persisted: true });
  }
  for (const m of (c.extra || [])) items.push({ who: "farmer", text: m.text, readAt: null, persisted: false });
  return items;
}
/* One tick = it is in the buyer's inbox; two = the buyer has opened it. */
function tickKey(item) { return item.readAt ? "clients.tickSeen" : "clients.tickInbox"; }
function buildMessageRow(outreachId, uid, body, role) {
  const text = String(body || "").trim().slice(0, 2000);
  return text ? { outreach_id: outreachId, sender_role: role === "buyer" ? "buyer" : "farmer", sender_id: uid, body: text } : null;
}
/* What the farmer chooses to show a buyer beside the thread: where, what, how
   much, when. Deliberately NOT their phone, address or VAT (those never leave
   their account) and not their name beyond what the message itself says. */
function buildFarmerSummary(profile) {
  if (!profile) return null;
  return {
    village: profile.village || null,
    distance_km: profile.distance_km_from_cassino != null ? Number(profile.distance_km_from_cassino) : null,
    organic: profile.organic || null,
    months: (profile.available_months || []).map(Number).filter(m => m >= 1 && m <= 12),
    products: (profile.products || []).slice(0, 20).map(p => ({ name: String(p.name || "").slice(0, 60), category: p.category || null, kg_per_week: Number(p.kg_per_week) || 0 }))
  };
}
/* Places one farmer message in the thread. Resolves true only if the database
   accepted it, so callers never show something as sent that is not. */
async function postThreadMessage(c, text) {
  const row = buildMessageRow(c.id, state.farmerId, text); if (!row) return false;
  try {
    const { data, error } = await DataStore.sendOutreachMessage(row);
    if (error) throw error;
    c.messages = c.messages || [];
    c.messages.push(mapThreadMessages([data])[0]);
    return true;
  } catch (e) { saveFailedWithOwnMessage("save.message", e, T("save.messageMsg")); return false; }
}

/* ================= MULTI-CHAT (Fasto-AI screen) ================= */
async function newChatObj() {
  try {
    const { data, error } = await DataStore.createChat(state.farmerId);
    if (error) throw error;
    return { id: data.id, title: data.title, phase: data.phase, pct: data.pct, ts: new Date(data.created_at).getTime(),
      messages: [], apiMessages: [], profile: null, candidates: [], recs: null, offlineStep: 0, offlineReady: false };
  } catch (e) {
    saveFailedWithOwnMessage("save.newChat", e, T("save.newChatMsg"));
    return { id: "local" + Date.now() + Math.random().toString(36).slice(2, 6), title: T("assist.newChatTitle"), phase: "interview", pct: 0, ts: Date.now(),
      messages: [], apiMessages: [], profile: null, candidates: [], recs: null, offlineStep: 0, offlineReady: false };
  }
}
function activeChat() { return state.chats.find(c => c.id === state.activeChatId) || null; }
/* The title is stored in the database, so a chat created in one language keeps
   that wording when the app is reopened in the other. Rebuilding every stored
   title on a language switch would rewrite rows on a display preference, which
   is a much worse trade than one stale label in a list. */
function chatTitle(chat) {
  if (chat.profile && chat.profile.farmer_name) return chat.profile.farmer_name;
  if (chat.profile) { const top = topProductCategory(chat.profile); if (top) return T("assist.chatCat", { cat: catLabel(top) || top }); }
  return T("assist.newChatTitle");
}

/* Offline mode is the one place the "Fasto answers in your language" promise
   was broken: there is no Brain 1 to mirror anyone, only a fixed script. So
   the greeting and the script below DO follow the UI language, while anything
   a real Brain wrote is left exactly as it came out. */
function greetingText() {
  return state.offline ? T("assist.greetOffline") : T("assist.greetLive");
}

/* ---------- duplicate / idle chat guard ----------
   A chat is "untouched" when it exists but was never actually used: the
   farmer typed nothing and Brain 1 captured nothing. The opening greeting
   doesn't count — every chat is born with one. These are what pile up in the
   rail when "Start New Chat" gets pressed a few times in a row, and each one
   is a real Supabase row plus a greeting message row, so this is about the
   farmer's data and not only about a tidy list. */
function isChatUntouched(chat) {
  if (!chat) return false;
  if (chat.profile) return false;                                  // Brain 1 captured something
  if (chat.phase && chat.phase !== "interview") return false;      // matching started or finished
  if (chat.candidates && chat.candidates.length) return false;     // Brain 2 ran
  return !chat.messages.some(m => m.role === "user");              // the farmer said something
}
// Prefer the chat already open, otherwise the newest untouched one
// (state.chats is newest-first, both when loaded and after an unshift).
function reusableChat() {
  const open = activeChat();
  if (isChatUntouched(open)) return open;
  return state.chats.find(isChatUntouched) || null;
}

let creatingChat = false; // a second click while the first row is still being created would make two
async function startNewChat() {
  const spare = reusableChat();
  if (spare) {
    const wasOpen = spare.id === state.activeChatId;
    selectChat(spare.id);
    // A chat restored from a session where the greeting write failed can come
    // back with an empty transcript; give it one rather than an empty screen.
    if (!spare.messages.length) addMsg(spare, "ai", greetingText());
    flashChatRailItem(spare.id);
    // Say something, or a button that quietly does nothing reads as broken.
    toast(wasOpen ? T("assist.stillEmpty") : T("assist.openedEmpty"));
    const input = $("userInput"); if (input) input.focus();
    return spare;
  }
  if (creatingChat) return null;
  creatingChat = true;
  try {
    const chat = await newChatObj();
    state.chats.unshift(chat);
    state.activeChatId = chat.id;
    addMsg(chat, "ai", greetingText());
    updateHeaderIdentity();
    renderChatRail();
    renderTranscript();
    return chat;
  } finally {
    creatingChat = false;
  }
}
function selectChat(id) { state.activeChatId = id; clearErr(); updateHeaderIdentity(); renderChatRail(); renderTranscript(); }

/* Each rail entry is a <button>, not a <div onclick>. The conversation history
   was reachable by mouse only — there was no way to change conversation from
   the keyboard at all. aria-current marks which one is open, since "active"
   here is a background tint and nothing else. */
function renderChatRail() {
  renderBell();
  const el = $("chatRailList"); if (!el) return;
  const q = normalizeQuery(state.search);
  const list = q ? filterChatRail(state.chats, q) : state.chats;
  /* The open conversation stays open even when the query excludes it — the
     rail is a way of changing conversation, not a way of losing one. */
  if (q && !list.length) {
    el.innerHTML = `<div class="chat-rail-empty">${esc(T("search.noneChats", { q: state.search.trim() }))}</div>`;
    return;
  }
  el.innerHTML = list.map(c => {
    const on = c.id === state.activeChatId;
    return `
    <button type="button" class="chat-rail-item ${on ? "active" : ""}" data-chat-id="${esc(c.id)}"${on ? ' aria-current="true"' : ""} aria-label="${escAttr(T("a11y.openChat", { title: c.title }))}" onclick="selectChat('${c.id}')">
      <img class="ic-svg sm" src="assets/icon-chat-item.svg" alt="">${esc(c.title)}
    </button>`;
  }).join("");
}
// Briefly outline the rail entry, so reusing a chat doesn't look like the
// button did nothing — especially when the reused chat was already the open one.
function flashChatRailItem(id) {
  const el = document.querySelector('.chat-rail-item[data-chat-id="' + String(id).replace(/"/g, '\\"') + '"]');
  if (!el) return;
  el.classList.remove("flash");
  void el.offsetWidth; // restart the animation if it is already running
  el.classList.add("flash");
  clearTimeout(flashChatRailItem._t);
  flashChatRailItem._t = setTimeout(() => el.classList.remove("flash"), 1300);
}
function addMsg(chat, role, text) {
  chat.messages.push({ role, text, ts: Date.now() });
  if (chat.id === state.activeChatId) renderTranscript();
  if (!isLocalId(chat.id)) bgSave(DataStore.addMessage(chat.id, role, text), "save.message");
}
function renderTranscript() {
  const chat = activeChat();
  const el = $("assistTranscript"); if (!el) return;
  if (!chat) { el.innerHTML = ""; return; }
  const bubbles = chat.messages.map(m => {
    if (m.role === "sys") return `<div class="bubble meta">${esc(m.text)}</div>`;
    return `<div class="bubble ${m.role === "user" ? "out" : "in"}">${esc(m.text)}</div>`;
  }).join("");
  // once matching is finished the transcript ends with a way into the match
  // view, and — as soon as Brain 1 has captured anything at all — a way to
  // correct what it captured without starting the interview over.
  const acts = [];
  if (chat.phase === "done" || (chat.profile && chat.candidates && chat.candidates.length)) {
    acts.push(`<button class="btn btn-ghost btn-sm" onclick="openMatchView('${chat.id}')">${esc(T("assist.why"))}</button>`);
  }
  if (chat.profile) acts.push(`<button class="btn btn-ghost btn-sm" onclick="openProfileEdit('${chat.id}')">${esc(T("assist.editDetails"))}</button>`);
  const cta = acts.length ? `<div class="match-cta">${acts.join("")}</div>` : "";
  el.innerHTML = bubbles + cta;
  el.scrollTop = el.scrollHeight;
}

/* ---------- Brain 1 turn ---------- */
async function sendUserMessage(text) {
  const chat = activeChat(); if (!chat) return;
  clearErr();
  addMsg(chat, "user", text);

  const findings = guardianScanText(text);
  findings.forEach(f => addLog(f.level, "Guardian · input scan: " + f.msg));
  if (findings.some(f => f.level === "block")) {
    addMsg(chat, "sys", T("assist.blocked"));
    return;
  }
  if (!findings.length) addLog("ok", "Guardian · input scan: clean");

  if (state.offline) return offlineTurn(chat);

  chat.apiMessages.push({ role: "user", content: text });
  setTyping(true);
  try {
    const resp = await callClaude(SYSTEM_INTERVIEW, chat.apiMessages, [TOOL_PROFILE], 600);
    setTyping(false);
    chat.apiMessages.push({ role: "assistant", content: resp.content });

    let toolUse = null;
    for (const block of resp.content) {
      if (block.type === "text" && block.text.trim()) addMsg(chat, "ai", block.text.trim());
      if (block.type === "tool_use" && block.name === "submit_farmer_profile") toolUse = block;
    }
    addLog("info", "Brain 1 · replied (" + (resp.usage ? resp.usage.output_tokens + " tokens" : "ok") + ")");

    if (toolUse) {
      chat.apiMessages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "Profile received by Guardian for validation." }] });
      await onProfileCaptured(toolUse.input, chat);
    }
  } catch (e) {
    setTyping(false);
    showErr(e.message);
    addLog("block", "System · " + e.message);
    chat.apiMessages.pop();
  }
}

/* ---------- Handoff: Guardian validates, Brain 2 runs ---------- */
async function onProfileCaptured(raw, chat) {
  addLog("info", "Brain 1 → Guardian · profile handoff");
  const v = guardianValidateProfile(raw);
  v.warnings.forEach(w => addLog("warn", "Guardian · " + w));

  if (!v.ok) {
    v.errors.forEach(er => addLog("block", "Guardian · REJECTED: " + er));
    addMsg(chat, "sys", T("assist.guardianRejected", { errors: v.errors.map(engineText).join("; ") }));
    return;
  }
  addLog("ok", "Guardian · profile valid (" + v.profile.products.length + " products, " + totalKg(v.profile) + " kg/week) → forwarded to Brain 2");
  chat.profile = v.profile;
  chat.phase = "matching"; chat.pct = 45; chat.ts = Date.now();
  chat.title = chatTitle(chat);
  if (chat.id === state.activeChatId) updateHeaderIdentity();
  renderChatRail(); renderDashboard();

  if (!isLocalId(chat.id)) {
    bgSave(DataStore.updateChat(chat.id, {
      phase: "matching", pct: 45, title: chat.title,
      farmer_name: v.profile.farmer_name || null, village: v.profile.village || null,
      distance_km_from_cassino: v.profile.distance_km_from_cassino ?? null,
      organic: v.profile.organic || null, available_months: v.profile.available_months || []
    }), "save.profile");
    bgSave(DataStore.saveProducts(chat.id, v.profile.products), "save.products");
    if (v.profile.farmer_name) bgSave(DataStore.updateFarmerName(state.farmerId, v.profile.farmer_name), "save.name");
  }

  const month = new Date().getMonth() + 1;
  const ranked = rankMatches(v.profile, DB, month);
  chat.candidates = ranked.slice(0, 8);
  addLog("info", "Brain 2 · scored " + ranked.length + " database entries, top score " + ranked[0].score + "/100");

  if (state.offline) { await finishWithRecs(offlineRecs(chat), chat); return; }

  addMsg(chat, "sys", T("assist.brain2Analysing", { n: ranked.length }));
  setTyping(true);
  try {
    const payload = { farmer_profile: chat.profile, current_month: month,
      candidates: chat.candidates.map(c => ({ buyer_id: c.id, name: c.name, type: c.type, zone: c.zone, distance_km: c.distance_km, buys: c.needs, volume_capacity: c.volume, quality_focus: c.quality_focus, notes: c.notes, engine_score: c.score, engine_reasons: c.reasons, is_channel: c.is_channel })) };
    const resp = await callClaude(SYSTEM_MATCH, [{ role: "user", content: JSON.stringify(payload) }], [TOOL_RECS], 1800, "submit_recommendations");
    setTyping(false);
    const tu = resp.content.find(b => b.type === "tool_use");
    if (!tu) throw new Error("Brain 2 returned no structured recommendations.");
    addLog("info", "Brain 2 → Guardian · recommendations handoff");
    const check = guardianVerifyRecs(tu.input, chat.candidates.map(c => c.id), chat.profile);
    check.issues.forEach(i => addLog(i.level, "Guardian · " + i.msg));
    await finishWithRecs(check.verified, chat);
    addMsg(chat, "ai", T("assist.finished"));
  } catch (e) {
    setTyping(false);
    showErr(e.message);
    addLog("block", "System · " + e.message);
  }
}

async function finishWithRecs(recs, chat) {
  chat.recs = recs;
  chat.phase = "done"; chat.pct = 100;
  if (!isLocalId(chat.id)) {
    bgSave(DataStore.updateChat(chat.id, { phase: "done", pct: 100 }), "save.progress");
    if (recs.ranked && recs.ranked.length) bgSave(DataStore.saveMatches(chat.id, recs.ranked), "save.matches");
  }
  await addClientFromRecs(recs, chat);
  renderDashboard();
  renderChats();
  renderTranscript(); // reveals the "Why these buyers?" button on the finished chat
}

/* ================= MATCH VIEW ("why these buyers") =================
   Brain 2 has always produced two things the farmer never got to see:
   a plain-language sentence per ranked buyer, and 2-3 creative
   suggestions. This surfaces both, next to the deterministic score and
   reasons the engine itself generated. Read-only, no schema change. */
/* ================= SHEETS: FOCUS AND KEYBOARD =================
   The three sheets (match view, logistics, profile editor) were `display:none`
   overlays and nothing more. Opening one left focus on the button underneath
   it, so a keyboard user pressed Enter and then had to Tab through the entire
   app behind the panel to reach it — and could Tab straight back out the far
   side while it was still up. Closing one dropped focus at the top of the
   document.

   Everything below is one small stack, because these sheets genuinely nest:
   the profile editor opens from the match sheet, and saving a corrected
   profile reopens the match sheet behind it.

   Only the FIRST sheet in a run remembers where focus came from. Opening the
   profile editor from the match sheet closes the match sheet on the way, so
   "put me back where I was" has to mean the button that started all of it, not
   a control inside a panel that has since been torn down and rebuilt. */
const SHEET_IDS = ["matchSheet", "logisticsSheet", "profileSheet", "exportSheet"];
const FOCUSABLE_SEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let sheetStack = [];
let sheetReturnFocus = null;

function focusablesIn(el) {
  if (!el || !el.querySelectorAll) return [];
  return Array.prototype.slice.call(el.querySelectorAll(FOCUSABLE_SEL));
}
function topSheet() { return sheetStack.length ? sheetStack[sheetStack.length - 1] : null; }

function focusIntoSheet(s) {
  if (!s) return;
  const items = focusablesIn(s);
  // The close button is first in the panel, which is where a dialog should
  // land: it names the thing you have just opened and it is the way out.
  const target = items.length ? items[0] : (s.querySelector ? s.querySelector(".match-panel") : null);
  if (target && target.focus) { try { target.focus(); } catch (e) { /* detached */ } }
}

/* While a sheet is up, everything behind it is hidden from assistive tech and
   inert where the browser supports it. The focus trap below is what holds the
   line in browsers that don't. Order matters in both directions: focus goes
   INTO the dialog before the app is hidden, and the app is revealed again
   before focus is handed back — aria-hidden over the focused element is
   exactly the bug this is meant to prevent. */
function setBehindSheetsHidden(on) {
  const app = $("app"); if (!app) return;
  if (on) { app.setAttribute("aria-hidden", "true"); app.setAttribute("inert", ""); }
  else { app.removeAttribute("aria-hidden"); app.removeAttribute("inert"); }
}

function openSheet(id) {
  const s = $(id); if (!s) return;
  const already = sheetStack.indexOf(id) !== -1;
  if (!already) {
    if (!sheetStack.length) sheetReturnFocus = (typeof document !== "undefined" && document.activeElement) || null;
    sheetStack.push(id);
  }
  s.classList.add("open");
  if (!already) { focusIntoSheet(s); setBehindSheetsHidden(true); }
}

function closeSheet(id) {
  const s = $(id); if (s) s.classList.remove("open");
  const i = sheetStack.indexOf(id);
  if (i !== -1) sheetStack.splice(i, 1);
  if (sheetStack.length) { focusIntoSheet($(topSheet())); return; }
  setBehindSheetsHidden(false);
  const back = sheetReturnFocus; sheetReturnFocus = null;
  // Only if it is still on the page. Saving a profile redraws the chat rail,
  // the dashboard and the client list, so the very button that was clicked may
  // no longer exist — focusing a detached node silently sends focus to <body>.
  const stillThere = back && back.focus &&
    (!document.body || !document.body.contains || document.body.contains(back));
  if (stillThere) { try { back.focus(); } catch (e) { /* ignore */ } }
}

/* Tab must not walk out of the sheet that is on top. */
function trapSheetTab(e) {
  if (!e || e.key !== "Tab") return;
  const s = $(topSheet()); if (!s) return;
  const items = focusablesIn(s);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  const cur = document.activeElement;
  const inside = s.contains ? s.contains(cur) : true;
  if (e.shiftKey ? (!inside || cur === first) : (!inside || cur === last)) {
    e.preventDefault();
    const t = e.shiftKey ? last : first;
    if (t.focus) t.focus();
  }
}

/* Escape closes the TOP sheet only. Three separate Escape listeners used to
   each close their own sheet, so one press on the profile editor also closed
   the match sheet waiting behind it. */
function closeTopSheet() {
  const id = topSheet(); if (!id) return false;
  if (id === "matchSheet") closeMatchView();
  else if (id === "logisticsSheet") closeLogistics();
  else if (id === "exportSheet") closeExportSheet();
  else closeProfileEdit();
  return true;
}

function scorePillClass(score) { return score >= 70 ? "pill-accent" : score >= 40 ? "pill-amber" : "pill-muted"; }

function matchRowsFor(chat) {
  // candidates carry the engine's score + reasons; recs carry Brain 2's
  // written sentence. A chat restored from a previous session arrives with
  // neither in memory — but scoring is deterministic, so we can rebuild the
  // engine side for free from the saved profile. Brain 2's prose isn't
  // reconstructible (it isn't stored), so those chats show reasons only.
  if (!chat.candidates || !chat.candidates.length) {
    if (!chat.profile) return [];
    chat.candidates = rankMatches(chat.profile, DB, new Date().getMonth() + 1).slice(0, 8);
  }
  const byId = {}; chat.candidates.forEach(c => byId[c.id] = c);
  // recsStale: the farmer edited the profile after Brain 2 wrote these, so the
  // sentences describe a farm that no longer exists. The scores below them have
  // been recomputed and are current; the prose can't be, so it is not shown.
  const fromRecs = (!chat.recsStale && chat.recs && chat.recs.ranked) || [];
  const rows = fromRecs.length
    ? fromRecs.map(r => ({ cand: byId[r.buyer_id], pitch: r.pitch_reason })).filter(x => x.cand)
    : chat.candidates.map(c => ({ cand: c, pitch: "" }));
  return rows.slice(0, 5);
}

function openMatchView(chatId) {
  const chat = state.chats.find(c => c.id === chatId);
  const sheet = $("matchSheet");
  if (!chat || !sheet) return;

  const rows = matchRowsFor(chat);
  const p = chat.profile;
  const poolSize = (DB.buyers || []).length + (DB.channels || []).length;

  // textContent, so no escaping needed here (unlike the innerHTML below)
  $("matchSubtitle").textContent = rows.length
    ? T("match.subtitle", { title: chat.title, n: rows.length, pool: poolSize })
    : chat.title;

  const profileBits = !p ? "" : `<div class="match-profile-row">
    <div class="match-profile">
      ${p.village ? `<span class="pill pill-muted">${esc(p.village)}</span>` : ""}
      ${isFinite(Number(p.distance_km_from_cassino)) ? `<span class="pill pill-muted">${esc(T("match.kmFrom", { n: Math.round(Number(p.distance_km_from_cassino)) }))}</span>` : ""}
      <span class="pill pill-muted">${esc(T("match.kgWeek", { n: Math.round(totalKg(p)) }))}</span>
      <span class="pill ${p.organic === "yes" ? "pill-accent" : "pill-muted"}">${esc(p.organic === "yes" ? T("match.organic") : p.organic === "partial" ? T("match.partlyOrganic") : T("match.notOrganic"))}</span>
      ${(p.products || []).map(pr => `<span class="pill pill-blue">${esc(pr.name)} · ${Math.round(Number(pr.kg_per_week))} kg</span>`).join("")}
    </div>
    <button class="btn btn-ghost btn-sm mp-edit" onclick="openProfileEdit('${chat.id}', true)">${esc(T("assist.editDetails"))}</button>
  </div>`;

  const cards = rows.map((r, i) => {
    const c = r.cand;
    const where = [c.zone, (c.type || "").replace(/_/g, " ")].filter(Boolean).map(esc).join(" · ");
    const km = isFinite(Number(c.distance_km)) ? " · " + Math.round(Number(c.distance_km)) + " km" : "";
    return `<div class="match-card">
      <div class="mc-head">
        <span class="mc-rank">${i + 1}</span>
        <div style="min-width:0;flex:1">
          <div class="title-sm">${esc(c.name)}</div>
          <div class="foot">${where}${km}</div>
        </div>
        ${c.is_channel ? `<span class="pill pill-blue">${esc(T("match.channel"))}</span>` : ""}
        <span class="pill ${scorePillClass(c.score)}">${c.score}/100</span>
      </div>
      ${r.pitch ? `<div class="mc-pitch">${esc(r.pitch)}</div>` : ""}
      <div class="mc-reasons">${(c.reasons || []).map(x => `<span class="reason-chip">${esc(engineText(x))}</span>`).join("")}</div>
    </div>`;
  }).join("");

  const suggs = (!chat.recsStale && chat.recs && chat.recs.creative_suggestions) || [];
  let tail = "";
  if (suggs.length) {
    tail = `<div class="eyebrow" style="margin-top:6px">${esc(T("match.ideas"))}</div>` +
      suggs.map((s, i) => `<div class="sugg-card"><span class="sugg-num">${i + 1}</span><span>${esc(s)}</span></div>`).join("");
  } else if (chat.recsStale) {
    tail = `<div class="foot" style="margin-top:6px">${esc(T("match.stale"))}</div>`;
  } else if (!chat.recs) {
    tail = `<div class="foot" style="margin-top:6px">${esc(T("match.noNotes"))}</div>`;
  }

  $("matchBody").innerHTML = rows.length
    ? profileBits + `<div class="eyebrow">${esc(T("match.best"))}</div>` + cards + tail
    : `<div class="empty-state">${esc(T("match.none"))}</div>`;

  openSheet("matchSheet");
}

function closeMatchView() { closeSheet("matchSheet"); }

/* ---------- Clients ("chats with clients") ---------- */
async function addClientFromRecs(recs, chat) {
  if (!recs.outreach) return;
  const c = chat.candidates.find(x => x.id === recs.outreach.buyer_id); if (!c) return;
  const existing = state.clients.find(x => x.buyerId === c.id && x.status === "draft");
  if (existing) {
    existing.message_it = recs.outreach.message_it; existing.message_en = recs.outreach.message_en; existing.flagged = !!recs.outreach.flagged_claim;
    if (!isLocalId(existing.id)) {
      bgSave(DataStore.updateOutreach(existing.id, { message_it: existing.message_it, message_en: existing.message_en, flagged: existing.flagged }), "save.outreachUpdate");
    }
    return;
  }
  let outreachId = "local" + Date.now();
  if (!isLocalId(chat.id)) {
    try {
      const { data, error } = await DataStore.createOutreach(state.farmerId, chat.id, c.id, recs.outreach.message_it, recs.outreach.message_en, !!recs.outreach.flagged_claim);
      if (error) throw error;
      outreachId = data.id;
    } catch (e) { saveFailedWithOwnMessage("save.outreach", e, T("save.outreachMsg")); }
  }
  state.clients.unshift({
    id: outreachId, buyerId: c.id, chatId: chat.id, name: c.name, type: c.type, zone: c.zone,
    message_it: recs.outreach.message_it, message_en: recs.outreach.message_en,
    flagged: !!recs.outreach.flagged_claim, status: "draft", ts: Date.now(), extra: [], messages: []
  });
  if (!state.activeClientId) state.activeClientId = state.clients[0].id;
  /* A draft lands while the farmer is still on Fasto-AI, where none of the
     three renderers above run. Without this the badge would not appear until
     they changed screen — which is exactly the moment it stops being news. */
  renderBell();
}
async function markSent(id) {
  const c = state.clients.find(x => x.id === id); if (!c) return;
  /* "Sent" means placed in the buyer's inbox: post the draft as the first
     message and only mark it sent if the database accepted it. */
  if (!isLocalId(id)) {
    if (c.posting) return; c.posting = true;
    const ok = await postThreadMessage(c, c.message_it);
    c.posting = false;
    if (!ok) return;
  }
  c.status = "sent"; c.sentTs = Date.now();
  const chatOfDraft = state.chats.find(x => x.id === c.chatId);
  toast(T("clients.markedSent", { name: c.name }));
  renderChats(); renderDashboard(); renderBell();
  if (!isLocalId(id)) bgSave(DataStore.updateOutreach(id, { status: "sent", sent_at: new Date().toISOString(), farmer_summary: buildFarmerSummary(chatOfDraft && chatOfDraft.profile) }), "save.sentMark");
}

/* ---------- Notification bell ---------- */
/* Pure and DOM-free, like filterClients / buildLogisticsPayload: the rule for
   what counts as waiting is the part worth testing, and it is tested without a
   page. "draft" is the status an outreach row is born with (see the unshift in
   the recommendation flow) and markSent is the only thing that moves it off. */
function draftCount(clients) { return (clients || []).filter(c => c && c.status === "draft").length; }

function renderBell() {
  const btn = $("bellBtn"); if (!btn) return;
  const n = draftCount(state.clients);
  const badge = $("bellCount");
  if (badge) {
    /* Three digits would push the badge wider than the button it sits on, and
       the exact number stops being the useful part long before 100. */
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.style.display = n ? "flex" : "none";
  }
  /* The label is written here rather than by applyI18n — the same division of
     labour as #researchEmpty, and for the same reason: it carries a number, so
     a language switch has to re-read the count instead of painting a stale
     sentence over it. setLang calls renderBell after applyI18n. The badge
     itself is aria-hidden; this label is where the count is announced, and
     reading it twice would be worse than not reading it at all. */
  const label = n ? T("top.bellSome", { n }) : T("top.bellNone");
  btn.setAttribute("title", label);
  btn.setAttribute("aria-label", label);
}

/* ---------- Header identity ---------- */
function updateHeaderIdentity() {
  if (isBuyer()) {
    const biz = myBusiness();
    $("whoName").textContent = (biz ? biz.name : T("buyer.guest")).toUpperCase();
    return;
  }
  const chat = activeChat();
  const name = (chat && chat.profile && chat.profile.farmer_name) || T("top.guest");
  $("whoName").textContent = name.toUpperCase();
}

/* ---------- first-paint skeleton ----------
   Used only between "Enter Fasto Innova" and the moment Supabase has
   answered. The rows go into the real table body so they inherit its
   column widths, and css/app.css delays them ~180ms so a fast
   connection never flashes a placeholder nobody needed. */
function bootStatus(text) {
  const el = $("bootChipText");
  if (el) el.textContent = text;
}

/* The CSS half of the boot lock is `pointer-events:none` under #app.booting,
   which stops a MOUSE. It does nothing to a keyboard: a focusable element with
   pointer-events:none still takes Tab and still fires on Enter. That did not
   matter while the nav items were <div>s, and it matters now that they are
   buttons — pressing "Start New Chat" or a nav item mid-boot creates a chat
   that loadFarmerData() then wipes when it replaces state.chats wholesale.
   So the same controls the stylesheet dims are really disabled here.
   Anything added to the #app.booting rules in css/app.css belongs in this
   list too, or the lock holds for a mouse and leaks for a keyboard. */
const BOOT_LOCK_SEL = ".nav-item[data-screen], #topbar .icon-btn, #topbar .lang-toggle button, #topSearch, #researchSeeAll, #exportBtn, #newChatBtn, #sendBtn, #attachBtn, #userInput, .sugg-chip";
function setBootLock(on) {
  if (!document.querySelectorAll) return;
  document.querySelectorAll(BOOT_LOCK_SEL).forEach(el => { el.disabled = !!on; });
}

function showResearchSkeleton(rows) {
  const body = $("researchBody");
  if (!body) return;
  let html = "";
  for (let i = 0; i < rows; i++) {
    html += '<tr class="rp-skel" aria-hidden="true">' +
      '<td><div class="skel-line w-70"></div><div class="skel-line sm w-40"></div></td>' +
      '<td><div class="skel-line w-60"></div></td>' +
      '<td><div class="skel-line w-50"></div></td>' +
      '<td><div class="skel-line w-40"></div></td>' +
      '<td class="rp-prog"><div class="skel-line bar"></div><div class="skel-line sm w-50"></div></td>' +
      '</tr>';
  }
  body.innerHTML = html;
  $("researchSeeAll").style.display = "none";
}

/* ================= SEARCH =================
   ROADMAP item 17. The top-bar box used to reach into the page after the fact:
   it walked the rows that happened to exist and set style.display on the ones
   that didn't match. Nothing recorded that a query was active, so the next
   render — a new message arriving, a price corrected, a draft marked sent, a
   language switch, arriving on the screen at all — rebuilt the list from state
   and every hidden row came back while the words were still in the box.

   The query lives in state.search now and the render functions do the
   filtering, which is what makes it survive. Four decisions on top of that:

   1. IT MATCHES FIELDS, NOT RENDERED TEXT. The old version tested the row's
      whole textContent, so a query could match across two cells that only
      happen to sit next to each other. Each field is matched on its own, and
      several words all have to match (in any order, in any field) rather than
      being one literal string — "pomodori sant" finds the row, which typing
      the cells in the wrong order never did.
   2. IT SEARCHES MORE THAN IS ON SCREEN where the screen is a summary: the
      Dashboard shows only a conversation's largest product, and the client
      list shows the first 46 characters of a draft. Both are searched in full.
   3. A QUERY NEVER CHANGES WHAT IS SELECTED. Filtering the client list does
      not close the thread you are reading, filtering the rail does not close
      the conversation you are in, and neither ever writes to state beyond the
      query itself. Clearing the box puts everything back exactly as it was.
   4. NO MATCH SAYS SO, naming the query. An empty table with no explanation
      reads as lost data, which is precisely the impression this app can least
      afford to give — the empty-state line is written by the renderer for that
      reason, so #researchEmpty carries no data-i18n of its own (one writer per
      element, the lesson from #modePill in item 10). */

function normalizeQuery(q) { return String(q == null ? "" : q).trim().toLowerCase(); }
function searchTerms(q) { const n = normalizeQuery(q); return n ? n.split(/\s+/) : []; }
/* The fields are joined with a space, and a term can never contain one (the
   query is split on whitespace), so no single term can span two fields — a
   row whose quantity ends in 80 and whose next field starts with "pomodori"
   must not be found by typing "80pomodori". */
function matchesSearch(fields, q) {
  const terms = searchTerms(q);
  if (!terms.length) return true;
  const hay = (fields || []).filter(f => f !== null && f !== undefined && f !== "")
    .map(f => String(f).toLowerCase()).join(" ");
  return terms.every(t => hay.includes(t));
}
function researchSearchFields(c) {
  const top = topProductCategory(c.profile);
  const prods = (c.profile && c.profile.products) || [];
  return [c.title, relDate(c.ts), catLabel(top), top, phaseLabel(c.phase),
    c.profile && c.profile.village, c.profile && c.profile.farmer_name]
    .concat(prods.map(p => p.name)).concat(prods.map(p => catLabel(p.category)))
    .concat(prods.map(p => p.category));
}
function clientSearchFields(c) {
  return [c.name, c.message_it, c.message_en,
    T(c.status === "sent" ? "clients.sent" : "clients.draft")];
}
function chatSearchFields(c) { return [c.title]; }
/* Pure and DOM-free on purpose, like buildLogisticsPayload / applyProfileEdit /
   authErrorInfo — the filtering is the part worth testing, and it is tested
   without a page. */
function filterResearch(chats, q) { return chats.filter(c => matchesSearch(researchSearchFields(c), q)); }
function filterClients(clients, q) { return clients.filter(c => matchesSearch(clientSearchFields(c), q)); }
function filterChatRail(chats, q) { return chats.filter(c => matchesSearch(chatSearchFields(c), q)); }

function setSearch(v) {
  const next = String(v == null ? "" : v);
  if (next === state.search) return;
  state.search = next;
  repaintForSearch();
}
/* Only the list that the query filters is redrawn. renderChats() would also
   rebuild the thread pane, and the thread pane contains the follow-up-note box
   — redrawing it on every keystroke would throw away a half-typed note. */
function repaintForSearch() {
  if (state.screen === "dashboard") renderDashboard();
  else if (state.screen === "clients") renderClientList();
  else if (state.screen === "assistant") renderChatRail();
}

/* ================= RENDERERS ================= */
function phaseLabel(p) { return ["interview", "matching", "done"].indexOf(p) === -1 ? p : T("phase." + p); }
function progClass(pct) { return pct >= 70 ? "" : pct >= 30 ? "warn" : "danger"; }
function relDate(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return T("date.today");
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return T("date.yesterday");
  return d.toLocaleDateString(T("date.locale"), { day: "2-digit", month: "short" });
}
function adjustPrice(cat) {
  if (!cat) return;
  const cur = PRICE_ASSUMPTIONS[cat] || 3;
  const v = window.prompt(T("dash.pricePrompt", { cat: catLabel(cat) || cat }), cur.toFixed(2));
  if (v === null) return;
  const n = parseFloat(v.replace(",", "."));
  if (isFinite(n) && n > 0) { PRICE_ASSUMPTIONS[cat] = n; renderDashboard(); }
}

function renderDashboard() {
  renderBell();
  if (!$("dashboardScreen")) return;
  const all = state.chats.filter(c => c.profile).sort((a, b) => b.ts - a.ts);
  const q = normalizeQuery(state.search);
  const rows = q ? filterResearch(all, q) : all;
  /* "Latest 3 / see all" is a way of not drowning the screen in a long list.
     A query is the same job done better, so while one is active every match is
     shown and the toggle is out of the way. */
  const shown = (q || state.showAllResearch) ? rows : rows.slice(0, 3);

  $("researchBody").innerHTML = shown.map(c => {
    const top = topProductCategory(c.profile);
    const prod = c.profile.products.find(p => p.category === top) || c.profile.products[0];
    const price = PRICE_ASSUMPTIONS[top] || 3;
    const done = c.phase === "done";
    /* Both of these used to be a <td onclick>: a cell is not focusable and not
       activatable, so opening the match view and correcting a price were mouse
       gestures with no keyboard equivalent anywhere else in the app. The cell
       keeps its class (the mobile data-label rules key off it); the control
       inside it is a real button. */
    const convCell = done
      ? `<button type="button" class="rp-cell-btn" onclick="openMatchView('${c.id}')" title="${escAttr(T("dash.whyTitle"))}" aria-label="${escAttr(T("dash.whyTitle"))}"><b>${esc(c.title)}</b><small>${esc(relDate(c.ts))}</small></button>`
      : `<b>${esc(c.title)}</b><small>${esc(relDate(c.ts))}</small>`;
    return `<tr>
      <td class="rp-conv ${done ? "rp-clickable" : ""}">${convCell}</td>
      <td>${esc(catLabel(top) || top || "—")}</td>
      <td>${prod ? esc(T("dash.kgWk", { n: Math.round(prod.kg_per_week) })) : "—"}</td>
      <td class="rp-price"><button type="button" class="rp-cell-btn" onclick="adjustPrice('${top}')" aria-label="${escAttr(T("a11y.changePrice", { cat: catLabel(top) || top }))}">€${price.toFixed(2)}/kg</button></td>
      <td class="rp-prog">
        <div class="progress-track"><div class="progress-fill ${progClass(c.pct)}" style="width:${c.pct}%"></div></div>
        <div class="prog-label">${esc(phaseLabel(c.phase))} · ${c.pct}%</div>
      </td>
    </tr>`;
  }).join("");
  const empty = $("researchEmpty");
  empty.style.display = shown.length ? "none" : "block";
  /* Written here rather than by a data-i18n attribute: the element has two
     messages now, and "nothing matched your search" must never be mistaken for
     "your research is gone". textContent, so the query is never markup. */
  empty.textContent = (q && all.length) ? T("search.noneResearch", { q: state.search.trim() }) : T("dash.empty");
  const seeAll = $("researchSeeAll");
  seeAll.style.display = (!q && all.length > 3) ? "inline-flex" : "none";
  seeAll.textContent = state.showAllResearch ? T("dash.showLatest") : T("dash.seeAllN", { n: all.length });
}


/* ================= EXPORT (Research Progress + outreach log) =================
   ROADMAP item 12. Two datasets leave the app here: what Brain 1 captured in
   every conversation, and every outreach draft Brain 2 wrote. Both as CSV, and
   both together as a printable report the browser can save as a PDF.

   FOUR DECISIONS THIS RESTS ON, none of them cosmetic:

   1. A RESEARCH ROW IS ONE PRODUCT, not one conversation. The Dashboard shows a
      conversation's LARGEST product and hides the rest, which is right for a
      glance and wrong for a report: the quantities would not add up to what the
      farmer actually pledged. So a conversation with three products is three
      rows, and the sheet, the CSV header block and the printed report all SAY
      SO — the same rule as the Admin funnel, where the unit is stated rather
      than left to be guessed at. A profile with no products at all is still one
      row with the product columns blank; it is never dropped.

   2. PRICE IS AN ASSUMPTION AND IS LABELLED AS ONE. PRICE_ASSUMPTIONS is desk
      research the farmer can override, not a quote from a buyer, so the column
      is "price assumption" and the money column says where it came from. This
      app's standing rule is that nothing invented is ever presented as if a
      buyer had said it, and an unlabelled "weekly value" column in a document
      handed to a tutor is exactly that.

   3. THE SEPARATOR FOLLOWS THE UI LANGUAGE. Excel splits on the list separator
      of its own locale: an Italian copy of Excel opens a comma-separated file
      as one column of text. The app already knows which language it is in (and
      defaults to the browser's), so Italian gets ";" with "," for decimals and
      English gets "," with ".". The export sheet states which one it will use.
      This is the one place where a language changes what leaves the app — the
      logistics email deliberately keeps English field names because it is read
      by the partner, but this file is read by whoever pressed the button.

   4. A CELL THAT STARTS LIKE A FORMULA IS NEUTRALISED. Product names and
      follow-up notes are typed by the farmer, and a spreadsheet treats a cell
      beginning with = + - @ as a formula. Quoting does not stop it; a leading
      apostrophe does. Plain negative numbers are left alone. */

const EXPORT_KINDS = ["research", "outreach"];

function csvSeparator() { return currentLang() === "it" ? ";" : ","; }

/* Numbers follow the same locale as the separator: ";"-separated files are for
   an Italian spreadsheet, which reads "3.00" as three hundred. */
function csvNumber(n, dp) {
  if (n == null || !isFinite(n)) return "";
  const s = Number(n).toFixed(dp == null ? 2 : dp);
  return csvSeparator() === ";" ? s.replace(".", ",") : s;
}

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;
function csvCell(v, sep) {
  let s = v == null ? "" : String(v);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = "'" + s;
  return /["\n\r]/.test(s) || s.indexOf(sep) !== -1 ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/* The BOM is not decoration: without it Excel reads a UTF-8 file as Latin-1 and
   every accented village name in the Cassino area comes out mangled. */
function toCSV(headers, rows, sep) {
  sep = sep || csvSeparator();
  const lines = [headers.map(h => csvCell(h, sep)).join(sep)];
  rows.forEach(r => lines.push(r.map(c => csvCell(c, sep)).join(sep)));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/* Local calendar date, not toISOString(): a conversation started at 00:30 in
   Italy is dated the day before in UTC, which is the day the farmer would
   swear it did not happen. */
function exportDate(ts) {
  const d = new Date(ts);
  if (!isFinite(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function exportFileName(kind) {
  return "fasto-" + (kind === "outreach" ? "outreach-log" : "research-progress") + "-" + exportDate(Date.now()) + ".csv";
}
function organicLabel(v) {
  return v === "yes" ? T("match.organic") : v === "partial" ? T("match.partlyOrganic") : T("match.notOrganic");
}

/* ---------- the two datasets, as plain objects and with no DOM ----------
   Split from everything that renders or downloads for the same reason
   buildLogisticsPayload() is: this is the part that can be wrong in a way
   nobody notices, so it is the part that gets tested. */
function researchExportRows(chats, clients) {
  const drafts = {}, sent = {};
  (clients || []).forEach(c => {
    if (!c.chatId) return;
    drafts[c.chatId] = (drafts[c.chatId] || 0) + 1;
    if (c.status === "sent") sent[c.chatId] = (sent[c.chatId] || 0) + 1;
  });
  const out = [];
  (chats || []).filter(c => c.profile).slice().sort((a, b) => b.ts - a.ts).forEach(c => {
    const p = c.profile;
    const dist = p.distance_km_from_cassino;
    const base = {
      conversation: c.title || "", date: exportDate(c.ts),
      farmer: p.farmer_name || "", village: p.village || "",
      distance: dist != null && isFinite(Number(dist)) ? Number(dist) : null,
      organic: organicLabel(p.organic),
      months: (p.available_months || []).map(m => monthName(m)).join(" · "),
      stage: phaseLabel(c.phase), pct: c.pct == null ? 0 : c.pct,
      drafts: drafts[c.id] || 0, sent: sent[c.id] || 0
    };
    const prods = p.products || [];
    // A captured profile with no products is a real state (the Guardian lets it
    // through with a warning) and it is the interesting one, so it keeps its row.
    if (!prods.length) { out.push(Object.assign({}, base, { product: "", category: "", kg: null, price: null, value: null })); return; }
    prods.forEach(pr => {
      const kg = Number(pr.kg_per_week);
      const price = PRICE_ASSUMPTIONS[pr.category] || 3;
      out.push(Object.assign({}, base, {
        product: pr.name || "", category: catLabel(pr.category) || pr.category || "",
        kg: isFinite(kg) ? kg : null, price: price, value: isFinite(kg) ? kg * price : null
      }));
    });
  });
  return out;
}

function outreachExportRows(clients, chats) {
  const titleById = {};
  (chats || []).forEach(c => { titleById[c.id] = c.title; });
  return (clients || []).slice().sort((a, b) => b.ts - a.ts).map(c => ({
    buyer: c.name || "", type: (c.type || "").replace(/_/g, " "), zone: c.zone || "",
    // "sent" only when it says so. createOutreach doesn't set a status, so a row
    // can hold null, and "not draft" would count that as sent.
    status: T(c.status === "sent" ? "clients.sent" : "clients.draft"),
    flagged: T(c.flagged ? "export.yes" : "export.no"),
    edited: T(c.profileEdited ? "export.yes" : "export.no"),
    // Named, never dropped — the same rule the Admin funnel follows for an
    // outreach row whose conversation isn't there.
    conversation: (c.chatId && titleById[c.chatId]) || T("export.orphanChat"),
    date: exportDate(c.ts),
    notes: threadItems(c).filter(m => m.who === "farmer").map(m => m.text).join(" | "),
    message_it: c.message_it || "", message_en: c.message_en || ""
  }));
}

const RESEARCH_COLS = ["conversation", "date", "farmer", "village", "distance", "organic", "product",
  "category", "kg", "months", "price", "value", "stage", "pct", "drafts", "sent"];
const OUTREACH_COLS = ["buyer", "buyerType", "zone", "status", "flagged", "edited",
  "conversation", "written", "notes", "messageIt", "messageEn"];
const exportHeaders = cols => cols.map(k => T("export.h." + k));

function researchCsvCells(r) {
  return [r.conversation, r.date, r.farmer, r.village,
    r.distance == null ? "" : csvNumber(r.distance, 1), r.organic, r.product, r.category,
    r.kg == null ? "" : csvNumber(r.kg, 0), r.months,
    r.price == null ? "" : csvNumber(r.price, 2), r.value == null ? "" : csvNumber(r.value, 2),
    r.stage, String(r.pct), String(r.drafts), String(r.sent)];
}
function outreachCsvCells(r) {
  return [r.buyer, r.type, r.zone, r.status, r.flagged, r.edited,
    r.conversation, r.date, r.notes, r.message_it, r.message_en];
}
function exportCsv(kind) {
  return kind === "outreach"
    ? toCSV(exportHeaders(OUTREACH_COLS), outreachExportRows(state.clients, state.chats).map(outreachCsvCells))
    : toCSV(exportHeaders(RESEARCH_COLS), researchExportRows(state.chats, state.clients).map(researchCsvCells));
}
function exportRowCount(kind) {
  return kind === "outreach" ? outreachExportRows(state.clients, state.chats).length
                             : researchExportRows(state.chats, state.clients).length;
}

function downloadTextFile(name, text, mime) {
  try {
    const blob = new Blob([text], { type: (mime || "text/csv") + ";charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) { /* already gone */ } }, 0);
    return true;
  } catch (e) {
    console.warn("Download blocked:", e);
    return false;
  }
}

function doExportCsv(kind) {
  if (!exportRowCount(kind)) { toast(T("export.nothing")); return; }
  const name = exportFileName(kind);
  if (downloadTextFile(name, exportCsv(kind))) toast(T("export.done", { file: name }));
  else toast(T("export.failed"));
}

/* ---------- printable report ----------
   No PDF library: this project has no build step, and a CDN script for one
   file would be a dependency the app carries on every load for a button most
   visits never press. The browser already writes PDFs. @media print in
   css/app.css hides every other child of <body> and prints #printReport on
   white paper, which also means no popup window for a blocker to eat. */
function printTable(cols, rows, cells) {
  if (!rows.length) return `<p class="pr-empty">${esc(T("export.emptyTable"))}</p>`;
  return `<table class="pr-table">
    <thead><tr>${cols.map(k => `<th scope="col">${esc(T("export.h." + k))}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cells(r).map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
}
function printCells(vals) { return vals.map(v => v == null ? "" : String(v)); }
function buildPrintReport() {
  const research = researchExportRows(state.chats, state.clients);
  const outreach = outreachExportRows(state.clients, state.chats);
  const account = (state.farmerProfile && state.farmerProfile.farmer_name) || T("export.noAccountName");
  const conv = (state.chats || []).filter(c => c.profile).length;
  return `
    <div class="pr-head">
      <h1>${esc(T("export.reportTitle"))}</h1>
      <p class="pr-meta">${esc(T("export.generated", { date: exportDate(Date.now()), account: account }))}</p>
      <p class="pr-meta">${esc(T("export.counts", { conv: conv, prod: research.length, out: outreach.length }))}</p>
    </div>
    <h2>${esc(T("export.researchName"))}</h2>
    <p class="pr-note">${esc(T("export.rowUnit"))}</p>
    ${printTable(RESEARCH_COLS, research, r => printCells([r.conversation, r.date, r.farmer, r.village,
      r.distance == null ? "" : r.distance, r.organic, r.product, r.category,
      r.kg == null ? "" : Math.round(r.kg), r.months,
      r.price == null ? "" : "€" + r.price.toFixed(2), r.value == null ? "" : "€" + r.value.toFixed(2),
      r.stage, r.pct + "%", r.drafts, r.sent]))}
    <h2>${esc(T("export.outreachName"))}</h2>
    ${printTable(OUTREACH_COLS, outreach, r => printCells([r.buyer, r.type, r.zone, r.status, r.flagged,
      r.edited, r.conversation, r.date, r.notes, r.message_it, r.message_en]))}
    <div class="pr-foot">
      <p>${esc(T("export.priceNote"))}</p>
      <p>${esc(T("export.sessionNote"))}</p>
    </div>`;
}
function doExportPrint() {
  const el = $("printReport");
  if (!el) return;
  if (!exportRowCount("research") && !exportRowCount("outreach")) { toast(T("export.nothing")); return; }
  el.innerHTML = buildPrintReport();
  if (typeof window !== "undefined" && typeof window.print === "function") window.print();
}

/* ---------- the sheet ---------- */
function openExportSheet() {
  const research = researchExportRows(state.chats, state.clients);
  const outreach = outreachExportRows(state.clients, state.chats);
  const conv = (state.chats || []).filter(c => c.profile).length;
  const sub = $("exportSubtitle");
  if (sub) sub.textContent = T("export.counts", { conv: conv, prod: research.length, out: outreach.length });
  const body = $("exportBody");
  if (body) body.innerHTML = `
    <div class="ex-row">
      <div class="ex-row-text">
        <div class="ex-row-title">${esc(T("export.researchName"))}</div>
        <div class="ex-row-sub">${esc(T("export.rowUnit"))}</div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="doExportCsv('research')"${research.length ? "" : " disabled"}>${esc(T("export.csv"))}</button>
    </div>
    <div class="ex-row">
      <div class="ex-row-text">
        <div class="ex-row-title">${esc(T("export.outreachName"))}</div>
        <div class="ex-row-sub">${esc(T("export.outreachSub"))}</div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="doExportCsv('outreach')"${outreach.length ? "" : " disabled"}>${esc(T("export.csv"))}</button>
    </div>
    <div class="ex-row">
      <div class="ex-row-text">
        <div class="ex-row-title">${esc(T("export.bothName"))}</div>
        <div class="ex-row-sub">${esc(T("export.printHint"))}</div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="doExportPrint()"${research.length || outreach.length ? "" : " disabled"}>${esc(T("export.print"))}</button>
    </div>
    <div class="ex-notes">
      <p>${esc(T("export.sepNote", { sep: csvSeparator() }))}</p>
      <p>${esc(T("export.priceNote"))}</p>
      <p>${esc(T("export.sessionNote"))}</p>
    </div>`;
  openSheet("exportSheet");
}
function closeExportSheet() { closeSheet("exportSheet"); }

function avatarHTML(name, idx) {
  return `<div class="avatar av-${idx % 5}">${esc((name || "?").slice(0, 2).toUpperCase())}</div>`;
}

/* Split from renderChats() so a search keystroke can redraw the list WITHOUT
   redrawing the thread beside it: renderThread() rebuilds the pane, and the
   pane holds the follow-up-note box a farmer may be halfway through typing. */
function renderClientList() {
  renderBell();
  const list = $("clientList");
  if (!list) return;
  if (!state.clients.length) {
    list.innerHTML = `<div class="empty-state">${esc(T("clients.emptyList"))}<br>${esc(T("clients.emptyListHint"))}</div>`;
    return;
  }
  const q = normalizeQuery(state.search);
  const shown = q ? filterClients(state.clients, q) : state.clients;
  if (!shown.length) {
    list.innerHTML = `<div class="empty-state">${esc(T("search.noneClients", { q: state.search.trim() }))}</div>`;
    return;
  }
  // Buttons for the same reason as the chat rail: this list was mouse-only.
  list.innerHTML = shown.map(c => {
    /* The avatar colour is picked from the position in the FULL list, not in
       the filtered one, or a buyer would change colour while you searched. */
    const i = state.clients.indexOf(c);
    const on = c.id === state.activeClientId;
    return `
    <button type="button" class="client-item ${on ? "active" : ""}"${on ? ' aria-current="true"' : ""} aria-label="${escAttr(T("a11y.openClient", { name: c.name }))}" onclick="selectClient('${c.id}')">
      ${avatarHTML(c.name, i)}
      <div style="min-width:0;flex:1">
        <div class="ci-top"><span class="ci-name">${esc(c.name)}</span>${c.status === "sent" ? `<span class="pill pill-accent" style="margin-left:auto">${esc(T("clients.sent"))}</span>` : `<span class="pill pill-amber" style="margin-left:auto">${esc(T("clients.draft"))}</span>`}</div>
        <div class="ci-prev">${esc(c.message_it.slice(0, 46))}…</div>
      </div>
    </button>`;
  }).join("");
}
function renderChats() {
  if (!$("clientsScreen")) return;
  renderClientList();
  if (!state.clients.length) {
    $("threadPane").innerHTML = `<div class="empty-state" style="margin:auto">${esc(T("clients.selectConv"))}</div>`;
    return;
  }
  /* Which thread is open is chosen from the full list, never from the filtered
     one: a search must not silently re-select a different conversation, and it
     must not close the one being read just because its name stops matching. */
  if (!state.activeClientId) state.activeClientId = state.clients[0].id;
  renderThread();
}
function selectClient(id) { state.activeClientId = id; renderChats(); }

function renderThread() {
  const c = state.clients.find(x => x.id === state.activeClientId);
  const pane = $("threadPane");
  if (!c) { pane.innerHTML = `<div class="empty-state" style="margin:auto">${esc(T("clients.selectConv"))}</div>`; return; }
  const idx = state.clients.indexOf(c);
  pane.innerHTML = `
    <div class="thread-head">
      ${avatarHTML(c.name, idx)}
      <div style="min-width:0;flex:1">
        <div class="title-sm">${esc(c.name)}</div>
        <div class="foot">${esc(c.zone)} · ${esc((c.type || "").replace(/_/g, " "))}</div>
      </div>
      ${c.status === "sent" ? `<span class="pill pill-accent">${esc(T("clients.sent"))}</span>` : `<span class="pill pill-amber">${esc(T("clients.draft"))}</span>`}
    </div>
    <div class="thread-body" id="threadBody">
      <div class="day-divider">${esc(T("date.today"))}</div>
      <div class="bubble meta">${esc(T("clients.draftedBy"))}</div>
      ${c.flagged ? `<div class="bubble meta" style="color:var(--warn)">${esc(T("clients.flagged"))}</div>` : ""}
      ${c.profileEdited ? `<div class="bubble meta" style="color:var(--warn)">${esc(T("clients.profileEdited"))}</div>` : ""}
      <div class="bubble out">${esc(c.message_it)}</div>
      <div class="bubble-actions">
        ${c.status === "sent" ? "" : `<button class="btn btn-ghost btn-sm" onclick="markSent('${c.id}')">${esc(T("clients.markSent"))}</button>`}
        <button class="btn btn-ghost btn-sm" onclick="copyClientMsg('${c.id}')">${esc(T("clients.copyIt"))}</button>
      </div>
      <div class="bubble meta">${esc(T("clients.englishTranslation"))}</div>
      <div class="bubble in">${esc(c.message_en)}</div>
      ${threadItems(c).map(m => m.who === "buyer"
        ? `<div class="bubble in">${esc(m.text)}</div>`
        : `<div class="bubble out">${esc(m.text)}</div>${m.persisted ? `<div class="bubble-tick">${esc(T(tickKey(m)))}</div>` : ""}`).join("")}
    </div>
    <div class="thread-input-row">
      <button class="round-icon-btn" title="${escAttr(T("clients.attachTitle"))}"><img class="ic-svg sm" src="assets/icon-attach.svg" alt=""></button>
      <input type="text" class="input-glass" id="clientInput" placeholder="${escAttr(T("clients.typeHere"))}">
      <button class="round-icon-btn" id="clientSendBtn" title="${escAttr(T("clients.sendTitle"))}"><img class="ic-svg sm" src="assets/icon-send.svg" alt=""></button>
      <button class="round-icon-btn logi-btn" id="clientLogisticsBtn" title="${escAttr(T("clients.logiTitle"))}" aria-label="${escAttr(T("clients.logiAria"))}"><img class="ic-svg sm" src="assets/icon-truck.svg" alt=""></button>
    </div>`;
  const body = $("threadBody"); body.scrollTop = body.scrollHeight;
  $("clientSendBtn").onclick = () => sendClientNote(c.id);
  $("clientLogisticsBtn").onclick = () => openLogistics(c.id);
  $("clientInput").addEventListener("keydown", e => { if (e.key === "Enter") sendClientNote(c.id); });
}
async function sendClientNote(id) {
  // A real, user-authored follow-up, never a fabricated buyer reply. Saved
  // conversations post it to the shared thread; local ones stay on this device.
  const input = $("clientInput"); if (!input) return;
  const text = input.value.trim(); if (!text) return;
  const c = state.clients.find(x => x.id === id); if (!c) return;
  if (!isLocalId(id)) {
    // The buyer only sees a thread once the draft is in it, so a note cannot go first.
    if (c.status !== "sent") { toast(T("clients.sendFirst")); return; }
    if (c.posting) return; c.posting = true;
    const ok = await postThreadMessage(c, text);
    c.posting = false;
    if (ok) { input.value = ""; renderThread(); }
    return;
  }
  c.extra = c.extra || []; c.extra.push({ text, ts: Date.now() });
  input.value = "";
  renderThread();
}
function copyClientMsg(id) { const c = state.clients.find(x => x.id === id); if (c) { navigator.clipboard.writeText(c.message_it); toast(T("clients.copied")); } }


/* ================= LOGISTICS HAND-OFF =================
   The point of the whole product: once the two sides agree, Fasto passes the
   shipment to the logistics partner so the farmer never has to arrange a van
   or leave the platform. Brain 1 has already captured what, how much, when
   and from where during the interview, so most of this form fills itself.

   Two halves by design — pickup (farmer) and delivery (buyer). Today only the
   farmer has an account, so the farmer fills both and the buyer half starts as
   clearly-labelled placeholder data. When buyers get accounts (ROADMAP #14)
   each side fills its own half and this form barely changes.
   ------------------------------------------------------------------------ */

// Where the completed request is emailed, via FormSubmit.
// FormSubmit requires a one-off activation: the FIRST submission sends a
// confirmation link to this inbox and delivers nothing until it's clicked.
// NOTE: this address ships in a public repo. After activating, FormSubmit
// gives you a random alias that works identically —
// swapping it in here keeps the address out of the source and out of reach
// of address scrapers, with no other change needed.
const LOGISTICS_EMAIL = "yuvraj11argal@gmail.com";
const FORMSUBMIT_URL = "https://formsubmit.co/ajax/" + LOGISTICS_EMAIL;

/* monthNames() lives in js/i18n.js and is a function, not a table: read at
   render time so the month strip and this label follow the current language
   instead of whichever one the page happened to open in. */
function monthsLabel(arr) {
  if (!arr || !arr.length) return "";
  return arr.slice().sort((a, b) => a - b).map(m => monthName(m)).filter(Boolean).join(", ");
}

// esc() leaves quotes alone, which is fine inside element text but would break
// out of an attribute — an address with a " in it would end the value early.
const escAttr = s => esc(s).replace(/"/g, "&quot;");

/* The buyer half. Placeholder values, and the form and the email both say so:
   the standing rule on this project is that nothing fabricated is ever shown
   as if it came from a buyer. */
function demoBuyerSide(buyer) {
  return {
    company: buyer.name || "",
    contact: "Responsabile acquisti",
    vat: "IT00000000000",
    phone: "+39 0776 000000",
    address: "Via Roma 1, " + (buyer.zone || "Cassino") + " (FR), Italia"
  };
}

function logisticsPrefill(client) {
  const chat = state.chats.find(c => c.id === client.chatId) || null;
  const prof = (chat && chat.profile) || {};
  const buyer = DB.buyers.concat(DB.channels).find(b => b.id === client.buyerId) || {};
  const f = state.farmerProfile || {};
  const top = topProductCategory(prof);
  const prods = prof.products || [];
  const prod = prods.find(p => p.category === top) || prods[0] || null;
  return {
    buyer,
    shipment: {
      product: prod ? prod.name : "",
      quantity: prod ? T("logi.qtyValue", { n: Math.round(prod.kg_per_week) }) : "",
      months: monthsLabel(prof.available_months),
      organic: prof.organic || "unknown"
    },
    farmer: {
      company: f.company_name || "",
      contact: f.farmer_name || prof.farmer_name || "",
      vat: f.vat_number || "",
      phone: f.phone || "",
      address: f.address || (prof.village ? prof.village + " (FR), Italia" : "")
    },
    buyerSide: demoBuyerSide(buyer)
  };
}

function lgField(id, label, value, opts) {
  opts = opts || {};
  // opts.options turns the field into a <select> — [value, label] pairs. Used by
  // the profile editor for category / organic, where a free-text box would let
  // the farmer type something the Guardian would then silently rewrite.
  const tag = opts.options
    ? `<select id="${id}">${opts.options.map(o => `<option value="${escAttr(o[0])}"${o[0] === value ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`
    : opts.rows
    ? `<textarea id="${id}" rows="${opts.rows}" placeholder="${escAttr(opts.ph || "")}"></textarea>`
    : `<input type="${opts.type || "text"}" id="${id}" value="${escAttr(value || "")}" placeholder="${escAttr(opts.ph || "")}" autocomplete="off">`;
  return `<div class="lg-field${opts.wide ? " wide" : ""}">
      <label for="${id}">${esc(label)}${opts.req ? '<span class="lg-req" aria-hidden="true">*</span>' : ""}</label>
      ${tag}
    </div>`;
}

let logisticsClientId = null;
let logisticsDemoSnapshot = {};

const LG_BUYER_FIELDS = [["lgBCompany", "company"], ["lgBContact", "contact"], ["lgBVat", "vat"], ["lgBPhone", "phone"], ["lgBAddress", "address"]];

function openLogistics(clientId) {
  const c = state.clients.find(x => x.id === clientId); if (!c) return;
  logisticsClientId = clientId;
  const d = logisticsPrefill(c);
  logisticsDemoSnapshot = Object.assign({}, d.buyerSide);

  $("logisticsSubtitle").textContent = T("logi.subtitle", { buyer: c.name }) + (c.zone ? " · " + c.zone : "");
  $("logisticsBody").innerHTML = `
    <div class="lg-intro">${esc(T("logi.intro"))}</div>

    <div class="lg-section">
      <div class="lg-section-head"><span class="eyebrow">${esc(T("logi.whatMoving"))}</span><span class="foot">${esc(T("logi.fromChat"))}</span></div>
      <div class="lg-grid">
        ${lgField("lgProduct", T("logi.product"), d.shipment.product, { req: true, ph: T("logi.productPh") })}
        ${lgField("lgQty", T("logi.qty"), d.shipment.quantity, { req: true, ph: T("logi.qtyPh") })}
        ${lgField("lgMonths", T("logi.months"), d.shipment.months, { ph: T("logi.monthsPh") })}
        ${lgField("lgFirstPickup", T("logi.firstPickup"), "", { type: "date" })}
      </div>
    </div>

    <div class="lg-section">
      <div class="lg-section-head"><span class="eyebrow">${esc(T("logi.pickupHead"))}</span><span class="foot">${esc(T("logi.savedNextTime"))}</span></div>
      <div class="lg-grid">
        ${lgField("lgFCompany", T("logi.farmName"), d.farmer.company, { req: true })}
        ${lgField("lgFContact", T("logi.contactName"), d.farmer.contact, { req: true })}
        ${lgField("lgFVat", T("logi.vat"), d.farmer.vat, { ph: T("logi.vatPh") })}
        ${lgField("lgFPhone", T("logi.phone"), d.farmer.phone, { req: true, type: "tel", ph: "+39 …" })}
        ${lgField("lgFAddress", T("logi.pickupAddress"), d.farmer.address, { req: true, wide: true, ph: T("logi.addressPh") })}
      </div>
    </div>

    <div class="lg-section lg-demo">
      <div class="lg-section-head"><span class="eyebrow">${esc(T("logi.deliveryHead"))}</span><span class="pill pill-amber">${esc(T("logi.demoData"))}</span></div>
      <div class="lg-note">${esc(T("logi.demoNote"))}</div>
      <div class="lg-grid">
        ${lgField("lgBCompany", T("logi.businessName"), d.buyerSide.company, { req: true })}
        ${lgField("lgBContact", T("logi.contactName"), d.buyerSide.contact, { req: true })}
        ${lgField("lgBVat", T("logi.vat"), d.buyerSide.vat)}
        ${lgField("lgBPhone", T("logi.phone"), d.buyerSide.phone, { req: true, type: "tel" })}
        ${lgField("lgBAddress", T("logi.deliveryAddress"), d.buyerSide.address, { req: true, wide: true })}
      </div>
    </div>

    <div class="lg-section">
      <div class="lg-grid">${lgField("lgNotes", T("logi.driverNotes"), "", { rows: 2, wide: true, ph: T("logi.driverNotesPh") })}</div>
    </div>

    <div class="lg-confirms">
      <label class="lg-check"><input type="checkbox" id="lgConfirmF"><span>${esc(T("logi.confirmF"))}</span></label>
      <label class="lg-check"><input type="checkbox" id="lgConfirmB"><span>${esc(T("logi.confirmB"))}</span></label>
    </div>
    <div class="err-banner" id="lgErr" role="alert"></div>`;

  const btn = $("logisticsSubmit");
  btn.disabled = false; btn.textContent = T("logi.submit");
  openSheet("logisticsSheet");
}

function closeLogistics() { closeSheet("logisticsSheet"); }

const lgVal = id => { const el = $(id); return el ? String(el.value || "").trim() : ""; };

/* Split out so it can be tested without a network: returns either
   { ok:false, message } or { ok:true, payload } ready to POST. */
function buildLogisticsPayload() {
  const required = [
    ["lgProduct", "logi.needProduct"], ["lgQty", "logi.needQty"],
    ["lgFCompany", "logi.needFarmName"], ["lgFContact", "logi.needContact"],
    ["lgFPhone", "logi.needPhone"], ["lgFAddress", "logi.needAddress"],
    ["lgBCompany", "logi.needBBusiness"], ["lgBContact", "logi.needBContact"],
    ["lgBPhone", "logi.needBPhone"], ["lgBAddress", "logi.needBAddress"]
  ];
  const missing = required.filter(([id]) => !lgVal(id)).map(([, key]) => T(key));
  if (missing.length) return { ok: false, message: T("logi.missing", { list: missing.join(", ") }) };
  if (!$("lgConfirmF").checked || !$("lgConfirmB").checked) {
    return { ok: false, message: T("logi.bothConfirm") };
  }

  const client = state.clients.find(x => x.id === logisticsClientId) || {};
  // Which buyer fields are still the placeholder text we put there — so the
  // partner is never left guessing whether a number is real.
  const stillDemo = LG_BUYER_FIELDS
    .filter(([id, key]) => lgVal(id) === (logisticsDemoSnapshot[key] || ""))
    .map(([id]) => ({ lgBCompany: "business name", lgBContact: "contact name", lgBVat: "IVA", lgBPhone: "phone", lgBAddress: "address" })[id]);

  /* The field names below stay English whatever the app is set to. This is
     the one thing here that is not read by the farmer: it is a report to the
     logistics partner, who receives requests from every farmer on the platform
     and should not have to work out that "Indirizzo di ritiro" and "Pickup
     address" are the same row. The values are of course whatever was typed.
     The farmer's UI language is recorded instead, so the partner knows which
     language to answer in. */
  return { ok: true, payload: {
    _subject: "Fasto Innova — logistics request: " + lgVal("lgProduct") + " → " + (client.name || "buyer"),
    _template: "table",
    _captcha: "false",
    "Sent": new Date().toLocaleString("en-GB"),
    "Product": lgVal("lgProduct"),
    "Quantity": lgVal("lgQty"),
    "Available months": lgVal("lgMonths") || "—",
    "First pickup": lgVal("lgFirstPickup") || "—",
    "PICKUP — farm": lgVal("lgFCompany"),
    "Pickup contact": lgVal("lgFContact"),
    "Pickup IVA": lgVal("lgFVat") || "—",
    "Pickup phone": lgVal("lgFPhone"),
    "Pickup address": lgVal("lgFAddress"),
    "DELIVERY — business": lgVal("lgBCompany"),
    "Delivery contact": lgVal("lgBContact"),
    "Delivery IVA": lgVal("lgBVat") || "—",
    "Delivery phone": lgVal("lgBPhone"),
    "Delivery address": lgVal("lgBAddress"),
    "Notes for the driver": lgVal("lgNotes") || "—",
    "Buyer fields still placeholder": stillDemo.length ? stillDemo.join(", ") : "none — all edited by the farmer",
    "Mode": state.offline ? "Offline demo" : "Live AI",
    "Farmer's app language": currentLang() === "it" ? "Italiano" : "English",
    "Fasto chat": client.chatId || "—"
  } };
}

async function submitLogistics() {
  const err = $("lgErr");
  const show = m => { err.textContent = m; err.style.display = "block"; };
  err.style.display = "none";

  const built = buildLogisticsPayload();
  if (!built.ok) { show(built.message); return; }

  const btn = $("logisticsSubmit");
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>' + esc(T("logi.sending"));

  // Saved whatever happens to the email: the farmer typed them, and next time
  // this form should already know them.
  if (state.farmerId && !isLocalId(state.farmerId)) {
    const patch = {
      farmer_name: lgVal("lgFContact"), company_name: lgVal("lgFCompany"),
      vat_number: lgVal("lgFVat"), address: lgVal("lgFAddress"), phone: lgVal("lgFPhone")
    };
    state.farmerProfile = Object.assign({}, state.farmerProfile, patch);
    bgSave(DataStore.updateFarmerDetails(state.farmerId, patch), "save.business");
  }

  try {
    const res = await fetch(FORMSUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(built.payload)
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || String(out.success) !== "true") throw new Error(out.message || ("the mail service answered " + res.status));

    const c = state.clients.find(x => x.id === logisticsClientId);
    if (c) { c.extra = c.extra || []; c.extra.push({ text: T("logi.sentNote", { product: lgVal("lgProduct"), qty: lgVal("lgQty") }), ts: Date.now() }); }
    closeLogistics();
    renderThread();
    toast(T("logi.sentToast"));
  } catch (e) {
    console.error("logistics submit failed", e);
    const msg = String((e && e.message) || e);
    // FormSubmit's one-time activation is the likeliest first failure, and the
    // generic wording gives no clue what to do about it.
    if (/activat|confirm/i.test(msg)) {
      show(T("logi.activation", { email: LOGISTICS_EMAIL }));
    } else {
      show(T("logi.failed", { error: msg }));
    }
  } finally {
    btn.disabled = false; btn.textContent = T("logi.submit");
  }
}

/* ================= EDIT A CAPTURED PROFILE =================
   Brain 1 captures the profile once, mid-conversation, from what the farmer
   happened to say. Anything it got slightly wrong — the village, a quantity,
   a month — was permanent until now: there was no way to correct it short of
   starting the whole interview again.

   This is a form over the same fields, saved with the same DataStore methods
   the capture path already uses (updateChat / saveProducts / updateFarmerName),
   so it needs no new table and no new column.

   Two things follow from an edit and are the reason this is more than a form:

   1. Brain 2's SCORES are deterministic, so they are simply recomputed from
      the new numbers — free, and always right. Brain 2's written SENTENCES
      are not: they were composed from the old figures and there is no way to
      regenerate them without another model call. They are marked stale and
      hidden rather than shown as if they still described the farm.
   2. The outreach draft sitting in Clients was written from the old numbers
      too, and it is the one thing here that gets sent to a real buyer. It is
      never rewritten silently — the thread carries a warning instead, so the
      farmer reads it before sending.
   ------------------------------------------------------------------------ */

const PROFILE_FIELDS = ["farmer_name", "village", "distance_km_from_cassino", "organic", "available_months", "products"];
// Changing any of these changes what the engine scores on, so the ranking has
// to be recomputed and Brain 2's written notes no longer describe this farm.
const PROFILE_SCORING_FIELDS = ["distance_km_from_cassino", "organic", "available_months", "products"];
// Changing any of these changes something the outreach draft actually says.
const PROFILE_DRAFT_FIELDS = ["farmer_name", "village", "organic", "available_months", "products"];
// A function, not a table: a table built at load time would freeze whichever
// language the page opened in. Same reason as adminStages() and offlineScript().
function profileFieldLabel(field) { return T("profile.fld." + field); }

/* Compares one field of two profiles. Normalising first matters more than it
   looks: Postgres hands numeric columns back as strings, so a distance that
   came from the database is "6" and the same distance typed into the form is
   6 — compared raw, simply opening this form and pressing Save would look
   like a change and rewrite every row. */
function profileFieldValue(profile, field) {
  const v = profile ? profile[field] : null;
  if (field === "products") {
    return JSON.stringify((v || []).map(p => [String(p.name == null ? "" : p.name).trim(), p.category, Number(p.kg_per_week) || 0]));
  }
  if (field === "available_months") return JSON.stringify((v || []).slice().sort((a, b) => a - b));
  if (field === "distance_km_from_cassino") return (v == null || v === "") ? "" : String(Number(v));
  return String(v == null ? "" : v).trim();
}
function changedProfileFields(before, after) {
  return PROFILE_FIELDS.filter(f => profileFieldValue(before, f) !== profileFieldValue(after, f));
}
function humanList(items) {
  if (items.length <= 1) return items[0] || "";
  return items.slice(0, -1).join(", ") + " " + T("list.and") + " " + items[items.length - 1];
}

/* The whole edit, minus the DOM — deliberately split the same way
   buildLogisticsPayload() is, so validation, the re-score and the exact set of
   Supabase writes can be tested without a browser. Returns
   { ok, errors, warnings, changed, rescored, staleDrafts, saved }. */
function applyProfileEdit(chat, raw) {
  const fail = errors => ({ ok: false, errors: errors, warnings: [], changed: [], rescored: false, staleDrafts: 0, saved: false });
  if (!chat) return fail([T("profile.gone")]);

  /* Guardian's own messages name a product by index ("product 0") when the
     name is blank, which is unreadable in a form the farmer is looking at.
     These two cases get asked for in plain words first; everything else —
     unknown categories, absurd quantities, a missing village, an unclear
     organic status — is left to the Guardian, which is the only thing on this
     project allowed to decide what a valid profile is. */
  const asked = [];
  (raw.products || []).forEach((p, i) => {
    const named = String(p.name == null ? "" : p.name).trim();
    if (!named) asked.push(T("profile.needName", { n: i + 1 }));
    else if (!isFinite(Number(p.kg_per_week)) || Number(p.kg_per_week) <= 0) asked.push(T("profile.needKg", { name: named }));
  });
  if (asked.length) return fail(asked);

  const v = guardianValidateProfile(raw);
  v.warnings.forEach(w => addLog("warn", "Guardian · profile edit: " + w));
  if (!v.ok) {
    v.errors.forEach(e => addLog("block", "Guardian · profile edit REJECTED: " + e));
    return { ok: false, errors: v.errors, warnings: v.warnings, changed: [], rescored: false, staleDrafts: 0, saved: false };
  }

  const before = chat.profile || {};
  const after = v.profile;
  const changed = changedProfileFields(before, after);
  if (!changed.length) return { ok: true, errors: [], warnings: v.warnings, changed: [], rescored: false, staleDrafts: 0, saved: false };

  chat.profile = after;
  chat.title = chatTitle(chat);
  chat.ts = Date.now();

  // The engine is pure and cheap, so the ranking is rebuilt from the new
  // numbers rather than left describing a farm that no longer exists.
  const rescored = changed.some(f => PROFILE_SCORING_FIELDS.indexOf(f) !== -1);
  if (rescored) {
    chat.candidates = rankMatches(after, DB, new Date().getMonth() + 1).slice(0, 8);
    if (chat.recs) chat.recsStale = true;
    addLog("info", "Brain 2 · re-scored after a profile edit, top score " + (chat.candidates[0] ? chat.candidates[0].score : 0) + "/100");
  }

  // Drafts already written from the old figures. Flagged, never rewritten:
  // rewording a message the farmer may already have sent, without being asked,
  // would be worse than leaving it visibly out of date.
  let staleDrafts = 0;
  if (changed.some(f => PROFILE_DRAFT_FIELDS.indexOf(f) !== -1)) {
    state.clients.forEach(c => { if (c.chatId === chat.id && c.status !== "sent") { c.profileEdited = true; staleDrafts++; } });
  }

  if (!isLocalId(chat.id)) {
    bgSave(DataStore.updateChat(chat.id, {
      title: chat.title,
      farmer_name: after.farmer_name || null,
      village: after.village || null,
      distance_km_from_cassino: after.distance_km_from_cassino == null ? null : after.distance_km_from_cassino,
      organic: after.organic || null,
      available_months: after.available_months || []
    }), "save.profile");
    // saveProducts is a delete-then-insert, so it is only run when the products
    // actually changed — correcting a village should not take the product list
    // out and put it back.
    if (changed.indexOf("products") !== -1) bgSave(DataStore.saveProducts(chat.id, after.products), "save.products");
  }
  // The account's display name is per-farmer, not per-chat, so it is written
  // whether or not this particular chat reached the database. Clearing the name
  // in one conversation deliberately does NOT wipe it from the account.
  if (changed.indexOf("farmer_name") !== -1 && after.farmer_name && state.farmerId && !isLocalId(state.farmerId)) {
    state.farmerProfile = Object.assign({}, state.farmerProfile, { farmer_name: after.farmer_name });
    bgSave(DataStore.updateFarmerName(state.farmerId, after.farmer_name), "save.name");
  }

  return { ok: true, errors: [], warnings: v.warnings, changed: changed, rescored: rescored, staleDrafts: staleDrafts, saved: true };
}

/* ---------- the form ---------- */
let profileChatId = null;
let profileReopenMatch = false;   // opened from the match sheet, so go back to it on save
let profileDraftProducts = [];    // the product rows, which can be added to and removed
let profileDraftMonths = [];

const pfVal = (id, fallback) => { const el = $(id); return el ? String(el.value == null ? "" : el.value).trim() : fallback; };

function renderProfileProducts() {
  const el = $("pfProducts"); if (!el) return;
  if (!profileDraftProducts.length) {
    el.innerHTML = `<div class="foot pf-noprod">${esc(T("profile.noProducts"))}</div>`;
    return;
  }
  el.innerHTML = profileDraftProducts.map((pr, i) => `
    <div class="pf-prod">
      <div class="pf-prod-head">
        <span class="eyebrow">${esc(T("profile.productN", { n: i + 1 }))}</span>
        <button type="button" class="pf-remove" onclick="removeProfileProduct(${i})">${esc(T("profile.remove"))}</button>
      </div>
      <div class="lg-grid pf-prod-grid">
        ${lgField("pfPName" + i, T("profile.whatIsIt"), pr.name || "", { req: true, ph: T("profile.whatIsItPh") })}
        ${/* the OPTION VALUE stays the Italian key the database and the engine
             agree on — only its label is translated. Getting this the wrong way
             round would write "vegetables" into a products row. */ ""}
        ${lgField("pfPCat" + i, T("profile.category"), pr.category || "verdure", { options: CATEGORIES.map(c => [c, catLabel(c) || c]) })}
        ${lgField("pfPKg" + i, T("profile.kgWeek"), pr.kg_per_week === "" || pr.kg_per_week == null ? "" : String(pr.kg_per_week), { req: true, type: "number", ph: T("profile.kgWeekPh") })}
      </div>
    </div>`).join("");
}

// Whatever is typed into the rows right now, before they are rebuilt — adding
// or removing a row must not throw away edits made to the others.
function syncProfileProducts() {
  profileDraftProducts = profileDraftProducts.map((pr, i) => ({
    name: pfVal("pfPName" + i, pr.name || ""),
    category: pfVal("pfPCat" + i, pr.category || "verdure"),
    kg_per_week: pfVal("pfPKg" + i, pr.kg_per_week == null ? "" : String(pr.kg_per_week))
  }));
}
function addProfileProduct() {
  syncProfileProducts();
  profileDraftProducts.push({ name: "", category: "verdure", kg_per_week: "" });
  renderProfileProducts();
  const el = $("pfPName" + (profileDraftProducts.length - 1)); if (el && el.focus) el.focus();
}
function removeProfileProduct(i) {
  syncProfileProducts();
  profileDraftProducts.splice(i, 1);
  renderProfileProducts();
}

function renderProfileMonths() {
  const el = $("pfMonths"); if (!el) return;
  el.innerHTML = monthNames().map((m, i) => {
    const n = i + 1;
    const on = profileDraftMonths.indexOf(n) !== -1;
    return `<button type="button" class="pf-month${on ? " on" : ""}" aria-pressed="${on}" onclick="toggleProfileMonth(${n})">${esc(m.slice(0, 3))}</button>`;
  }).join("");
}
function toggleProfileMonth(n) {
  const i = profileDraftMonths.indexOf(n);
  if (i === -1) profileDraftMonths.push(n); else profileDraftMonths.splice(i, 1);
  renderProfileMonths();
}

function readProfileForm() {
  syncProfileProducts();
  const raw = {
    farmer_name: pfVal("pfName", ""),
    village: pfVal("pfVillage", ""),
    organic: pfVal("pfOrganic", "no"),
    available_months: profileDraftMonths.slice().sort((a, b) => a - b),
    products: profileDraftProducts.map(p => ({
      name: p.name,
      category: p.category,
      kg_per_week: p.kg_per_week === "" ? NaN : Number(String(p.kg_per_week).replace(",", "."))
    }))
  };
  // Left OFF the object entirely when blank, rather than sent as null:
  // Number(null) is 0, so a null would be stored as a farm 0 km from Cassino
  // and quietly score better on distance. Absent means "unclear", which the
  // Guardian answers with its 8 km assumption AND a visible warning.
  const dist = pfVal("pfDist", "");
  if (dist !== "") raw.distance_km_from_cassino = Number(String(dist).replace(",", "."));
  return raw;
}

function showProfileNotice(msg, kind) {
  const el = $("pfErr"); if (!el) return;
  el.textContent = msg;
  // add/remove rather than toggle(name, force): the two-argument form is the
  // one thing in this file a stand-in DOM is most likely to get wrong, and
  // there is nothing to gain by depending on it.
  if (kind === "notice") el.classList.add("pf-notice"); else el.classList.remove("pf-notice");
  el.style.display = "block";
}

function openProfileEdit(chatId, fromMatchView) {
  const chat = state.chats.find(c => c.id === chatId);
  const sheet = $("profileSheet");
  if (!chat || !chat.profile || !sheet) return;
  profileChatId = chatId;
  profileReopenMatch = !!fromMatchView;
  if (fromMatchView) closeMatchView();

  const p = chat.profile;
  profileDraftProducts = (p.products || []).map(pr => ({ name: pr.name, category: pr.category, kg_per_week: pr.kg_per_week }));
  profileDraftMonths = (p.available_months || []).slice();

  const sub = $("profileSubtitle");
  if (sub) sub.textContent = T("profile.subtitle", { title: chat.title });

  $("profileBody").innerHTML = `
    <div class="lg-intro">${esc(T("profile.intro"))}</div>

    <div class="lg-section">
      <div class="lg-section-head"><span class="eyebrow">${esc(T("profile.yourFarm"))}</span></div>
      <div class="lg-grid">
        ${lgField("pfName", T("profile.name"), p.farmer_name || "", { ph: T("profile.namePh") })}
        ${lgField("pfVillage", T("profile.village"), p.village || "", { req: true, ph: T("profile.villagePh") })}
        ${lgField("pfDist", T("profile.distance"), p.distance_km_from_cassino == null ? "" : String(Number(p.distance_km_from_cassino)), { type: "number", ph: T("profile.distancePh") })}
        ${/* like the category select: the stored value is yes/partial/no, only the label moves */ ""}
        ${lgField("pfOrganic", T("profile.organic"), p.organic || "no", { options: [["yes", T("profile.organicYes")], ["partial", T("profile.organicPartial")], ["no", T("profile.organicNo")]] })}
      </div>
    </div>

    <div class="lg-section">
      <div class="lg-section-head"><span class="eyebrow">${esc(T("profile.whatYouGrow"))}</span><span class="foot">${esc(T("profile.perWeek"))}</span></div>
      <div id="pfProducts"></div>
      <button type="button" class="btn btn-ghost btn-sm pf-add" onclick="addProfileProduct()">${esc(T("profile.addProduct"))}</button>
    </div>

    <div class="lg-section">
      <div class="lg-section-head"><span class="eyebrow">${esc(T("profile.monthsHead"))}</span><span class="foot">${esc(T("profile.monthsHint"))}</span></div>
      <div class="pf-months" id="pfMonths"></div>
    </div>

    ${/* role="alert" so the Guardian's "I changed one of your numbers" notice is
          spoken, not only shown — it is the one correction this app must never
          let slip past unnoticed. */ ""}
    <div class="err-banner" id="pfErr" role="alert"></div>`;

  renderProfileProducts();
  renderProfileMonths();
  const btn = $("profileSaveBtn");
  if (btn) { btn.disabled = false; btn.textContent = T("profile.save"); }
  openSheet("profileSheet");
}

function closeProfileEdit() { closeSheet("profileSheet"); }

function saveProfileEdit() {
  const chat = state.chats.find(c => c.id === profileChatId);
  const el = $("pfErr"); if (el) el.style.display = "none";
  if (!chat) { showProfileNotice(T("profile.gone"), "error"); return; }

  const res = applyProfileEdit(chat, readProfileForm());
  // Some of these came straight from the Guardian in js/core.js, so they go
  // through engineText() on the way to the farmer's eyes.
  if (!res.ok) { showProfileNotice(res.errors.map(engineText).join(" "), "error"); return; }

  if (chat.id === state.activeChatId) updateHeaderIdentity();
  renderChatRail(); renderTranscript(); renderDashboard(); renderChats();

  /* The Guardian changed one of the farmer's own numbers on the way through
     (a distance it couldn't read, a quantity too large to be a small farm).
     Saying so in a toast that fades would be the one place this app hides a
     correction it made, so the sheet stays open, redrawn from what was
     actually stored, with the adjustment written above the fields. */
  if (res.warnings.length) {
    openProfileEdit(chat.id, profileReopenMatch);
    const list = res.warnings.map(engineText).join(" · ");
    showProfileNotice(res.warnings.length === 1
      ? T("profile.adjustedOne", { list: list })
      : T("profile.adjustedMany", { n: res.warnings.length, list: list }), "notice");
    return;
  }

  closeProfileEdit();
  if (!res.changed.length) toast(T("profile.nothingChanged"));
  else {
    let msg = T("profile.updated", { list: humanList(res.changed.map(profileFieldLabel)) });
    if (res.rescored) msg += T("profile.rescored");
    if (res.staleDrafts) msg += T("profile.staleDraft");
    toast(msg);
  }
  if (profileReopenMatch) openMatchView(chat.id);
}

/* ---------- dormant: WhatsApp hand-off ----------
   The "Open in WhatsApp" button was removed from the thread on 2026-08-26.
   The point of Fasto Innova is that the deal is arranged *here* — the AI has
   already captured what, how much and from where, and the logistics hand-off
   depends on both sides confirming inside the app. Sending the farmer out to
   WhatsApp to arrange it privately loses all of that.
   The two functions below are left in place, unreferenced, so the button can
   be restored by re-adding its markup in renderThread() if that changes.
   ------------------------------------------------------------------------- */
// Hands the Italian draft to WhatsApp instead of making the farmer copy-paste it.
// The buyer database is desk research and holds no phone numbers, so we use the
// no-recipient wa.me form: WhatsApp opens with the message already written and the
// farmer picks the buyer from their own contacts. If a buyer record ever gains a
// phone/whatsapp field, we address the chat directly instead — no other change needed.
function waNumber(client) {
  const buyer = DB.buyers.concat(DB.channels).find(b => b.id === client.buyerId) || {};
  const raw = buyer.whatsapp || buyer.phone || "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8) return "";                       // nothing usable
  return digits.length <= 10 ? "39" + digits : digits;    // bare Italian number → add country code
}
function openWhatsApp(id) {
  const c = state.clients.find(x => x.id === id); if (!c) return;
  const num = waNumber(c);
  const url = "https://wa.me/" + num + "?text=" + encodeURIComponent(c.message_it);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {                                             // pop-up blocked — don't lose the message
    navigator.clipboard.writeText(c.message_it);
    toast("WhatsApp was blocked by the browser — the Italian message is copied instead.");
    return;
  }
  toast(num ? "WhatsApp opened with your message ready to send."
            : "WhatsApp opened — pick " + c.name + " from your contacts, the message is already written.");
}

/* ================= ADMIN (visible only when the signed-in farmer is is_admin) =================

   The funnel answers one question: of everyone who started talking to Fasto,
   how many got as far as a message a real buyer can read?

   It counts CONVERSATIONS at every stage and never drafts. One finished
   conversation produces an outreach draft per matched buyer, so a funnel that
   starts in chats and ends in drafts can be wider at the bottom than at the
   top — "3 conversations → 12 sent" reads as a 400% conversion rate, which is
   worse than showing nothing. The raw draft totals are still worth knowing, so
   they sit beside the funnel instead, where their unit is spelled out.

   Read-only: three selects that already existed, no schema change.           */

/* The keys are the contract — adminStageSets() below returns a set of the same
   name for each one, and dropping either half renders a blank funnel. The
   labels are looked up per call rather than stored, so a language switch
   repaints the funnel instead of leaving it in the language it was drawn in. */
const ADMIN_STAGE_KEYS = ["started", "profile", "drafted", "sent"];
function adminStages() {
  return ADMIN_STAGE_KEYS.map(k => ({ key: k, label: T("admin.stage." + k), hint: T("admin.hint." + k) }));
}

/* Which conversations reached each stage. Pure — no DOM, no network — so the
   numbers can be tested on their own.

   Later stages are folded up into the earlier ones rather than counted
   independently. A chat holding an outreach draft must have finished its
   interview, because the draft is written from the captured profile — but the
   phase column is a fire-and-forget write, so it can fail while the outreach
   row itself lands, leaving a conversation that plainly reached stage 3 and
   reads as stage 1. Folding upwards keeps every stage a subset of the one
   above it, which is the only condition under which the percentages mean
   anything at all. */
function adminStageSets(chats, outreach) {
  const byId = new Map((chats || []).map(c => [c.id, c]));
  const started = new Set(byId.keys());
  const drafted = new Set(), sent = new Set();
  let orphanDrafts = 0;
  (outreach || []).forEach(o => {
    // A draft pointing at a conversation this query didn't return can't be
    // placed in the funnel. Counted and shown rather than dropped: a number
    // quietly disappearing is how a broken join goes unnoticed for months.
    if (!o.chat_id || !byId.has(o.chat_id)) { orphanDrafts++; return; }
    drafted.add(o.chat_id);
    if (o.status === "sent") sent.add(o.chat_id);   // ⊆ drafted by construction
  });
  const profile = new Set(drafted);
  (chats || []).forEach(c => { if (c.phase === "matching" || c.phase === "done") profile.add(c.id); });
  return { started, profile, drafted, sent, orphanDrafts };
}

/* Turns those sets into the rows the funnel draws: how many, what share of
   everyone who started, and how many fell away since the stage above. */
function adminFunnel(chats, outreach) {
  const sets = adminStageSets(chats, outreach);
  const top = sets.started.size;
  let prev = null;
  const stages = adminStages().map(s => {
    const count = sets[s.key].size;
    const row = {
      key: s.key, label: s.label, hint: s.hint, count,
      pctOfStart: top ? Math.round(count / top * 100) : 0,
      prev,
      fromPrev: prev ? Math.round(count / prev * 100) : null,
      dropped: prev === null ? null : prev - count
    };
    prev = count;
    return row;
  });
  return {
    stages, sets,
    drafts: (outreach || []).length,
    draftsSent: (outreach || []).filter(o => o.status === "sent").length,
    orphanDrafts: sets.orphanDrafts
  };
}

// Last loaded admin data, so clicking a funnel stage re-filters the table
// without three more round trips to Supabase.
let adminCache = null;

async function renderAdmin() {
  if (!$("adminScreen") || !state.isAdmin) return;
  const [{ data: farmers, error: e1 }, { data: chats, error: e2 }, { data: outreach, error: e3 }, { data: claims, error: e4 }] = await Promise.all([
    DataStore.listAllFarmers(), DataStore.listAllChats(), DataStore.listAllOutreach(), DataStore.listAllClaims()
  ]);
  if (e1 || e2 || e3 || e4) { console.error("admin load failed", e1, e2, e3, e4); toast(T("admin.loadFailed")); return; }
  // The accounts table also holds buyers now; "N farmers signed up" must not count them.
  adminCache = { farmers: (farmers || []).filter(x => x.role !== "buyer"), chats: chats || [], outreach: outreach || [], claims: claims || [] };
  paintAdmin();
}

/* Clicking a stage filters the table under the funnel to the conversations in
   it; clicking the selected one again clears the filter. Without this the
   funnel can say "4 stopped at the interview" while the table below has no way
   to show you which four. */
function setAdminStage(key) {
  state.adminStage = state.adminStage === key ? "started" : key;
  paintAdmin();
}

/* ---------- buyer claims (ROADMAP item 24) ----------
   A claim is the only way a buyer account gets anywhere: until an admin
   approves it, RLS treats the buyer as nobody. Approving a claim for a
   business that was not on the list creates its listing first, with the
   same honest placeholders the rest of the database uses — low confidence,
   no inferred needs, and a distance that scores zero rather than "right in
   the centre of Cassino", which a missing value would quietly mean. */
function makeBuyerId() { return "u" + Math.random().toString(36).slice(2, 8); }
function newBuyerRowFromClaim(claim, id) {
  return {
    id, name: String(claim.new_business_name || "").trim(), type: "other",
    zone: claim.new_business_zone || "Cassino area", distance_km: 25,
    needs: [], volume: "low", quality_focus: [],
    notes: "Registered by the business itself; details not yet provided.",
    source: "self-registered", confidence: "low", is_channel: false
  };
}
function claimBusinessLabel(c) {
  if (c.buyer_id) { const b = DB.buyers.concat(DB.channels).find(x => x.id === c.buyer_id); if (b) return b.name; }
  return c.new_business_name || c.buyer_id || "—";
}
function paintAdminClaims() {
  const panel = $("adminClaimsPanel"); if (!panel) return;
  const pending = ((adminCache && adminCache.claims) || []).filter(c => c.status === "pending");
  panel.style.display = pending.length ? "" : "none";
  $("adminClaimsTitle").textContent = T("admin.claimsTitle", { n: pending.length });
  $("adminClaims").innerHTML = pending.map(c => {
    const name = claimBusinessLabel(c);
    const bits = [c.buyer_id ? null : T("admin.claimNotListed"), c.buyer_id ? null : c.new_business_zone,
      c.contact_name, c.contact_email, relDate(new Date(c.created_at).getTime())].filter(Boolean);
    return `<div class="claim-row">
      <div class="claim-main"><b>${esc(name)}</b><small>${esc(bits.join(" · "))}</small></div>
      <div class="claim-actions">
        <button type="button" class="btn btn-primary btn-sm" onclick="decideClaimAdmin('${escAttr(c.id)}', true)" aria-label="${escAttr(T("admin.claimApproveFor", { name }))}">${esc(T("admin.claimApprove"))}</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="decideClaimAdmin('${escAttr(c.id)}', false)" aria-label="${escAttr(T("admin.claimRejectFor", { name }))}">${esc(T("admin.claimReject"))}</button>
      </div>
    </div>`;
  }).join("");
}
let claimDecisionBusy = false;
async function decideClaimAdmin(id, approve) {
  if (claimDecisionBusy || !adminCache) return;
  const c = (adminCache.claims || []).find(x => x.id === id); if (!c) return;
  claimDecisionBusy = true;
  try {
    const patch = { status: approve ? "approved" : "rejected", decided_at: new Date().toISOString() };
    if (approve && !c.buyer_id) {
      const made = await DataStore.createBuyer(newBuyerRowFromClaim(c, makeBuyerId()));
      if (made.error) throw made.error;
      patch.buyer_id = made.data.id;
      DB.buyers.push(made.data);            // so this session's lists know about it too
    }
    const r = await DataStore.decideClaim(id, patch);
    if (r && r.error) throw r.error;
    Object.assign(c, patch);
    paintAdminClaims();
    toast(T(approve ? "admin.claimApproved" : "admin.claimRejected"));
  } catch (e) {
    console.error("claim decision failed", e);
    // 23505 is the unique index that allows ONE approved owner per business.
    toast(T(e && e.code === "23505" ? "admin.claimConflict" : "admin.claimFailed"));
  }
  claimDecisionBusy = false;
}

function paintAdmin() {
  if (!adminCache || !$("adminFunnel")) return;
  paintAdminClaims();
  const { farmers, chats, outreach } = adminCache;
  const f = adminFunnel(chats, outreach);
  const active = ADMIN_STAGE_KEYS.indexOf(state.adminStage) !== -1 ? state.adminStage : "started";

  $("adminFunnel").innerHTML = f.stages.map((s, i) => {
    const gap = i === 0 ? "" : `<div class="fn-gap">${
      !s.prev ? "—"
        : s.dropped > 0 ? T("admin.dropped", { n: s.dropped, pct: s.fromPrev })
        : T("admin.allCarried", { n: s.prev })
    }</div>`;
    // Never quite 0, so a stage nobody has reached is still a visible,
    // clickable row rather than a label floating over nothing.
    const w = Math.max(s.pctOfStart, 1.5);
    return gap + `<button type="button" class="fn-stage${s.key === active ? " active" : ""}"
      aria-pressed="${s.key === active}" title="${esc(s.hint)}" onclick="setAdminStage('${s.key}')">
      <span class="fn-head">
        <span class="fn-label">${esc(s.label)}</span>
        <span class="fn-count">${s.count}</span>
        <span class="fn-pct">${s.pctOfStart}%</span>
      </span>
      <span class="fn-track"><span class="fn-fill" style="width:${w}%"></span></span>
    </button>`;
  }).join("");

  // Everything here is counted in something other than conversations, which is
  // exactly why it sits outside the funnel rather than as a fifth bar in it.
  $("adminAside").innerHTML = [
    `<span class="pill pill-blue">${esc(T(farmers.length === 1 ? "admin.farmers" : "admin.farmersPl", { n: farmers.length }))}</span>`,
    `<span class="pill pill-muted">${esc(T(f.drafts === 1 ? "admin.drafts" : "admin.draftsPl", { n: f.drafts, sent: f.draftsSent }))}</span>`,
    f.orphanDrafts ? `<span class="pill pill-amber">${esc(T(f.orphanDrafts === 1 ? "admin.orphan" : "admin.orphanPl", { n: f.orphanDrafts }))}</span>` : ""
  ].join("");

  const farmerById = {}; farmers.forEach(x => farmerById[x.id] = x);
  const outreachByChat = {};
  outreach.forEach(o => { if (o.chat_id) (outreachByChat[o.chat_id] = outreachByChat[o.chat_id] || []).push(o); });

  const inStage = f.sets[active];
  const rows = chats.filter(c => inStage.has(c.id));
  const def = adminStages().find(s => s.key === active);
  $("adminTableTitle").textContent = T("admin.titleN", { label: active === "started" ? T("admin.everyConv") : def.label, n: rows.length });
  $("adminClearFilter").style.display = active === "started" ? "none" : "inline-flex";

  $("adminBody").innerHTML = rows.map(c => {
    const farmer = farmerById[c.farmer_id];
    const displayName = (farmer && farmer.farmer_name) || c.farmer_name || T("admin.unnamed");
    const outs = outreachByChat[c.id] || [];
    const outLabel = outs.length ? outs.map(o => o.status).join(", ") : "—";
    // data-label is what the cell calls itself once the table stacks into
    // single-column blocks on a phone and the column headers are hidden —
    // "Terelle" and "draft, sent" mean nothing on their own. Ignored on desktop.
    return `<tr>
      <td data-label="${escAttr(T("admin.colFarmer"))}"><b>${esc(displayName)}</b></td>
      <td class="rp-conv" data-label="${escAttr(T("admin.colConversation"))}"><b>${esc(c.title)}</b><small>${esc(relDate(new Date(c.created_at).getTime()))}</small></td>
      <td data-label="${escAttr(T("admin.colLocation"))}">${esc(c.village || "—")}</td>
      <td class="rp-prog" data-label="${escAttr(T("admin.colProgress"))}">
        <div class="progress-track"><div class="progress-fill ${progClass(c.pct)}" style="width:${c.pct}%"></div></div>
        <div class="prog-label">${esc(phaseLabel(c.phase))} · ${c.pct}%</div>
      </td>
      <td data-label="${escAttr(T("admin.colOutreach"))}">${esc(outLabel)}</td>
    </tr>`;
  }).join("");
  $("adminEmpty").textContent = !chats.length ? T("admin.empty") : T("admin.emptyStage");
  $("adminEmpty").style.display = rows.length ? "none" : "block";
}

/* ================= BACKDROP ROTATION =================
   The farm photo sits on #main, behind all three screens at once, so this
   changes the whole backdrop rather than one screen's. A new one is picked
   each time the farmer *arrives* at the Dashboard from somewhere else —
   re-rendering the Dashboard while already on it doesn't count, or the photo
   would flip on every search keystroke.
   The JPEGs are resized exports of the 3440x1440 PNGs in assets/Backgrounds
   (~250KB each instead of ~6MB); at 35MB the originals would have made this
   unusable on the rural connections this app is aimed at. */
// Written out in full rather than built from a loop so qa_check.js can verify
// all six actually exist on disk — a concatenated path is invisible to it.
const BACKDROPS = [
  "assets/Backgrounds/bg-1.jpg", "assets/Backgrounds/bg-2.jpg", "assets/Backgrounds/bg-3.jpg",
  "assets/Backgrounds/bg-4.jpg", "assets/Backgrounds/bg-5.jpg", "assets/Backgrounds/bg-6.jpg"
];
// Start somewhere random so two demos in a row don't open on the same photo.
let backdropIdx = Math.floor(Math.random() * BACKDROPS.length);
const BACKDROP_FADE_MS = 900; // must match the transition in css/app.css
let backdropFront = null;     // the layer currently on screen
let backdropTimer = null;     // hides the outgoing layer once the fade has finished

/* Ends whatever fade is in flight, immediately and without animating, leaving
   the pair in the only state a swap can start from: exactly one layer visible,
   the other transparent and free to take the next photo.

   Needed because someone can leave the Dashboard and come back inside the
   900ms a fade takes. Without this the next swap would grab a layer that is
   still half-way through its own transition, and the photo would appear at
   whatever opacity it happened to be at — which is how the fade broke the
   first time round. */
function settleBackdrop() {
  clearTimeout(backdropTimer);
  const a = $("backdropA"), b = $("backdropB");
  if (!a || !b || !backdropFront) return;
  const other = backdropFront === a ? b : a;
  backdropFront.classList.add("instant");
  backdropFront.classList.add("on");
  other.classList.remove("on");
  void backdropFront.offsetWidth;       // apply both while the transition is off
  backdropFront.classList.remove("instant");
}

/* Puts BACKDROPS[backdropIdx] on screen, dissolving out of whatever is there.
   The scrim and the fade itself live in css/app.css; this decides which of the
   two layers is next, and when it is safe to show it.

   The order below is the whole thing, and each step is load-bearing:

   1. Settle any fade still running, so exactly one layer is visible.
   2. The incoming layer is the transparent one. Give it the photo WHILE it is
      still transparent — it is invisible, so nothing flashes.
   3. Move it in front (z-index 1, the other drops to 0). Still transparent, so
      the picture on screen does not change yet.
   4. Force the browser to apply all of that at opacity 0, then fade it up. Skip
      this and the browser collapses steps 2-4 into one paint and there is no
      transition to see — a cut, not a fade.
   5. Once it is fully opaque, hide the layer underneath. That is what frees it
      up for next time. Leaving it visible was the bug that made every swap
      after the first one instant.

   The fade also waits for the photo to arrive: fading up an empty layer
   dissolves to nothing and then snaps when the file lands, which is worse than
   the cut this replaced. Normally it is already cached, because the next photo
   is fetched a whole screen-visit early. */
function showBackdrop() {
  const a = $("backdropA"), b = $("backdropB");
  if (!a || !b) return;
  const url = BACKDROPS[backdropIdx];

  let revealed = false;
  const reveal = () => {
    if (revealed) return;               // onload can still fire after the cached path
    revealed = true;

    settleBackdrop();                                     // 1
    const outgoing = backdropFront;
    const incoming = (outgoing === a) ? b : a;

    incoming.style.backgroundImage = "url('" + url + "')"; // 2
    incoming.classList.add("front");                       // 3
    if (outgoing) outgoing.classList.remove("front");
    void incoming.offsetWidth;                             // 4
    incoming.classList.add("on");
    backdropFront = incoming;

    if (outgoing) {                                        // 5
      backdropTimer = setTimeout(() => outgoing.classList.remove("on"), BACKDROP_FADE_MS + 60);
    }

    const nxt = new Image();            // next visit's photo, fetched now
    nxt.src = BACKDROPS[(backdropIdx + 1) % BACKDROPS.length];
  };

  const img = new Image();
  img.onload = reveal;
  img.onerror = reveal;                 // a missing file must not strand the backdrop
  img.src = url;
  if (img.complete) reveal();           // already cached: no event is coming
}
function rotateBackdrop() {
  backdropIdx = (backdropIdx + 1) % BACKDROPS.length;
  showBackdrop();
}

/* ================= BUYER SIDE (ROADMAP items 24-25) =================
   Buyers sign up with the same form as farmers and get the same kind of
   account row, with role = 'buyer'. What they can DO is decided in the
   database, not here: until an admin approves their claim on a business they
   own nothing, and RLS answers every query about it with nothing. These
   screens only draw the state of that claim honestly.

   claimState(): none -> (submit) -> pending -> approved | rejected
   A rejected buyer is sent back to the form rather than left at a dead end.
   An approved claim always wins over any older or newer one. */
function isBuyer() { return state.role === "buyer"; }
const CLAIM_NOT_LISTED = "__new";
const CLAIM_NAME_MIN = 2, CLAIM_NAME_MAX = 120, CLAIM_FIELD_MAX = 120, CLAIM_EMAIL_MAX = 200;

function claimState(claims) {
  const list = claims || [];
  if (list.some(c => c.status === "approved")) return "approved";
  if (list.some(c => c.status === "pending")) return "pending";
  return list.length ? "rejected" : "none";
}
function currentClaim(claims) {
  const list = claims || [];
  return list.find(c => c.status === "approved") || list.find(c => c.status === "pending") || list[0] || null;
}
function myBusiness() {
  const c = (state.claims || []).find(x => x.status === "approved");
  return c && c.buyer_id ? (DB.buyers.concat(DB.channels).find(b => b.id === c.buyer_id) || null) : null;
}

/* The form -> the row that is inserted. Pure, so the rules are testable
   without a page: a listed business has to be one we actually list (channels
   such as the weekly market are not businesses anyone owns), an unlisted one
   needs a name, and everything is trimmed and capped to what the table allows. */
function buildClaimRow(uid, form) {
  const pick = String(form.pick == null ? "" : form.pick);
  const row = { user_id: uid, buyer_id: null, new_business_name: null, new_business_zone: null,
    contact_name: String(form.contactName || "").trim().slice(0, CLAIM_FIELD_MAX) || null,
    contact_email: String(form.contactEmail || "").trim().slice(0, CLAIM_EMAIL_MAX) || null };
  if (!pick) return { ok: false, errKey: "buyer.err.pick" };
  if (pick === CLAIM_NOT_LISTED) {
    const name = String(form.name || "").trim();
    if (name.length < CLAIM_NAME_MIN) return { ok: false, errKey: "buyer.err.name" };
    row.new_business_name = name.slice(0, CLAIM_NAME_MAX);
    row.new_business_zone = String(form.zone || "").trim().slice(0, CLAIM_FIELD_MAX) || null;
  } else {
    if (!DB.buyers.some(b => b.id === pick)) return { ok: false, errKey: "buyer.err.pick" };
    row.buyer_id = pick;
  }
  return { ok: true, row };
}

async function loadAccountRole(uid) {
  const { data, error } = await DataStore.getMyFarmer(uid);
  if (error) throw error;
  state.role = data && data.role === "buyer" ? "buyer" : "farmer";
  state.isAdmin = !!(data && data.is_admin) && state.role !== "buyer";
  state.farmerProfile = data || {};
}
async function loadBuyerData(uid) {
  const { data, error } = await DataStore.listMyClaims(uid);
  if (error) throw error;
  state.claims = data || [];
}

function buyerNoteHTML(kind, titleKey, bodyKey, vars) {
  return `<div class="buyer-note ${kind}" role="status"><b>${esc(T(titleKey))}</b><p>${esc(T(bodyKey, vars))}</p></div>`;
}
function claimFormHTML() {
  const options = DB.buyers.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(b => `<option value="${escAttr(b.id)}">${esc(b.name)}</option>`).join("");
  return `<div class="claim-form">
    <div class="field"><label for="claimPick">${esc(T("buyer.claimPick"))}</label>
      <select id="claimPick"><option value="">${esc(T("buyer.claimChoose"))}</option>${options}<option value="${CLAIM_NOT_LISTED}">${esc(T("buyer.claimNotListed"))}</option></select></div>
    <div id="claimNewBlock" style="display:none">
      <div class="field"><label for="claimName">${esc(T("buyer.claimName"))}</label><input type="text" id="claimName" maxlength="${CLAIM_NAME_MAX}" autocomplete="organization"></div>
      <div class="field"><label for="claimZone">${esc(T("buyer.claimZone"))}</label><input type="text" id="claimZone" maxlength="${CLAIM_FIELD_MAX}"></div>
    </div>
    <div class="field"><label for="claimContact">${esc(T("buyer.claimContact"))}</label><input type="text" id="claimContact" maxlength="${CLAIM_FIELD_MAX}" autocomplete="name"></div>
    <div class="field"><label for="claimEmail">${esc(T("buyer.claimEmail"))}</label><input type="email" id="claimEmail" maxlength="${CLAIM_EMAIL_MAX}" value="${escAttr(state.email)}" autocomplete="email"></div>
    <div class="err-banner" id="claimErr" role="alert"></div>
    <button type="button" class="btn btn-primary" id="claimSubmit" onclick="submitClaim()">${esc(T("buyer.claimSubmit"))}</button>
  </div>`;
}
function bindClaimForm() {
  const pick = $("claimPick"); if (!pick) return;
  pick.onchange = () => { $("claimNewBlock").style.display = pick.value === CLAIM_NOT_LISTED ? "block" : "none"; };
}
// A language switch redraws the form; whatever was typed has to survive it.
function claimFormSnapshot() {
  if (!$("claimPick")) return null;
  const ids = ["claimPick", "claimName", "claimZone", "claimContact", "claimEmail"];
  const snap = {}; ids.forEach(id => { snap[id] = $(id) ? $(id).value : ""; });
  return snap;
}
function claimFormRestore(snap) {
  if (!snap || !$("claimPick")) return;
  Object.keys(snap).forEach(id => { if ($(id)) $(id).value = snap[id]; });
  if ($("claimPick").value !== snap.claimPick) $("claimPick").value = "";   // option vanished
  $("claimNewBlock").style.display = $("claimPick").value === CLAIM_NOT_LISTED ? "block" : "none";
}
function showClaimError(key) { const b = $("claimErr"); if (!b) return; b.textContent = T(key); b.style.display = "block"; }

let claimBusy = false;
async function submitClaim() {
  if (claimBusy || !$("claimPick")) return;
  const built = buildClaimRow(state.farmerId, {
    pick: $("claimPick").value, name: $("claimName").value, zone: $("claimZone").value,
    contactName: $("claimContact").value, contactEmail: $("claimEmail").value
  });
  if (!built.ok) { showClaimError(built.errKey); return; }
  claimBusy = true;
  const btn = $("claimSubmit");
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>' + esc(T("buyer.claimSending")); }
  try {
    const { data, error } = await DataStore.createClaim(built.row);
    if (error) throw error;
    state.claims.unshift(data);
    toast(T("buyer.claimSent"));
    claimBusy = false;
    renderBuyerScreens();
    return;
  } catch (e) {
    console.error("claim failed", e);
    // 23505: one of the unique indexes — this business already has an approved owner.
    showClaimError(e && e.code === "23505" ? "buyer.err.taken" : "buyer.err.generic");
  }
  claimBusy = false;
  if (btn) { btn.disabled = false; btn.textContent = T("buyer.claimSubmit"); }
}

function buyerFactsHTML(biz) {
  const km = Number(biz.distance_km);
  return `<dl class="buyer-facts">
    <dt>${esc(T("buyer.bizType"))}</dt><dd>${esc(String(biz.type || "").replace(/_/g, " "))}</dd>
    <dt>${esc(T("buyer.bizArea"))}</dt><dd>${esc(biz.zone || "—")}</dd>
    <dt>${esc(T("buyer.bizDistance"))}</dt><dd>${isFinite(km) ? esc(T("buyer.km", { n: km })) : "—"}</dd>
    <dt>${esc(T("buyer.bizSource"))}</dt><dd>${esc(biz.source || "—")}</dd>
  </dl>`;
}
function buyerAssumedHTML(biz) {
  const needs = (biz.needs || []).map(catLabel).join(", ");
  const vol = ["low", "medium", "high"].indexOf(biz.volume) !== -1 ? T("band." + biz.volume) : "—";
  return `<div class="buyer-note"><b>${esc(T("buyer.bizAssumedTitle"))}</b><p>${esc(T("buyer.bizAssumedBody"))}</p>
    <dl class="buyer-facts" style="margin-top:10px">
      <dt>${esc(T("buyer.bizBuys"))}</dt><dd>${esc(needs || "—")}</dd>
      <dt>${esc(T("buyer.bizVolume"))}</dt><dd>${esc(vol)}</dd>
    </dl></div>`;
}

// What Inbox / Offers / My business show before the claim is approved.
function buyerGateHTML() {
  const st = claimState(state.claims);
  if (st === "approved") return "";
  return `<div class="empty-state">${esc(T(st === "pending" ? "buyer.gatePending" : "buyer.gateNone"))}</div>`;
}

function renderBuyerHome() {
  const el = $("buyerHomeBody"); if (!el) return;
  const snap = claimFormSnapshot();
  const st = claimState(state.claims), claim = currentClaim(state.claims);
  const name = claimBusinessLabel(claim || {});
  let html = "";
  if (st === "approved") {
    const biz = myBusiness();
    html = buyerNoteHTML("", "buyer.approvedTitle", "buyer.homeReady", { name: biz ? biz.name : name }) + (biz ? buyerFactsHTML(biz) : "");
  } else if (st === "pending") {
    html = buyerNoteHTML("pending", "buyer.pendingTitle", "buyer.pendingBody", { name });
  } else {
    if (st === "rejected") html += buyerNoteHTML("rejected", "buyer.rejectedTitle", "buyer.rejectedBody", { name });
    html += `<p class="buyer-lead"><b>${esc(T("buyer.claimTitle"))}.</b> ${esc(T("buyer.claimIntro"))}</p>` + claimFormHTML();
  }
  el.innerHTML = html;
  bindClaimForm();
  claimFormRestore(snap);
}
/* ---------- Buyer inbox (ROADMAP item 27) ----------
   state.inbox holds one entry per conversation a farmer has started with the
   buyer's business. Everything a buyer types here is a real reply. */
function unreadCount(thread) { return ((thread && thread.messages) || []).filter(m => m.role === "farmer" && !m.readAt).length; }
function inboxUnread(inbox) { return (inbox || []).reduce((n, t) => n + unreadCount(t), 0); }
async function loadBuyerInbox() {
  const biz = myBusiness(); state.inbox = [];
  if (!biz) return;
  const { data, error } = await DataStore.listBuyerOutreach(biz.id);
  if (error) throw error;
  state.inbox = await Promise.all((data || []).map(async o => {
    const t = { id: o.id, ts: new Date(o.created_at).getTime(), summary: o.farmer_summary || null, messages: [] };
    try {
      const res = await DataStore.listOutreachMessages(o.id);
      if (res && !res.error && res.data) t.messages = mapThreadMessages(res.data);
    } catch (e) { console.warn("couldn't load one inbox thread", e); }
    return t;
  }));
  state.inbox.sort((a, b) => lastActivity(b) - lastActivity(a));
}
function lastActivity(t) { const m = t.messages[t.messages.length - 1]; return m ? m.ts : t.ts; }
function inboxTitle(t) {
  return t.summary && t.summary.village ? T("buyer.convoFrom", { village: t.summary.village }) : T("buyer.convoUnknown");
}
function renderBuyerBadge() {
  const b = $("buyerInboxBadge"); if (!b) return;
  const n = inboxUnread(state.inbox);
  b.textContent = n > 99 ? "99+" : String(n);
  b.style.display = n ? "flex" : "none";
  const btn = b.closest ? b.closest("button") : null;
  if (btn) btn.setAttribute("aria-label", n ? T("buyer.inboxAria", { n }) : T("nav.bInbox"));
}
function farmerSummaryHTML(s) {
  if (!s) return `<div class="buyer-note"><p>${esc(T("buyer.sumNone"))}</p></div>`;
  const prods = (s.products || []).map(p => esc(p.name) + (p.kg_per_week ? " (" + esc(T("buyer.sumKg", { kg: Math.round(p.kg_per_week) })) + ")" : "")).join(", ");
  return `<div class="buyer-note"><b>${esc(T("buyer.sumTitle"))}</b><dl class="buyer-facts" style="margin-top:8px">
    <dt>${esc(T("buyer.sumVillage"))}</dt><dd>${esc(s.village || "—")}${s.distance_km != null ? " · " + esc(T("buyer.km", { n: s.distance_km })) : ""}</dd>
    <dt>${esc(T("buyer.sumProducts"))}</dt><dd>${prods || "—"}</dd>
    <dt>${esc(T("buyer.sumMonths"))}</dt><dd>${esc(monthsLabel(s.months) || T("buyer.sumAllYear"))}</dd>
  </dl></div>`;
}
function renderBuyerInbox() {
  const el = $("buyerInboxBody"); if (!el) return;
  renderBuyerBadge();
  const gate = buyerGateHTML();
  if (gate) { el.innerHTML = gate; return; }
  const inbox = state.inbox || [];
  if (!inbox.length) { el.innerHTML = `<div class="empty-state">${esc(T("buyer.inboxEmpty"))}</div>`; return; }
  const open = inbox.find(t => t.id === state.openThreadId) || null;
  const list = inbox.map(t => {
    const last = t.messages[t.messages.length - 1], n = unreadCount(t);
    return `<button type="button" class="inbox-row${open && open.id === t.id ? " active" : ""}" onclick="openInboxThread('${t.id}')">
      <span class="inbox-row-main"><b>${esc(inboxTitle(t))}</b><span>${esc(last ? last.text.slice(0, 70) : "")}</span></span>
      ${n ? `<span class="bell-badge inbox-badge" aria-label="${escAttr(T("buyer.unread", { n }))}" style="display:flex">${n}</span>` : ""}</button>`;
  }).join("");
  let thread = `<div class="empty-state">${esc(T("buyer.noThread"))}</div>`;
  if (open) {
    thread = farmerSummaryHTML(open.summary) + `<div class="inbox-thread">` + open.messages.map(m =>
      `<div class="bubble ${m.role === "buyer" ? "out" : "in"}">${esc(m.text)}</div>`).join("") + `</div>
      <div class="inbox-reply"><input type="text" class="input-glass" id="buyerReplyInput" maxlength="2000" aria-label="${escAttr(T("buyer.replyPlaceholder"))}" placeholder="${escAttr(T("buyer.replyPlaceholder"))}">
      <button type="button" class="btn btn-primary btn-sm" id="buyerReplySend">${esc(T("buyer.replySend"))}</button></div>`;
  }
  el.innerHTML = `<div class="inbox-list">${list}</div><div class="inbox-pane">${thread}</div>`;
  const send = $("buyerReplySend");
  if (send) {
    send.onclick = () => sendBuyerReply(open.id);
    $("buyerReplyInput").addEventListener("keydown", e => { if (e.key === "Enter") sendBuyerReply(open.id); });
  }
}
async function openInboxThread(id) {
  state.openThreadId = id;
  const t = (state.inbox || []).find(x => x.id === id);
  const hadUnread = t && unreadCount(t) > 0;
  renderBuyerInbox();
  if (!hadUnread) return;
  // Opening a thread is what sets "seen". Only after the database agrees do we
  // clear the badge, so the farmer's ticks and our count never disagree.
  const res = await DataStore.markThreadRead(id);
  if (res && res.error) { saveFailed("save.readMark", res.error); return; }
  const now = new Date().toISOString();
  t.messages.forEach(m => { if (m.role === "farmer" && !m.readAt) m.readAt = now; });
  renderBuyerInbox();
}
async function sendBuyerReply(id) {
  const input = $("buyerReplyInput"); if (!input) return;
  const t = (state.inbox || []).find(x => x.id === id); if (!t || t.posting) return;
  const row = buildMessageRow(id, state.farmerId, input.value, "buyer"); if (!row) return;
  t.posting = true;
  try {
    const { data, error } = await DataStore.sendOutreachMessage(row);
    if (error) throw error;
    t.messages.push(mapThreadMessages([data])[0]);
    renderBuyerInbox();
  } catch (e) { saveFailedWithOwnMessage("save.message", e, T("save.messageMsg")); }
  t.posting = false;
}
function renderBuyerOffers() {
  const el = $("buyerOffersBody"); if (!el) return;
  el.innerHTML = buyerGateHTML() || `<div class="empty-state">${esc(T("buyer.offersEmpty"))}</div>`;
}
function renderBuyerBusiness() {
  const el = $("buyerBusinessBody"); if (!el) return;
  const biz = myBusiness();
  el.innerHTML = buyerGateHTML() || (biz ? buyerFactsHTML(biz) + buyerAssumedHTML(biz) : "");
}
function renderBuyerScreens() { renderBuyerHome(); renderBuyerInbox(); renderBuyerOffers(); renderBuyerBusiness(); }

/* Opening a buyer's app. Mirrors the farmer path in boot(): into the shell at
   once, locked while the data loads, lock lifted whatever happens. */
async function enterBuyerApp() {
  $("onboard").style.display = "none";
  const app = $("app");
  app.setAttribute("data-role", "buyer");
  app.classList.add("ready", "booting");
  setBootLock(true);
  showBackdrop();
  try {
    await loadBuyers();
    await loadBuyerData(state.farmerId);
    await loadBuyerInbox();
  } catch (e) {
    console.error("Failed to load the buyer account", e);
    toast(T("boot.loadFailed"));
  } finally {
    app.classList.remove("booting");
    setBootLock(false);
  }
  updateHeaderIdentity();
  switchScreen("buyerHome");
}

/* ================= NAVIGATION ================= */
function switchScreen(name) {
  const prev = state.screen;
  state.screen = name;
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === name + "Screen"));
  document.querySelectorAll(".nav-item").forEach(s => {
    const on = s.dataset.screen === name;
    s.classList.toggle("active", on);
    // Which screen you are on is otherwise carried by opacity and a tint, and
    // neither reaches a screen reader. aria-current is removed rather than set
    // to "false" — the attribute's presence is the signal.
    if (on) s.setAttribute("aria-current", "page"); else s.removeAttribute("aria-current");
  });
  if (name === "dashboard") { if (prev !== "dashboard") rotateBackdrop(); renderDashboard(); }
  if (name === "clients") renderChats();
  if (name === "assistant") { renderChatRail(); renderTranscript(); }
  if (name === "admin") renderAdmin();
  if (name.indexOf("buyer") === 0) renderBuyerScreens();
}

/* ================= Offline scripted demo ================= */
/* A function, not an array of English sentences: this is the app standing in
   for Brain 1, and Brain 1 is supposed to answer in the farmer's language.
   Its LENGTH is load-bearing — offlineStep and offlineReady are compared
   against it and offlineStep is persisted as the message count — so both
   translations must have the same number of lines, which qa_check.js checks. */
const OFFLINE_SCRIPT_KEYS = ["offline.q1", "offline.q2", "offline.q3", "offline.q4", "offline.q5", "offline.q6"];
function offlineScript() { return OFFLINE_SCRIPT_KEYS.map(k => T(k)); }
const OFFLINE_PROFILE = { farmer_name: "Marco", village: "Sant'Elia Fiumerapido", distance_km_from_cassino: 6, organic: "no", available_months: [6,7,8,9,10],
  products: [{ name: "pomodori", category: "pomodori", kg_per_week: 80 }, { name: "zucchine", category: "verdure", kg_per_week: 40 }] };

function offlineTurn(chat) {
  const script = offlineScript();
  const step = chat.offlineStep++;
  if (step < script.length) {
    setTimeout(() => { addMsg(chat, "ai", script[step]); addLog("info", "Brain 1 · scripted reply (offline mode)"); }, 450);
    if (step === script.length - 1) chat.offlineReady = true;
  }
  if (chat.offlineReady && step === script.length) {
    setTimeout(() => onProfileCaptured(OFFLINE_PROFILE, chat), 550);
  }
}
/* Deliberately NOT translated, and the reason is the same rule that made the
   script above translated: the offline stand-in does whatever the real Brain
   would have done. Brain 1's own instructions say "mirror the user's
   language", so its script follows the UI. Brain 2 has no such promise — its
   pitch lines are built from the buyer database's `notes` field, which is
   data, and its outreach is deliberately an Italian message plus an English
   translation, whoever is reading. Translating the offline copy of that would
   make the demo say something the live app never says. */
function offlineRecs(chat) {
  const top = chat.candidates.slice(0, 5);
  return {
    ranked: top.map(c => ({ buyer_id: c.id, pitch_reason: (c.is_channel ? "Direct sales channel: " : "") + c.notes })),
    creative_suggestions: [
      "Surplus tomatoes in late September? Offer them to Di Vetta dal 1934 as artisan passata (conserve).",
      "The Saturday market at Piazza Nicholas Green lets you sell retail at retail prices — good margin on 20-30 kg.",
      "Joining Rete Campagna Amica gives km-0 visibility that hotels like Edra Palace value."
    ],
    outreach: { buyer_id: top[0].id,
      message_it: "Buongiorno, sono Marco, un piccolo produttore di Sant'Elia Fiumerapido. Ogni settimana ho circa 80 kg di pomodori freschi e 40 kg di zucchine, disponibili da giugno a ottobre. Mi piacerebbe proporvi una fornitura diretta: prodotto raccolto in giornata, consegna gestita dal partner logistico di Fasto Innova. Possiamo fissare una breve chiacchierata o portarvi un campione? Grazie!",
      message_en: "Good morning, I'm Marco, a small producer from Sant'Elia Fiumerapido. Every week I have about 80 kg of fresh tomatoes and 40 kg of zucchine, available June to October. I would love to propose a direct supply: picked the same day, delivery handled by Fasto Innova's logistics partner. Could we arrange a short chat, or may I bring you a sample? Thank you!" }
  };
}

/* ================= BOOT ================= */
function boot() {
  /* Language first, before anything is measured or drawn: applyI18n() fills in
     every data-i18n attribute in index.html and sets <html lang>. */
  applyI18n(document);
  paintLangToggles();
  // One delegated handler covers all three toggles (both onboarding cards and
  // the topbar), so adding a fourth needs no wiring.
  document.addEventListener("click", e => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-set-lang]") : null;
    if (btn) setLang(btn.getAttribute("data-set-lang"));
  });

  const saved = localStorage.getItem("fasto_key");
  if (saved) $("apikey").value = saved;

  /* ---- account: sign in / sign up ---- */
  let authMode = "in";
  function setAuthMode(next) {
    authMode = next;
    $("authTabIn").classList.toggle("active", next === "in");
    $("authTabUp").classList.toggle("active", next === "up");
    // Which of the two is chosen is otherwise only a red background.
    $("authTabIn").setAttribute("aria-pressed", next === "in" ? "true" : "false");
    $("authTabUp").setAttribute("aria-pressed", next === "up" ? "true" : "false");
    // don't overwrite a spinner that's mid-request — setAuthBusy(false) relabels
    if (!$("authSubmitBtn").disabled) $("authSubmitBtn").textContent = authLabel();
    // data-i18n is updated too, or a later language switch would put the wrong
     // one back: applyI18n() reads the attribute, not what is on screen.
    $("authHint").setAttribute("data-i18n", next === "up" ? "auth.hintUp" : "auth.hintIn");
    $("authHint").textContent = T(next === "up" ? "auth.hintUp" : "auth.hintIn");
    // Phone password managers key off this: left on "current-password" while
    // signing UP, iOS and Android offer to fill an old password instead of
    // suggesting a new one, and never offer to save the new account.
    $("authPassword").setAttribute("autocomplete", next === "up" ? "new-password" : "current-password");
    $("authRoleBlock").style.display = next === "up" ? "" : "none";
    // Switching tabs drops the message AND what it was, or a later language
    // switch would repaint an error the farmer has already dismissed.
    clearAuthError();
  }
  $("authTabIn").onclick = () => setAuthMode("in");
  $("authTabUp").onclick = () => setAuthMode("up");

  /* Which app a NEW account opens. Only offered on the Sign up tab; the
     database keeps it from then on and nothing here can change it later. */
  let signupRole = "farmer";
  function setSignupRole(next) {
    signupRole = next;
    $("authRoleFarmer").classList.toggle("active", next === "farmer");
    $("authRoleBuyer").classList.toggle("active", next === "buyer");
    $("authRoleFarmer").setAttribute("aria-pressed", next === "farmer" ? "true" : "false");
    $("authRoleBuyer").setAttribute("aria-pressed", next === "buyer" ? "true" : "false");
  }
  $("authRoleFarmer").onclick = () => setSignupRole("farmer");
  $("authRoleBuyer").onclick = () => setSignupRole("buyer");
  // The submit button's label depends on which tab is selected, so it can't be
  // a plain data-i18n attribute. Don't touch it mid-request: setAuthBusy(false)
  // relabels it when the request finishes.
  $("authSubmitBtn").textContent = authLabel();
  onLangChange(() => { if (!$("authSubmitBtn").disabled) $("authSubmitBtn").textContent = authLabel(); });

  function authLabel() { return T(authMode === "up" ? "auth.submitUp" : "auth.submitIn"); }
  // A disabled button with its normal label just looks broken; say what it's waiting on.
  function setAuthBusy(on, busyText) {
    const b = $("authSubmitBtn");
    b.disabled = on;
    if (on) b.innerHTML = '<span class="spinner"></span>' + busyText;
    else b.textContent = authLabel();
  }

  function goToModeCard() { $("authCard").style.display = "none"; $("modeCard").style.display = "block"; }

  /* After any successful sign-in: read the account's role from the database
     (never from what the browser claims) and open the right app. If the read
     fails the person is treated as a farmer, which is the original behaviour
     and opens nothing that belongs to a buyer. */
  async function afterAuth() {
    try { await loadAccountRole(state.farmerId); }
    catch (e) { console.error("couldn't read the account role - treating it as a farmer", e); state.role = "farmer"; }
    if (state.role === "buyer") enterBuyerApp(); else goToModeCard();
  }

  /* The error box is written to as a KEY, never as a finished sentence, so that
     a farmer who presses IT while the message is on screen gets the message
     translated too — rather than the rest of the card changing language around
     a line that doesn't. Everything the box can say goes through here. */
  let authErrShown = null;
  function showAuthError(key, vars) {
    authErrShown = { key: key, vars: vars || null };
    const b = $("authErr");
    b.textContent = T(key, vars);
    b.style.display = "block";
  }
  function clearAuthError() { authErrShown = null; $("authErr").style.display = "none"; }
  onLangChange(() => { if (authErrShown) $("authErr").textContent = T(authErrShown.key, authErrShown.vars); });

  $("authSubmitBtn").onclick = async () => {
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    clearAuthError();
    if (!email || !password) { showAuthError("auth.needBoth"); return; }
    if (password.length < 6) { showAuthError("auth.tooShort"); return; }
    setAuthBusy(true, T(authMode === "up" ? "auth.creating" : "auth.signingIn"));
    try {
      const { data, error } = authMode === "up" ? await DataStore.signUp(email, password, signupRole) : await DataStore.signIn(email, password);
      if (error) throw error;
      if (!data.session) {
        showAuthError("auth.confirmEmail");
      } else {
        state.farmerId = data.user.id;
        state.email = data.user.email || email;
        await afterAuth();
      }
    } catch (e) {
      // Was `e.message` — Supabase's own English, printed at a farmer who may
      // not read it, on the one screen the language toggle couldn't reach.
      const info = authErrorInfo(e);
      logAuthError(e, info);
      showAuthError(info.key, info.vars);
    }
    setAuthBusy(false);
  };

  // Returning visitor with a live browser session skips straight past sign-in.
  // Until that check answers we don't know whether this person needs to type
  // anything at all, so the button says it's checking instead of sitting there
  // dead. The failsafe matters more than it looks: if the check never settles,
  // the form still has to unlock, or a network blip locks people out entirely.
  let authUnlocked = false;
  function unlockAuth() { if (!authUnlocked) { authUnlocked = true; setAuthBusy(false); } }
  setAuthBusy(true, T("auth.checking"));
  const authFailsafe = setTimeout(unlockAuth, 4000);
  DataStore.getSession().then(session => {
    if (session && session.user) { state.farmerId = session.user.id; state.email = session.user.email || ""; return afterAuth(); }
  }).catch(e => console.error("session check failed — falling through to the sign-in card, which is the right outcome, so nothing is shown", e))
    .finally(() => { clearTimeout(authFailsafe); unlockAuth(); });

  /* ---- demo mode: offline vs live AI (unchanged) ---- */
  let mode = "offline";
  function setDemoMode(next) {
    mode = next;
    const off = next === "offline";
    $("modeOffline").classList.toggle("active", off);
    $("modeLive").classList.toggle("active", !off);
    $("modeOffline").setAttribute("aria-pressed", off ? "true" : "false");
    $("modeLive").setAttribute("aria-pressed", off ? "false" : "true");
    // aria-expanded on the button that reveals the key block, so the extra
    // fields appearing below isn't a purely visual event.
    $("modeLive").setAttribute("aria-expanded", off ? "false" : "true");
    $("liveKeyBlock").style.display = off ? "none" : "block";
  }
  $("modeOffline").onclick = () => setDemoMode("offline");
  $("modeLive").onclick = () => setDemoMode("live");
  setDemoMode("offline");

  let entering = false;
  $("startBtn").onclick = async () => {
    state.offline = (mode === "offline");
    state.apiKey = $("apikey").value.trim();
    state.model = $("model").value;
    if (!state.offline && !state.apiKey.startsWith("sk-ant")) { alert(T("mode.badKey")); return; }
    if (!state.offline && $("remember").checked) localStorage.setItem("fasto_key", state.apiKey);

    if (entering) return;
    entering = true;

    // Go into the shell straight away and put the skeleton THERE, instead of
    // holding the onboarding card still while Supabase answers. Between one
    // and a dozen round trips happen below (buyers, then the farmer's chats
    // and every chat's messages and products), which on a slow connection was
    // several seconds of a screen that looked frozen.
    // Nothing in the shell is clickable until `booting` comes off — see
    // css/app.css. That isn't only cosmetic: starting a chat mid-load would be
    // wiped the moment loadFarmerData() replaced state.chats underneath it.
    $("onboard").style.display = "none";
    $("app").classList.add("ready", "booting");
    setBootLock(true);
    showBackdrop();                                   // first photo of the session; rotates on each return to Dashboard
    paintModePill();
    switchScreen("dashboard");
    showResearchSkeleton(3);

    // The outer finally is the point: whatever goes wrong in here, the skeleton
    // has to come off. A shell frozen in placeholders is worse than a shell
    // with missing data, because nothing in it can be clicked.
    try {
      try {
        bootStatus(T("boot.buyers"));
        await loadBuyers();
        bootStatus(T("boot.chats"));
        await loadFarmerData(state.farmerId);
      } catch (e) {
        console.error("Failed to load account data", e);
        toast(T("boot.loadFailed"));
      }

      addLog("ok", "Guardian armed. Database loaded: " + DB.buyers.length + " buyers + " + DB.channels.length + " channels (Cassino).");
      addLog("info", "Guardian watching all traffic Brain 1 ⇄ Brain 2.");
      $("adminNavItem").style.display = state.isAdmin ? "flex" : "none";

      if (state.chats.length) { state.activeChatId = state.chats[0].id; updateHeaderIdentity(); renderChatRail(); renderTranscript(); }
      else { bootStatus(T("boot.firstChat")); await startNewChat(); }
    } catch (e) {
      console.error("Failed to finish opening the app", e);
      toast(T("boot.openFailed"));
    } finally {
      $("app").classList.remove("booting");
      setBootLock(false);
      entering = false;
    }

    switchScreen("dashboard");
    renderChats();
  };

  // Nav
  document.querySelectorAll(".nav-item[data-screen]").forEach(el => el.onclick = () => switchScreen(el.dataset.screen));
  $("newChatBtn").onclick = () => startNewChat();

  // Chat
  $("sendBtn").onclick = () => { const v = $("userInput").value.trim(); if (v) { $("userInput").value = ""; sendUserMessage(v); } };
  $("userInput").addEventListener("keydown", e => { if (e.key === "Enter") $("sendBtn").onclick(); });
  document.querySelectorAll(".sugg-chip").forEach(ch => ch.onclick = () => { $("userInput").value = ch.dataset.fill; $("userInput").focus(); });

  /* Search. The box only ever writes the query into state — the renderers do
     the filtering (see the SEARCH section), which is what lets a filtered list
     survive being redrawn. */
  $("topSearch").addEventListener("input", e => setSearch(e.target.value));
  $("topSearch").addEventListener("keydown", e => {
    /* Escape clears the query rather than reaching the document handler, which
       would look for a sheet to close. The box is unreachable while a sheet is
       open (they are fixed;inset:0 above the top bar), so nothing is stolen. */
    if (e.key === "Escape" && state.search) { e.stopPropagation(); e.preventDefault(); e.target.value = ""; setSearch(""); }
  });

  // Notification bell -> jump to clients
  /* The bell used to say the same thing however many times it was pressed,
     including "0 draft(s) ready to send" — a notification that is never news,
     and the one thing a notification must never be. The count lives on the
     button now (renderBell), so it is readable without pressing anything, and
     the press only speaks when there is something to say. The jump to Clients
     is unconditional either way: that is where drafts are, and a bell that
     sometimes does nothing at all is a worse bell than a quiet one. */
  $("bellBtn").onclick = () => { const n = draftCount(state.clients); switchScreen("clients"); if (n) toast(T("top.draftsReady", { n })); };

  // Avatar -> sign out (data stays in the account; this just clears the local view)
  $("profileBtn").onclick = async () => {
    if (!confirm(T("top.signOutConfirm"))) return;
    let signedOut = true;
    try { const r = await DataStore.signOut(); if (r && r.error) throw r.error; }
    catch (e) { console.error("sign out failed", e); signedOut = false; }
    localStorage.removeItem("fasto_key");
    if (signedOut) { location.reload(); return; }
    // The browser session survived, so reloading now walks straight back in.
    // Say so rather than pretending it worked, and leave the words on screen.
    toast(T("top.signOutFailed"));
    setTimeout(() => location.reload(), 2600);
  };

  $("researchSeeAll").onclick = () => { state.showAllResearch = !state.showAllResearch; renderDashboard(); };

  // The three sheets: close on the X, on a backdrop click, or on Escape.
  // Backdrop only — never a stray click inside a panel, which would throw away
  // a half-typed logistics request or a half-corrected profile.
  $("matchCloseBtn").onclick = () => closeMatchView();
  $("matchSheet").addEventListener("click", e => { if (e.target === $("matchSheet")) closeMatchView(); });
  $("logisticsCloseBtn").onclick = () => closeLogistics();
  $("logisticsSubmit").onclick = () => submitLogistics();
  $("logisticsSheet").addEventListener("click", e => { if (e.target === $("logisticsSheet")) closeLogistics(); });
  $("profileCloseBtn").onclick = () => closeProfileEdit();
  $("profileSaveBtn").onclick = () => saveProfileEdit();
  $("profileSheet").addEventListener("click", e => { if (e.target === $("profileSheet")) closeProfileEdit(); });

  /* ONE keyboard handler for all three, not one each. Three separate Escape
     listeners each closed their own sheet, so a single press while correcting a
     profile also closed the match sheet waiting behind it. Tab is held inside
     whichever sheet is on top — see trapSheetTab(). */
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeTopSheet(); return; }
    if (e.key === "Tab") trapSheetTab(e);
  });

  renderDashboard();
}
document.addEventListener("DOMContentLoaded", boot);
