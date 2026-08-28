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
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText() {} } },
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
  const files = ["js/supabase-client.js", "js/data.js", "js/core.js", "js/app.js"];
  const src = files.map(f => fs.readFileSync(root + "/" + f, "utf8")).join("\n;\n") + `
;globalThis.__t = { state, DataStore, DB, loadFarmerData, bgSave, isLocalId, addMsg,
  saveState, flushSaveFailures, saveOk, saveFailed, explainSyncWarn, isChatUntouched, SAVE_REPEAT_MS,
  applyProfileEdit, changedProfileFields, readProfileForm, openProfileEdit, saveProfileEdit,
  addProfileProduct, removeProfileProduct, toggleProfileMonth };`;
  vm.runInContext(src, sandbox, { filename: "fasto-bundle.js" });
  return { app: sandbox.__t, sb, els, logs };
}

const { app, sb, els, logs } = loadApp(path);

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

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("\nHARNESS ERROR:", e); process.exit(1); });
