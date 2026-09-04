/* ============================================================
   FASTO INNOVA — public "for buyers" page (buyers.html)
   ------------------------------------------------------------
   Read-only by design. No Supabase, no auth, no writes, no form:
   this page tells a buyer what Fasto Innova is, why their
   business is on a list they never asked to be on, and how to be
   corrected or removed. Letting them submit their own needs is a
   different thing entirely — it turns a curated dataset into a
   self-declared one — and is deliberately out of scope
   (ROADMAP #14).

   THE ONE RULE THIS FILE EXISTS TO KEEP: only the fields that
   came from a public listing are rendered — name, type, zone,
   distance, source. `needs`, `volume` and `quality_focus` are
   inferred by desk research from cuisine type and reviews, and
   printing an inference beside a real company's name presents a
   guess as a fact about someone else's business. That is the
   same standing rule that stops the app showing invented buyer
   replies. If you add a column here, check which side of that
   line the field is on first.
   ============================================================ */

(function () {
  "use strict";

  /* Kept in step with LOGISTICS_EMAIL in js/app.js — qa_check.js fails if the
     two ever drift apart. app.js is not loaded on this page, so it cannot
     simply be read from there. */
  var BUYERS_EMAIL = "yuvraj11argal@gmail.com";

  /* Only these five. See the note at the top of the file. */
  var PUBLIC_FIELDS = ["name", "type", "zone", "distance_km", "source"];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function typeLabel(t) { return T("buyers.type." + t); }

  /* One row. `data-label` on every cell but the first is what the mobile
     stacked layout renders in place of the hidden column header — without it
     "Cervaro area" and "virgilio.it" are bare words on a phone. */
  function row(b) {
    return "<tr>" +
      "<td>" + esc(b.name) + "</td>" +
      "<td data-label=\"" + esc(T("buyers.list.colType")) + "\">" + esc(typeLabel(b.type)) + "</td>" +
      "<td data-label=\"" + esc(T("buyers.list.colZone")) + "\">" + esc(b.zone) + "</td>" +
      "<td data-label=\"" + esc(T("buyers.list.colDist")) + "\">" + esc(T("buyers.list.km", { n: b.distance_km })) + "</td>" +
      "<td class=\"pub-src\" data-label=\"" + esc(T("buyers.list.colSource")) + "\">" + esc(b.source) + "</td>" +
      "</tr>";
  }

  /* Matched against the name, the area, the raw type key and the type as it is
     currently displayed — so searching "pizzeria" works in Italian and
     "restaurant" works in English, without either language being special. */
  function matches(b, q) {
    if (!q) return true;
    return [b.name, b.zone, b.type, typeLabel(b.type)]
      .join(" ").toLowerCase().indexOf(q) !== -1;
  }

  function renderBuyers() {
    var q = ($("buyerSearch").value || "").trim().toLowerCase();
    var all = DB.buyers.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    var shown = all.filter(function (b) { return matches(b, q); });
    $("buyerRows").innerHTML = shown.map(row).join("");
    $("buyerEmpty").style.display = shown.length ? "none" : "";
    $("buyerCount").textContent = T("buyers.list.count", { shown: shown.length, total: all.length });
  }

  function renderChannels() {
    $("channelRows").innerHTML = DB.channels.map(row).join("");
  }

  function renderStats() {
    $("statBusinesses").textContent = DB.buyers.length;
    $("statChannels").textContent = DB.channels.length;
    $("statCategories").textContent = DB.meta.categories.length;
    $("statDistance").textContent = DB.buyers.reduce(function (m, b) {
      return Math.max(m, Number(b.distance_km) || 0);
    }, 0);
  }

  /* The subject line is translated, so it is rebuilt on every language change
     rather than written once into the markup. */
  function paintMail() {
    $("listingMail").setAttribute("href",
      "mailto:" + BUYERS_EMAIL + "?subject=" + encodeURIComponent(T("buyers.data.mailSubject")));
  }

  /* Same localStorage key as the app (`fasto_lang`, in js/i18n.js), so a buyer
     who follows the link into the app arrives in the language they were just
     reading, and a farmer who comes the other way does too. */
  function setLang(lang) {
    if (!setLangValue(lang)) return;
    applyI18n(document);
    paintLangToggles(document);
    paintMail();
    renderBuyers();
    renderChannels();
  }

  function init() {
    applyI18n(document);
    paintLangToggles(document);
    paintMail();
    renderStats();
    renderChannels();
    renderBuyers();

    var btns = document.querySelectorAll("[data-set-lang]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        setLang(this.getAttribute("data-set-lang"));
      });
    }
    $("buyerSearch").addEventListener("input", renderBuyers);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  /* Exported for the test harness only — nothing on the page reads this. */
  if (typeof window !== "undefined") {
    window.__buyersPage = { row: row, matches: matches, typeLabel: typeLabel, PUBLIC_FIELDS: PUBLIC_FIELDS, BUYERS_EMAIL: BUYERS_EMAIL };
  }
})();
