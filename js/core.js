/* ============================================================
   Agri-Link AI — Core engine (Brain 2: Matchmaker, Brain 3: Guardian)
   Pure functions: run in the browser AND in Node for testing.
   ============================================================ */

var CATEGORIES = ["verdure","pomodori","frutta","legumi","olio","vino","uova","formaggi","carne","erbe","castagne","miele","conserve"];

/* Months (1-12) when each category is typically available locally */
var CATEGORY_SEASONS = {
  verdure:   [1,2,3,4,5,6,7,8,9,10,11,12],
  pomodori:  [6,7,8,9,10],
  frutta:    [5,6,7,8,9,10],
  legumi:    [1,2,3,4,5,6,7,8,9,10,11,12],
  olio:      [1,2,11,12],
  vino:      [1,2,3,4,5,6,7,8,9,10,11,12],
  uova:      [1,2,3,4,5,6,7,8,9,10,11,12],
  formaggi:  [1,2,3,4,5,6,7,8,9,10,11,12],
  carne:     [1,2,3,4,5,6,7,8,9,10,11,12],
  erbe:      [3,4,5,6,7,8,9,10],
  castagne:  [10,11],
  miele:     [1,2,3,4,5,6,7,8,9,10,11,12],
  conserve:  [1,2,3,4,5,6,7,8,9,10,11,12]
};

function volumeBand(totalKg) {
  if (totalKg < 50) return "low";
  if (totalKg <= 200) return "medium";
  return "high";
}

function totalKg(profile) {
  return (profile.products || []).reduce(function (s, p) { return s + (Number(p.kg_per_week) || 0); }, 0);
}

function farmerCategories(profile) {
  var set = {};
  (profile.products || []).forEach(function (p) { if (p.category) set[p.category] = true; });
  return Object.keys(set);
}

function topProductCategory(profile) {
  var best = null, kg = -1;
  (profile.products || []).forEach(function (p) {
    if ((Number(p.kg_per_week) || 0) > kg) { kg = Number(p.kg_per_week) || 0; best = p.category; }
  });
  return best;
}

/* ---------- BRAIN 2: deterministic scoring ---------- */
function scoreBuyer(profile, buyer, month) {
  var reasons = [];
  var cats = farmerCategories(profile);
  if (!cats.length) return { score: 0, reasons: ["No products in profile"] };

  // 1. Category match (max 45)
  var matched = cats.filter(function (c) { return buyer.needs.indexOf(c) !== -1; });
  var catPts = 40 * (matched.length / cats.length);
  var topCat = topProductCategory(profile);
  if (topCat && buyer.needs.indexOf(topCat) !== -1) { catPts += 5; reasons.push("Needs your main product (" + topCat + ")"); }
  if (matched.length) reasons.push("Buys " + matched.join(", "));
  else reasons.push("No direct product overlap");

  // 2. Volume fit (max 20)
  var fBand = volumeBand(totalKg(profile));
  var order = ["low", "medium", "high"];
  var diff = Math.abs(order.indexOf(fBand) - order.indexOf(buyer.volume));
  var volPts = diff === 0 ? 20 : (diff === 1 ? 12 : 5);
  if (diff === 0) reasons.push("Volume fits (" + fBand + " ↔ " + buyer.volume + ")");
  else if (diff === 1) reasons.push("Volume roughly compatible");
  else reasons.push("Volume mismatch (" + fBand + " vs " + buyer.volume + ")");

  // 3. Distance (max 15) — proximity to Cassino centre as logistics proxy
  var d = Math.min(Number(buyer.distance_km) || 0, 25);
  var distPts = 15 * (1 - d / 25);
  if (d <= 3) reasons.push("Very close (" + buyer.distance_km + " km)");

  // 4. Quality alignment (max 10)
  var q = buyer.quality_focus || [];
  var qPts = 0;
  var likesQuality = q.some(function (x) { return ["km0","bio","alta_qualità","qualità","qualità_ingredienti","territorio","solo_produttori"].indexOf(x) !== -1; });
  if (profile.organic === "yes" && likesQuality) { qPts = 10; reasons.push("Values organic / km0 producers"); }
  else if (profile.organic === "partial" && likesQuality) { qPts = 7; }
  else if (likesQuality) { qPts = 5; reasons.push("Quality-focused buyer"); }
  else qPts = 3;

  // 5. Seasonality (max 10)
  var months = profile.available_months && profile.available_months.length ? profile.available_months : null;
  var inSeason = months ? months.indexOf(month) !== -1 : true;
  var catInSeason = topCat ? (CATEGORY_SEASONS[topCat] || []).indexOf(month) !== -1 : true;
  var seaPts = (inSeason && catInSeason) ? 10 : (inSeason || catInSeason ? 6 : 3);
  if (inSeason && catInSeason) reasons.push("In season now");
  else if (!inSeason) reasons.push("Supply starts later — plan ahead");

  // 6. Declared by the buyer itself (+5, ROADMAP item 28). Inferred needs are a
  //    guess from reviews; what a business says about itself is better evidence,
  //    so it is preferred, but only when it actually overlaps with this farmer.
  var declPts = 0;
  if (buyer.declared_by_buyer && matched.length) { declPts = 5; reasons.push("This business confirmed what it buys"); }

  var score = Math.round(catPts + volPts + distPts + qPts + seaPts + declPts);
  return { score: Math.max(0, Math.min(100, score)), reasons: reasons };
}

function rankMatches(profile, db, month) {
  // A business with no recorded fresh-produce needs (for example one added only for finished products) has nothing to match here.
  var pool = (db.buyers || []).concat(db.channels || []).filter(function (b) { return b.needs && b.needs.length; });
  var ranked = pool.map(function (b) {
    var r = scoreBuyer(profile, b, month);
    return {
      id: b.id, name: b.name, type: b.type, zone: b.zone, distance_km: b.distance_km,
      needs: b.needs, volume: b.volume, quality_focus: b.quality_focus, notes: b.notes,
      confidence: b.confidence, declared_by_buyer: !!b.declared_by_buyer, is_channel: (db.channels || []).indexOf(b) !== -1,
      score: r.score, reasons: r.reasons
    };
  });
  ranked.sort(function (a, b) { return b.score - a.score; });
  return ranked;
}

/* ---------- BRAIN 3: Guardian ---------- */
var INJECTION_PATTERNS = [
  /ignore (all|any|previous|prior|the) (instructions|rules|prompts?)/i,
  /disregard (the )?(system|previous)/i,
  /system prompt/i,
  /you are now/i,
  /pretend (to be|you are)/i,
  /jailbreak/i,
  /reveal.*(key|prompt|instructions)/i,
  /<\s*script/i
];

var PII_PATTERNS = [
  { name: "phone number", re: /(\+39\s?)?3\d{2}[\s.\-]?\d{6,7}\b/ },
  { name: "codice fiscale", re: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/i },
  { name: "IBAN", re: /\bIT\d{2}[A-Z]\d{10,26}\b/i },
  { name: "email address", re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/ }
];

function guardianScanText(text) {
  var findings = [];
  INJECTION_PATTERNS.forEach(function (re) {
    if (re.test(text)) findings.push({ level: "block", msg: "Possible prompt-injection pattern detected (" + re.source.slice(0, 30) + "…)" });
  });
  PII_PATTERNS.forEach(function (p) {
    if (p.re.test(text)) findings.push({ level: "warn", msg: "Personal data detected (" + p.name + ") — not needed at this stage, will not be stored in the profile" });
  });
  return findings;
}

function guardianValidateProfile(profile) {
  var errors = [], warnings = [];
  var p = JSON.parse(JSON.stringify(profile || {}));

  if (typeof p.farmer_name === "string" && p.farmer_name.trim()) p.farmer_name = p.farmer_name.trim().slice(0, 60);
  else delete p.farmer_name;

  if (!p.village || typeof p.village !== "string") { p.village = "Cassino area"; warnings.push("Village missing — defaulted to 'Cassino area'"); }
  if (!Array.isArray(p.products) || !p.products.length) errors.push("Profile has no products — cannot match");

  (p.products || []).forEach(function (prod, i) {
    if (CATEGORIES.indexOf(prod.category) === -1) {
      warnings.push("Unknown category '" + prod.category + "' for product " + (prod.name || i) + " — mapped to 'verdure'");
      prod.category = "verdure";
    }
    var kg = Number(prod.kg_per_week);
    if (!isFinite(kg) || kg <= 0) { errors.push("Invalid quantity for " + (prod.name || "product " + i)); }
    else if (kg > 5000) { warnings.push("Quantity " + kg + " kg/week for " + prod.name + " looks too high for a small farm — capped at 5000"); prod.kg_per_week = 5000; }
    else prod.kg_per_week = kg;
  });

  if (["yes", "no", "partial"].indexOf(p.organic) === -1) { p.organic = "no"; warnings.push("Organic status unclear — set to 'no' (never claim what we can't verify)"); }

  if (Array.isArray(p.available_months)) {
    p.available_months = p.available_months.filter(function (m) { return m >= 1 && m <= 12; });
  } else p.available_months = [];

  var d = Number(p.distance_km_from_cassino);
  if (!isFinite(d) || d < 0 || d > 60) { p.distance_km_from_cassino = 8; warnings.push("Farm distance unclear — assumed 8 km"); }

  return { ok: errors.length === 0, errors: errors, warnings: warnings, profile: p };
}

function guardianVerifyRecs(recs, candidateIds, profile) {
  var issues = [];
  var out = { ranked: [], creative_suggestions: [], outreach: null };

  (recs.ranked || []).forEach(function (r) {
    if (candidateIds.indexOf(r.buyer_id) === -1) {
      issues.push({ level: "block", msg: "Blocked: AI referenced a buyer not in the database (id '" + r.buyer_id + "') — removed" });
    } else out.ranked.push(r);
  });

  out.creative_suggestions = (recs.creative_suggestions || []).slice(0, 4);

  var o = recs.outreach;
  if (o) {
    if (candidateIds.indexOf(o.buyer_id) === -1) {
      issues.push({ level: "block", msg: "Blocked: outreach message targeted an unknown buyer — removed" });
    } else {
      var claimsOrganic = /biologic|organic|certificat/i;
      if (profile.organic !== "yes" && (claimsOrganic.test(o.message_it || "") || claimsOrganic.test(o.message_en || ""))) {
        issues.push({ level: "warn", msg: "Outreach draft claimed organic/certified status the farmer does not have — flagged for correction" });
        o.flagged_claim = true;
      }
      if ((o.message_it || "").length > 1200) { o.message_it = o.message_it.slice(0, 1200); issues.push({ level: "warn", msg: "Outreach (IT) truncated to safe length" }); }
      out.outreach = o;
    }
  }
  return { verified: out, issues: issues };
}

/* ---------- Buyer-declared profile (ROADMAP item 28) ----------
   What a buyer types about its own business reaches Brain 2's ranking, so it is
   checked like a farmer's profile: only known categories, a known volume band,
   a short list of known quality tags, sane counts. Pure. */
var QUALITY_TAGS = ["km0","bio","alta_qualità","qualità","territorio","solo_produttori","tradizionale","prezzo","genuino","casalingo","stagionale","eventi"];
var VOLUME_BANDS = ["low","medium","high"];
var BUYER_NEEDS_MAX = 8, BUYER_QUALITY_MAX = 4;
function guardianValidateBuyerProfile(input) {
  var bad = [];
  input = input || {};
  var needs = (Array.isArray(input.needs) ? input.needs : []).filter(function (x, i, a) { return a.indexOf(x) === i; });
  if (!needs.length) bad.push("needs");
  else if (needs.length > BUYER_NEEDS_MAX || needs.some(function (c) { return CATEGORIES.indexOf(c) === -1; })) bad.push("needsBad");
  if (VOLUME_BANDS.indexOf(input.volume) === -1) bad.push("volume");
  var q = (Array.isArray(input.quality_focus) ? input.quality_focus : []).filter(function (x, i, a) { return a.indexOf(x) === i; });
  if (q.length > BUYER_QUALITY_MAX || q.some(function (t) { return QUALITY_TAGS.indexOf(t) === -1; })) bad.push("quality");
  if (bad.length) return { ok: false, bad: bad };
  return { ok: true, row: { needs: needs, volume: input.volume, quality_focus: q } };
}

/* Item 31 pass A: what an ADMIN may save on any buyers row. Wider than the
   buyer's own form (name, type, zone, distance, notes, source, confidence) but
   the same category/volume/quality lists. Returns only the fields that were
   given, trimmed; the database function admin_edit_buyer() re-checks the
   column list, so this is the friendly layer, not the lock. */
var CONFIDENCE_LEVELS = ["low", "medium", "high"];
function guardianValidateAdminBuyer(input) {
  var bad = [], row = {};
  input = input || {};
  function text(k, max, required) {
    if (input[k] === undefined) return;
    var v = String(input[k] === null ? "" : input[k]).trim();
    if (required && !v) bad.push(k); else if (v.length > max) bad.push(k); else row[k] = v === "" ? null : v;
  }
  text("name", 120, true); text("type", 40, true); text("zone", 80); text("notes", 600); text("source", 300);
  if (input.distance_km !== undefined) {
    var d = input.distance_km === null || input.distance_km === "" ? null : Number(input.distance_km);
    if (d !== null && (!isFinite(d) || d < 0 || d > 500)) bad.push("distance_km"); else row.distance_km = d;
  }
  if (input.needs !== undefined) {
    var n = (Array.isArray(input.needs) ? input.needs : []).filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (n.some(function (c) { return CATEGORIES.indexOf(c) === -1; })) bad.push("needs"); else row.needs = n;
  }
  if (input.volume !== undefined) {
    if (input.volume !== null && input.volume !== "" && VOLUME_BANDS.indexOf(input.volume) === -1) bad.push("volume");
    else row.volume = input.volume || null;
  }
  if (input.quality_focus !== undefined) {
    var q = (Array.isArray(input.quality_focus) ? input.quality_focus : []).filter(function (x, i, a) { return a.indexOf(x) === i; });
    if (q.some(function (t) { return QUALITY_TAGS.indexOf(t) === -1; })) bad.push("quality_focus"); else row.quality_focus = q;
  }
  if (input.confidence !== undefined) {
    if (input.confidence && CONFIDENCE_LEVELS.indexOf(input.confidence) === -1) bad.push("confidence");
    else row.confidence = input.confidence || null;
  }
  if (bad.length) return { ok: false, bad: bad };
  return { ok: true, row: row };
}

/* Item 31 pass B: village-level points for the admin map. Town centres only
   (approximate), so a farmer is never placed more precisely than their village
   and no street address is ever turned into a position. Unknown village -> null. */
var VILLAGE_POINTS = {
  "cassino": [41.4905, 13.8330], "sant'elia fiumerapido": [41.5233, 13.8350],
  "cervaro": [41.4667, 13.9167]
};
function villagePoint(village) {
  var key = String(village == null ? "" : village).toLowerCase().replace(/[\u2019`]/g, "'").replace(/\(.*?\)/g, "").trim().replace(/\s+/g, " ");
  var p = VILLAGE_POINTS[key];
  return p ? { lat: p[0], lng: p[1], geo_source: "town" } : null;
}

/* Item 31 pass C: the admin map. Pure, so it is tested without a page.
   adminMapPoints turns buyers (with lat/lng from the database), their claims and
   the farmers' chats into plain points; clusterMapPoints merges points that sit on
   the same spot (all our points are town centres, so many share one). Farmers are
   only ever counted per village (never named, never placed more precisely than the
   village) because the admin map must not become a farmer location list. */
function adminMapPoints(buyers, claims, chats, filters) {
  var f = filters || {}, kind = f.kind || "all", cat = f.category || "", claim = f.claim || "any", out = [];
  var status = {};   // buyer id -> "claimed" | "pending"
  (claims || []).forEach(function (c) {
    if (!c.buyer_id) return;
    if (c.status === "approved") status[c.buyer_id] = "claimed";
    else if (c.status === "pending" && status[c.buyer_id] !== "claimed") status[c.buyer_id] = "pending";
  });
  (buyers || []).forEach(function (b) {
    if (b.lat == null || b.lng == null || isNaN(Number(b.lat)) || isNaN(Number(b.lng))) return;
    var k = /^c\d/.test(String(b.id)) ? "channel" : "buyer";
    var cs = status[b.id] || "unclaimed";
    if (kind !== "all" && kind !== k) return;
    if (cat && (b.needs || []).indexOf(cat) === -1) return;
    if (claim !== "any" && claim !== cs) return;
    out.push({ kind: k, id: b.id, label: b.name, lat: Number(b.lat), lng: Number(b.lng), geo_source: b.geo_source || "town", claim: cs });
  });
  if ((kind === "all" || kind === "farmer") && !cat && (claim === "any")) {
    var byVillage = {};
    (chats || []).forEach(function (c) {
      var p = villagePoint(c.village); if (!p || !c.farmer_id) return;
      var key = p.lat + "," + p.lng, g = byVillage[key] || (byVillage[key] = { p: p, village: c.village, ids: {} });
      g.ids[c.farmer_id] = 1;
    });
    Object.keys(byVillage).forEach(function (key) {
      var g = byVillage[key];
      out.push({ kind: "farmer", id: "village:" + key, label: g.village, lat: g.p.lat, lng: g.p.lng, geo_source: "town", claim: "n/a", count: Object.keys(g.ids).length });
    });
  }
  return out;
}
function clusterMapPoints(points) {
  var groups = {}, order = [];
  (points || []).forEach(function (p) {
    var key = p.lat.toFixed(3) + "," + p.lng.toFixed(3);
    if (!groups[key]) { groups[key] = { key: key, lat: p.lat, lng: p.lng, items: [] }; order.push(key); }
    groups[key].items.push(p);
  });
  return order.map(function (k) { return groups[k]; });
}

/* ---------- Packaged-product sheet (ROADMAP item 32 pass C) ----------
   Brain 1 fills a product sheet by interviewing the producer. Brain 3 (here)
   checks it before anything is saved. Two honesty rules live in this code:
   1. Some things may be SUGGESTED by the AI when the producer does not know
      (shelf life, storage, pack sizes, nutrition values) and are then stored as
      "suggested" until the producer confirms them. Others are business or safety
      facts that must come from the producer or a document and are NEVER taken
      from the AI: ingredients, allergens, certifications, minimum order, price.
   2. A sheet is complete only when every required field is present, nothing is
      still "suggested", and at least one document is attached. */
var PRODUCT_NUTRIENTS = ["energy_kcal", "fat_g", "saturated_fat_g", "carbs_g", "sugars_g", "protein_g", "salt_g"];
var PRODUCT_NUTRIENT_OPTIONAL = ["fibre_g"];
var PRODUCT_NUTRIENT_MAX = { energy_kcal: 900, fat_g: 100, saturated_fat_g: 100, carbs_g: 100, sugars_g: 100, protein_g: 100, salt_g: 100, fibre_g: 100 };
var PRODUCT_LIST_FIELDS = ["ingredients", "allergens", "pack_sizes", "certifications"];
var PRODUCT_TEXT_FIELDS = ["storage", "min_order", "price_range"];
var PRODUCT_REQUIRED = ["name", "ai_category", "ingredients", "allergens", "shelf_life_days", "storage", "pack_sizes", "min_order"];
// What the attach button names a draft before the interview has given it a real name (i18n "attach.newProduct").
var PRODUCT_PLACEHOLDER_NAMES = ["New product", "Nuovo prodotto"];
var PRODUCT_NEVER_SUGGESTED = ["ingredients", "allergens", "certifications", "min_order", "price_range"];

function cleanSheetText(v, max) { return typeof v === "string" ? v.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : ""; }

/* Returns { ok, errors: [codes], warnings: [text], sheet: {name, ai_category, details, nutrition} }.
   `sheet` holds only the fields that were present in the input (so it can be merged). */
function guardianValidateProductSheet(raw) {
  var codes = [], notes = [];
  var r = raw && typeof raw === "object" ? raw : {};
  var details = {}, nutrition = {}, sheet = { details: details, nutrition: nutrition };

  var allText = JSON.stringify(r);
  if (guardianScanText(allText).some(function (f) { return f.level === "block"; })) codes.push("scan");

  if (r.name !== undefined) { var n = cleanSheetText(r.name, 120); if (n) sheet.name = n; else codes.push("name"); }
  if (r.ai_category !== undefined) {
    var c = cleanSheetText(r.ai_category, 60).toLowerCase();
    if (c) sheet.ai_category = c; else codes.push("category");
  }

  var suggested = Array.isArray(r.suggested_fields) ? r.suggested_fields.filter(function (k) { return typeof k === "string"; }) : [];
  var keptSuggested = [];
  function markSuggested(key) {
    if (suggested.indexOf(key) === -1) return true;
    if (PRODUCT_NEVER_SUGGESTED.indexOf(key.split(".")[0]) !== -1) return false; // dropped: must come from the producer
    keptSuggested.push(key); return true;
  }

  PRODUCT_LIST_FIELDS.forEach(function (k) {
    if (!Array.isArray(r[k])) return;
    var arr = r[k].map(function (x) { return cleanSheetText(x, 80); }).filter(Boolean).slice(0, 25);
    if (!markSuggested(k)) { notes.push("dropped:" + k); return; }
    details[k] = arr;
  });
  PRODUCT_TEXT_FIELDS.forEach(function (k) {
    if (r[k] === undefined) return;
    var t = cleanSheetText(r[k], 200);
    if (!t) return;
    if (!markSuggested(k)) { notes.push("dropped:" + k); return; }
    details[k] = t;
  });
  // Documents worth uploading for THIS product (e.g. "DOP certificate"). Only shown as optional roadmap
  // items; never facts about the product, so no suggested/confirmed bookkeeping.
  if (Array.isArray(r.suggested_documents)) {
    details.suggested_documents = r.suggested_documents.map(function (x) { return cleanSheetText(x, 60); }).filter(Boolean)
      .filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 5);
  }
  if (r.shelf_life_days !== undefined) {
    var d = Number(r.shelf_life_days);
    if (isFinite(d) && d > 0 && d <= 3650) { if (markSuggested("shelf_life_days")) details.shelf_life_days = Math.round(d); }
    else notes.push("range:shelf_life_days");
  }

  var nin = r.nutrition && typeof r.nutrition === "object" ? r.nutrition : {};
  PRODUCT_NUTRIENTS.concat(PRODUCT_NUTRIENT_OPTIONAL).forEach(function (k) {
    if (nin[k] === undefined || nin[k] === null) return;
    var v = Number(nin[k]);
    if (!isFinite(v) || v < 0 || v > PRODUCT_NUTRIENT_MAX[k]) { notes.push("range:" + k); return; }
    if (markSuggested("nutrition." + k)) nutrition[k] = Math.round(v * 100) / 100;
  });
  // A per-100 g table must add up: fat + carbs + protein + salt cannot exceed 100 g,
  // sugars cannot exceed carbs, saturates cannot exceed fat.
  var sum = (nutrition.fat_g || 0) + (nutrition.carbs_g || 0) + (nutrition.protein_g || 0) + (nutrition.salt_g || 0);
  if (sum > 101) codes.push("nutrition_sum");
  if (nutrition.sugars_g !== undefined && nutrition.carbs_g !== undefined && nutrition.sugars_g > nutrition.carbs_g + 0.01) codes.push("nutrition_sugars");
  if (nutrition.saturated_fat_g !== undefined && nutrition.fat_g !== undefined && nutrition.saturated_fat_g > nutrition.fat_g + 0.01) codes.push("nutrition_sat");

  details.suggested = keptSuggested;
  return { ok: codes.length === 0, errors: codes, warnings: notes, sheet: sheet };
}

/* New values win; fields the new snapshot did not mention are kept. A field
   confirmed in the new snapshot stops being "suggested". */
function mergeProductSheet(oldRow, patch) {
  var o = oldRow || {};
  var od = Object.assign({}, o.details || {}), on = Object.assign({}, o.nutrition || {});
  var oldSug = (od.suggested || []).slice();
  var nd = patch.details || {}, nn = patch.nutrition || {};
  var details = Object.assign({}, od, nd), nutrition = Object.assign({}, on, nn);
  delete details.suggested;
  var newSug = nd.suggested || [];
  var touched = Object.keys(nd).filter(function (k) { return k !== "suggested"; }).concat(Object.keys(nn).map(function (k) { return "nutrition." + k; }));
  // old suggestions survive only for fields this snapshot did not touch
  var sug = oldSug.filter(function (k) { return touched.indexOf(k) === -1; }).concat(newSug);
  details.suggested = sug.filter(function (k, i) { return sug.indexOf(k) === i; });
  return { name: patch.name || o.name, ai_category: patch.ai_category || o.ai_category, details: details, nutrition: nutrition };
}

/* What is still missing from a sheet (a row of farmer_products + a document count). */
function productCompleteness(row, docCount) {
  var r = row || {}, d = r.details || {}, n = r.nutrition || {}, sug = d.suggested || [];
  var missing = [];
  function has(k) {
    if (k === "name") return !!r.name && PRODUCT_PLACEHOLDER_NAMES.indexOf(r.name) === -1;
    if (k === "ai_category") return !!r.ai_category;
    if (k === "allergens") return Array.isArray(d.allergens); // [] = "none", still an answer
    if (k === "ingredients" || k === "pack_sizes") return Array.isArray(d[k]) && d[k].length > 0;
    if (k === "shelf_life_days") return typeof d.shelf_life_days === "number";
    return typeof d[k] === "string" && d[k] !== "";
  }
  PRODUCT_REQUIRED.forEach(function (k) { if (!has(k) || sug.indexOf(k) !== -1) missing.push(k); });
  PRODUCT_NUTRIENTS.forEach(function (k) {
    if (typeof n[k] !== "number" || sug.indexOf("nutrition." + k) !== -1) missing.push("nutrition." + k);
  });
  if (!docCount) missing.push("documents");
  return { complete: missing.length === 0, missing: missing };
}

/* ---------- Product roadmap (the checklist in the product side panel) ----------
   Derived from the SAME rules as productCompleteness, so the checklist, the
   launch rule and the progress bar can never disagree. Each required step is
   done when none of its fields is still missing; pct counts required steps only.
   Optional steps (documents the AI thinks this product needs, e.g. a DOP
   certificate) are ticked by the producer, stored in details.docs_done, and
   never count towards the percentage or the launch rule. */
var ROADMAP_STEPS = [
  { key: "basic", fields: ["name", "ai_category", "pack_sizes", "min_order"] },
  { key: "ingredients", fields: ["ingredients"] },
  { key: "allergens", fields: ["allergens"] },
  { key: "shelf", fields: ["shelf_life_days", "storage"] },
  { key: "nutrition", fields: PRODUCT_NUTRIENTS.map(function (k) { return "nutrition." + k; }) },
  { key: "documents", fields: ["documents"] }
];
function productRoadmap(row, docCount) {
  var pc = productCompleteness(row, docCount), d = (row && row.details) || {};
  var steps = ROADMAP_STEPS.map(function (st) {
    var left = st.fields.filter(function (f) { return pc.missing.indexOf(f) !== -1; });
    return { key: st.key, done: left.length === 0, missing: left };
  });
  var done = steps.filter(function (x) { return x.done; }).length;
  var got = Array.isArray(d.docs_done) ? d.docs_done : [];
  var optional = (Array.isArray(d.suggested_documents) ? d.suggested_documents : []).map(function (t) { return { text: t, done: got.indexOf(t) !== -1 }; });
  return { steps: steps, optional: optional, done: done, total: steps.length, pct: Math.round(done * 100 / steps.length), complete: pc.complete };
}

/* ---------- Chat sidebar grouping (pinned / projects / recents) ----------
   chats: [{id, pinnedAt, projectId, ts}], projects: [{id, name, pinnedAt}].
   Pinned = pinned chats (wherever they live) and pinned projects. Projects =
   the unpinned projects, each with its chats (a pinned chat also stays inside its
   project; a pinned project is listed under Pinned only).
   Recents = chats in no project and not pinned, newest first. Pure. */
function groupChatRail(chats, projects) {
  var byNew = function (a, b) { return (b.ts || 0) - (a.ts || 0); };
  var byPin = function (a, b) { return (b.pinnedAt || 0) - (a.pinnedAt || 0); };
  var ids = {}; (projects || []).forEach(function (p) { ids[p.id] = true; });
  var inProject = function (c) { return !!c.projectId && ids[c.projectId]; };
  return {
    pinnedChats: (chats || []).filter(function (c) { return c.pinnedAt; }).sort(byPin),
    pinnedProjects: (projects || []).filter(function (p) { return p.pinnedAt; }).sort(byPin),
    projects: (projects || []).filter(function (p) { return !p.pinnedAt; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).map(function (p) {
      return { project: p, chats: (chats || []).filter(function (c) { return c.projectId === p.id; }).sort(byNew) };
    }),
    recents: (chats || []).filter(function (c) { return !c.pinnedAt && !inProject(c); }).sort(byNew)
  };
}

/* Sorting for My products. mode: "new" (last changed first, the default), "old", or "az" (by name).
   Pure; returns a new array. Rows with no date sort as oldest. */
function sortProductRows(rows, mode) {
  var arr = (rows || []).slice();
  var t = function (p) { var n = Date.parse(p && p.updated_at); return isFinite(n) ? n : 0; };
  var nm = function (p) { return String((p && p.name) || ""); };
  if (mode === "az") return arr.sort(function (a, b) { return nm(a).localeCompare(nm(b), undefined, { sensitivity: "base" }); });
  if (mode === "old") return arr.sort(function (a, b) { return t(a) - t(b); });
  return arr.sort(function (a, b) { return t(b) - t(a); });
}
/* How many of the three filters are away from their defaults (type: any, status: drafts and active, category: any). */
function productFiltersActive(f) {
  var fl = f || {};
  return (fl.kind ? 1 : 0) + ((fl.status !== undefined && fl.status !== "open") ? 1 : 0) + (fl.category ? 1 : 0);
}

/* ---------- Dashboard builders (the farmer's home screen) ----------
   Pure functions: they take plain data (see dashInput in js/dashboard.js) and return
   what each card shows. All times are milliseconds. Nothing here touches the page. */
var DASH_SOON_DAYS = 60;
// Messages from buyers that arrived after the farmer last opened that thread.
function dashUnread(c) {
  var seen = (c && c.seenAt) || 0;
  return ((c && c.messages) || []).filter(function (m) { return m.role === "buyer" && m.ts > seen; }).length;
}
function dashLastMessage(c) {
  var ms = (c && c.messages) || [];
  return ms.length ? ms.reduce(function (a, b) { return b.ts >= a.ts ? b : a; }) : null;
}
// "expired", "soon" (within 60 days) or null. expires_on is a plain date, YYYY-MM-DD.
function docExpiryState(doc, now) {
  if (!doc || !doc.expires_on) return null;
  var t = Date.parse(String(doc.expires_on).slice(0, 10) + "T23:59:59");
  if (!isFinite(t)) return null;
  if (t < now) return "expired";
  return t - now <= DASH_SOON_DAYS * 86400000 ? "soon" : null;
}
function dashProductName(products, id) {
  for (var i = 0; i < (products || []).length; i++) if (products[i].id === id) return products[i].name;
  return "";
}

/* A: what needs the farmer right now, most urgent first. Each item says where to go. */
function buildAttention(d) {
  var items = [], clients = d.clients || [], products = d.products || [], now = d.now || Date.now();
  var unreadThreads = clients.filter(function (c) { return dashUnread(c) > 0; });
  if (unreadThreads.length) {
    var total = unreadThreads.reduce(function (n, c) { return n + dashUnread(c); }, 0);
    var newest = unreadThreads.slice().sort(function (a, b) { return (dashLastMessage(b).ts) - (dashLastMessage(a).ts); })[0];
    items.push({ k: "unread", n: total, go: { to: "client", id: newest.id } });
  }
  var waiting = clients.filter(function (c) { var m = dashLastMessage(c); return m && m.role === "buyer" && dashUnread(c) === 0; });
  if (waiting.length) items.push({ k: "awaiting", n: waiting.length, go: { to: "client", id: waiting[0].id } });
  var live = products.filter(function (p) { return p.status !== "archived"; });
  live.forEach(function (p) {
    if (p.status !== "draft") return;
    var rm = productRoadmap(p, (d.docCounts || {})[p.id] || 0);
    if (rm.complete) items.push({ k: "ready", name: p.name, go: { to: "shop", id: p.id } });
  });
  live.forEach(function (p) {
    if (p.status !== "draft") return;
    var rm = productRoadmap(p, (d.docCounts || {})[p.id] || 0);
    if (!rm.complete && rm.done >= 1 && rm.total - rm.done <= 2) items.push({ k: "almost", name: p.name, done: rm.done, total: rm.total, go: { to: "product", id: p.id } });
  });
  var drafts = clients.filter(function (c) { return c.status === "draft"; });
  if (drafts.length) items.push({ k: "drafts", n: drafts.length, go: { to: "client", id: drafts[0].id } });
  var docsBy = d.docs || {};
  Object.keys(docsBy).forEach(function (pid) {
    var p = products.filter(function (x) { return x.id === pid; })[0];
    if (!p || p.status === "archived") return;
    docsBy[pid].forEach(function (doc) {
      var st = docExpiryState(doc, now);
      if (st) items.push({ k: st === "expired" ? "expired" : "soon", name: p.name, file: doc.file_name, date: String(doc.expires_on).slice(0, 10), go: { to: "product", id: pid, tab: "documents" } });
    });
  });
  // expired documents jump the queue: they can block a sale
  items.sort(function (a, b) { return (a.k === "expired" ? 0 : 1) - (b.k === "expired" ? 0 : 1); });
  return items;
}

/* B: the shop in numbers. Completeness is the average roadmap percentage of products that are not archived. */
function buildShopTiles(d) {
  var products = d.products || [], t = { live: 0, draft: 0, archived: 0, ready: 0, avgPct: 0 }, sum = 0, n = 0;
  products.forEach(function (p) {
    if (p.status === "archived") { t.archived++; return; }
    if (p.status === "active") t.live++; else t.draft++;
    var rm = productRoadmap(p, (d.docCounts || {})[p.id] || 0);
    sum += rm.pct; n++;
    if (p.status === "draft" && rm.complete) t.ready++;
  });
  t.avgPct = n ? Math.round(sum / n) : 0;
  t.total = t.live + t.draft + t.archived;
  return t;
}

/* E: the best matches across everything the farmer sells, one row per buyer.
   subjects: [{ name, rows: [{id, name, type, zone, distance_km, score}] }] */
function buildBestBuyers(subjects, limit) {
  var best = {};
  (subjects || []).forEach(function (s) {
    (s.rows || []).forEach(function (r) {
      if (!best[r.id] || r.score > best[r.id].score) best[r.id] = { id: r.id, name: r.name, type: r.type, zone: r.zone, distance_km: r.distance_km, score: r.score, forName: s.name };
    });
  });
  return Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return b.score - a.score; }).slice(0, limit || 3);
}

/* G: for each thing you sell, how many good-fit businesses are near and how many you have already written to.
   subjects: [{ name, chatId, rows: [{id, score, distance_km}] }] */
/* "Good fit" = score 60 or more. Measured on the real buyer list: unrelated business types still reach about 40
   on distance and confidence alone, so a lower bar would call nearly every business a good fit. */
function buildGaps(subjects, clients, maxKm, minScore) {
  var km = maxKm || 10, min = minScore || 60;
  return (subjects || []).map(function (s) {
    var fit = (s.rows || []).filter(function (r) { var dk = Number(r.distance_km); return r.score >= min && isFinite(dk) && dk <= km; });
    var ids = {}; (clients || []).forEach(function (c) { if (c.initiatedBy !== "buyer" && c.chatId && c.chatId === s.chatId) ids[c.buyerId] = true; });
    var contacted = fit.filter(function (r) { return ids[r.id]; }).length;
    return { name: s.name, fit: fit.length, contacted: contacted, km: km };
  }).filter(function (g) { return g.fit > 0; });
}

/* H: interest in launched products. views: { productId: ["2026-10-02", ...] } (one entry = one buyer on one day). */
function buildInterest(d) {
  var now = d.now || Date.now(), cut = now - 30 * 86400000, views = d.views || {}, clients = d.clients || [];
  return (d.products || []).filter(function (p) { return p.status === "active"; }).map(function (p) {
    var v = views[p.id] || [];
    return { id: p.id, name: p.name, total: v.length, last30: v.filter(function (x) { var t = Date.parse(x + "T12:00:00"); return isFinite(t) && t >= cut; }).length,
      contacts: clients.filter(function (c) { return c.productId === p.id; }).length };
  });
}

/* I: a merged, newest-first activity list. */
function buildTimeline(d, limit) {
  var ev = [], products = d.products || [], now = d.now || Date.now();
  products.forEach(function (p) {
    var t = Date.parse(p.created_at); if (isFinite(t)) ev.push({ k: "created", ts: t, name: p.name });
  });
  (d.events || []).forEach(function (e) {
    var t = Date.parse(e.created_at); if (isFinite(t)) ev.push({ k: e.kind, ts: t, name: dashProductName(products, e.product_id) });
  });
  var docs = d.docs || {};
  Object.keys(docs).forEach(function (pid) {
    docs[pid].forEach(function (doc) { var t = Date.parse(doc.created_at); if (isFinite(t)) ev.push({ k: "doc", ts: t, name: dashProductName(products, pid), file: doc.file_name }); });
  });
  (d.clients || []).forEach(function (c) {
    if (c.initiatedBy === "buyer" && isFinite(c.ts)) ev.push({ k: "inquiry", ts: c.ts, buyer: c.name });
    (c.messages || []).forEach(function (m) {
      if (m.role === "buyer") ev.push({ k: "buyerMsg", ts: m.ts, buyer: c.name });
      else if (m.readAt) { var t = Date.parse(m.readAt); if (isFinite(t)) ev.push({ k: "seen", ts: t, buyer: c.name }); }
    });
  });
  return ev.filter(function (e) { return isFinite(e.ts) && e.ts <= now + 60000; }).sort(function (a, b) { return b.ts - a.ts; }).slice(0, limit || 8);
}

/* J: documents that need a look. */
function buildDocHealth(d) {
  var now = d.now || Date.now(), out = { optional: [], expiring: [], noDocs: [] };
  (d.products || []).forEach(function (p) {
    if (p.status === "archived") return;
    var det = p.details || {}, got = det.docs_done || [];
    (det.suggested_documents || []).forEach(function (t) { if (got.indexOf(t) === -1) out.optional.push({ id: p.id, name: p.name, doc: t }); });
    var list = (d.docs || {})[p.id] || [];
    if (!list.length && ((d.docCounts || {})[p.id] || 0) === 0 && (productHasSheetContent(p))) out.noDocs.push({ id: p.id, name: p.name });
    list.forEach(function (doc) {
      var st = docExpiryState(doc, now);
      if (st) out.expiring.push({ id: p.id, name: p.name, file: doc.file_name, state: st, date: String(doc.expires_on).slice(0, 10) });
    });
  });
  out.expiring.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  out.ok = !out.optional.length && !out.expiring.length && !out.noDocs.length;
  return out;
}
// Has the sheet anything in it yet (so "no documents" is worth saying)?
function productHasSheetContent(p) {
  return !!p && (Object.keys(p.details || {}).filter(function (k) { return k !== "suggested"; }).length > 0 || !!p.ai_category);
}

/* ---------- "My products" list filters (ROADMAP item 32 pass E) ----------
   status filter: "open" = drafts and active (the default; archived are tucked
   away), "all", or one status. kind and category "" mean any. */
function filterProductRows(rows, f) {
  var fl = f || {};
  var st = fl.status === undefined ? "open" : fl.status;
  return (rows || []).filter(function (p) {
    if (st === "open" ? p.status === "archived" : (st !== "all" && p.status !== st)) return false;
    if (fl.kind && p.kind !== fl.kind) return false;
    if (fl.category && String(p.ai_category || "").toLowerCase() !== fl.category) return false;
    return true;
  });
}
// Distinct AI-chosen categories (they are free text), lowercase, sorted.
function productCategoriesOf(rows) {
  var seen = {};
  (rows || []).forEach(function (p) { var c = String(p.ai_category || "").trim().toLowerCase(); if (c) seen[c] = true; });
  return Object.keys(seen).sort();
}

/* ---------- Matching finished products to buyers (ROADMAP item 32 pass I) ----------
   Fresh produce is matched on categories, volume, distance, quality and season.
   A finished, packaged product is different: what matters is WHAT KIND of
   business the buyer is (a food shop stocks finished products, a wholesaler buys
   them in volume, a restaurant mostly cooks), plus whether our (inferred) notes
   say it already buys this sort of product, and how close it is. The reasons are
   small objects {k, v}, not sentences, so the screen can translate them; the
   numbers below are judgment calls and are tested, not facts about any business. */
var PACKAGED_TYPE_FIT = [
  [/gastronom|salumer|enoteca|delicatessen|alimentari/, 50, "shop"],
  [/ingrosso|wholesale|cash/, 45, "wholesale"],
  [/supermerc/, 40, "supermarket"],
  [/distribut|vending/, 35, "vending"],
  [/bottega|negozio/, 45, "shop"],
  [/cater|banquet|eventi|hotel|agritur/, 35, "kitchen"],
  [/panific|pasticc|forno/, 30, "bakery"],
  [/caff|^bar|gelater/, 30, "cafe"],
  [/istituz|mensa/, 30, "institution"],
  [/ristorant|trattor|osteri|pizz|steak|rostic|birr|sushi|locanda/, 25, "restaurant"],
  [/mercato|km0/, 25, "market"]
];
/* Sweet baked goods and snacks (donuts, croissants, biscuits, cakes...). For these
   the businesses that sell them across a counter or a vending machine are the
   natural buyers, and a delicatessen or wine shop is not, so they use their own
   table. Same shape as PACKAGED_TYPE_FIT; first match wins. Weights are my
   judgment, not data (see ROADMAP "Reminders"). */
var PACKAGED_SWEET_WORDS = /donut|doughnut|ciambell|krapfen|bombolon|cornett|croissant|brioche|biscott|biscuit|cookie|muffin|torta|\bcake|dolc|sweet|pastr|pasticc|merend|wafer|maritozz|panettone|snack/i;
var PACKAGED_TYPE_FIT_SWEET = [
  [/caff|^bar|panific|pasticc|forno|cornett/, 50, "cafe"],
  [/distribut|vending/, 45, "vending"],
  [/ingrosso|wholesale|cash/, 45, "wholesale"],
  [/gelater/, 40, "cafe"],
  [/supermerc|bottega|negozio|alimentari/, 40, "supermarket"],
  [/cater|banquet|eventi|hotel|agritur/, 35, "kitchen"],
  [/istituz|mensa/, 30, "institution"],
  [/gastronom|salumer|enoteca|delicatessen/, 25, "shop"],
  [/ristorant|trattor|osteri|pizz|steak|rostic|birr|sushi|locanda/, 20, "restaurant"],
  [/mercato|km0/, 25, "market"]
];
// Words in the AI-chosen category (free text) that point at a need we track.
var PACKAGED_NEED_WORDS = [
  ["formaggi", /chees|formagg|latticin|mozzarell|ricott|pecorin|burrat/i], ["miele", /honey|miele/i],
  ["olio", /\boil\b|olio|olive/i], ["vino", /wine|vino|spumant/i], ["conserve", /jam|preserv|conserv|marmellat|sott|sugo|sauce|pesto/i],
  ["uova", /\begg|uova|pasta all/i], ["castagne", /chestnut|castagn/i], ["legumi", /legum|bean|fagiol|lentic|ceci/i]
];
function scorePackagedBuyer(product, buyer) {
  var why = [];
  var type = String(buyer.type || "").toLowerCase(), tier = [20, "other"];
  var sweet = PACKAGED_SWEET_WORDS.test(String((product && product.ai_category) || "") + " " + String((product && product.name) || ""));
  var table = sweet ? PACKAGED_TYPE_FIT_SWEET : PACKAGED_TYPE_FIT;
  for (var i = 0; i < table.length; i++) if (table[i][0].test(type)) { tier = [table[i][1], table[i][2]]; break; }
  why.push({ k: "type", v: tier[1] });
  var typePts = tier[0];

  var text = String((product && product.ai_category) || "") + " " + String((product && product.name) || "");
  var needs = buyer.needs || [], needPts = 0, matchedNeed = null;
  for (var j = 0; j < PACKAGED_NEED_WORDS.length; j++) {
    if (PACKAGED_NEED_WORDS[j][1].test(text) && needs.indexOf(PACKAGED_NEED_WORDS[j][0]) !== -1) { matchedNeed = PACKAGED_NEED_WORDS[j][0]; needPts = 20; break; }
  }
  if (matchedNeed) why.push({ k: "need", v: matchedNeed });

  var distPts;
  if (buyer.distance_km === null || buyer.distance_km === undefined || buyer.distance_km === "" || !isFinite(Number(buyer.distance_km))) { distPts = 5; why.push({ k: "farUnknown" }); }
  else {
    var d = Math.min(Number(buyer.distance_km), 25);
    distPts = 15 * (1 - d / 25);
    if (d <= 3) why.push({ k: "near", v: Math.round(Number(buyer.distance_km)) });
  }

  var conf = buyer.confidence, confPts = conf === "high" ? 8 : conf === "medium" ? 6 : 4;
  if (conf === "low") why.push({ k: "lowConf" });

  var declPts = 0;
  if (buyer.declared_by_buyer && matchedNeed) { declPts = 5; why.push({ k: "declared" }); }

  var score = Math.round(typePts + needPts + distPts + confPts + declPts);
  return { score: Math.max(0, Math.min(100, score)), reasons: why };
}
function rankPackaged(product, db) {
  var pool = (db.buyers || []).concat(db.channels || []);
  var ranked = pool.map(function (b) {
    var r = scorePackagedBuyer(product, b);
    return {
      id: b.id, name: b.name, type: b.type, zone: b.zone, distance_km: b.distance_km,
      needs: b.needs, volume: b.volume, quality_focus: b.quality_focus, notes: b.notes,
      confidence: b.confidence, declared_by_buyer: !!b.declared_by_buyer, is_channel: (db.channels || []).indexOf(b) !== -1,
      source: b.source, score: r.score, reasons: r.reasons
    };
  });
  ranked.sort(function (a, b) { return b.score - a.score; });
  return ranked;
}

/* ---------- Attachments (ROADMAP item 32 pass B) ----------
   Pure rules for a file a producer attaches: which types, how big, and the
   storage path. The database enforces the same limits (bucket + table checks),
   this is the friendly first line. Path must be <user id>/products/<name>. */
var PRODUCT_FILE_MAX = 5 * 1024 * 1024;
var PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
var PRODUCT_DOC_TYPES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"];
var PRODUCT_FILE_TYPES = PRODUCT_IMAGE_TYPES.concat(PRODUCT_DOC_TYPES);
function checkProductFile(f) {
  if (!f || !f.size) return { ok: false, key: "attach.errEmpty" };
  if (!productFileType(f)) return { ok: false, key: "attach.errType" };
  if (f.size > PRODUCT_FILE_MAX) return { ok: false, key: "attach.errSize" };
  return { ok: true };
}
/* A browser sometimes reports no type for Word/Excel files (it depends on the
   computer), so fall back to the extension. Returns a type from the list or "". */
var PRODUCT_EXT_TYPES = { pdf: "application/pdf", doc: "application/msword", docx: PRODUCT_DOC_TYPES[2], xls: "application/vnd.ms-excel",
  xlsx: PRODUCT_DOC_TYPES[4], csv: "text/csv", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
function productFileType(f) {
  if (!f) return "";
  if (PRODUCT_FILE_TYPES.indexOf(f.type) !== -1) return f.type;
  var m = /\.([a-z0-9]+)$/i.exec(String(f.name || ""));
  return m && PRODUCT_EXT_TYPES[m[1].toLowerCase()] || "";
}
/* Which of the two attach buttons a file belongs to: "image" or "doc". */
function productFileGroup(type) { return PRODUCT_IMAGE_TYPES.indexOf(type) !== -1 ? "image" : "doc"; }
// "2.7 MB", "340 KB", "12 B": the size shown beside a file.
function formatBytes(n) {
  n = Number(n) || 0;
  if (n >= 1048576) return (Math.round(n / 104857.6) / 10) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}
// A short label for the kind of file: PDF, WORD, EXCEL, CSV or IMAGE.
function productFileLabel(type) {
  if (type === "application/pdf") return "PDF";
  if (type === "text/csv") return "CSV";
  if (type === "application/msword" || type === PRODUCT_DOC_TYPES[2]) return "WORD";
  if (type === "application/vnd.ms-excel" || type === PRODUCT_DOC_TYPES[4]) return "EXCEL";
  return PRODUCT_IMAGE_TYPES.indexOf(type) !== -1 ? "IMAGE" : "FILE";
}
function productFilePath(uid, name, stamp, rand) {
  var safe = String(name || "file").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(-80);
  if (!safe) safe = "file";
  return uid + "/products/" + stamp + "-" + rand + "-" + safe;
}

/* ---- Dashboard tile order (drag to rearrange) ----
   Pure: the saved order may be old, partial or tampered with, so it is cleaned against the tiles that exist today. */
var DASH_TILE_IDS = ["attention", "shop", "best", "interest", "docs", "gaps", "timeline"];
function dashTileOrder(saved) {
  var out = [];
  (Array.isArray(saved) ? saved : []).forEach(function (id) { if (DASH_TILE_IDS.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id); });
  DASH_TILE_IDS.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });   // new tiles join at the end
  return out;
}
/* Moves `id` to where `target` is now (the others shift along). Unknown ids change nothing. */
function moveDashTile(order, id, target) {
  var from = order.indexOf(id), to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return order.slice();
  var next = order.slice(); next.splice(from, 1); next.splice(to, 0, id); return next;
}
/* Keyboard: one step earlier (-1) or later (+1). */
function shiftDashTile(order, id, delta) {
  var from = order.indexOf(id), to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return order.slice();
  var next = order.slice(); next.splice(from, 1); next.splice(to, 0, id); return next;
}
function dashOrderIsDefault(order) { return dashTileOrder(order).join() === DASH_TILE_IDS.join(); }

/* ---------- Buyer side: Open market order, and the first-message limit on offers ---------- */
/* The Open market list. o.view picks the order or the filter: "recent" (newest change first), "relevant" (how well the
   product fits THIS buyer's business, o.relevance[id], newest first on a tie), "viewed" (o.views[id], totals only),
   "bookmarks" (only o.bookmarks[id], newest first). o.sort "az" / "za" puts the names in order instead, whatever the view
   (a bookmarks view stays a bookmarks filter). Pure: never changes the rows it is given. */
function sortMarketRows(rows, o) {
  o = o || {};
  var arr = (rows || []).slice();
  var t = function (p) { var n = Date.parse(p && p.updated_at); return isFinite(n) ? n : 0; };
  var num = function (m, p) { var v = m && p ? Number(m[p.id]) : 0; return isFinite(v) ? v : 0; };
  var nm = function (p) { return String((p && p.name) || ""); };
  if (o.view === "bookmarks") arr = arr.filter(function (p) { return !!(o.bookmarks && o.bookmarks[p.id]); });
  if (o.sort === "az" || o.sort === "za") {
    var dir = o.sort === "az" ? 1 : -1;
    return arr.sort(function (a, b) { return dir * nm(a).localeCompare(nm(b), undefined, { sensitivity: "base" }) || t(b) - t(a); });
  }
  if (o.view === "relevant") return arr.sort(function (a, b) { return num(o.relevance, b) - num(o.relevance, a) || t(b) - t(a); });
  if (o.view === "viewed") return arr.sort(function (a, b) { return num(o.views, b) - num(o.views, a) || t(b) - t(a); });
  return arr.sort(function (a, b) { return t(b) - t(a); });
}
/* A buyer's FIRST message on an offer is a short hello: two lines of about eight words. The limit is 16 words and 120
   characters, whichever comes first; the conversation after that has no limit. clipFirstMessage cuts what is over (a space
   the buyer has just typed is kept, so typing a sentence feels normal). */
var FIRST_MSG_MAX_WORDS = 16, FIRST_MSG_MAX_CHARS = 120;
function firstMessageWords(text) { var m = String(text == null ? "" : text).match(/\S+/g); return m ? m.length : 0; }
function clipFirstMessage(text) {
  var s = String(text == null ? "" : text).replace(/\s*[\r\n]+\s*/g, " ").replace(/^\s+/, "");
  var re = /\S+\s*/g, m, n = 0, out = "";
  while ((m = re.exec(s))) { if (++n > FIRST_MSG_MAX_WORDS) break; out += m[0].replace(/\s+$/, " "); }   // a run of spaces counts as one
  return out.length > FIRST_MSG_MAX_CHARS ? out.slice(0, FIRST_MSG_MAX_CHARS) : out;
}

/* Node export for testing */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CATEGORIES: CATEGORIES, CATEGORY_SEASONS: CATEGORY_SEASONS,
    volumeBand: volumeBand, totalKg: totalKg, farmerCategories: farmerCategories,
    scoreBuyer: scoreBuyer, rankMatches: rankMatches,
    guardianScanText: guardianScanText, guardianValidateProfile: guardianValidateProfile,
    guardianVerifyRecs: guardianVerifyRecs, guardianValidateBuyerProfile: guardianValidateBuyerProfile, guardianValidateAdminBuyer: guardianValidateAdminBuyer, QUALITY_TAGS: QUALITY_TAGS, adminMapPoints: adminMapPoints, clusterMapPoints: clusterMapPoints, villagePoint: villagePoint, VILLAGE_POINTS: VILLAGE_POINTS,
    guardianValidateProductSheet: guardianValidateProductSheet, mergeProductSheet: mergeProductSheet, productCompleteness: productCompleteness, PRODUCT_NUTRIENTS: PRODUCT_NUTRIENTS, PRODUCT_REQUIRED: PRODUCT_REQUIRED,
    productRoadmap: productRoadmap, groupChatRail: groupChatRail,
    DASH_TILE_IDS: DASH_TILE_IDS, dashTileOrder: dashTileOrder, moveDashTile: moveDashTile, shiftDashTile: shiftDashTile, dashOrderIsDefault: dashOrderIsDefault,
    dashUnread: dashUnread, docExpiryState: docExpiryState, buildAttention: buildAttention, buildShopTiles: buildShopTiles, buildBestBuyers: buildBestBuyers, buildGaps: buildGaps, buildInterest: buildInterest, buildTimeline: buildTimeline, buildDocHealth: buildDocHealth, sortProductRows: sortProductRows, productFiltersActive: productFiltersActive, filterProductRows: filterProductRows, productCategoriesOf: productCategoriesOf,
    scorePackagedBuyer: scorePackagedBuyer, rankPackaged: rankPackaged,
    sortMarketRows: sortMarketRows, clipFirstMessage: clipFirstMessage, firstMessageWords: firstMessageWords, FIRST_MSG_MAX_WORDS: FIRST_MSG_MAX_WORDS, FIRST_MSG_MAX_CHARS: FIRST_MSG_MAX_CHARS,
    formatBytes: formatBytes, productFileLabel: productFileLabel, checkProductFile: checkProductFile, productFileType: productFileType, productFileGroup: productFileGroup, productFilePath: productFilePath, PRODUCT_FILE_MAX: PRODUCT_FILE_MAX
  };
}
