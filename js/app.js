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
const CAT_LABEL = { verdure:"vegetables", pomodori:"tomatoes", frutta:"fruit", legumi:"legumes", olio:"oil", vino:"wine", uova:"eggs", formaggi:"cheese", carne:"meat", erbe:"herbs", castagne:"chestnuts", miele:"honey", conserve:"preserves" };

let state = {
  apiKey: "", model: "claude-haiku-4-5-20251001", offline: true,
  farmerId: null, isAdmin: false,
  farmerProfile: {},    // the farmer's own `farmers` row — name + the business details the logistics form needs
  chats: [],           // {id,title,phase,pct,messages:[{role,text}],apiMessages,profile,candidates,recs,offlineStep,offlineReady,ts}
  activeChatId: null,
  clients: [],          // matched-buyer threads (Clients screen) — backed by the outreach table
  glog: [],
  screen: "dashboard",
  activeClientId: null,
  showAllResearch: false
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
  const what = items.length === 1 ? items[0]
    : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
  toast("Couldn't save " + what + " to your account — fine for now, but it may not be here next time.");
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
  toast(saveState.failures === 1
    ? "1 change couldn't be saved to your account. It's still here for this session, but it may not be next time."
    : saveState.failures + " changes couldn't be saved to your account. They're still here for this session, but may not be next time.");
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
      offlineStep: (msgs || []).length, offlineReady: (msgs || []).length >= OFFLINE_SCRIPT.length,
      ts: new Date(row.created_at).getTime()
    });
  }
  state.activeChatId = state.chats.length ? state.chats[0].id : null;

  const byId = {}; DB.buyers.concat(DB.channels).forEach(b => byId[b.id] = b);
  state.clients = (outreachRows || []).map(o => {
    const b = byId[o.buyer_id] || {};
    return { id: o.id, buyerId: o.buyer_id, chatId: o.chat_id, name: b.name || o.buyer_id, type: b.type || "", zone: b.zone || "",
      message_it: o.message_it, message_en: o.message_en, flagged: o.flagged, status: o.status,
      ts: new Date(o.created_at).getTime(), extra: [] };
  });
  state.activeClientId = state.clients.length ? state.clients[0].id : null;
}

/* ================= MULTI-CHAT (Fasto-AI screen) ================= */
async function newChatObj() {
  try {
    const { data, error } = await DataStore.createChat(state.farmerId);
    if (error) throw error;
    return { id: data.id, title: data.title, phase: data.phase, pct: data.pct, ts: new Date(data.created_at).getTime(),
      messages: [], apiMessages: [], profile: null, candidates: [], recs: null, offlineStep: 0, offlineReady: false };
  } catch (e) {
    saveFailedWithOwnMessage("this new chat", e, "Couldn't save this chat to your account — it will only last this session.");
    return { id: "local" + Date.now() + Math.random().toString(36).slice(2, 6), title: "New chat", phase: "interview", pct: 0, ts: Date.now(),
      messages: [], apiMessages: [], profile: null, candidates: [], recs: null, offlineStep: 0, offlineReady: false };
  }
}
function activeChat() { return state.chats.find(c => c.id === state.activeChatId) || null; }
function chatTitle(chat) {
  if (chat.profile && chat.profile.farmer_name) return chat.profile.farmer_name;
  if (chat.profile) { const top = topProductCategory(chat.profile); if (top) return "Chat · " + (CAT_LABEL[top] || top); }
  return "New chat";
}

function greetingText() {
  return state.offline
    ? "Buongiorno! (Offline demo) I'm the Fasto Innova assistant. Press a sample chip or say hello to begin."
    : "Buongiorno! I'm the Fasto Innova assistant. I help small farmers around Cassino find the right local buyers — no forms, just a chat. What's your name, and what do you grow?";
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
    toast(wasOpen ? "This chat is still empty — just type below to begin."
                  : "Opened your empty chat instead of starting another one.");
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

function renderChatRail() {
  const el = $("chatRailList"); if (!el) return;
  el.innerHTML = state.chats.map(c => `
    <div class="chat-rail-item ${c.id === state.activeChatId ? "active" : ""}" data-chat-id="${esc(c.id)}" onclick="selectChat('${c.id}')">
      <img class="ic-svg sm" src="assets/icon-chat-item.svg" alt="">${esc(c.title)}
    </div>`).join("");
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
  if (!isLocalId(chat.id)) bgSave(DataStore.addMessage(chat.id, role, text), "this message");
}
function renderTranscript() {
  const chat = activeChat();
  const el = $("assistTranscript"); if (!el) return;
  if (!chat) { el.innerHTML = ""; return; }
  const bubbles = chat.messages.map(m => {
    if (m.role === "sys") return `<div class="bubble meta">${esc(m.text)}</div>`;
    return `<div class="bubble ${m.role === "user" ? "out" : "in"}">${esc(m.text)}</div>`;
  }).join("");
  // once matching is finished the transcript ends with a way into the match view
  const cta = (chat.phase === "done" || (chat.profile && chat.candidates && chat.candidates.length))
    ? `<div class="match-cta"><button class="btn btn-ghost btn-sm" onclick="openMatchView('${chat.id}')">Why these buyers?</button></div>`
    : "";
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
    addMsg(chat, "sys", "Message blocked by the Guardian for safety. Please rephrase.");
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
    addMsg(chat, "sys", "The Guardian rejected the profile: " + v.errors.join("; "));
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
    }), "your farm profile");
    bgSave(DataStore.saveProducts(chat.id, v.profile.products), "your product list");
    if (v.profile.farmer_name) bgSave(DataStore.updateFarmerName(state.farmerId, v.profile.farmer_name), "your name");
  }

  const month = new Date().getMonth() + 1;
  const ranked = rankMatches(v.profile, DB, month);
  chat.candidates = ranked.slice(0, 8);
  addLog("info", "Brain 2 · scored " + ranked.length + " database entries, top score " + ranked[0].score + "/100");

  if (state.offline) { await finishWithRecs(offlineRecs(chat), chat); return; }

  addMsg(chat, "sys", "Brain 2 is analysing " + ranked.length + " verified Cassino buyers…");
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
    addMsg(chat, "ai", "Done! I found the best matches for you — check Clients for the outreach draft.");
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
    bgSave(DataStore.updateChat(chat.id, { phase: "done", pct: 100 }), "this chat's progress");
    if (recs.ranked && recs.ranked.length) bgSave(DataStore.saveMatches(chat.id, recs.ranked), "your buyer matches");
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
  const fromRecs = (chat.recs && chat.recs.ranked) || [];
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
    ? chat.title + " · top " + rows.length + " of " + poolSize + " verified Cassino entries"
    : chat.title;

  const profileBits = !p ? "" : `<div class="match-profile">
      ${p.village ? `<span class="pill pill-muted">${esc(p.village)}</span>` : ""}
      ${isFinite(Number(p.distance_km_from_cassino)) ? `<span class="pill pill-muted">${Math.round(Number(p.distance_km_from_cassino))} km from Cassino</span>` : ""}
      <span class="pill pill-muted">${Math.round(totalKg(p))} kg/week</span>
      <span class="pill ${p.organic === "yes" ? "pill-accent" : "pill-muted"}">${p.organic === "yes" ? "Organic" : p.organic === "partial" ? "Partly organic" : "Not certified organic"}</span>
      ${(p.products || []).map(pr => `<span class="pill pill-blue">${esc(pr.name)} · ${Math.round(Number(pr.kg_per_week))} kg</span>`).join("")}
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
        ${c.is_channel ? `<span class="pill pill-blue">Channel</span>` : ""}
        <span class="pill ${scorePillClass(c.score)}">${c.score}/100</span>
      </div>
      ${r.pitch ? `<div class="mc-pitch">${esc(r.pitch)}</div>` : ""}
      <div class="mc-reasons">${(c.reasons || []).map(x => `<span class="reason-chip">${esc(x)}</span>`).join("")}</div>
    </div>`;
  }).join("");

  const suggs = (chat.recs && chat.recs.creative_suggestions) || [];
  let tail = "";
  if (suggs.length) {
    tail = `<div class="eyebrow" style="margin-top:6px">Ideas worth trying</div>` +
      suggs.map((s, i) => `<div class="sugg-card"><span class="sugg-num">${i + 1}</span><span>${esc(s)}</span></div>`).join("");
  } else if (!chat.recs) {
    tail = `<div class="foot" style="margin-top:6px">Brain 2's written notes and ideas belong to the conversation that produced them and aren't saved yet, so an older chat shows the scoring reasons only.</div>`;
  }

  $("matchBody").innerHTML = rows.length
    ? profileBits + `<div class="eyebrow">Best matches</div>` + cards + tail
    : `<div class="empty-state">This conversation hasn't produced any matches yet.</div>`;

  sheet.classList.add("open");
}

function closeMatchView() { const s = $("matchSheet"); if (s) s.classList.remove("open"); }

/* ---------- Clients ("chats with clients") ---------- */
async function addClientFromRecs(recs, chat) {
  if (!recs.outreach) return;
  const c = chat.candidates.find(x => x.id === recs.outreach.buyer_id); if (!c) return;
  const existing = state.clients.find(x => x.buyerId === c.id && x.status === "draft");
  if (existing) {
    existing.message_it = recs.outreach.message_it; existing.message_en = recs.outreach.message_en; existing.flagged = !!recs.outreach.flagged_claim;
    if (!isLocalId(existing.id)) {
      bgSave(DataStore.updateOutreach(existing.id, { message_it: existing.message_it, message_en: existing.message_en, flagged: existing.flagged }), "the updated outreach draft");
    }
    return;
  }
  let outreachId = "local" + Date.now();
  if (!isLocalId(chat.id)) {
    try {
      const { data, error } = await DataStore.createOutreach(state.farmerId, chat.id, c.id, recs.outreach.message_it, recs.outreach.message_en, !!recs.outreach.flagged_claim);
      if (error) throw error;
      outreachId = data.id;
    } catch (e) { saveFailedWithOwnMessage("the outreach draft", e, "Couldn't save the outreach draft to your account — it will only last this session."); }
  }
  state.clients.unshift({
    id: outreachId, buyerId: c.id, chatId: chat.id, name: c.name, type: c.type, zone: c.zone,
    message_it: recs.outreach.message_it, message_en: recs.outreach.message_en,
    flagged: !!recs.outreach.flagged_claim, status: "draft", ts: Date.now(), extra: []
  });
  if (!state.activeClientId) state.activeClientId = state.clients[0].id;
}
function markSent(id) {
  const c = state.clients.find(x => x.id === id); if (!c) return;
  c.status = "sent"; c.sentTs = Date.now();
  toast("Marked as sent to " + c.name);
  renderChats(); renderDashboard();
  if (!isLocalId(id)) bgSave(DataStore.updateOutreach(id, { status: "sent", sent_at: new Date().toISOString() }), "the \"sent\" mark on this draft");
}

/* ---------- Header identity ---------- */
function updateHeaderIdentity() {
  const chat = activeChat();
  const name = (chat && chat.profile && chat.profile.farmer_name) || "Guest Farmer";
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

/* ================= RENDERERS ================= */
function phaseLabel(p) { return { interview: "Interviewing", matching: "Matching", done: "Outreach ready" }[p] || p; }
function progClass(pct) { return pct >= 70 ? "" : pct >= 30 ? "warn" : "danger"; }
function relDate(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function adjustPrice(cat) {
  if (!cat) return;
  const cur = PRICE_ASSUMPTIONS[cat] || 3;
  const v = window.prompt("Assumed price for " + (CAT_LABEL[cat] || cat) + " (EUR/kg):", cur.toFixed(2));
  if (v === null) return;
  const n = parseFloat(v.replace(",", "."));
  if (isFinite(n) && n > 0) { PRICE_ASSUMPTIONS[cat] = n; renderDashboard(); }
}

function renderDashboard() {
  if (!$("dashboardScreen")) return;
  const rows = state.chats.filter(c => c.profile).sort((a, b) => b.ts - a.ts);
  const shown = state.showAllResearch ? rows : rows.slice(0, 3);

  $("researchBody").innerHTML = shown.map(c => {
    const top = topProductCategory(c.profile);
    const prod = c.profile.products.find(p => p.category === top) || c.profile.products[0];
    const price = PRICE_ASSUMPTIONS[top] || 3;
    const done = c.phase === "done";
    return `<tr>
      <td class="rp-conv ${done ? "rp-clickable" : ""}" ${done ? `onclick="openMatchView('${c.id}')" title="See why these buyers were chosen"` : ""}><b>${esc(c.title)}</b><small>${esc(relDate(c.ts))}</small></td>
      <td>${esc(CAT_LABEL[top] || top || "—")}</td>
      <td>${prod ? Math.round(prod.kg_per_week) + " kg/wk" : "—"}</td>
      <td class="rp-price" onclick="adjustPrice('${top}')">€${price.toFixed(2)}/kg</td>
      <td class="rp-prog">
        <div class="progress-track"><div class="progress-fill ${progClass(c.pct)}" style="width:${c.pct}%"></div></div>
        <div class="prog-label">${esc(phaseLabel(c.phase))} · ${c.pct}%</div>
      </td>
    </tr>`;
  }).join("");
  $("researchEmpty").style.display = shown.length ? "none" : "block";
  const seeAll = $("researchSeeAll");
  seeAll.style.display = rows.length > 3 ? "inline-flex" : "none";
  seeAll.textContent = state.showAllResearch ? "Show latest 3" : "See all (" + rows.length + ")";
}

function avatarHTML(name, idx) {
  return `<div class="avatar av-${idx % 5}">${esc((name || "?").slice(0, 2).toUpperCase())}</div>`;
}

function renderChats() {
  if (!$("clientsScreen")) return;
  const list = $("clientList");
  if (!state.clients.length) {
    list.innerHTML = `<div class="empty-state">No matched buyers yet.<br>Talk to Fasto-AI to get your first match.</div>`;
    $("threadPane").innerHTML = `<div class="empty-state" style="margin:auto">Select a conversation</div>`;
    return;
  }
  list.innerHTML = state.clients.map((c, i) => `
    <div class="client-item ${c.id === state.activeClientId ? "active" : ""}" onclick="selectClient('${c.id}')">
      ${avatarHTML(c.name, i)}
      <div style="min-width:0;flex:1">
        <div class="ci-top"><span class="ci-name">${esc(c.name)}</span>${c.status === "sent" ? '<span class="pill pill-accent" style="margin-left:auto">Sent</span>' : '<span class="pill pill-amber" style="margin-left:auto">Draft</span>'}</div>
        <div class="ci-prev">${esc(c.message_it.slice(0, 46))}…</div>
      </div>
    </div>`).join("");
  if (!state.activeClientId) state.activeClientId = state.clients[0].id;
  renderThread();
}
function selectClient(id) { state.activeClientId = id; renderChats(); }

function renderThread() {
  const c = state.clients.find(x => x.id === state.activeClientId);
  const pane = $("threadPane");
  if (!c) { pane.innerHTML = `<div class="empty-state" style="margin:auto">Select a conversation</div>`; return; }
  const idx = state.clients.indexOf(c);
  pane.innerHTML = `
    <div class="thread-head">
      ${avatarHTML(c.name, idx)}
      <div style="min-width:0;flex:1">
        <div class="title-sm">${esc(c.name)}</div>
        <div class="foot">${esc(c.zone)} · ${esc((c.type || "").replace(/_/g, " "))}</div>
      </div>
      ${c.status === "sent" ? '<span class="pill pill-accent">Sent</span>' : '<span class="pill pill-amber">Draft</span>'}
    </div>
    <div class="thread-body" id="threadBody">
      <div class="day-divider">Today</div>
      <div class="bubble meta">Drafted by Brain 2 · real message, not simulated</div>
      ${c.flagged ? '<div class="bubble meta" style="color:var(--warn)">⚠ Guardian adjusted a claim in this draft</div>' : ""}
      <div class="bubble out">${esc(c.message_it)}</div>
      <div class="bubble-actions">
        ${c.status === "sent" ? "" : `<button class="btn btn-ghost btn-sm" onclick="markSent('${c.id}')">Mark as sent</button>`}
        <button class="btn btn-ghost btn-sm" onclick="copyClientMsg('${c.id}')">Copy Italian</button>
      </div>
      <div class="bubble meta">English translation</div>
      <div class="bubble in">${esc(c.message_en)}</div>
      ${(c.extra || []).map(m => `<div class="bubble out">${esc(m.text)}</div>`).join("")}
    </div>
    <div class="thread-input-row">
      <button class="round-icon-btn" title="Attach (not needed for this demo)"><img class="ic-svg sm" src="assets/icon-attach.svg" alt=""></button>
      <input type="text" class="input-glass" id="clientInput" placeholder="Type your message here">
      <button class="round-icon-btn" id="clientSendBtn" title="Send"><img class="ic-svg sm" src="assets/icon-send.svg" alt=""></button>
      <button class="round-icon-btn logi-btn" id="clientLogisticsBtn" title="Set up logistics for this deal" aria-label="Set up logistics"><img class="ic-svg sm" src="assets/icon-truck.svg" alt=""></button>
    </div>`;
  const body = $("threadBody"); body.scrollTop = body.scrollHeight;
  $("clientSendBtn").onclick = () => sendClientNote(c.id);
  $("clientLogisticsBtn").onclick = () => openLogistics(c.id);
  $("clientInput").addEventListener("keydown", e => { if (e.key === "Enter") sendClientNote(c.id); });
}
function sendClientNote(id) {
  // Kept local-only for now (no dedicated table yet) — a real, user-authored
  // follow-up note, never a fabricated buyer reply.
  const input = $("clientInput"); if (!input) return;
  const text = input.value.trim(); if (!text) return;
  const c = state.clients.find(x => x.id === id); if (!c) return;
  c.extra = c.extra || []; c.extra.push({ text, ts: Date.now() });
  input.value = "";
  renderThread();
}
function copyClientMsg(id) { const c = state.clients.find(x => x.id === id); if (c) { navigator.clipboard.writeText(c.message_it); toast("Copied"); } }


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

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function monthsLabel(arr) {
  if (!arr || !arr.length) return "";
  return arr.slice().sort((a, b) => a - b).map(m => MONTH_NAMES[m - 1]).filter(Boolean).join(", ");
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
      quantity: prod ? Math.round(prod.kg_per_week) + " kg per week" : "",
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
  const tag = opts.rows
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

  $("logisticsSubtitle").textContent = "Your farm → " + c.name + (c.zone ? " · " + c.zone : "");
  $("logisticsBody").innerHTML = `
    <div class="lg-intro">Fasto's logistics partner arranges pickup and delivery — nobody needs a van. Check the details, then both sides confirm and it goes straight to the partner.</div>

    <div class="lg-section">
      <div class="lg-section-head"><span class="eyebrow">What is moving</span><span class="foot">From your conversation</span></div>
      <div class="lg-grid">
        ${lgField("lgProduct", "Product", d.shipment.product, { req: true, ph: "e.g. Tomatoes" })}
        ${lgField("lgQty", "Quantity", d.shipment.quantity, { req: true, ph: "e.g. 80 kg per week" })}
        ${lgField("lgMonths", "Available months", d.shipment.months, { ph: "e.g. June, July, August" })}
        ${lgField("lgFirstPickup", "First pickup", "", { type: "date" })}
      </div>
    </div>

    <div class="lg-section">
      <div class="lg-section-head"><span class="eyebrow">Pickup — your details</span><span class="foot">Saved for next time</span></div>
      <div class="lg-grid">
        ${lgField("lgFCompany", "Farm / company name", d.farmer.company, { req: true })}
        ${lgField("lgFContact", "Contact name", d.farmer.contact, { req: true })}
        ${lgField("lgFVat", "Partita IVA", d.farmer.vat, { ph: "Leave blank if you don't have one" })}
        ${lgField("lgFPhone", "Phone", d.farmer.phone, { req: true, type: "tel", ph: "+39 …" })}
        ${lgField("lgFAddress", "Pickup address", d.farmer.address, { req: true, wide: true, ph: "Street, town, province" })}
      </div>
    </div>

    <div class="lg-section lg-demo">
      <div class="lg-section-head"><span class="eyebrow">Delivery — buyer's details</span><span class="pill pill-amber">Demo data</span></div>
      <div class="lg-note">Buyers don't have Fasto accounts yet, so this half starts as placeholder text. Overwrite anything you've actually agreed with them — the email flags which fields are still placeholders.</div>
      <div class="lg-grid">
        ${lgField("lgBCompany", "Business name", d.buyerSide.company, { req: true })}
        ${lgField("lgBContact", "Contact name", d.buyerSide.contact, { req: true })}
        ${lgField("lgBVat", "Partita IVA", d.buyerSide.vat)}
        ${lgField("lgBPhone", "Phone", d.buyerSide.phone, { req: true, type: "tel" })}
        ${lgField("lgBAddress", "Delivery address", d.buyerSide.address, { req: true, wide: true })}
      </div>
    </div>

    <div class="lg-section">
      <div class="lg-grid">${lgField("lgNotes", "Notes for the driver", "", { rows: 2, wide: true, ph: "Access, cold chain, best time of day…" })}</div>
    </div>

    <div class="lg-confirms">
      <label class="lg-check"><input type="checkbox" id="lgConfirmF"><span>The farmer confirms these details</span></label>
      <label class="lg-check"><input type="checkbox" id="lgConfirmB"><span>The buyer confirms these details</span></label>
    </div>
    <div class="err-banner" id="lgErr"></div>`;

  const btn = $("logisticsSubmit");
  btn.disabled = false; btn.textContent = "Send to logistics partner";
  $("logisticsSheet").classList.add("open");
}

function closeLogistics() { $("logisticsSheet").classList.remove("open"); }

const lgVal = id => { const el = $(id); return el ? String(el.value || "").trim() : ""; };

/* Split out so it can be tested without a network: returns either
   { ok:false, message } or { ok:true, payload } ready to POST. */
function buildLogisticsPayload() {
  const required = [
    ["lgProduct", "the product"], ["lgQty", "the quantity"],
    ["lgFCompany", "your farm name"], ["lgFContact", "your contact name"],
    ["lgFPhone", "your phone number"], ["lgFAddress", "your pickup address"],
    ["lgBCompany", "the buyer's business name"], ["lgBContact", "the buyer's contact name"],
    ["lgBPhone", "the buyer's phone"], ["lgBAddress", "the delivery address"]
  ];
  const missing = required.filter(([id]) => !lgVal(id)).map(([, label]) => label);
  if (missing.length) return { ok: false, message: "Still needed: " + missing.join(", ") + "." };
  if (!$("lgConfirmF").checked || !$("lgConfirmB").checked) {
    return { ok: false, message: "Both sides have to confirm before this goes to the logistics partner." };
  }

  const client = state.clients.find(x => x.id === logisticsClientId) || {};
  // Which buyer fields are still the placeholder text we put there — so the
  // partner is never left guessing whether a number is real.
  const stillDemo = LG_BUYER_FIELDS
    .filter(([id, key]) => lgVal(id) === (logisticsDemoSnapshot[key] || ""))
    .map(([id]) => ({ lgBCompany: "business name", lgBContact: "contact name", lgBVat: "IVA", lgBPhone: "phone", lgBAddress: "address" })[id]);

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
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Sending…';

  // Saved whatever happens to the email: the farmer typed them, and next time
  // this form should already know them.
  if (state.farmerId && !isLocalId(state.farmerId)) {
    const patch = {
      farmer_name: lgVal("lgFContact"), company_name: lgVal("lgFCompany"),
      vat_number: lgVal("lgFVat"), address: lgVal("lgFAddress"), phone: lgVal("lgFPhone")
    };
    state.farmerProfile = Object.assign({}, state.farmerProfile, patch);
    bgSave(DataStore.updateFarmerDetails(state.farmerId, patch), "your business details");
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
    if (c) { c.extra = c.extra || []; c.extra.push({ text: "Logistics request sent to Fasto's partner — " + lgVal("lgProduct") + ", " + lgVal("lgQty") + ".", ts: Date.now() }); }
    closeLogistics();
    renderThread();
    toast("Sent to the logistics partner. They'll be in touch to arrange pickup.");
  } catch (e) {
    console.error("logistics submit failed", e);
    const msg = String((e && e.message) || e);
    // FormSubmit's one-time activation is the likeliest first failure, and the
    // generic wording gives no clue what to do about it.
    if (/activat|confirm/i.test(msg)) {
      show("This inbox still has to be activated once: FormSubmit has emailed " + LOGISTICS_EMAIL + " a confirmation link. Click it, then send again.");
    } else {
      show("Couldn't reach the logistics partner (" + msg + "). Your details were saved — try again in a moment.");
    }
  } finally {
    btn.disabled = false; btn.textContent = "Send to logistics partner";
  }
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

/* ---------- Admin (visible only when the signed-in farmer is flagged is_admin) ---------- */
async function renderAdmin() {
  if (!$("adminScreen") || !state.isAdmin) return;
  const [{ data: farmers, error: e1 }, { data: chats, error: e2 }, { data: outreach, error: e3 }] = await Promise.all([
    DataStore.listAllFarmers(), DataStore.listAllChats(), DataStore.listAllOutreach()
  ]);
  if (e1 || e2 || e3) { console.error("admin load failed", e1, e2, e3); toast("Couldn't load admin overview."); return; }

  const farmerById = {}; (farmers || []).forEach(f => farmerById[f.id] = f);
  const outreachByChat = {};
  (outreach || []).forEach(o => { if (o.chat_id) (outreachByChat[o.chat_id] = outreachByChat[o.chat_id] || []).push(o); });
  const sentCount = (outreach || []).filter(o => o.status === "sent").length;

  $("adminStats").innerHTML = [
    `<span class="pill pill-blue">${(farmers || []).length} farmers</span>`,
    `<span class="pill pill-accent">${(chats || []).length} conversations</span>`,
    `<span class="pill pill-amber">${(outreach || []).length} outreach drafts</span>`,
    `<span class="pill pill-accent">${sentCount} sent</span>`
  ].join("");

  const rows = (chats || []).filter(c => c.village || c.organic || c.farmer_name);
  $("adminBody").innerHTML = rows.map(c => {
    const farmer = farmerById[c.farmer_id];
    const displayName = (farmer && farmer.farmer_name) || c.farmer_name || "Unnamed farmer";
    const outs = outreachByChat[c.id] || [];
    const outLabel = outs.length ? outs.map(o => o.status).join(", ") : "—";
    // data-label is what the cell calls itself once the table stacks into
    // single-column blocks on a phone and the column headers are hidden —
    // "Terelle" and "draft, sent" mean nothing on their own. Ignored on desktop.
    return `<tr>
      <td data-label="Farmer"><b>${esc(displayName)}</b></td>
      <td class="rp-conv" data-label="Conversation"><b>${esc(c.title)}</b><small>${esc(relDate(new Date(c.created_at).getTime()))}</small></td>
      <td data-label="Location">${esc(c.village || "—")}</td>
      <td class="rp-prog" data-label="Progress">
        <div class="progress-track"><div class="progress-fill ${progClass(c.pct)}" style="width:${c.pct}%"></div></div>
        <div class="prog-label">${esc(phaseLabel(c.phase))} · ${c.pct}%</div>
      </td>
      <td data-label="Outreach">${esc(outLabel)}</td>
    </tr>`;
  }).join("");
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
const BACKDROP_SCRIM = "linear-gradient(to bottom, rgba(10,6,6,.05) 0%, rgba(8,5,5,.65) 100%)";
// Start somewhere random so two demos in a row don't open on the same photo.
let backdropIdx = Math.floor(Math.random() * BACKDROPS.length);

function showBackdrop() {
  const main = $("main"); if (!main) return;
  main.style.backgroundImage = BACKDROP_SCRIM + ", url('" + BACKDROPS[backdropIdx] + "')";
  // Fetch the *next* one now, so the following visit swaps instantly instead
  // of showing a bare dark frame while it downloads.
  const nxt = new Image();
  nxt.src = BACKDROPS[(backdropIdx + 1) % BACKDROPS.length];
}
function rotateBackdrop() {
  backdropIdx = (backdropIdx + 1) % BACKDROPS.length;
  showBackdrop();
}

/* ================= NAVIGATION ================= */
function switchScreen(name) {
  const prev = state.screen;
  state.screen = name;
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === name + "Screen"));
  document.querySelectorAll(".nav-item").forEach(s => s.classList.toggle("active", s.dataset.screen === name));
  if (name === "dashboard") { if (prev !== "dashboard") rotateBackdrop(); renderDashboard(); }
  if (name === "clients") renderChats();
  if (name === "assistant") { renderChatRail(); renderTranscript(); }
  if (name === "admin") renderAdmin();
}

/* ================= Offline scripted demo ================= */
const OFFLINE_SCRIPT = [
  "Buongiorno! I'm the Fasto Innova assistant. First — what's your name?",
  "Nice to meet you! Now tell me — what do you grow on your farm?",
  "Lovely! And roughly how many kilograms per week can you offer, for each product?",
  "Great. Which months of the year is your produce available, and where is your farm (village and rough distance from Cassino)?",
  "Last question: do you have an organic certification — yes, no, or partially?",
  "Perfect, let me summarise: tomatoes ~80 kg/week and zucchine ~40 kg/week, June–October, near Sant'Elia Fiumerapido (~6 km), no organic certification. Shall I search for matches?"
];
const OFFLINE_PROFILE = { farmer_name: "Marco", village: "Sant'Elia Fiumerapido", distance_km_from_cassino: 6, organic: "no", available_months: [6,7,8,9,10],
  products: [{ name: "pomodori", category: "pomodori", kg_per_week: 80 }, { name: "zucchine", category: "verdure", kg_per_week: 40 }] };

function offlineTurn(chat) {
  const step = chat.offlineStep++;
  if (step < OFFLINE_SCRIPT.length) {
    setTimeout(() => { addMsg(chat, "ai", OFFLINE_SCRIPT[step]); addLog("info", "Brain 1 · scripted reply (offline mode)"); }, 450);
    if (step === OFFLINE_SCRIPT.length - 1) chat.offlineReady = true;
  }
  if (chat.offlineReady && step === OFFLINE_SCRIPT.length) {
    setTimeout(() => onProfileCaptured(OFFLINE_PROFILE, chat), 550);
  }
}
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
  const saved = localStorage.getItem("fasto_key");
  if (saved) $("apikey").value = saved;

  /* ---- account: sign in / sign up ---- */
  let authMode = "in";
  function setAuthMode(next) {
    authMode = next;
    $("authTabIn").classList.toggle("active", next === "in");
    $("authTabUp").classList.toggle("active", next === "up");
    // don't overwrite a spinner that's mid-request — setAuthBusy(false) relabels
    if (!$("authSubmitBtn").disabled) $("authSubmitBtn").textContent = authLabel();
    $("authHint").textContent = next === "up"
      ? "Already have an account? Switch to Sign in above."
      : "New here? Switch to Sign up above — it only takes an email and a password.";
    // Phone password managers key off this: left on "current-password" while
    // signing UP, iOS and Android offer to fill an old password instead of
    // suggesting a new one, and never offer to save the new account.
    $("authPassword").setAttribute("autocomplete", next === "up" ? "new-password" : "current-password");
    $("authErr").style.display = "none";
  }
  $("authTabIn").onclick = () => setAuthMode("in");
  $("authTabUp").onclick = () => setAuthMode("up");

  function authLabel() { return authMode === "up" ? "Create account" : "Sign in"; }
  // A disabled button with its normal label just looks broken; say what it's waiting on.
  function setAuthBusy(on, busyText) {
    const b = $("authSubmitBtn");
    b.disabled = on;
    if (on) b.innerHTML = '<span class="spinner"></span>' + busyText;
    else b.textContent = authLabel();
  }

  function goToModeCard() { $("authCard").style.display = "none"; $("modeCard").style.display = "block"; }

  $("authSubmitBtn").onclick = async () => {
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const errBox = $("authErr"); errBox.style.display = "none";
    if (!email || !password) { errBox.textContent = "Enter an email and a password."; errBox.style.display = "block"; return; }
    if (password.length < 6) { errBox.textContent = "Password must be at least 6 characters."; errBox.style.display = "block"; return; }
    setAuthBusy(true, authMode === "up" ? "Creating your account…" : "Signing you in…");
    try {
      const { data, error } = authMode === "up" ? await DataStore.signUp(email, password) : await DataStore.signIn(email, password);
      if (error) throw error;
      if (!data.session) {
        errBox.textContent = "Check your email to confirm your account, then sign in.";
        errBox.style.display = "block";
      } else {
        state.farmerId = data.user.id;
        goToModeCard();
      }
    } catch (e) {
      errBox.textContent = e.message || "Something went wrong.";
      errBox.style.display = "block";
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
  setAuthBusy(true, "Checking your account…");
  const authFailsafe = setTimeout(unlockAuth, 4000);
  DataStore.getSession().then(session => {
    if (session && session.user) { state.farmerId = session.user.id; goToModeCard(); }
  }).catch(e => console.error("session check failed — falling through to the sign-in card, which is the right outcome, so nothing is shown", e))
    .finally(() => { clearTimeout(authFailsafe); unlockAuth(); });

  /* ---- demo mode: offline vs live AI (unchanged) ---- */
  let mode = "offline";
  $("modeOffline").onclick = () => { mode = "offline"; $("modeOffline").classList.add("active"); $("modeLive").classList.remove("active"); $("liveKeyBlock").style.display = "none"; };
  $("modeLive").onclick = () => { mode = "live"; $("modeLive").classList.add("active"); $("modeOffline").classList.remove("active"); $("liveKeyBlock").style.display = "block"; };

  let entering = false;
  $("startBtn").onclick = async () => {
    state.offline = (mode === "offline");
    state.apiKey = $("apikey").value.trim();
    state.model = $("model").value;
    if (!state.offline && !state.apiKey.startsWith("sk-ant")) { alert("Paste a valid Anthropic API key (starts with sk-ant), or switch to Offline mode."); return; }
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
    showBackdrop();                                   // first photo of the session; rotates on each return to Dashboard
    $("modePill").textContent = state.offline ? "Offline demo" : ("Live · " + (state.model.includes("haiku") ? "Haiku 4.5" : "Sonnet 5"));
    switchScreen("dashboard");
    showResearchSkeleton(3);

    // The outer finally is the point: whatever goes wrong in here, the skeleton
    // has to come off. A shell frozen in placeholders is worse than a shell
    // with missing data, because nothing in it can be clicked.
    try {
      try {
        bootStatus("Loading the Cassino buyer database…");
        await loadBuyers();
        bootStatus("Loading your saved chats…");
        await loadFarmerData(state.farmerId);
      } catch (e) {
        console.error("Failed to load account data", e);
        toast("Couldn't load your saved data — starting fresh.");
      }

      addLog("ok", "Guardian armed. Database loaded: " + DB.buyers.length + " buyers + " + DB.channels.length + " channels (Cassino).");
      addLog("info", "Guardian watching all traffic Brain 1 ⇄ Brain 2.");
      $("adminNavItem").style.display = state.isAdmin ? "flex" : "none";

      if (state.chats.length) { state.activeChatId = state.chats[0].id; updateHeaderIdentity(); renderChatRail(); renderTranscript(); }
      else { bootStatus("Setting up your first conversation…"); await startNewChat(); }
    } catch (e) {
      console.error("Failed to finish opening the app", e);
      toast("Something went wrong opening your account — you can still use the app, but some of it may be empty.");
    } finally {
      $("app").classList.remove("booting");
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

  // Search (filters clients list + dashboard research rows)
  $("topSearch").addEventListener("input", e => {
    const q = e.target.value.trim().toLowerCase();
    if (state.screen === "clients") {
      document.querySelectorAll(".client-item").forEach(el => { el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none"; });
    } else if (state.screen === "dashboard") {
      document.querySelectorAll("#researchBody tr").forEach(el => { el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none"; });
    }
  });

  // Notification bell -> jump to clients
  $("bellBtn").onclick = () => { switchScreen("clients"); toast(state.clients.filter(c => c.status === "draft").length + " draft(s) ready to send"); };

  // Avatar -> sign out (data stays in the account; this just clears the local view)
  $("profileBtn").onclick = async () => {
    if (!confirm("Sign out and restart? Your saved data stays in your account for next time.")) return;
    let signedOut = true;
    try { const r = await DataStore.signOut(); if (r && r.error) throw r.error; }
    catch (e) { console.error("sign out failed", e); signedOut = false; }
    localStorage.removeItem("fasto_key");
    if (signedOut) { location.reload(); return; }
    // The browser session survived, so reloading now walks straight back in.
    // Say so rather than pretending it worked, and leave the words on screen.
    toast("Couldn't reach your account to sign out — you may still be signed in on this device.");
    setTimeout(() => location.reload(), 2600);
  };

  $("researchSeeAll").onclick = () => { state.showAllResearch = !state.showAllResearch; renderDashboard(); };

  // Match view: close on the X, on a backdrop click, or on Escape
  $("matchCloseBtn").onclick = () => closeMatchView();
  $("matchSheet").addEventListener("click", e => { if (e.target === $("matchSheet")) closeMatchView(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMatchView(); });

  // Logistics sheet: same three ways out. Backdrop/Escape only — never a stray
  // click inside the panel, which would throw away a half-typed form.
  $("logisticsCloseBtn").onclick = () => closeLogistics();
  $("logisticsSubmit").onclick = () => submitLogistics();
  $("logisticsSheet").addEventListener("click", e => { if (e.target === $("logisticsSheet")) closeLogistics(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeLogistics(); });

  renderDashboard();
}
document.addEventListener("DOMContentLoaded", boot);
