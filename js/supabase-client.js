/* ============================================================
   FASTO INNOVA — Supabase client + data access layer
   ------------------------------------------------------------
   The URL and key below are the PUBLIC ("publishable") ones —
   Supabase's security model is built around this: they're safe
   to ship in client-side code because every table is locked down
   with Row Level Security (see the migration in the project
   notes). This is a different situation from the Anthropic API
   key, which IS secret and is deliberately never stored in any
   file — only ever typed in by hand, in the browser, per session.
   ============================================================ */
const SUPABASE_URL = "https://asiuqyhlpnljhpcvkfaj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_4rVvLMZoV57aPPJK2MRvIg_fuscIRNo";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const DataStore = {
  /* ---------- auth ---------- */
  // The role rides along as sign-up metadata and is read by the database trigger
  // (private.handle_new_user), which whitelists it to "buyer" or "farmer". It is
  // a choice of WHICH app to open, never a privilege: admin cannot be set this way.
  // Name, surname and nickname ride along the same way: the trigger copies them
  // into the account row once. After that name and surname cannot be changed by
  // the account holder (database trigger), only the nickname can.
  signUp(email, password, role, names) {
    const n = names || {};
    return sb.auth.signUp({ email, password, options: { data: { role: role === "buyer" ? "buyer" : "farmer",
      first_name: n.first || "", last_name: n.last || "", nickname: n.nickname || "" } } });
  },
  signIn(email, password) { return sb.auth.signInWithPassword({ email, password }); },
  signOut() { return sb.auth.signOut(); },
  async getSession() { const { data } = await sb.auth.getSession(); return data.session; },

  /* ---------- farmer (display row) ---------- */
  getMyFarmer(uid) { return sb.from("farmers").select("*").eq("id", uid).maybeSingle(); },
  updateFarmerName(uid, name) { return sb.from("farmers").update({ farmer_name: name }).eq("id", uid); },
  // Business details for the logistics partner (company_name / vat_number /
  // address / phone). Per-account, not per-chat: unlike the crop profile these
  // don't change between conversations, and Brain 1 never asks for them.
  // Contact details and nickname (the only account columns a person may edit).
  // A name or surname can be written once for an older account that has none;
  // the database refuses any later change.
  updateMyAccount(uid, patch) { return sb.from("farmers").update(patch).eq("id", uid).select().single(); },
  updateFarmerDetails(uid, patch) { return sb.from("farmers").update(patch).eq("id", uid); },

  /* ---------- chats (each chat carries its own captured profile) ---------- */
  listMyChats(uid) { return sb.from("chats").select("*").eq("farmer_id", uid).order("created_at", { ascending: false }); },
  createChat(uid) { return sb.from("chats").insert({ farmer_id: uid }).select().single(); },
  updateChat(chatId, patch) { return sb.from("chats").update(patch).eq("id", chatId); },

  listMessages(chatId) { return sb.from("messages").select("*").eq("chat_id", chatId).order("created_at", { ascending: true }); },
  addMessage(chatId, role, text) { return sb.from("messages").insert({ chat_id: chatId, role, text }); },

  listProducts(chatId) { return sb.from("products").select("*").eq("chat_id", chatId); },
  async saveProducts(chatId, products) {
    const del = await sb.from("products").delete().eq("chat_id", chatId);
    if (del.error) return del;
    if (!products || !products.length) return { error: null };
    const rows = products.map(p => ({ chat_id: chatId, name: p.name, category: p.category, kg_per_week: p.kg_per_week }));
    return sb.from("products").insert(rows);
  },

  saveMatches(chatId, ranked) {
    const rows = ranked.map((r, i) => ({ chat_id: chatId, buyer_id: r.buyer_id, pitch_reason: r.pitch_reason, match_rank: i + 1 }));
    return sb.from("matches").insert(rows);
  },

  /* ---------- outreach (Clients screen) ---------- */
  listMyOutreach(uid) { return sb.from("outreach").select("*").eq("farmer_id", uid).order("created_at", { ascending: false }); },
  createOutreach(uid, chatId, buyerId, messageIt, messageEn, flagged) {
    return sb.from("outreach").insert({ farmer_id: uid, chat_id: chatId, buyer_id: buyerId, message_it: messageIt, message_en: messageEn, flagged }).select().single();
  },
  updateOutreach(id, patch) { return sb.from("outreach").update(patch).eq("id", id); },

  /* ---------- buyers (curated reference database) ---------- */
  listBuyers() { return sb.from("buyers").select("*"); },

  /* ---------- buyer accounts: claiming a business (ROADMAP item 24) ----------
     A buyer signs up with the buyer role and then CLAIMS a listed business (or
     says theirs is missing). A claim does nothing until an admin approves it;
     RLS only treats the buyer as the business's owner once it is 'approved'. */
  listMyClaims(uid) { return sb.from("buyer_claims").select("*").eq("user_id", uid).order("created_at", { ascending: false }); },
  createClaim(row) { return sb.from("buyer_claims").insert(row).select().single(); },
  // admin only, enforced by RLS: no filter on purpose, like the other admin reads
  listAllClaims() { return sb.from("buyer_claims").select("*").order("created_at", { ascending: false }); },
  decideClaim(id, patch) { return sb.from("buyer_claims").update(patch).eq("id", id); },
  // admin only: creates the listing for a business that was not on the list
  createBuyer(row) { return sb.from("buyers").insert(row).select().single(); },

  /* ---------- two-way messages on an outreach (ROADMAP item 26) ----------
     RLS lets only the farmer who owns the outreach, the approved owner of the
     addressed business, and admins read or write; nothing here can be edited
     or deleted afterwards. The sender is stamped by the caller and checked by
     the database against the signed-in user. */
  listOutreachMessages(outreachId) {
    return sb.from("outreach_messages").select("*").eq("outreach_id", outreachId).order("created_at", { ascending: true });
  },
  sendOutreachMessage(row) { return sb.from("outreach_messages").insert(row).select().single(); },

  /* ---------- buyer inbox (ROADMAP item 27) ----------
     A buyer's outreach rows: RLS only returns ones addressed to the business
     they own AND that already have a message on them. */
  listBuyerOutreach(buyerId) { return sb.from("outreach").select("*").eq("buyer_id", buyerId).order("created_at", { ascending: false }); },
  // Marks the farmer's unread messages in one thread as read. RLS lets only the
  // approved owner do this, and only the read_at column is writable.
  markThreadRead(outreachId) {
    return sb.from("outreach_messages").update({ read_at: new Date().toISOString() })
      .eq("outreach_id", outreachId).eq("sender_role", "farmer").is("read_at", null);
  },

  // The approved owner of a business declares what it buys (ROADMAP item 28).
  // Only these columns are writable by anyone but an admin, enforced by column grants.
  updateMyBusiness(buyerId, patch) {
    return sb.from("buyers").update(patch).eq("id", buyerId).select().single();
  },

  /* ---------- offers (ROADMAP item 29) ----------
     A farmer publishes a snapshot of what they can supply (never phone or
     address). RLS: the farmer reads and edits their own; approved buyers read
     only the published ones; nothing is ever deleted, only unpublished. */
  listMyOffers(uid) { return sb.from("offers").select("*").eq("farmer_id", uid); },
  createOffer(row) { return sb.from("offers").insert(row).select().single(); },
  updateOffer(id, patch) { return sb.from("offers").update(patch).eq("id", id).select().single(); },
  listPublishedOffers() { return sb.from("offers").select("*").eq("status", "published").order("created_at", { ascending: false }); },
  // A buyer starting a conversation from an offer. No .select(): the buyer can
  // only read an outreach row once a message exists on it, so the id is made by
  // the caller and the first message is sent next.
  createInquiry(row) { return sb.from("outreach").insert(row); },

  /* ---------- profile views (My business) ----------
     A farmer opening a business counts as one view per farmer per day (unique
     index). viewer_id can be written but never read back by anyone, so an owner
     sees counts only; that is why the read names its columns. */
  logBuyerView(buyerId, viewerId) { return sb.from("buyer_views").insert({ buyer_id: buyerId, viewer_id: viewerId }); },
  listMyBusinessViews(buyerId, sinceDay) { return sb.from("buyer_views").select("viewed_on").eq("buyer_id", buyerId).gte("viewed_on", sinceDay); },

  /* ---------- admin (RLS returns every farmer's rows once is_admin=true) ---------- */
  listAllFarmers() { return sb.from("farmers").select("*").order("created_at", { ascending: false }); },
  listAllChats() { return sb.from("chats").select("*").order("updated_at", { ascending: false }); },
  // Item 31 pass A. Admin-only database function: edits any buyers row and writes
  // the admin_audit row in the same transaction. Direct table updates stay limited.
  adminEditBuyer(id, patch) { return sb.rpc("admin_edit_buyer", { p_id: id, p_patch: patch }); },
  listAudit(limit) { return sb.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(limit || 50); },
  listAllOutreach() { return sb.from("outreach").select("*").order("created_at", { ascending: false }); }
};
