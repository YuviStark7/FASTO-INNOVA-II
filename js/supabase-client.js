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
  // Real deletion (item 21). RLS allows only the owner; messages/products/matches cascade.
  deleteChat(chatId) { return sb.from("chats").delete().eq("id", chatId); },

  listMessages(chatId) { return sb.from("messages").select("*").eq("chat_id", chatId).order("created_at", { ascending: true }); },
  // docIds: the product documents attached with this message (shown in its bubble)
  addMessage(chatId, role, text, docIds) {
    const row = { chat_id: chatId, role, text };
    if (docIds && docIds.length) row.doc_ids = docIds;
    return sb.from("messages").insert(row);
  },

  /* ---------- chat projects (the sidebar's folders) ----------
     A farmer's own groups of chats. RLS: own rows only; only name and pinned_at
     can be edited. Deleting a project keeps its chats (project_id is cleared). */
  listMyProjects(uid) { return sb.from("chat_projects").select("*").eq("owner_id", uid).order("created_at", { ascending: true }); },
  createProject(uid, name) { return sb.from("chat_projects").insert({ owner_id: uid, name }).select().single(); },
  updateProject(id, patch) { return sb.from("chat_projects").update(patch).eq("id", id); },
  deleteProject(id) { return sb.from("chat_projects").delete().eq("id", id); },

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

  /* ---------- packaged products (ROADMAP item 32, pass A: data layer only) ----------
     A farmer's own product sheets. RLS shows a farmer only their own rows and
     there is no delete: a product is archived (status "archived"), never removed.
     Documents are files in the private "farmer-files" bucket under
     <user id>/products/..., recorded in product_documents. */
  listMyProducts(uid) { return sb.from("farmer_products").select("*").eq("owner_id", uid).order("updated_at", { ascending: false }); },
  createProduct(row) { return sb.from("farmer_products").insert(row).select().single(); },
  updateProduct(id, patch) { return sb.from("farmer_products").update(patch).eq("id", id).select().single(); },
  listProductDocuments(productId) { return sb.from("product_documents").select("*").eq("product_id", productId).order("created_at", { ascending: true }); },
  addProductDocument(row) { return sb.from("product_documents").insert(row).select().single(); },
  // What an APPROVED buyer sees: only launched (active) products. RLS enforces it; the filter is just clarity.
  listLaunchedProducts() { return sb.from("farmer_products").select("*").eq("status", "active").order("updated_at", { ascending: false }); },
  // A second chat that works on an existing product (the product keeps its original chat in source_chat_id).
  linkProductToChat(productId, chatId) { return sb.from("product_chat_links").insert({ product_id: productId, chat_id: chatId }); },
  linkedProductForChat(chatId) { return sb.from("product_chat_links").select("product_id, farmer_products(*)").eq("chat_id", chatId).limit(1); },
  // The farmer's documents (names only, never file contents), to draw the files in each product folder.
  listMyProductDocs(uid) { return sb.from("product_documents").select("id, product_id, file_name, mime_type, size_bytes, storage_path, doc_kind, expires_on, created_at").eq("owner_id", uid).order("created_at", { ascending: true }); },
  // The owner can set a document's type and (for a certificate) its expiry date, nothing else (column grant + policy).
  updateProductDocument(id, patch) { return sb.from("product_documents").update(patch).eq("id", id).select().single(); },

  /* ---------- dashboard data (2026-10-17) ----------
     product_views: an approved buyer opening a launched product's full sheet counts once per day.
     The producer can count them but never see who (viewer_id has no select grant): always name the columns.
     product_events: launched / withdrawn / archived / restored, written by a database trigger only. */
  logProductView(productId) { return sb.from("product_views").insert({ product_id: productId }); },
  listMyProductViews(productIds) { return sb.from("product_views").select("product_id, viewed_on").in("product_id", productIds); },
  /* ---------- buyer: bookmarks and the "Most viewed" order (2026-10-20) ----------
     product_bookmarks: a buyer's own list (RLS: own rows, approved buyers only). product_view_counts(): totals per launched
     product for the buyer's Most viewed order; it returns counts and never who looked. */
  listMyBookmarks() { return sb.from("product_bookmarks").select("product_id"); },
  addBookmark(productId) { return sb.from("product_bookmarks").insert({ product_id: productId }); },
  removeBookmark(productId) { return sb.from("product_bookmarks").delete().eq("product_id", productId); },
  productViewCounts() { return sb.rpc("product_view_counts"); },
  listMyProductEvents(uid) { return sb.from("product_events").select("product_id, kind, created_at").eq("owner_id", uid).order("created_at", { ascending: false }).limit(60); },
  // The draft product a chat created (a chat makes at most one).
  productForChat(chatId) { return sb.from("farmer_products").select("*").eq("source_chat_id", chatId).order("created_at", { ascending: true }).limit(1); },
  // Files live in the private "farmer-files" bucket; RLS limits each user to their own folder.
  // contentType is passed because a browser may report none for a Word or Excel file.
  uploadProductFile(path, file, contentType) { return sb.storage.from("farmer-files").upload(path, file, { contentType: contentType || file.type, upsert: false }); },
  removeProductFile(path) { return sb.storage.from("farmer-files").remove([path]); },
  signedFileUrl(path) { return sb.storage.from("farmer-files").createSignedUrl(path, 3600); },
  removeProductDocument(id) { return sb.from("product_documents").delete().eq("id", id); },

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
  // Item 31 pass A, farmers. Display fields only: the directory read names its columns
  // so phone, address and VAT never reach the Admin screen; the edit is an audited RPC.
  listFarmerDirectory() { return sb.from("farmers").select("id,farmer_name,first_name,last_name,nickname,company_name,role,created_at").order("created_at", { ascending: false }); },
  adminEditFarmer(id, patch) { return sb.rpc("admin_edit_farmer", { p_id: id, p_patch: patch }); },
  // Audited reveal of phone, address and VAT: the database function logs the look.
  adminRevealFarmer(id) { return sb.rpc("admin_reveal_farmer_private", { p_id: id }); },
  listAudit(limit) { return sb.from("admin_audit").select("*").order("created_at", { ascending: false }).limit(limit || 50); },
  listAllOutreach() { return sb.from("outreach").select("*").order("created_at", { ascending: false }); }
};
