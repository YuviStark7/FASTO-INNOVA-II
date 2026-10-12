# Buyer research for finished (packaged) products: REVIEW LIST

Item 32, pass H. Started 2026-10-12 by the daily run. **Decided by Yuvi in chat on 2026-10-12: approve all.** The approved rows were added to the database `buyers` table as p01 to p12 (12 rows, `confidence: low`, empty needs/volume/quality, not contacted). They are NOT in `js/data.js`, so they are not on the public `buyers.html`.

_(Original note: nothing here was in the buyers database before the decision.)_ Yuvi decides; only rows marked `approve` go in (a later step, additive, one row each, `confidence: low`, `source` filled from the link below).

## How to use this file

1. Read each candidate and open its source link.
2. Change the `Decision` cell to `approve`, `reject`, or `need more info`.
3. Tell the daily run "pass H decisions are in" and it will add the approved rows to `buyers` (and nothing else).

## Rules this list follows (CLAUDE.md "Data honesty")

- Every row has a real source I opened in a web search on 2026-10-12. "What the source says" is only what the search result stated, nothing added.
- I did NOT fill `needs`, `volume` or `quality_focus` for any row: those would be guesses. "Why it might fit" is my reasoning, labelled as such, and is not a fact about the business.
- No row goes on `buyers.html`. The businesses did not ask to be listed.
- Opening hours and whether a place still trades come from third-party directories and may be out of date; **none of these have been phoned or visited**.

## Candidates (10)

| # | Name | Type | Where | What the source says | Why it might fit finished products (my reasoning) | Source | Confidence | Decision |
|---|------|------|-------|----------------------|---------------------------------------------------|--------|-----------|----------|
| 1 | Il Rustico | Gastronomia / delicatessen | Piazza A. Labriola 3, Cassino | Gambero Rosso lists it as a gastronomia; sells local cured meats, raw-milk cheeses, smoked fish, caviar, sourdough bread; closed Thursday afternoon and Sunday; last evaluated 2024 | Already sells artisanal cheese and cured meats, so it is the closest match for cheese, preserves and similar products | https://www.gamberorosso.it/luoghi/locali/gastronomia/il-rustico | medium |  approve (added, id p01) |
| 2 | Qalici Vini e Salumi | Wine bar with cured-meat and cheese boards | Corso della Repubblica 83, Cassino | Raisin listing: Italian cured meats and cheeses of varied ageing, Iberian boards; closed Wednesdays | Builds boards from finished cheeses and meats, so a small-batch cheese producer could supply it | https://www.raisin.digital/en/explore/italy/lazio/venues/qalici-vini-e-salumi-27156/wines | medium |  approve (added, id p02) |
| 3 | Santo Bevitore Enoteca / Bottega | Wine bar, restaurant, wine shop with food | Via Guglielmo Marconi 8, Cassino | Raisin: wine bar and restaurant focused on natural wines and food; an earlier result showed the listing as closed at the time of the snapshot; Gambero Rosso also has a page for it | Natural-wine venues often stock small artisan food producers; **check it is still open** | https://www.raisin.digital/en/explore/italy/lazio/venues/santo-bevitore-enoteca-8218/ | low |  approve (added, id p03) |
| 4 | Panificio Lanni | Bakery with gastronomy and catering preparations | Via Garigliano 86, Cassino | Italia.it: active since 1987; bread, pizza, sweets, gastronomy and preparations for catering; takeaway | Uses cheese, preserves and similar ingredients in gastronomy and catering lines | https://www.italia.it/it/lazio/cassino/dove-mangiare/panificio-lanni | low |  approve (added, id p04) |
| 5 | Pasticceria Maria Casertano | Pastry shop | Via D'Annunzio 51, Cassino | Appears on the Too Good To Go app with festive sweet and savoury items | Weak fit for cheese; possible for jams, honey, nuts and similar products | https://www.toogoodtogo.com/it/find/cassino/pasticceriamariacasertanoviadannunzio/bakedgoods/salvalefeste-1097103 | low |  approve (added, id p05) |
| 6 | Enoteca Alzacalici | Enoteca (wine shop) listed under typical products | Corso Lucio Munazio Planco 421, Atina | Italia.it lists it under "prodotti tipici"; open Tuesday to Sunday | The one confirmed typical-products shop found in the Valle di Comino; likely to stock local finished foods | https://www.italia.it/it/lazio/atina/dove-mangiare/enoteca-alzacalici | medium |  approve (added, id p06) |
| 7 | Conad (four stores in Cassino) | Supermarket chain, local stores | Via G. Parini 35; Via Bellini 24; Via Casilina Nord km 136.200; Via Casilina Sud km 140.250 (listing); one more at Via Portogaleo, Santi Cosma e Damiano | DoveConviene lists these stores with phones and hours (aggregator, not official) | Local supermarkets sometimes take local products, but Conad stores are independent members of a cooperative, so the buying decision may sit with the cooperative; **needs a phone call to find out** | https://www.doveconviene.it/cassino/volantino/conad | low |  approve (added as ONE row, id p07) |
| 8 | Hotel Forum Palace congress centre | Hotel venue with banqueting | Cassino | Cvent: congress centre with five rooms for up to 350 people, hosts conferences and banquets | **Already in the buyers list as a hotel**; listed here only because the banqueting side may buy finished products. Probably no new row needed | https://cvent.com/venues/cassino/hotel/hotel-forum-palace/venue-b1099106-35ee-4fc1-879a-f51ae2c0d78b | low |  approve (already in the list as Forum Palace Hotel & Spa, b25: no new row) |
| 9 | Masci Eventi Catering & Banqueting | Caterer | Frosinone area (not confirmed in Cassino) | matrimonio.com lists it for 50 to 2,000 guests; wedding-oriented | Caterers buy finished foods in volume, but the listing does not confirm Cassino or non-wedding work | https://www.matrimonio.com/catering-matrimoni/frosinone | low |  approve (added, id p08) |
| 10 | Other Frosinone-area caterers on the same page (Evo Catering ed Eventi, Quarantacinquegiri, Girasoli Catering, Lá Eventi) | Caterers | Frosinone area (not confirmed in Cassino) | Named on the same matrimonio.com listing; no further detail | Same reasoning as 9; one row per business only if you want them | https://www.matrimonio.com/catering-matrimoni/frosinone | low |  approve (added as four rows, p09 to p12) |

## Leads that need more research (not candidates yet: no named business found)

- **Food wholesalers and cash & carry (Ho.Re.Ca.).** Dun & Bradstreet counts 67 grocery wholesalers in the Cassino area but its page shows no names (https://www.dnb.com/business-directory/company-information.grocery_and_related_product_merchant_wholesalers.it.frosinone.cassino.html). I found no dairy wholesaler in the province. These would buy in volume, so this is probably the most valuable gap. Suggested next step: ATECO 46.33 / 46.39 searches in the Frosinone Chamber of Commerce register, or you ask a producer who they sell to.
- **Gruppi di acquisto solidale (GAS).** No group for Cassino or the Valle di Comino turned up in search. They usually live on social media, so this needs a human check.
- **Typical-product shops in Cervaro, Sant'Elia Fiumerapido and San Vittore del Lazio.** Searches found none. Sant'Elia is known for olive oil (Città dell'Olio), which suggests oil producers rather than buyers.
- **Local butcher shops, delis (salumerie) and alimentari beyond Il Rustico.** The search tool returned few small-shop names for Cassino; Google Maps or a visit would find more.

## Honest summary

The search tool found **six named, plausible local buyers** (rows 1 to 6), **one chain whose stores are real but whose buying route is unknown** (7), and **three weak or duplicate rows** (8 to 10). It did not find wholesalers, which is what a cheese-slice producer would most want. I would approve 1, 2, 6 and perhaps 3, and treat the wholesaler lead as the real next research task.
