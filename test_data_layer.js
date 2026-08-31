/* ============================================================
   FASTO INNOVA — Supabase data-layer tests
   ------------------------------------------------------------
   Run with `node test_data_layer.js` from inside this folder
   (or pass a path: `node test_data_layer.js /path/to/app`).

   The third of the three dev scripts kept in this folder:
     · test_engine.js     — the matching engine (Brains 2 + 3)
     · qa_check.js        — static cross-references (ids, assets, syntax)
     · test_data_layer.js — this one: everything between the app and
                            the database

   Nothing here touches the real Supabase project. `js/supabase-client.js`
   and `js/app.js` are loaded FOR REAL into a sandbox, with a stand-in
   Supabase that records every query instead of sending it — so these are
   tests of the shipped files, not of a copy that could drift away from
   them.

   No npm install: Node's own `vm` module only. That is deliberate. The
   daily improvement run (see ROADMAP.md) starts from nothing each time,
   and a test suite that needs a download first is a test suite that
   quietly stops being run.

   WHAT IT GUARDS, and why each one is here:
     1. Query shape — table, filter column and sort direction of every
        DataStore method. A filter that goes missing is not a cosmetic
        bug: `.eq("farmer_id", uid)` is what keeps one farmer's chats out
        of another's app. Row Level Security would still block it in the
        database, but the two are meant to agree, and only one of them is
        visible in this repo.
     2. saveProducts / saveMatches — the only two methods with real logic
        rather than a single query.
     3. bgSave — Supabase RESOLVES with { error } instead of rejecting.
        Every background write in this app was silently swallowing real
        failures for that reason until 2026-08-23. This locks it shut.
     4. loadFarmerData — the database → screen mapping, including the
        numeric-as-string values PostgREST sends back for `numeric`
        columns, which arrive as "80" and would print as NaN unwrapped.
     5. isLocalId — after a failed write a record gets a client-only id.
        Sending that id back to Postgres is a guaranteed error, so every
        later write has to check first.
     8. The IT/EN language layer. Two things, and the second is the
        point: that every translated label is read at RENDER time rather
        than frozen at load — the classic i18n bug, invisible until
        somebody presses the toggle — and that switching language never
        changes a single value written to the database. A category is
        stored as "pomodori" whether the label beside it says "tomatoes"
        or "pomodori", and the logistics email keeps its English field
        names whatever the farmer's app is set to.
   ============================================================ */
const fs = require("fs");
const vm = require("vm");
const path = process.argv[2] || __dirname;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗ FAIL:", name, extra === undefined ? "" : extra); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ============================================================
   A stand-in Supabase client.
   `sb.from("chats").select("*").eq("farmer_id", uid).order(...)` builds a
   chain of calls and only talks to the network when it is awaited. This
   records the chain instead, so a query can be inspected without being
   sent, and answers with whatever the test has programmed.
   ============================================================ */
function makeFakeSupabase() {
  const chains = [];
  const authCalls = [];
  const fake = {
    chains, authCalls,
    queue: [],        // programmed answers, taken in order
    router: null,     // ...or one function that answers by table
    session: { data: { session: null } },
    reset() { chains.length = 0; authCalls.length = 0; fake.queue.length = 0; fake.router = null; },
    last() { return chains[chains.length - 1]; },
    from(table) {
      const chain = { table, ops: [] };
      chains.push(chain);
      const api = { chain };
      for (const op of ["select", "insert", "update", "delete", "eq", "order", "single", "maybeSingle", "in", "limit"]) {
        api[op] = (...args) => { chain.ops.push({ op, args }); return api; };
      }
      // Awaiting the chain is what "sends" it.
      api.then = (onOk, onErr) => {
        let result = fake.queue.length ? fake.queue.shift()
          : fake.router ? fake.router(chain)
          : { data: [], error: null };
        chain.result = result;
        const p = (result instanceof Error) ? Promise.reject(result) : Promise.resolve(result);
        return p.then(onOk, onErr);
      };
      return api;
    },
    auth: {
      signUp(a) { authCalls.push({ fn: "signUp", args: a }); return Promise.resolve({ data: {}, error: null }); },
      signInWithPassword(a) { authCalls.push({ fn: "signInWithPassword", args: a }); return Promise.resolve({ data: {}, error: null }); },
      signOut() { authCalls.push({ fn: "signOut" }); return Promise.resolve({ error: null }); },
      getSession() { authCalls.push({ fn: "getSession" }); return Promise.resolve(fake.session); }
    },
    createClient(url, key) { fake.url = url; fake.key = key; return fake; }
  };
  return fake;
}

/* A DOM small enough to fit in this file. app.js reads elements by id and
   nearly every helper already gives up quietly when one isn't there, so an
   unknown id answers null on purpose: it keeps the rendering code out of the
   way while the data-layer functions run for real. The two elements that are
   written to without a guard (the toast, the "Not saved" chip) are the two
   that exist here. */
function fakeEl(id) {
  const classes = new Set();
  return {
    id, textContent: "", innerHTML: "", value: "", style: {}, dataset: {},
    disabled: false, checked: false, offsetWidth: 0,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: c => classes.has(c),
      toggle: c => (classes.has(c) ? classes.delete(c) : classes.add(c))
    },
    has: c => classes.has(c),
    addEventListener() {}, removeEventListener() {}, focus() {}, scrollTo() {}, querySelector: () => null
  };
}

function loadApp(root) {
  const sb = makeFakeSupabase();
  const els = { toast: fakeEl("toast"), syncWarn: fakeEl("syncWarn") };
  const logs = { error: [], warn: [], debug: [], log: [] };
  const sandbox = {
    setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON, isFinite, Number, String, Object, Array,
    console: {
      log: (...a) => logs.log.push(a), warn: (...a) => logs.warn.push(a),
      error: (...a) => logs.error.push(a), debug: (...a) => logs.debug.push(a)
    },
    document: {
      getElementById: id => els[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {}, createElement: () => fakeEl("new")
    },
    /* js/i18n.js reads both of these the moment it is evaluated, to pick a
       starting language. A null localStorage and an English navigator mean the
       suite always runs in English unless a test says otherwise, so the
       assertions below can compare against literal English strings. */
    localStorage: (() => { const store = {};
      return { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
               removeItem: k => { delete store[k]; }, __store: store }; })(),
    navigator: { clipboard: { writeText() {} }, language: "en-GB" },
    location: { reload() {}, href: "" },
    fetch: () => Promise.reject(new Error("no network in tests")),
    alert() {}, confirm: () => false, open: () => null
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.supabase = sb;
  vm.createContext(sandbox);

  /* One script, not four. Top-level `const`/`let` are scoped to the script
     that declares them, so evaluating these files separately would leave
     app.js unable to see DataStore or DB. */
  // Same order as index.html: i18n.js before app.js, because app.js calls T().
  const files = ["js/supabase-client.js", "js/i18n.js", "js/data.js", "js/core.js", "js/app.js"];
  const src = files.map(f => fs.readFileSync(root + "/" + f, "utf8")).join("\n;\n") + `
;globalThis.__t = { state, DataStore, DB, loadFarmerData, bgSave, isLocalId, addMsg,
  saveState, flushSaveFailures, saveOk, saveFailed, explainSyncWarn, isChatUntouched, SAVE_REPEAT_MS,
  applyProfileEdit, changedProfileFields, readProfileForm, openProfileEdit, saveProfileEdit,
  addProfileProduct, removeProfileProduct, toggleProfileMonth,
  adminStageSets, adminFunnel, adminStages, ADMIN_STAGE_KEYS, setAdminStage, renderAdmin,
  T, currentLang, setLangValue, setLang, applyI18n, engineText, catLabel, monthNames, offlineScript,
  STRINGS, ENGINE_PATTERNS, OFFLINE_SCRIPT_KEYS, phaseLabel, relDate, chatTitle, greetingText,
  profileFieldLabel, humanList, buildLogisticsPayload, paintModePill, lgField };`;
  vm.runInContext(src, sandbox, { filename: "fasto-bundle.js" });
  return { app: sandbox.__t, sb, els, logs, storage: sandbox.localStorage };
}

const { app, sb, els, logs, storage } = loadApp(path);

/* ============================================================
   1. Query shape — table, filter, sort, single-row flags
   ============================================================ */
console.log("== Test 1: every DataStore query is aimed at the right table, with the right filter ==");

function shapeOf(build) {
  sb.reset();
  build();
  const c = sb.last();
  return { table: c.table, ops: c.ops.map(o => o.op), args: c.ops };
}
const argOf = (s, op) => (s.args.find(o => o.op === op) || { args: [] }).args;

const UID = "11111111-2222-3333-4444-555555555555";
const CHAT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const sFarmer = shapeOf(() => app.DataStore.getMyFarmer(UID));
check("getMyFarmer: farmers, filtered by id, expects at most one row",
  sFarmer.table === "farmers" && eq(argOf(sFarmer, "eq"), ["id", UID]) && sFarmer.ops.includes("maybeSingle"),
  JSON.stringify(sFarmer));

const sName = shapeOf(() => app.DataStore.updateFarmerName(UID, "Marco"));
check("updateFarmerName: writes farmer_name to this farmer's row only",
  sName.table === "farmers" && eq(argOf(sName, "update"), [{ farmer_name: "Marco" }]) && eq(argOf(sName, "eq"), ["id", UID]));

const detailPatch = { company_name: "Az. Agricola Rossi", vat_number: "IT01234567890", address: "Via Roma 1", phone: "+39 333" };
const sDet = shapeOf(() => app.DataStore.updateFarmerDetails(UID, detailPatch));
check("updateFarmerDetails: passes the business-details patch through untouched",
  sDet.table === "farmers" && eq(argOf(sDet, "update"), [detailPatch]) && eq(argOf(sDet, "eq"), ["id", UID]));

const sChats = shapeOf(() => app.DataStore.listMyChats(UID));
check("listMyChats: chats belonging to this farmer only",
  sChats.table === "chats" && eq(argOf(sChats, "eq"), ["farmer_id", UID]));
check("listMyChats: newest first — the whole app assumes state.chats[0] is the newest",
  eq(argOf(sChats, "order"), ["created_at", { ascending: false }]), JSON.stringify(argOf(sChats, "order")));

const sNewChat = shapeOf(() => app.DataStore.createChat(UID));
check("createChat: inserts one chat for this farmer and reads the new row back",
  sNewChat.table === "chats" && eq(argOf(sNewChat, "insert"), [{ farmer_id: UID }]) && sNewChat.ops.includes("single"),
  JSON.stringify(sNewChat));

const sUpChat = shapeOf(() => app.DataStore.updateChat(CHAT, { phase: "done", pct: 100 }));
check("updateChat: updates one chat by id",
  sUpChat.table === "chats" && eq(argOf(sUpChat, "eq"), ["id", CHAT]) && eq(argOf(sUpChat, "update"), [{ phase: "done", pct: 100 }]));

const sMsgs = shapeOf(() => app.DataStore.listMessages(CHAT));
check("listMessages: this chat's messages, oldest first — a transcript read backwards is unreadable",
  sMsgs.table === "messages" && eq(argOf(sMsgs, "eq"), ["chat_id", CHAT]) && eq(argOf(sMsgs, "order"), ["created_at", { ascending: true }]));

const sAdd = shapeOf(() => app.DataStore.addMessage(CHAT, "user", "ciao"));
check("addMessage: inserts chat_id + role + text",
  sAdd.table === "messages" && eq(argOf(sAdd, "insert"), [{ chat_id: CHAT, role: "user", text: "ciao" }]));

const sProds = shapeOf(() => app.DataStore.listProducts(CHAT));
check("listProducts: scoped to the chat, not to the farmer (profile data is per-conversation)",
  sProds.table === "products" && eq(argOf(sProds, "eq"), ["chat_id", CHAT]));

const sOut = shapeOf(() => app.DataStore.listMyOutreach(UID));
check("listMyOutreach: this farmer's drafts, newest first",
  sOut.table === "outreach" && eq(argOf(sOut, "eq"), ["farmer_id", UID]) && eq(argOf(sOut, "order"), ["created_at", { ascending: false }]));

const sMkOut = shapeOf(() => app.DataStore.createOutreach(UID, CHAT, "b22", "Buongiorno", "Good morning", true));
const outRow = argOf(sMkOut, "insert")[0] || {};
check("createOutreach: carries farmer, chat, buyer, both languages and the flag, and reads the row back",
  sMkOut.table === "outreach" && outRow.farmer_id === UID && outRow.chat_id === CHAT && outRow.buyer_id === "b22" &&
  outRow.message_it === "Buongiorno" && outRow.message_en === "Good morning" && outRow.flagged === true && sMkOut.ops.includes("single"),
  JSON.stringify(outRow));

const sUpOut = shapeOf(() => app.DataStore.updateOutreach("o1", { status: "sent" }));
check("updateOutreach: updates one draft by id",
  sUpOut.table === "outreach" && eq(argOf(sUpOut, "eq"), ["id", "o1"]));

const sBuyers = shapeOf(() => app.DataStore.listBuyers());
check("listBuyers: the whole curated buyer table, unfiltered (it is reference data, shared by everyone)",
  sBuyers.table === "buyers" && !sBuyers.ops.includes("eq"));

/* The three admin reads are deliberately unfiltered: they return every
   farmer's rows, and what decides whether that is allowed is the RLS policy
   in Postgres reading is_admin — never anything in this file. Pinning the
   shape here means a future edit that "helpfully" adds a filter, or that
   points one of them at the wrong table, shows up as a failure. */
console.log("== Test 1b: admin reads are unfiltered by design (RLS decides, not the client) ==");
for (const [name, fn, table] of [
  ["listAllFarmers", () => app.DataStore.listAllFarmers(), "farmers"],
  ["listAllChats", () => app.DataStore.listAllChats(), "chats"],
  ["listAllOutreach", () => app.DataStore.listAllOutreach(), "outreach"]
]) {
  const s = shapeOf(fn);
  check(name + ": reads " + table + " with no client-side filter", s.table === table && !s.ops.includes("eq"), JSON.stringify(s));
}

check("every per-farmer read carries its ownership filter (none of them rely on RLS alone)",
  [sChats, sOut].every(s => s.ops.includes("eq")) && [sMsgs, sProds].every(s => s.ops.includes("eq")));

/* ============================================================
   2. The two methods with real logic in them
   ============================================================ */
console.log("== Test 2: saveProducts and saveMatches ==");

(async () => {
  /* saveProducts replaces a chat's product list: delete what's there, then
     insert the new set. */
  sb.reset();
  sb.router = () => ({ data: null, error: null });
  await app.DataStore.saveProducts(CHAT, [
    { name: "pomodori", category: "pomodori", kg_per_week: 80 },
    { name: "zucchine", category: "verdure", kg_per_week: 40 }
  ]);
  const ops = sb.chains.map(c => c.ops[0].op);
  check("saveProducts: deletes the old rows first, then inserts", eq(ops, ["delete", "insert"]), JSON.stringify(ops));
  const inserted = sb.chains[1].ops[0].args[0];
  check("saveProducts: every row carries its chat_id and the three product fields",
    inserted.length === 2 && eq(inserted[0], { chat_id: CHAT, name: "pomodori", category: "pomodori", kg_per_week: 80 }),
    JSON.stringify(inserted[0]));

  /* If the delete is refused the insert must not run, or the chat ends up
     with both the old products and the new ones. */
  sb.reset();
  sb.queue.push({ data: null, error: { message: "permission denied for table products" } });
  const refused = await app.DataStore.saveProducts(CHAT, [{ name: "x", category: "verdure", kg_per_week: 1 }]);
  check("saveProducts: a refused delete stops the insert (otherwise the list doubles)",
    sb.chains.length === 1 && sb.chains[0].ops[0].op === "delete", "chains: " + JSON.stringify(sb.chains.map(c => c.ops[0].op)));
  check("saveProducts: and hands that error back to the caller so bgSave can report it",
    !!(refused && refused.error), JSON.stringify(refused));

  sb.reset();
  const emptied = await app.DataStore.saveProducts(CHAT, []);
  check("saveProducts: an empty list still clears the old rows, and inserts nothing",
    sb.chains.length === 1 && sb.chains[0].ops[0].op === "delete" && eq(emptied, { error: null }));
  sb.reset();
  await app.DataStore.saveProducts(CHAT, null);
  check("saveProducts: null products doesn't throw", sb.chains.length === 1);

  sb.reset();
  app.DataStore.saveMatches(CHAT, [
    { buyer_id: "b22", pitch_reason: "wants tomatoes weekly" },
    { buyer_id: "b23", pitch_reason: "3 km away" },
    { buyer_id: "b34", pitch_reason: "buys in volume" }
  ]);
  const rows = sb.last().ops[0].args[0];
  check("saveMatches: ranks 1, 2, 3 in the order Brain 2 gave them",
    eq(rows.map(r => r.match_rank), [1, 2, 3]) && rows[0].buyer_id === "b22" && rows[2].buyer_id === "b34",
    JSON.stringify(rows.map(r => r.match_rank + ":" + r.buyer_id)));
  check("saveMatches: keeps each buyer's written reason alongside its rank",
    rows[1].pitch_reason === "3 km away" && rows[1].chat_id === CHAT);

  /* getSession digs the session out of Supabase's { data: { session } }. */
  sb.session = { data: { session: { user: { id: UID } } } };
  const session = await app.DataStore.getSession();
  check("getSession: unwraps data.session", !!session && session.user.id === UID);
  sb.session = { data: { session: null } };
  check("getSession: answers null when nobody is signed in", (await app.DataStore.getSession()) === null);

  /* ============================================================
     3. The trap that actually bit: Supabase resolves with { error }
     ============================================================ */
  console.log("== Test 3: bgSave — a failed write must be reported, in all three shapes ==");

  function resetSave() {
    app.saveState.queue.length = 0;
    app.saveState.failures = 0;
    app.saveState.lastFailure = 0;
    app.saveState.lastToast = 0;
    els.syncWarn.classList.remove("show");
    els.toast.textContent = "";
    logs.error.length = 0;
  }

  resetSave();
  await app.bgSave(Promise.resolve({ data: null, error: { message: "new row violates row-level security policy" } }), "this message");
  check("a resolved { error } counts as a failure — this is the one a plain .catch() never saw",
    app.saveState.failures === 1 && app.saveState.queue.includes("this message"), JSON.stringify(app.saveState.queue));
  check("...and the amber \"Not saved\" chip comes up", els.syncWarn.has("show"));
  check("...and it still reaches the console for debugging", logs.error.length === 1);

  resetSave();
  await app.bgSave(Promise.reject(new Error("network down")), "your product list");
  check("a thrown rejection counts too (a dropped connection, rather than a refusal)",
    app.saveState.failures === 1 && app.saveState.queue.includes("your product list"));

  resetSave();
  els.syncWarn.classList.add("show");
  const okRes = await app.bgSave(Promise.resolve({ data: [{ id: 1 }], error: null }), "your name");
  check("a write that gets through reports nothing and clears the chip",
    app.saveState.failures === 0 && !els.syncWarn.has("show") && okRes.data[0].id === 1);

  resetSave();
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "your farm profile");
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "your product list");
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "your name");
  app.flushSaveFailures();
  check("three failures in the same instant become one sentence, not three toasts",
    els.toast.textContent === "Couldn't save your farm profile, your product list and your name to your account — fine for now, but it may not be here next time.",
    els.toast.textContent);

  resetSave();
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "one thing");
  app.flushSaveFailures();
  check("a single failure reads as one thing, without a stray \"and\"",
    els.toast.textContent.indexOf("Couldn't save one thing to your account") === 0, els.toast.textContent);

  els.toast.textContent = "";
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "something else");
  app.flushSaveFailures();
  check("a repeat inside the quiet period stays quiet — the chip carries it instead",
    els.toast.textContent === "" && els.syncWarn.has("show"), els.toast.textContent);

  app.saveState.lastToast = Date.now() - (app.SAVE_REPEAT_MS + 1000);
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "a later thing");
  app.flushSaveFailures();
  check("...but once the quiet period is over it speaks up again",
    els.toast.textContent.indexOf("Couldn't save a later thing") === 0, els.toast.textContent);

  resetSave();
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "a");
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "a");
  app.flushSaveFailures();
  check("the same thing failing twice is named once", els.toast.textContent.indexOf("Couldn't save a to your account") === 0, els.toast.textContent);

  resetSave();
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "a");
  app.explainSyncWarn();
  check("the chip explains itself in the singular for one failure",
    els.toast.textContent.indexOf("1 change couldn't be saved") === 0, els.toast.textContent);
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "b");
  app.explainSyncWarn();
  check("...and in the plural for more", els.toast.textContent.indexOf("2 changes couldn't be saved") === 0, els.toast.textContent);

  /* A success arriving in the middle of a failing burst must not switch the
     warning off — the connection is still down. */
  resetSave();
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "a");
  await app.bgSave(Promise.resolve({ data: [], error: null }), "b");
  check("one success inside a failing burst does NOT clear the warning", els.syncWarn.has("show"));

  /* And the debounce itself, on the real clock, once. */
  resetSave();
  await app.bgSave(Promise.resolve({ error: { message: "x" } }), "the debounced thing");
  check("nothing is said immediately — failures are given a moment to group", els.toast.textContent === "");
  await new Promise(r => setTimeout(r, 1100));
  check("...and the toast lands on its own after the grouping window",
    els.toast.textContent.indexOf("Couldn't save the debounced thing") === 0, els.toast.textContent);

  /* ============================================================
     4. loadFarmerData — rows from Postgres to what the screens read
     ============================================================ */
  console.log("== Test 4: loadFarmerData maps the database onto the app's state ==");

  function loadWith({ farmer, chats, outreach, messages = {}, products = {} }) {
    sb.reset();
    sb.router = chain => {
      const t = chain.table;
      if (t === "farmers") return { data: farmer, error: null };
      if (t === "chats") return { data: chats, error: null };
      if (t === "outreach") return { data: outreach, error: null };
      const id = (chain.ops.find(o => o.op === "eq") || { args: [] }).args[1];
      if (t === "messages") return { data: messages[id] || [], error: null };
      if (t === "products") return { data: products[id] || [], error: null };
      return { data: [], error: null };
    };
    app.state.chats = []; app.state.clients = []; app.state.isAdmin = false;
    return app.loadFarmerData(UID);
  }

  const NOW = "2026-08-27T09:00:00Z";
  await loadWith({
    farmer: { id: UID, farmer_name: "Marco", is_admin: true, company_name: "Az. Rossi" },
    chats: [
      // PostgREST sends `numeric` columns back as STRINGS, to avoid losing
      // precision. Untouched, "12.5" prints fine but does arithmetic wrong.
      { id: "c1", title: "Marco", phase: "done", pct: 100, village: "Terelle", organic: "no",
        distance_km_from_cassino: "12.5", available_months: [10, 11], farmer_name: "Marco", created_at: NOW },
      { id: "c2", title: "New chat", phase: "interview", pct: 0, village: null, organic: null,
        distance_km_from_cassino: null, available_months: null, created_at: NOW }
    ],
    outreach: [
      { id: "o1", buyer_id: "b22", chat_id: "c1", message_it: "Buongiorno", message_en: "Hello", flagged: false, status: "draft", created_at: NOW },
      { id: "o2", buyer_id: "ZZZ_not_in_db", chat_id: "c1", message_it: "x", message_en: "y", flagged: true, status: "sent", created_at: NOW }
    ],
    messages: { c1: [{ role: "ai", text: "Buongiorno!", created_at: NOW }, { role: "user", text: "ciao", created_at: NOW }] },
    products: { c1: [{ name: "castagne", category: "castagne", kg_per_week: "150" }] }
  });

  const c1 = app.state.chats.find(c => c.id === "c1");
  const c2 = app.state.chats.find(c => c.id === "c2");
  check("both chats loaded, in the order the database gave them", app.state.chats.length === 2 && app.state.chats[0].id === "c1");
  check("the newest chat is the one opened", app.state.activeChatId === "c1");
  check("distance arrives as the string \"12.5\" and is stored as the number 12.5",
    c1.profile.distance_km_from_cassino === 12.5 && typeof c1.profile.distance_km_from_cassino === "number",
    typeof c1.profile.distance_km_from_cassino + " " + c1.profile.distance_km_from_cassino);
  check("kg_per_week arrives as the string \"150\" and is stored as the number 150",
    c1.profile.products[0].kg_per_week === 150 && typeof c1.profile.products[0].kg_per_week === "number");
  check("no NaN anywhere in the loaded numbers",
    [c1.profile.distance_km_from_cassino, c1.profile.products[0].kg_per_week].every(n => !Number.isNaN(n)));
  check("a chat with a village/organic/products has its captured profile rebuilt", !!c1.profile && c1.profile.village === "Terelle");
  check("a chat Brain 1 never finished has no profile at all, rather than an empty one", c2.profile === null);
  check("an untouched chat is still recognised as reusable after a reload", app.isChatUntouched(c2) === true);
  check("a finished chat is not", app.isChatUntouched(c1) === false);
  check("the transcript comes back in order", eq(c1.messages.map(m => m.role), ["ai", "user"]) && c1.messages[1].text === "ciao");
  check("available_months survives, and a null one becomes an empty list",
    eq(c1.profile.available_months, [10, 11]) && eq(c2.profile, null));
  check("is_admin on the farmer row turns on the Admin nav item", app.state.isAdmin === true);
  check("the farmer's own row is kept for the logistics form", app.state.farmerProfile.company_name === "Az. Rossi");

  const cl1 = app.state.clients.find(c => c.id === "o1");
  const cl2 = app.state.clients.find(c => c.id === "o2");
  check("an outreach draft is joined to its buyer, so the Clients list shows a name and not an id",
    cl1.name && cl1.name !== "b22" && cl1.buyerId === "b22", cl1 && cl1.name);
  check("a buyer id missing from the database falls back to the id rather than showing \"undefined\"",
    cl2.name === "ZZZ_not_in_db" && cl2.type === "");
  check("the draft's status and flag survive the round trip", cl1.status === "draft" && cl2.flagged === true);
  check("the first client is selected", app.state.activeClientId === "o1");

  /* A brand-new account: every list comes back empty. */
  await loadWith({ farmer: { id: UID, farmer_name: null, is_admin: false }, chats: [], outreach: [] });
  check("a new account loads with no chats and nothing selected",
    app.state.chats.length === 0 && app.state.activeChatId === null && app.state.clients.length === 0);
  check("...and is not an admin", app.state.isAdmin === false);

  /* Supabase answering with nulls (which it does on an error it swallowed)
     must not take the app down on the way in. */
  await loadWith({ farmer: null, chats: null, outreach: null });
  check("null rows from a failed read don't throw — the app opens empty instead",
    app.state.chats.length === 0 && app.state.clients.length === 0 && eq(app.state.farmerProfile, {}));

  /* Only products, no village: still a real captured profile. */
  await loadWith({
    farmer: { id: UID }, chats: [{ id: "c9", phase: "matching", created_at: NOW }], outreach: [],
    products: { c9: [{ name: "uova", category: "uova", kg_per_week: 30 }] }
  });
  check("a chat with products but no village still counts as having a profile",
    !!app.state.chats[0].profile && app.state.chats[0].profile.products.length === 1);

  /* ============================================================
     5. Client-only ids must never be sent to Postgres
     ============================================================ */
  console.log("== Test 5: records that failed to save never get written to again ==");
  check("isLocalId spots the fallback id", app.isLocalId("local1756282800000abcd") === true);
  check("isLocalId leaves a real uuid alone", app.isLocalId(CHAT) === false);
  check("isLocalId survives a non-string id", app.isLocalId(12345) === false);

  sb.reset();
  app.state.activeChatId = null;
  app.addMsg({ id: "local999", messages: [] }, "user", "hello");
  check("a message in a chat that never reached the database is not sent on its own",
    sb.chains.length === 0, JSON.stringify(sb.chains.map(c => c.table)));

  sb.reset();
  const realChat = { id: CHAT, messages: [] };
  app.addMsg(realChat, "user", "hello");
  check("...but a message in a real chat is written once, with its text",
    sb.chains.length === 1 && sb.chains[0].table === "messages" && sb.chains[0].ops[0].args[0].text === "hello");
  check("...and it is on screen immediately either way, saved or not", realChat.messages.length === 1);

  /* ============================================================
     6. Editing a captured profile (ROADMAP item 8)
     ------------------------------------------------------------
     applyProfileEdit() is split from the form the same way
     buildLogisticsPayload() is split from the fetch, so what it decides can be
     tested without a browser: which Supabase writes it makes, which it
     deliberately does NOT make, and what it does to a ranking and to an
     outreach draft that were produced from the old numbers.

     The line to keep in mind (see ROADMAP, 2026-08-27): this file drives a
     stand-in DOM, so it can prove what the code does with the data and
     nothing at all about what any of it looks like.
     ============================================================ */
  console.log("== Test 6: editing a captured profile ==");

  const BASE = {
    farmer_name: "Marco", village: "Sant'Elia Fiumerapido", distance_km_from_cassino: 6,
    organic: "no", available_months: [6, 7, 8, 9, 10],
    products: [{ name: "pomodori", category: "pomodori", kg_per_week: 80 }]
  };
  const copy = o => JSON.parse(JSON.stringify(o));
  const withEdit = patch => Object.assign(copy(BASE), patch);
  const tick = () => new Promise(r => setTimeout(r, 15));   // let the awaited writes land
  const tables = () => sb.chains.map(c => c.table);
  const chainFor = t => sb.chains.filter(c => c.table === t);
  const opArgs = (chain, op) => (chain.ops.find(o => o.op === op) || { args: [] }).args;

  function editSetup(opts) {
    opts = opts || {};
    sb.reset();
    sb.router = () => ({ data: null, error: null });
    app.state.farmerId = UID;
    app.state.farmerProfile = { id: UID, farmer_name: "Marco" };
    app.state.activeChatId = null;
    app.state.clients = opts.clients || [];
    const chat = {
      id: opts.chatId || CHAT, title: "Marco", phase: "done", pct: 100, messages: [],
      profile: copy(opts.profile || BASE), candidates: opts.candidates || [], recs: opts.recs || null, ts: 0
    };
    app.state.chats = [chat];
    return chat;
  }

  /* --- the no-op. Opening this form and pressing Save without touching
     anything must not rewrite a single row: saveProducts is a delete followed
     by an insert, so a pointless "save" is a real window in which a chat can
     lose its products to a dropped connection. --- */
  let chat = editSetup({});
  let r = app.applyProfileEdit(chat, copy(BASE));
  await tick();
  check("saving an untouched profile writes nothing at all",
    r.ok && r.changed.length === 0 && r.saved === false && sb.chains.length === 0, JSON.stringify(tables()));

  chat = editSetup({});
  r = app.applyProfileEdit(chat, withEdit({
    distance_km_from_cassino: "6", products: [{ name: "pomodori", category: "pomodori", kg_per_week: "80" }]
  }));
  await tick();
  check("...still nothing when the same numbers arrive as the strings Postgres hands back",
    r.changed.length === 0 && sb.chains.length === 0, JSON.stringify(r.changed));

  /* --- what counts as "changed" at all. Postgres hands numeric columns back
     as strings, and "6.0" and 6 are the same distance; so are the same months
     listed in another order. Compared raw, simply opening this form and
     pressing Save would rewrite every row. --- */
  check("the same months in a different order are not a change",
    app.changedProfileFields({ available_months: [10, 6, 7, 8, 9] }, { available_months: [6, 7, 8, 9, 10] }).length === 0);
  check("a distance that came back from Postgres as \"6.0\" is not a change from 6",
    app.changedProfileFields({ distance_km_from_cassino: "6.0" }, { distance_km_from_cassino: 6 }).length === 0);
  check("a product name with a stray space, and a quantity as a string, are not a change",
    app.changedProfileFields(
      { products: [{ name: "pomodori ", category: "pomodori", kg_per_week: "80" }] },
      { products: [{ name: "pomodori", category: "pomodori", kg_per_week: 80 }] }).length === 0);
  check("...but a real correction still is",
    eq(app.changedProfileFields(
      { products: [{ name: "pomodori", category: "pomodori", kg_per_week: 80 }] },
      { products: [{ name: "pomodori", category: "pomodori", kg_per_week: 120 }] }), ["products"]));
  check("...and so is a village",
    eq(app.changedProfileFields({ village: "Terelle" }, { village: "Cervaro" }), ["village"]));

  /* --- a village correction is the cheapest possible edit and must stay that
     way: one row updated, the product list left where it is. --- */
  chat = editSetup({});
  r = app.applyProfileEdit(chat, withEdit({ village: "Cervaro" }));
  await tick();
  check("correcting only the village updates the chat row and does not touch the products",
    eq(tables(), ["chats"]), JSON.stringify(tables()));
  check("...with the new village in the patch, alongside the recomputed title",
    opArgs(chainFor("chats")[0], "update")[0].village === "Cervaro" && "title" in opArgs(chainFor("chats")[0], "update")[0],
    JSON.stringify(opArgs(chainFor("chats")[0], "update")[0]));
  check("...and it is not treated as a re-score, because distance is what the engine reads",
    r.rescored === false && eq(r.changed, ["village"]));

  /* --- a quantity correction: chat row, then the products replaced. --- */
  chat = editSetup({ candidates: [] });
  r = app.applyProfileEdit(chat, withEdit({ products: [{ name: "pomodori", category: "pomodori", kg_per_week: 120 }] }));
  await tick();
  check("correcting a quantity updates the chat row and replaces the product list",
    eq(tables(), ["chats", "products", "products"]) && eq(chainFor("products").map(c => c.ops[0].op), ["delete", "insert"]),
    JSON.stringify(tables()));
  check("...and the inserted row carries the corrected quantity, not the old one",
    opArgs(chainFor("products")[1], "insert")[0][0].kg_per_week === 120,
    JSON.stringify(opArgs(chainFor("products")[1], "insert")[0]));
  check("...and the ranking is worked out again from the new numbers",
    r.rescored === true && chat.candidates.length > 0 && typeof chat.candidates[0].score === "number");

  /* --- what the Guardian refuses never reaches the database, and never
     touches the profile already on screen either. --- */
  chat = editSetup({});
  r = app.applyProfileEdit(chat, withEdit({ products: [] }));
  await tick();
  check("a profile with every product removed is refused, and nothing is written",
    !r.ok && /no products/i.test(r.errors.join(" ")) && sb.chains.length === 0, JSON.stringify(r.errors));
  check("...and the profile the farmer can still see is the one that was there before",
    chat.profile.products.length === 1 && chat.profile.products[0].kg_per_week === 80);

  chat = editSetup({});
  r = app.applyProfileEdit(chat, withEdit({ products: [{ name: "", category: "verdure", kg_per_week: 10 }] }));
  check("a product with no name is asked for by number, not by the Guardian's \"product 0\"",
    !r.ok && r.errors[0] === "Product 1 still needs a name.", JSON.stringify(r.errors));
  r = app.applyProfileEdit(chat, withEdit({ products: [{ name: "pomodori", category: "pomodori", kg_per_week: 0 }] }));
  check("a product with no quantity is asked for by name",
    !r.ok && r.errors[0] === "How many kg per week of pomodori?", JSON.stringify(r.errors));

  /* --- where the Guardian changes a number rather than refusing it, the
     changed number is what gets stored, and the farmer is told. --- */
  chat = editSetup({});
  r = app.applyProfileEdit(chat, withEdit({ products: [{ name: "pomodori", category: "pomodori", kg_per_week: 9000 }] }));
  await tick();
  check("a quantity too large for a small farm is capped, and the cap is what is saved",
    r.ok && chat.profile.products[0].kg_per_week === 5000 &&
    opArgs(chainFor("products")[1], "insert")[0][0].kg_per_week === 5000);
  check("...and the farmer is told, rather than finding a different number later",
    r.warnings.length === 1 && /5000/.test(r.warnings[0]), JSON.stringify(r.warnings));

  chat = editSetup({});
  r = app.applyProfileEdit(chat, withEdit({ products: [{ name: "qualcosa", category: "fantasia", kg_per_week: 10 }] }));
  await tick();
  check("a category the engine doesn't know is mapped before it is stored, never after",
    opArgs(chainFor("products")[1], "insert")[0][0].category === "verdure" && r.warnings.length === 1);

  /* --- a blank distance box. Number(null) is 0, so a null here would store a
     farm sitting in the middle of Cassino and quietly improve its score. --- */
  chat = editSetup({});
  const noDist = copy(BASE); delete noDist.distance_km_from_cassino;
  r = app.applyProfileEdit(chat, noDist);
  await tick();
  check("a distance left blank becomes the Guardian's stated assumption, not 0 km",
    chat.profile.distance_km_from_cassino === 8 && /distance/i.test(r.warnings.join(" ")), JSON.stringify(r.warnings));

  /* --- the account's display name is per-farmer; the chat's is per-conversation. --- */
  chat = editSetup({});
  r = app.applyProfileEdit(chat, withEdit({ farmer_name: "Marco Rossi" }));
  await tick();
  check("changing the name writes it to the account as well as to the chat",
    tables().indexOf("farmers") !== -1 && eq(opArgs(chainFor("farmers")[0], "update"), [{ farmer_name: "Marco Rossi" }]),
    JSON.stringify(tables()));
  check("...and the copy the logistics form reads is updated in the same breath",
    app.state.farmerProfile.farmer_name === "Marco Rossi");
  check("...but a name is not something the engine scores on, so nothing is re-ranked",
    r.rescored === false);

  chat = editSetup({});
  r = app.applyProfileEdit(chat, withEdit({ farmer_name: "" }));
  await tick();
  check("clearing the name in one conversation does not wipe it from the account",
    tables().indexOf("farmers") === -1 && app.state.farmerProfile.farmer_name === "Marco", JSON.stringify(tables()));
  check("...it only clears it on that chat", opArgs(chainFor("chats")[0], "update")[0].farmer_name === null);

  /* --- the outreach draft is the one thing here a real buyer ever reads. --- */
  const clients = [
    { id: "o1", chatId: CHAT, status: "draft", message_it: "…80 kg…" },
    { id: "o2", chatId: CHAT, status: "sent", message_it: "…80 kg…" },
    { id: "o3", chatId: "another-chat", status: "draft", message_it: "…" }
  ];
  chat = editSetup({ clients: clients });
  r = app.applyProfileEdit(chat, withEdit({ products: [{ name: "pomodori", category: "pomodori", kg_per_week: 120 }] }));
  await tick();
  check("an unsent draft from this chat is flagged as written before the correction",
    clients[0].profileEdited === true && r.staleDrafts === 1);
  check("...a draft already sent is not — the farmer cannot unsend it, so a warning would only confuse",
    !clients[1].profileEdited);
  check("...and another conversation's draft is left alone", !clients[2].profileEdited);
  check("...and the draft's words are never rewritten behind the farmer's back",
    clients[0].message_it === "…80 kg…");

  /* --- Brain 2's prose vs Brain 2's scores. --- */
  const recs = { ranked: [{ buyer_id: "b1", pitch_reason: "buys 80 kg of tomatoes a week" }], creative_suggestions: ["passata"], outreach: null };
  chat = editSetup({ recs: copy(recs) });
  app.applyProfileEdit(chat, withEdit({ products: [{ name: "pomodori", category: "pomodori", kg_per_week: 120 }] }));
  await tick();
  check("written notes composed from the old figures are marked stale, not deleted",
    chat.recsStale === true && chat.recs.ranked.length === 1);
  chat = editSetup({ recs: copy(recs) });
  app.applyProfileEdit(chat, withEdit({ farmer_name: "Marco Rossi" }));
  await tick();
  check("...but a change the notes don't depend on leaves them alone", !chat.recsStale);

  /* --- a chat that never reached the database. --- */
  chat = editSetup({ chatId: "local1756282800000abcd" });
  r = app.applyProfileEdit(chat, withEdit({ farmer_name: "Nuovo", products: [{ name: "pomodori", category: "pomodori", kg_per_week: 120 }] }));
  await tick();
  check("a chat with a client-only id is edited on screen but never written to Postgres",
    eq(tables(), ["farmers"]) && chat.profile.products[0].kg_per_week === 120, JSON.stringify(tables()));

  chat = editSetup({});
  r = app.applyProfileEdit(chat, withEdit({ available_months: [1, 2] }));
  await tick();
  const patch = opArgs(chainFor("chats")[0], "update")[0];
  check("the chat patch carries every profile column the capture path writes",
    eq(patch.available_months, [1, 2]) && patch.organic === "no" && patch.village === BASE.village &&
    patch.distance_km_from_cassino === 6 && patch.farmer_name === "Marco",
    JSON.stringify(patch));
  check("...and changing the months counts as a re-score, because seasonality is scored",
    r.rescored === true && eq(r.changed, ["available_months"]));

  /* ------------------------------------------------------------
     The form itself. The stand-in DOM answers null for any id it hasn't been
     given, so the fields are registered here by hand — which is the honest
     limit of this: it tests what the form READS, never how it looks.
     ------------------------------------------------------------ */
  console.log("== Test 6b: what the form reads back ==");
  ["profileSheet", "profileBody", "profileSubtitle", "profileSaveBtn", "pfProducts", "pfMonths", "pfErr", "whoName"]
    .forEach(id => { els[id] = fakeEl(id); });
  const formFields = ["pfName", "pfVillage", "pfDist", "pfOrganic", "pfPName0", "pfPCat0", "pfPKg0"];
  function fillForm(values) {
    formFields.forEach(id => { els[id] = els[id] || fakeEl(id); els[id].value = ""; });
    Object.keys(values).forEach(id => { els[id] = els[id] || fakeEl(id); els[id].value = values[id]; });
  }

  chat = editSetup({});
  app.openProfileEdit(CHAT);
  check("opening the form marks the sheet open", els.profileSheet.has("open"));
  fillForm({ pfName: "Marco", pfVillage: "Sant'Elia Fiumerapido", pfDist: "", pfOrganic: "no",
    pfPName0: "pomodori", pfPCat0: "pomodori", pfPKg0: "80" });
  let raw = app.readProfileForm();
  check("a blank distance box is left OFF the profile entirely — null would read as 0 km",
    !("distance_km_from_cassino" in raw), JSON.stringify(raw));
  check("the months come from the chips, in order", eq(raw.available_months, [6, 7, 8, 9, 10]));
  els.pfDist.value = "12";
  check("a distance that was typed comes through as a number", app.readProfileForm().distance_km_from_cassino === 12);

  app.openProfileEdit(CHAT);
  fillForm({ pfName: "Marco", pfVillage: "Sant'Elia Fiumerapido", pfDist: "6", pfOrganic: "no",
    pfPName0: "pomodorini", pfPCat0: "pomodori", pfPKg0: "80" });
  app.addProfileProduct();
  raw = app.readProfileForm();
  check("adding a second product keeps what was already typed into the first",
    raw.products.length === 2 && raw.products[0].name === "pomodorini", JSON.stringify(raw.products));
  app.removeProfileProduct(0);
  check("...and removing a row removes that row", app.readProfileForm().products.length === 1);

  app.openProfileEdit(CHAT);
  app.toggleProfileMonth(6);
  app.toggleProfileMonth(1);
  check("a month chip switches its own month off and on, and nothing else",
    eq(app.readProfileForm().available_months, [1, 7, 8, 9, 10]), JSON.stringify(app.readProfileForm().available_months));

  /* --- and the save button, all the way through to the writes --- */
  console.log("== Test 6c: the Save button, end to end ==");
  chat = editSetup({ clients: [{ id: "o1", chatId: CHAT, status: "draft", message_it: "…" }] });
  app.openProfileEdit(CHAT);
  fillForm({ pfName: "Marco", pfVillage: "Cervaro", pfDist: "6", pfOrganic: "no",
    pfPName0: "pomodori", pfPCat0: "pomodori", pfPKg0: "120" });
  sb.reset(); sb.router = () => ({ data: null, error: null });
  els.toast.textContent = "";
  app.saveProfileEdit();
  await tick();
  check("Save writes the chat row and the products, and closes the sheet",
    eq(tables(), ["chats", "products", "products"]) && !els.profileSheet.has("open"), JSON.stringify(tables()));
  check("...and says in plain words what changed and what it means for the draft",
    /village/.test(els.toast.textContent) && /products/.test(els.toast.textContent) &&
    /re-scored/.test(els.toast.textContent) && /before sending/.test(els.toast.textContent), els.toast.textContent);

  /* When the Guardian changed one of the farmer's own numbers, the sheet stays
     open with the adjustment written above the fields — a toast that fades
     would be the one place this app hides a correction it made. */
  chat = editSetup({});
  app.openProfileEdit(CHAT);
  fillForm({ pfName: "Marco", pfVillage: "Sant'Elia Fiumerapido", pfDist: "6", pfOrganic: "no",
    pfPName0: "pomodori", pfPCat0: "pomodori", pfPKg0: "9000" });
  app.saveProfileEdit();
  await tick();
  check("an adjusted number keeps the sheet open instead of fading away in a toast",
    els.profileSheet.has("open") && els.pfErr.has("pf-notice") && /^Saved\./.test(els.pfErr.textContent),
    els.pfErr.textContent);
  check("...and what was stored is the adjusted number", chat.profile.products[0].kg_per_week === 5000);

  chat = editSetup({});
  app.openProfileEdit(CHAT);
  fillForm({ pfName: "Marco", pfVillage: "Sant'Elia Fiumerapido", pfDist: "6", pfOrganic: "no",
    pfPName0: "", pfPCat0: "pomodori", pfPKg0: "80" });
  sb.reset();
  app.saveProfileEdit();
  await tick();
  check("a form that can't be saved says so in the panel and writes nothing",
    els.profileSheet.has("open") && !els.pfErr.has("pf-notice") &&
    els.pfErr.textContent === "Product 1 still needs a name." && sb.chains.length === 0,
    els.pfErr.textContent);

  /* ============================================================
     7. The Admin funnel (queue item 9)
     ------------------------------------------------------------
     Pure arithmetic over three admin reads — no writes, no schema.
     The reason it is worth this many tests is that a funnel is a
     picture people trust without checking: every number is a
     comparison against another number, so a single miscount doesn't
     look wrong, it looks like a finding. The two failure modes that
     matter are (a) counting a different unit at different stages,
     which invents conversion rates out of nothing, and (b) a stage
     that isn't a subset of the one above it, which makes "how many
     dropped out" meaningless or negative.
     ============================================================ */
  console.log("== Test 7: the Admin funnel counts conversations, and only conversations ==");

  const chat_ = (id, phase) => ({ id, phase, farmer_id: "f1", title: "t" + id, pct: 0, created_at: "2026-08-01T00:00:00Z" });
  const out_ = (id, chatId, status) => ({ id, chat_id: chatId, status, farmer_id: "f1", buyer_id: "b1" });
  const stageCount = (f, key) => f.stages.find(s => s.key === key).count;

  {
    // 6 conversations: 1 never got past the greeting, 1 is mid-interview,
    // 2 finished the interview but produced no draft, 2 have drafts and one
    // of those two has been sent. That is 6 → 4 → 2 → 1.
    const chats = [chat_("c1", "interview"), chat_("c2", "interview"), chat_("c3", "matching"),
                   chat_("c4", "done"), chat_("c5", "done"), chat_("c6", "done")];
    const outreach = [out_("o1", "c5", "draft"), out_("o2", "c5", "draft"), out_("o3", "c5", "draft"),
                      out_("o4", "c6", "sent"), out_("o5", "c6", "draft")];
    const f = app.adminFunnel(chats, outreach);

    check("stage 1 is every conversation started", stageCount(f, "started") === 6, stageCount(f, "started"));
    check("stage 2 is the conversations whose interview finished", stageCount(f, "profile") === 4, stageCount(f, "profile"));
    check("stage 3 counts conversations with a draft, not drafts — 5 drafts across 2 chats is 2",
      stageCount(f, "drafted") === 2, stageCount(f, "drafted"));
    check("stage 4 counts conversations with a sent draft — 1 sent draft in 1 chat is 1",
      stageCount(f, "sent") === 1, stageCount(f, "sent"));

    const counts = f.stages.map(s => s.count);
    check("every stage is smaller than or equal to the one above it",
      counts.every((n, i) => i === 0 || n <= counts[i - 1]), JSON.stringify(counts));
    check("each stage is a genuine SUBSET of the one above it, not just a smaller number",
      [...f.sets.sent].every(id => f.sets.drafted.has(id)) &&
      [...f.sets.drafted].every(id => f.sets.profile.has(id)) &&
      [...f.sets.profile].every(id => f.sets.started.has(id)));

    check("share-of-start is measured against stage 1", eq(f.stages.map(s => s.pctOfStart), [100, 67, 33, 17]),
      JSON.stringify(f.stages.map(s => s.pctOfStart)));
    check("drop-off is the gap to the stage above, and the first stage has none",
      eq(f.stages.map(s => s.dropped), [null, 2, 2, 1]), JSON.stringify(f.stages.map(s => s.dropped)));
    check("carried-on % is measured against the stage above, not against stage 1",
      eq(f.stages.map(s => s.fromPrev), [null, 67, 50, 50]), JSON.stringify(f.stages.map(s => s.fromPrev)));

    check("the raw draft totals are reported separately, in their own unit",
      f.drafts === 5 && f.draftsSent === 1, f.drafts + "/" + f.draftsSent);
    check("no orphan drafts when every draft points at a real conversation", f.orphanDrafts === 0);
  }

  {
    // The phase column is a fire-and-forget write. If it fails while the
    // outreach insert lands, the chat still plainly finished its interview —
    // the draft was written from the captured profile.
    const chats = [chat_("c1", "interview")];
    const f = app.adminFunnel(chats, [out_("o1", "c1", "sent")]);
    check("a conversation whose phase write failed is still counted at every stage it reached",
      eq(f.stages.map(s => s.count), [1, 1, 1, 1]), JSON.stringify(f.stages.map(s => s.count)));
  }

  {
    // The old Admin table filtered on village/organic/farmer_name. A farmer
    // who never gave a name or a village would finish the interview and not
    // appear anywhere. phase is the signal the app itself sets.
    const chats = [{ ...chat_("c1", "matching"), village: null, organic: null, farmer_name: null }];
    const f = app.adminFunnel(chats, []);
    check("a finished interview counts even with no name, village or organic status on the row",
      stageCount(f, "profile") === 1);
  }

  {
    const f = app.adminFunnel([], []);
    check("an empty database gives zeros, not NaN or a division by zero",
      f.stages.every(s => s.count === 0 && s.pctOfStart === 0), JSON.stringify(f.stages.map(s => s.pctOfStart)));
    check("with nothing above it, a stage reports no carried-on percentage rather than 0%",
      f.stages.slice(1).every(s => s.fromPrev === null));
  }

  {
    const chats = [chat_("c1", "done")];
    const outreach = [out_("o1", "c1", "sent"), out_("o2", "ghost-chat", "sent"), out_("o3", null, "draft")];
    const f = app.adminFunnel(chats, outreach);
    check("a draft pointing at no conversation is counted and surfaced, never folded into a stage",
      f.orphanDrafts === 2 && stageCount(f, "sent") === 1, f.orphanDrafts + "/" + stageCount(f, "sent"));
    check("orphan drafts still count in the raw draft total, which is a count of drafts",
      f.drafts === 3 && f.draftsSent === 2, f.drafts + "/" + f.draftsSent);
  }

  {
    /* createOutreach never sets `status` — a fresh draft gets whatever the
       column defaults to, and a row written before that default existed can
       hold null. "sent" has to be tested for by name, never inferred as
       "not a draft", or an unsent draft lands in the bottom stage and the
       funnel reports outreach that no buyer has ever seen. */
    const chats = [chat_("c1", "done"), chat_("c2", "done")];
    const outreach = [out_("o1", "c1", null), { id: "o2", chat_id: "c2", farmer_id: "f1", buyer_id: "b1" }];
    const f = app.adminFunnel(chats, outreach);
    check("a draft whose status is null or missing is NOT counted as sent",
      stageCount(f, "sent") === 0 && f.draftsSent === 0,
      stageCount(f, "sent") + "/" + f.draftsSent);
    check("...but it still counts as a draft that was written",
      stageCount(f, "drafted") === 2 && f.drafts === 2);
  }

  {
    // A chat with several sent drafts is one conversation, not several.
    const f = app.adminFunnel([chat_("c1", "done")],
      [out_("o1", "c1", "sent"), out_("o2", "c1", "sent"), out_("o3", "c1", "sent")]);
    check("three sent drafts in one conversation is one conversation at the bottom of the funnel",
      stageCount(f, "sent") === 1 && f.draftsSent === 3);
    check("...and the funnel can never be wider at the bottom than at the top",
      stageCount(f, "sent") <= stageCount(f, "started"));
  }

  {
    const f = app.adminFunnel(null, null);
    check("null arrays (a failed read handed straight through) don't throw",
      f.stages.every(s => s.count === 0) && f.drafts === 0);
  }

  // adminStages() is a function now (its labels are translated and so have to
  // be read at render time); ADMIN_STAGE_KEYS is the order it walks.
  const stagesNow = app.adminStages();
  check("the funnel draws exactly the stages it declares, in order",
    eq(stagesNow.map(s => s.key), ["started", "profile", "drafted", "sent"]),
    JSON.stringify(stagesNow.map(s => s.key)));
  check("the key list and the stage builder cannot drift apart",
    eq(app.ADMIN_STAGE_KEYS, stagesNow.map(s => s.key)));
  // Not `instanceof Set`: the app runs in its own vm context with its own
  // intrinsics, so its Set is a different constructor from this file's.
  const isSet = x => Object.prototype.toString.call(x) === "[object Set]";
  check("every declared stage has a set behind it — a stage with no set would render blank",
    stagesNow.every(s => isSet(app.adminStageSets([], [])[s.key])));
  check("every declared stage has a label and a hint",
    stagesNow.every(s => s.label && s.hint));

  console.log("== Test 7b: the funnel filters the table, and the reads stay read-only ==");
  {
    app.state.adminStage = "started";
    app.setAdminStage("sent");
    check("clicking a stage selects it", app.state.adminStage === "sent");
    app.setAdminStage("sent");
    check("clicking the selected stage again clears the filter rather than doing nothing",
      app.state.adminStage === "started");
    app.setAdminStage("profile");
    app.setAdminStage("drafted");
    check("clicking a different stage switches to it", app.state.adminStage === "drafted");
    app.setAdminStage("started");
  }
  {
    /* The Admin elements are registered only for this block. Everywhere else
       in this file an unknown id answers null on purpose, which is what keeps
       the rendering code out of the way while the data layer runs for real —
       leaving them registered would quietly change every earlier test.
       Nothing here asserts anything visual: that needs the real stylesheet and
       a real cascade, which this fake DOM does not have. */
    ["adminScreen", "adminFunnel", "adminAside", "adminTableTitle", "adminClearFilter", "adminBody", "adminEmpty"]
      .forEach(id => els[id] = fakeEl(id));

    const chats = [chat_("c1", "interview"), chat_("c2", "matching"), chat_("c3", "done")];
    const outreach = [out_("o1", "c3", "sent")];
    app.state.isAdmin = true;
    app.state.adminStage = "started";
    sb.reset();
    sb.router = ch => ({ data: ch.table === "chats" ? chats : ch.table === "outreach" ? outreach : [{ id: "f1", farmer_name: "Marco" }], error: null });

    await app.renderAdmin();
    check("the admin overview issues exactly its three reads, and none of them writes",
      sb.chains.length === 3 &&
      eq(sb.chains.map(c => c.table).sort(), ["chats", "farmers", "outreach"]) &&
      sb.chains.every(c => c.ops.every(o => !["insert", "update", "delete"].includes(o.op))),
      JSON.stringify(sb.chains.map(c => c.table + ":" + c.ops.map(o => o.op).join(","))));

    check("the funnel renders one clickable stage per declared stage",
      (els.adminFunnel.innerHTML.match(/class="fn-stage/g) || []).length === app.ADMIN_STAGE_KEYS.length,
      els.adminFunnel.innerHTML.slice(0, 120));
    check("unfiltered, the table lists every conversation — including the ones that stopped early",
      els.adminTableTitle.textContent === "Every conversation (3)", els.adminTableTitle.textContent);
    check("...and the 'show all' escape hatch is hidden while nothing is filtered",
      els.adminClearFilter.style.display === "none", els.adminClearFilter.style.display);

    sb.reset();
    app.setAdminStage("sent");
    check("re-filtering re-uses what was already fetched instead of querying Supabase again",
      sb.chains.length === 0, sb.chains.length);
    check("filtering to a stage narrows the table to that stage's conversations",
      els.adminTableTitle.textContent === "Outreach sent (1)", els.adminTableTitle.textContent);
    check("...and offers the way back out", els.adminClearFilter.style.display === "inline-flex");
    check("the selected stage is the one marked pressed, and only it",
      (els.adminFunnel.innerHTML.match(/aria-pressed="true"/g) || []).length === 1 &&
      /aria-pressed="true"[^>]*onclick="setAdminStage\('sent'\)"/.test(els.adminFunnel.innerHTML.replace(/\s+/g, " ")));

    app.setAdminStage("profile");
    check("a stage nobody has reached says so instead of leaving the last stage's rows on screen",
      els.adminTableTitle.textContent === "Farm profile captured (2)", els.adminTableTitle.textContent);

    // Chats exist, but none of them reached this stage — a different sentence
    // from "no farmer activity yet", which would be untrue.
    sb.reset();
    sb.router = ch => ({ data: ch.table === "chats" ? [chat_("c1", "interview")] : [], error: null });
    await app.renderAdmin();
    app.setAdminStage("sent");
    check("with activity but nothing at this stage, the empty line says that and not 'no activity'",
      els.adminEmpty.textContent === "No conversation has reached this stage yet." &&
      els.adminEmpty.style.display === "block", els.adminEmpty.textContent);

    sb.reset();
    sb.router = () => ({ data: [], error: null });
    await app.renderAdmin();
    check("with no activity at all it says that instead",
      els.adminEmpty.textContent === "No farmer activity yet.", els.adminEmpty.textContent);

    app.setAdminStage("started");
    app.state.isAdmin = false;
    sb.router = null;
    ["adminScreen", "adminFunnel", "adminAside", "adminTableTitle", "adminClearFilter", "adminBody", "adminEmpty"]
      .forEach(id => delete els[id]);
  }


  /* ============================================================
     8. The IT / EN language layer
     ============================================================ */
  console.log("== Test 8: the dictionary itself ==");
  {
    const en = app.STRINGS.en, it = app.STRINGS.it;
    const enKeys = Object.keys(en), itKeys = Object.keys(it);
    check("both languages define exactly the same keys",
      eq(enKeys.slice().sort(), itKeys.slice().sort()),
      JSON.stringify({ onlyEn: enKeys.filter(k => !(k in it)), onlyIt: itKeys.filter(k => !(k in en)) }));
    check("no string is empty in either language",
      enKeys.every(k => String(en[k]).trim()) && itKeys.every(k => String(it[k]).trim()));
    /* A translator dropping a {placeholder} is the quiet one: the sentence
       still reads, and the number it was about simply isn't there. */
    const holders = str => (String(str).match(/\{\w+\}/g) || []).slice().sort();
    const lostVars = enKeys.filter(k => !eq(holders(en[k]), holders(it[k])));
    check("every {placeholder} in an English string survives into the Italian one", !lostVars.length,
      JSON.stringify(lostVars));
    /* The two entries that go through innerHTML are the only ones allowed to
       carry markup; anything else is written with textContent, where a tag or
       an entity would be printed literally. */
    const htmlOk = ["mode.keyHint", "mode.brains", "admin.dropped"];
    const withMarkup = enKeys.filter(k => /<[a-z/]|&\w+;/i.test(en[k] + it[k]) && htmlOk.indexOf(k) === -1);
    check("no textContent string smuggles in a tag or an HTML entity", !withMarkup.length,
      JSON.stringify(withMarkup));
    check("the two languages are actually different translations, not a copy",
      enKeys.filter(k => en[k] !== it[k]).length > enKeys.length * 0.7);
  }

  console.log("== Test 8b: T() — lookup, fallback and interpolation ==");
  {
    check("a known key resolves", app.T("nav.clients") === "Clients");
    check("an unknown key returns the key itself, so a typo is visible rather than blank",
      app.T("nope.not.here") === "nope.not.here");
    check("{placeholders} are filled in", app.T("dash.seeAllN", { n: 7 }) === "See all (7)");
    check("a placeholder with no value is left alone rather than printed as 'undefined'",
      app.T("dash.seeAllN", {}) === "See all ({n})");
    check("a value of 0 is substituted, not treated as missing",
      app.T("top.draftsReady", { n: 0 }).indexOf("0") !== -1);
  }

  console.log("== Test 8c: switching language ==");
  {
    check("the suite starts in English, from the navigator", app.currentLang() === "en");
    check("an unknown language code is refused", app.setLangValue("de") === false && app.currentLang() === "en");
    app.setLang("it");
    check("switching works", app.currentLang() === "it");
    check("the choice is remembered", storage.getItem("fasto_lang") === "it");
    check("switching to the language already in use is a no-op, so nothing re-renders for free",
      app.setLangValue("it") === false);

    /* THE ONE THAT MATTERS. Each of these used to be a table of English words
       built when the file was evaluated. Frozen at load, they would still be
       returning English here, and nothing else in the app would look wrong. */
    check("phase labels are read at render time, not frozen at load",
      app.phaseLabel("done") === app.STRINGS.it["phase.done"], app.phaseLabel("done"));
    check("category labels are read at render time", app.catLabel("pomodori") === "pomodori");
    check("month names are read at render time", app.monthNames()[0] === "gennaio");
    check("funnel stage labels are read at render time",
      app.adminStages()[0].label === app.STRINGS.it["admin.stage.started"]);
    check("profile field labels are read at render time",
      app.profileFieldLabel("village") === app.STRINGS.it["profile.fld.village"]);
    check("the offline demo script is read at render time",
      app.offlineScript()[0] === app.STRINGS.it["offline.q1"]);
    check("the list conjunction follows the language too",
      app.humanList(["a", "b"]) === "a e b", app.humanList(["a", "b"]));
    check("dates follow the language", app.relDate(Date.now()) === "Oggi");

    /* offlineStep is an index into this script AND is persisted as a message
       count, so the two languages have to be the same length or a farmer who
       switches mid-demo lands on a different question. */
    check("both offline scripts have the same number of lines",
      app.offlineScript().length === app.OFFLINE_SCRIPT_KEYS.length &&
      app.OFFLINE_SCRIPT_KEYS.every(k => app.STRINGS.en[k] && app.STRINGS.it[k]));

    check("the greeting follows the language",
      (app.state.offline = true, app.greetingText() === app.STRINGS.it["assist.greetOffline"]));
    check("a chat with no profile is titled in the current language",
      app.chatTitle({ messages: [] }) === app.STRINGS.it["assist.newChatTitle"]);
  }

  console.log("== Test 8d: a language is a display choice — it must never change stored data ==");
  {
    /* In Italian the category dropdown says "pomodori" and in English it says
       "tomatoes", but the value written to the products table is the key both
       the engine and the database agree on. Getting this backwards would
       store "tomatoes", which scores against nothing. */
    const optionsIt = app.lgField("x", "Category", "verdure", { options: [["verdure", app.catLabel("verdure")], ["pomodori", app.catLabel("pomodori")]] });
    check("the category select's VALUES are the stored keys, in Italian",
      /value="verdure"/.test(optionsIt) && /value="pomodori"/.test(optionsIt) && />pomodori</.test(optionsIt));
    app.setLang("en");
    const optionsEn = app.lgField("x", "Category", "verdure", { options: [["verdure", app.catLabel("verdure")], ["pomodori", app.catLabel("pomodori")]] });
    check("...and exactly the same values in English, with only the label changed",
      /value="verdure"/.test(optionsEn) && /value="pomodori"/.test(optionsEn) && />tomatoes</.test(optionsEn));

    /* An edit saved in one language and an identical edit saved in the other
       have to produce byte-identical writes. */
    const raw = { farmer_name: "Marco", village: "Terelle", organic: "no", available_months: [10, 11],
      products: [{ name: "castagne", category: "castagne", kg_per_week: 150 }] };
    const shot = () => {
      const chat = { id: "local-lang", title: "t", phase: "done", profile: null, messages: [], candidates: [], recs: null };
      app.applyProfileEdit(chat, JSON.parse(JSON.stringify(raw)));
      return JSON.stringify(chat.profile);
    };
    const savedEn = shot();
    app.setLang("it");
    const savedIt = shot();
    check("the same edit stores exactly the same profile in either language", savedEn === savedIt,
      savedEn + " vs " + savedIt);
    check("...and the stored category is still the Italian key, not a label",
      JSON.parse(savedIt).products[0].category === "castagne");
  }

  console.log("== Test 8e: the logistics email keeps its English field names ==");
  {
    /* The partner receives requests from every farmer on the platform. Field
       names that changed language per farmer would make one inbox unreadable,
       so only the VALUES follow the farmer — plus a line naming their language
       so the partner knows how to reply. */
    const form = {};
    ["lgProduct", "lgQty", "lgFCompany", "lgFContact", "lgFPhone", "lgFAddress",
     "lgBCompany", "lgBContact", "lgBPhone", "lgBAddress", "lgMonths", "lgFirstPickup", "lgFVat", "lgBVat", "lgNotes"]
      .forEach(id => { els[id] = fakeEl(id); els[id].value = "x"; form[id] = els[id]; });
    els.lgConfirmF = fakeEl("lgConfirmF"); els.lgConfirmF.checked = true;
    els.lgConfirmB = fakeEl("lgConfirmB"); els.lgConfirmB.checked = true;

    app.setLang("it");
    const builtIt = app.buildLogisticsPayload();
    app.setLang("en");
    const builtEn = app.buildLogisticsPayload();
    check("the payload is valid in both languages", builtIt.ok && builtEn.ok, JSON.stringify(builtIt.message || ""));
    check("the field names are identical whatever the app is set to",
      eq(Object.keys(builtIt.payload), Object.keys(builtEn.payload)));
    check("...and they are the English ones",
      "Pickup address" in builtEn.payload && "Delivery phone" in builtEn.payload);
    check("the farmer's language is recorded so the partner knows how to answer",
      builtIt.payload["Farmer's app language"] === "Italiano" &&
      builtEn.payload["Farmer's app language"] === "English");

    /* Validation messages, on the other hand, are read by the farmer. */
    els.lgProduct.value = "";
    app.setLang("it");
    const missingIt = app.buildLogisticsPayload();
    check("a validation message does follow the farmer's language",
      !missingIt.ok && missingIt.message.indexOf(app.STRINGS.it["logi.needProduct"]) !== -1, missingIt.message);

    ["lgProduct", "lgQty", "lgFCompany", "lgFContact", "lgFPhone", "lgFAddress", "lgBCompany",
     "lgBContact", "lgBPhone", "lgBAddress", "lgMonths", "lgFirstPickup", "lgFVat", "lgBVat", "lgNotes",
     "lgConfirmF", "lgConfirmB"].forEach(id => delete els[id]);
  }

  console.log("== Test 8f: the engine's own sentences, translated at the boundary ==");
  {
    const C = require(path + "/js/core.js");
    app.setLang("en");
    check("in English, engineText is a pass-through",
      app.engineText("In season now") === "In season now");
    app.setLang("it");
    check("a known reason is translated", app.engineText("In season now") === "Di stagione adesso");
    check("a reason with a captured value keeps the value",
      app.engineText("Very close (2 km)") === "Molto vicino (2 km)", app.engineText("Very close (2 km)"));
    check("the volume bands inside a reason are translated too",
      app.engineText("Volume fits (medium ↔ medium)") === "Volume adatto (medio ↔ medio)",
      app.engineText("Volume fits (medium ↔ medium)"));
    check("something the engine never says comes back untouched, not blank",
      app.engineText("Brain 2 said something new") === "Brain 2 said something new");
    check("null and undefined don't throw", app.engineText(null) === "" && app.engineText(undefined) === "");

    /* Every pattern has to actually do something. One left pointing at a
       sentence core.js no longer produces would pass the qa_check sync test
       and still never fire. */
    const inert = app.ENGINE_PATTERNS.filter(p => {
      const sample = p.re.source.replace(/^\^/, "").replace(/\$$/, "")
        .replace(/\\\//g, "/").replace(/\(\.\+\)|\(\.\*\)/g, "medium").replace(/\(\\w\+\)/g, "medium")
        .replace(/\\([().'\/])/g, "$1");
      return app.engineText(sample) === sample;
    });
    check("every ENGINE_PATTERNS entry actually rewrites its own sentence", !inert.length,
      JSON.stringify(inert.map(p => p.re.source)));

    /* And the real thing: run the engine and check nothing comes back English. */
    const prof = C.guardianValidateProfile({ village: "Terelle", organic: "no", available_months: [10, 11],
      products: [{ name: "castagne", category: "castagne", kg_per_week: 150 }] }).profile;
    const ranked = C.rankMatches(prof, app.DB, 10);
    const untranslated = [];
    ranked.slice(0, 10).forEach(r => (r.reasons || []).forEach(x => { if (app.engineText(x) === x) untranslated.push(x); }));
    check("a real ranking produces no reason chip the boundary can't translate", !untranslated.length,
      JSON.stringify([...new Set(untranslated)]));

    const warned = C.guardianValidateProfile({ products: [{ name: "x", category: "exotic", kg_per_week: 99999 }], organic: "maybe" });
    const wUntranslated = warned.warnings.filter(w => app.engineText(w) === w);
    check("nor does a Guardian correction the farmer is shown", !wUntranslated.length, JSON.stringify(wUntranslated));
  }

  console.log("== Test 8g: switching mid-boot must not wipe the skeleton ==");
  {
    /* loadFarmerData() replaces state.chats wholesale, so a re-render during
       the boot sequence would swap the placeholder rows for an empty table
       moments before the real one arrives. The toggle is pointer-events:none
       while #app.booting; this is the same rule enforced in code. */
    /* Every element setLang() would reach has to be registered, or the render
       helpers bail on their own null guards and this passes whether the boot
       guard is there or not — which is exactly what it did the first time. */
    const ids = ["app", "dashboardScreen", "researchBody", "researchEmpty", "researchSeeAll", "whoName"];
    ids.forEach(id => els[id] = fakeEl(id));
    els.app.classList.add("ready", "booting");
    els.researchBody.innerHTML = "SKELETON";
    app.setLang("en");
    check("a switch during boot leaves the skeleton where it is",
      els.researchBody.innerHTML === "SKELETON", els.researchBody.innerHTML);
    els.app.classList.remove("booting");
    app.setLang("it");
    check("...and once the data has landed a switch does redraw the table",
      els.researchBody.innerHTML !== "SKELETON");
    ids.forEach(id => delete els[id]);
    app.setLang("en");
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("\nHARNESS ERROR:", e); process.exit(1); });
