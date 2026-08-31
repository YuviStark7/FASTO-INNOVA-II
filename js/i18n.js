/* ============================================================
   FASTO INNOVA — UI language (Italiano / English)
   ------------------------------------------------------------
   Brain 1 already mirrors whatever language the farmer writes in.
   Everything AROUND that conversation — nav, buttons, tables, the
   sign-in card, every toast — was English only. This file is the
   dictionary and the handful of functions that apply it.

   WHERE THE LINE IS DRAWN, and it matters:
     - The app's OWN words are translated. That includes the
       scripted offline demo conversation, which is the app
       standing in for Brain 1 and is the one place the "Fasto
       speaks your language" promise was broken.
     - Anything a Brain actually produced is left exactly as it
       came out: Brain 2's written pitch sentences, its creative
       suggestions, and above all the outreach draft, which is
       deliberately Italian plus an English translation and is the
       one thing a real buyer ever reads.
     - The engine's own scoring reasons and Guardian warnings come
       out of js/core.js, the byte-for-byte tested engine, which
       is NOT touched by this work. They are translated at the
       boundary instead — see ENGINE_PATTERNS at the bottom, and
       the sync check in qa_check.js that fails loudly if core.js
       ever starts saying something new.

   The chosen language lives in localStorage only — NOT in the
   farmers table. The toggle has to work on the sign-in card,
   before there is an account to save it against, and one setting
   kept in two places is how the two drift apart. The cost is that
   a new device starts from the browser's language again.
   ============================================================ */

var LANG_KEY = "fasto_lang";
var LANGS = ["en", "it"];

var STRINGS = {

  /* ======================== English ======================== */
  en: {
    "doc.title": "Fasto Innova — AI for Cassino Farmers",
    "lang.aria": "Interface language",
    "lang.en": "EN",
    "lang.it": "IT",

    /* ---- sign in / sign up ---- */
    "auth.tag": "Sign in to keep your farm profile, chats and matches saved between visits.",
    "auth.tabIn": "Sign in",
    "auth.tabUp": "Sign up",
    "auth.email": "Email",
    "auth.emailPh": "you@example.com",
    "auth.password": "Password",
    "auth.passwordPh": "At least 6 characters",
    "auth.submitIn": "Sign in",
    "auth.submitUp": "Create account",
    "auth.hintIn": "New here? Switch to Sign up above — it only takes an email and a password.",
    "auth.hintUp": "Already have an account? Switch to Sign in above.",
    "auth.checking": "Checking your account…",
    "auth.signingIn": "Signing you in…",
    "auth.creating": "Creating your account…",
    "auth.needBoth": "Enter an email and a password.",
    "auth.tooShort": "Password must be at least 6 characters.",
    "auth.confirmEmail": "Check your email to confirm your account, then sign in.",
    "auth.generic": "Something went wrong.",

    /* ---- demo mode card ---- */
    "mode.tag": "The AI that helps small farmers around Cassino sell directly to nearby buyers. Prototype — MVP demo.",
    "mode.offline": "Offline demo (works instantly)",
    "mode.live": "Live AI (needs API key)",
    "mode.apiKey": "Anthropic API key",
    "mode.keyHint": "Get one at <a href=\"https://console.anthropic.com\" target=\"_blank\" rel=\"noopener\">console.anthropic.com</a> → API Keys. A full demo run costs a few cents. The key stays only in this browser — never saved to any file or repo.",
    "mode.model": "AI model",
    /* Plain "&", not "&amp;" — data-i18n writes textContent, so an entity here
       would be shown literally. Only the two data-i18n-html strings, which go
       through innerHTML, may contain markup. */
    "mode.modelHaiku": "Claude Haiku 4.5 — fast & cheap (recommended)",
    "mode.modelSonnet": "Claude Sonnet 5 — smarter, slightly slower",
    "mode.remember": "Remember key on this device only",
    "mode.enter": "Enter Fasto Innova",
    "mode.brains": "<b>Three brains:</b> Brain 1 interviews the farmer in plain language · Brain 2 matches &amp; ranks against a database of real Cassino buyers · Brain 3 (Guardian) validates everything moving between them, quietly, in the background.",
    "mode.badKey": "Paste a valid Anthropic API key (starts with sk-ant), or switch to Offline mode.",

    /* ---- shell ---- */
    "nav.dashboard": "Dashboard",
    "nav.clients": "Clients",
    "nav.assistant": "Fasto - AI",
    "nav.admin": "Admin",
    "pill.offline": "Offline demo",
    "pill.live": "Live · {model}",
    "top.welcome": "WELCOME,",
    "top.guest": "Guest Farmer",
    "top.searchPh": "Search chats, research…",
    "top.notSaved": "Not saved",
    "top.notSavedTitle": "Some changes couldn't be saved to your account",
    "top.bellTitle": "Drafts ready",
    "top.profileTitle": "Restart / change mode",
    "top.signOutConfirm": "Sign out and restart? Your saved data stays in your account for next time.",
    "top.signOutFailed": "Couldn't reach your account to sign out — you may still be signed in on this device.",
    "top.draftsReady": "{n} draft(s) ready to send",

    /* ---- boot ---- */
    "boot.account": "Loading your account…",
    "boot.buyers": "Loading the Cassino buyer database…",
    "boot.chats": "Loading your saved chats…",
    "boot.firstChat": "Setting up your first conversation…",
    "boot.loadFailed": "Couldn't load your saved data — starting fresh.",
    "boot.openFailed": "Something went wrong opening your account — you can still use the app, but some of it may be empty.",

    /* ---- dashboard ---- */
    "dash.title": "Research Progress",
    "dash.seeAll": "See all",
    "dash.seeAllN": "See all ({n})",
    "dash.showLatest": "Show latest 3",
    "dash.colConversation": "Conversation",
    "dash.colProduct": "Targeted product",
    "dash.colQuantity": "Quantity pledged",
    "dash.colPrice": "Price",
    "dash.colProgress": "Progress",
    "dash.empty": "No research yet — start a conversation in the Fasto-AI tab.",
    "dash.whyTitle": "See why these buyers were chosen",
    "dash.kgWk": "{n} kg/wk",
    "dash.pricePrompt": "Assumed price for {cat} (EUR/kg):",

    /* ---- conversation phase ---- */
    "phase.interview": "Interviewing",
    "phase.matching": "Matching",
    "phase.done": "Outreach ready",

    /* ---- dates ---- */
    "date.today": "Today",
    "date.yesterday": "Yesterday",
    "date.locale": "en-GB",

    /* ---- clients ---- */
    "clients.emptyList": "No matched buyers yet.",
    "clients.emptyListHint": "Talk to Fasto-AI to get your first match.",
    "clients.selectConv": "Select a conversation",
    "clients.sent": "Sent",
    "clients.draft": "Draft",
    "clients.draftedBy": "Drafted by Brain 2 · real message, not simulated",
    "clients.flagged": "⚠ Guardian adjusted a claim in this draft",
    "clients.profileEdited": "⚠ You corrected your farm details after this was written — check the figures before you send it",
    "clients.markSent": "Mark as sent",
    "clients.copyIt": "Copy Italian",
    "clients.englishTranslation": "English translation",
    "clients.attachTitle": "Attach (not needed for this demo)",
    "clients.typeHere": "Type your message here",
    "clients.sendTitle": "Send",
    "clients.logiTitle": "Set up logistics for this deal",
    "clients.logiAria": "Set up logistics",
    "clients.copied": "Copied",
    "clients.markedSent": "Marked as sent to {name}",

    /* ---- Fasto-AI screen ---- */
    "assist.newChat": "Start New Chat",
    "assist.thinking": "Fasto is thinking…",
    "assist.chip1": "Demo farmer (EN)",
    "assist.chip2": "Demo farmer (IT)",
    "assist.chip3": "Autumn chestnuts",
    "assist.newChatTitle": "New chat",
    "assist.chatCat": "Chat · {cat}",
    "assist.why": "Why these buyers?",
    "assist.editDetails": "Edit details",
    "assist.stillEmpty": "This chat is still empty — just type below to begin.",
    "assist.openedEmpty": "Opened your empty chat instead of starting another one.",
    "assist.blocked": "Message blocked by the Guardian for safety. Please rephrase.",
    "assist.guardianRejected": "The Guardian rejected the profile: {errors}",
    "assist.brain2Analysing": "Brain 2 is analysing {n} verified Cassino buyers…",
    "assist.finished": "Done! I found the best matches for you — check Clients for the outreach draft.",
    "assist.greetOffline": "Buongiorno! (Offline demo) I'm the Fasto Innova assistant. Press a sample chip or say hello to begin.",
    "assist.greetLive": "Buongiorno! I'm the Fasto Innova assistant. I help small farmers around Cassino find the right local buyers — no forms, just a chat. What's your name, and what do you grow?",

    /* ---- offline scripted demo (the app standing in for Brain 1) ---- */
    "offline.q1": "Buongiorno! I'm the Fasto Innova assistant. First — what's your name?",
    "offline.q2": "Nice to meet you! Now tell me — what do you grow on your farm?",
    "offline.q3": "Lovely! And roughly how many kilograms per week can you offer, for each product?",
    "offline.q4": "Great. Which months of the year is your produce available, and where is your farm (village and rough distance from Cassino)?",
    "offline.q5": "Last question: do you have an organic certification — yes, no, or partially?",
    "offline.q6": "Perfect, let me summarise: tomatoes ~80 kg/week and zucchine ~40 kg/week, June–October, near Sant'Elia Fiumerapido (~6 km), no organic certification. Shall I search for matches?",

    /* ---- match sheet ---- */
    "match.title": "Why these buyers",
    "match.foot": "Ranked by Fasto's scoring engine, written up by Brain 2, checked by the Guardian. Every buyer here comes from the verified Cassino database — never invented.",
    "match.close": "Close",
    "match.subtitle": "{title} · top {n} of {pool} verified Cassino entries",
    "match.kmFrom": "{n} km from Cassino",
    "match.kgWeek": "{n} kg/week",
    "match.organic": "Organic",
    "match.partlyOrganic": "Partly organic",
    "match.notOrganic": "Not certified organic",
    "match.channel": "Channel",
    "match.best": "Best matches",
    "match.ideas": "Ideas worth trying",
    "match.stale": "You changed these details after Fasto wrote its notes on them. The scores and reasons above have been worked out again from the new numbers; the written notes were about the old ones, so they aren't shown.",
    "match.noNotes": "Brain 2's written notes and ideas belong to the conversation that produced them and aren't saved yet, so an older chat shows the scoring reasons only.",
    "match.none": "This conversation hasn't produced any matches yet.",

    /* ---- logistics sheet ---- */
    "logi.title": "Set up logistics",
    "logi.subtitle": "Your farm → {buyer}",
    "logi.submit": "Send to logistics partner",
    "logi.sending": "Sending…",
    "logi.foot": "Goes to Fasto's logistics partner, who arranges pickup and delivery. Nothing is sent to the buyer from here.",
    "logi.intro": "Fasto's logistics partner arranges pickup and delivery — nobody needs a van. Check the details, then both sides confirm and it goes straight to the partner.",
    "logi.whatMoving": "What is moving",
    "logi.fromChat": "From your conversation",
    "logi.product": "Product",
    "logi.productPh": "e.g. Tomatoes",
    "logi.qty": "Quantity",
    "logi.qtyPh": "e.g. 80 kg per week",
    "logi.qtyValue": "{n} kg per week",
    "logi.months": "Available months",
    "logi.monthsPh": "e.g. June, July, August",
    "logi.firstPickup": "First pickup",
    "logi.pickupHead": "Pickup — your details",
    "logi.savedNextTime": "Saved for next time",
    "logi.farmName": "Farm / company name",
    "logi.contactName": "Contact name",
    "logi.vat": "Partita IVA",
    "logi.vatPh": "Leave blank if you don't have one",
    "logi.phone": "Phone",
    "logi.pickupAddress": "Pickup address",
    "logi.addressPh": "Street, town, province",
    "logi.deliveryHead": "Delivery — buyer's details",
    "logi.demoData": "Demo data",
    "logi.demoNote": "Buyers don't have Fasto accounts yet, so this half starts as placeholder text. Overwrite anything you've actually agreed with them — the email flags which fields are still placeholders.",
    "logi.businessName": "Business name",
    "logi.deliveryAddress": "Delivery address",
    "logi.driverNotes": "Notes for the driver",
    "logi.driverNotesPh": "Access, cold chain, best time of day…",
    "logi.confirmF": "The farmer confirms these details",
    "logi.confirmB": "The buyer confirms these details",
    "logi.missing": "Still needed: {list}.",
    "logi.bothConfirm": "Both sides have to confirm before this goes to the logistics partner.",
    "logi.needProduct": "the product",
    "logi.needQty": "the quantity",
    "logi.needFarmName": "your farm name",
    "logi.needContact": "your contact name",
    "logi.needPhone": "your phone number",
    "logi.needAddress": "your pickup address",
    "logi.needBBusiness": "the buyer's business name",
    "logi.needBContact": "the buyer's contact name",
    "logi.needBPhone": "the buyer's phone",
    "logi.needBAddress": "the delivery address",
    "logi.sentToast": "Sent to the logistics partner. They'll be in touch to arrange pickup.",
    "logi.sentNote": "Logistics request sent to Fasto's partner — {product}, {qty}.",
    "logi.activation": "This inbox still has to be activated once: FormSubmit has emailed {email} a confirmation link. Click it, then send again.",
    "logi.failed": "Couldn't reach the logistics partner ({error}). Your details were saved — try again in a moment.",

    /* ---- profile editor ---- */
    "profile.title": "Your farm details",
    "profile.subtitle": "{title} · taken from your conversation with Fasto",
    "profile.save": "Save changes",
    "profile.foot": "Saved to your account and used to work your matches out again. Nothing here is sent to a buyer.",
    "profile.intro": "This is what Fasto understood from your conversation. Correct anything that isn't right — your matches are re-scored from it as soon as you save.",
    "profile.yourFarm": "Your farm",
    "profile.name": "Your name",
    "profile.namePh": "Leave blank to stay anonymous",
    "profile.village": "Village or area",
    "profile.villagePh": "e.g. Sant'Elia Fiumerapido",
    "profile.distance": "Distance from Cassino (km)",
    "profile.distancePh": "roughly",
    "profile.organic": "Organic certification",
    "profile.organicYes": "Yes, certified",
    "profile.organicPartial": "Partly certified",
    "profile.organicNo": "No certification",
    "profile.whatYouGrow": "What you grow",
    "profile.perWeek": "Quantities are per week",
    "profile.addProduct": "Add a product",
    "profile.noProducts": "Nothing left to sell here — add at least one product, or there is nothing for Fasto to match you on.",
    "profile.productN": "Product {n}",
    "profile.remove": "Remove",
    "profile.whatIsIt": "What is it",
    "profile.whatIsItPh": "e.g. Pomodori",
    "profile.category": "Category",
    "profile.kgWeek": "Kg per week",
    "profile.kgWeekPh": "e.g. 80",
    "profile.monthsHead": "Months you can supply",
    "profile.monthsHint": "All off = all year round",
    "profile.gone": "This conversation is no longer open.",
    "profile.needName": "Product {n} still needs a name.",
    "profile.needKg": "How many kg per week of {name}?",
    "profile.nothingChanged": "Nothing to change — these details are already what Fasto has.",
    "profile.updated": "Updated {list}.",
    "profile.rescored": " Matches re-scored.",
    "profile.staleDraft": " Your outreach draft still has the old wording — check it before sending.",
    "profile.adjustedOne": "Saved. Fasto adjusted one thing on the way through: {list}",
    "profile.adjustedMany": "Saved. Fasto adjusted {n} things on the way through: {list}",
    "profile.fld.farmer_name": "your name",
    "profile.fld.village": "your village",
    "profile.fld.distance_km_from_cassino": "the distance from Cassino",
    "profile.fld.organic": "your organic status",
    "profile.fld.available_months": "your available months",
    "profile.fld.products": "your products",
    "list.and": "and",

    /* ---- admin ---- */
    "admin.funnelTitle": "Funnel — where conversations stop",
    "admin.everyConv": "Every conversation",
    "admin.showAll": "Show all",
    "admin.colFarmer": "Farmer",
    "admin.colConversation": "Conversation",
    "admin.colLocation": "Location",
    "admin.colProgress": "Progress",
    "admin.colOutreach": "Outreach",
    "admin.empty": "No farmer activity yet.",
    "admin.emptyStage": "No conversation has reached this stage yet.",
    "admin.loadFailed": "Couldn't load admin overview.",
    "admin.unnamed": "Unnamed farmer",
    "admin.stage.started": "Conversations started",
    "admin.stage.profile": "Farm profile captured",
    "admin.stage.drafted": "Buyers matched, outreach written",
    "admin.stage.sent": "Outreach sent",
    "admin.hint.started": "A farmer opened a chat with Fasto.",
    "admin.hint.profile": "Brain 1 finished the interview and the farm details were saved.",
    "admin.hint.drafted": "Brain 2 ranked the buyers and wrote an outreach draft.",
    "admin.hint.sent": "The farmer marked a draft as sent to the buyer.",
    "admin.dropped": "<b>{n}</b> stopped here · {pct}% carried on",
    "admin.allCarried": "all {n} carried on",
    "admin.farmers": "{n} farmer signed up",
    "admin.farmersPl": "{n} farmers signed up",
    "admin.drafts": "{n} draft written · {sent} sent",
    "admin.draftsPl": "{n} drafts written · {sent} sent",
    "admin.orphan": "{n} draft with no matching conversation",
    "admin.orphanPl": "{n} drafts with no matching conversation",
    "admin.titleN": "{label} ({n})",

    /* ---- background-save failures ---- */
    "save.couldnt": "Couldn't save {what} to your account — fine for now, but it may not be here next time.",
    "save.one": "1 change couldn't be saved to your account. It's still here for this session, but it may not be next time.",
    "save.many": "{n} changes couldn't be saved to your account. They're still here for this session, but may not be next time.",
    "save.newChat": "this new chat",
    "save.newChatMsg": "Couldn't save this chat to your account — it will only last this session.",
    "save.message": "this message",
    "save.profile": "your farm profile",
    "save.products": "your product list",
    "save.name": "your name",
    "save.progress": "this chat's progress",
    "save.matches": "your buyer matches",
    "save.outreach": "the outreach draft",
    "save.outreachMsg": "Couldn't save the outreach draft to your account — it will only last this session.",
    "save.outreachUpdate": "the updated outreach draft",
    "save.sentMark": "the \"sent\" mark on this draft",
    "save.business": "your business details",

    /* ---- category labels (the stored value is always the Italian key) ---- */
    "cat.verdure": "vegetables", "cat.pomodori": "tomatoes", "cat.frutta": "fruit",
    "cat.legumi": "legumes", "cat.olio": "oil", "cat.vino": "wine", "cat.uova": "eggs",
    "cat.formaggi": "cheese", "cat.carne": "meat", "cat.erbe": "herbs",
    "cat.castagne": "chestnuts", "cat.miele": "honey", "cat.conserve": "preserves",

    /* ---- months ---- */
    "month.1": "January", "month.2": "February", "month.3": "March", "month.4": "April",
    "month.5": "May", "month.6": "June", "month.7": "July", "month.8": "August",
    "month.9": "September", "month.10": "October", "month.11": "November", "month.12": "December",

    /* ---- volume bands, used inside the engine's own reason sentences ---- */
    "band.low": "low", "band.medium": "medium", "band.high": "high"
  },

  /* ======================== Italiano ======================== */
  it: {
    "doc.title": "Fasto Innova — l'AI per gli agricoltori di Cassino",
    "lang.aria": "Lingua dell'interfaccia",
    "lang.en": "EN",
    "lang.it": "IT",

    "auth.tag": "Accedi per conservare il profilo della tua azienda, le chat e gli abbinamenti da una visita all'altra.",
    "auth.tabIn": "Accedi",
    "auth.tabUp": "Registrati",
    "auth.email": "Email",
    "auth.emailPh": "tu@esempio.com",
    "auth.password": "Password",
    "auth.passwordPh": "Almeno 6 caratteri",
    "auth.submitIn": "Accedi",
    "auth.submitUp": "Crea l'account",
    "auth.hintIn": "Prima volta qui? Passa a Registrati qui sopra: bastano un'email e una password.",
    "auth.hintUp": "Hai già un account? Passa ad Accedi qui sopra.",
    "auth.checking": "Controllo il tuo account…",
    "auth.signingIn": "Accesso in corso…",
    "auth.creating": "Creo il tuo account…",
    "auth.needBoth": "Inserisci un'email e una password.",
    "auth.tooShort": "La password deve avere almeno 6 caratteri.",
    "auth.confirmEmail": "Controlla la tua email per confermare l'account, poi accedi.",
    "auth.generic": "Qualcosa è andato storto.",

    "mode.tag": "L'AI che aiuta i piccoli agricoltori intorno a Cassino a vendere direttamente agli acquirenti della zona. Prototipo — demo MVP.",
    "mode.offline": "Demo offline (funziona subito)",
    "mode.live": "AI dal vivo (serve una chiave API)",
    "mode.apiKey": "Chiave API Anthropic",
    "mode.keyHint": "Puoi ottenerne una su <a href=\"https://console.anthropic.com\" target=\"_blank\" rel=\"noopener\">console.anthropic.com</a> → API Keys. Una demo completa costa pochi centesimi. La chiave resta solo in questo browser — non viene mai salvata in nessun file o repository.",
    "mode.model": "Modello AI",
    "mode.modelHaiku": "Claude Haiku 4.5 — veloce ed economico (consigliato)",
    "mode.modelSonnet": "Claude Sonnet 5 — più bravo, un po' più lento",
    "mode.remember": "Ricorda la chiave solo su questo dispositivo",
    "mode.enter": "Entra in Fasto Innova",
    "mode.brains": "<b>Tre cervelli:</b> il Cervello 1 intervista l'agricoltore con parole semplici · il Cervello 2 cerca e ordina gli abbinamenti su un database di acquirenti reali di Cassino · il Cervello 3 (Guardian) controlla in silenzio tutto ciò che passa tra i due.",
    "mode.badKey": "Incolla una chiave API Anthropic valida (inizia con sk-ant), oppure passa alla modalità offline.",

    "nav.dashboard": "Cruscotto",
    "nav.clients": "Clienti",
    "nav.assistant": "Fasto - AI",
    "nav.admin": "Admin",
    "pill.offline": "Demo offline",
    "pill.live": "Dal vivo · {model}",
    "top.welcome": "BENVENUTO,",
    "top.guest": "Agricoltore ospite",
    "top.searchPh": "Cerca chat, ricerche…",
    "top.notSaved": "Non salvato",
    "top.notSavedTitle": "Alcune modifiche non sono state salvate nel tuo account",
    "top.bellTitle": "Bozze pronte",
    "top.profileTitle": "Riavvia / cambia modalità",
    "top.signOutConfirm": "Vuoi uscire e ricominciare? I tuoi dati restano salvati nel tuo account per la prossima volta.",
    "top.signOutFailed": "Non sono riuscito a contattare il tuo account per uscire — potresti essere ancora connesso su questo dispositivo.",
    "top.draftsReady": "{n} bozza/e pronta/e da inviare",

    "boot.account": "Carico il tuo account…",
    "boot.buyers": "Carico il database degli acquirenti di Cassino…",
    "boot.chats": "Carico le tue chat salvate…",
    "boot.firstChat": "Preparo la tua prima conversazione…",
    "boot.loadFailed": "Non sono riuscito a caricare i tuoi dati salvati — ricomincio da zero.",
    "boot.openFailed": "Qualcosa è andato storto nell'aprire il tuo account — puoi comunque usare l'app, ma qualche parte potrebbe essere vuota.",

    "dash.title": "Avanzamento ricerche",
    "dash.seeAll": "Vedi tutte",
    "dash.seeAllN": "Vedi tutte ({n})",
    "dash.showLatest": "Mostra le ultime 3",
    "dash.colConversation": "Conversazione",
    "dash.colProduct": "Prodotto principale",
    "dash.colQuantity": "Quantità dichiarata",
    "dash.colPrice": "Prezzo",
    "dash.colProgress": "Avanzamento",
    "dash.empty": "Ancora nessuna ricerca — inizia una conversazione nella scheda Fasto-AI.",
    "dash.whyTitle": "Scopri perché sono stati scelti questi acquirenti",
    "dash.kgWk": "{n} kg/sett",
    "dash.pricePrompt": "Prezzo ipotizzato per {cat} (EUR/kg):",

    "phase.interview": "Intervista in corso",
    "phase.matching": "Ricerca abbinamenti",
    "phase.done": "Messaggio pronto",

    "date.today": "Oggi",
    "date.yesterday": "Ieri",
    "date.locale": "it-IT",

    "clients.emptyList": "Ancora nessun acquirente abbinato.",
    "clients.emptyListHint": "Parla con Fasto-AI per ottenere il primo abbinamento.",
    "clients.selectConv": "Seleziona una conversazione",
    "clients.sent": "Inviato",
    "clients.draft": "Bozza",
    "clients.draftedBy": "Scritto dal Cervello 2 · messaggio reale, non simulato",
    "clients.flagged": "⚠ Il Guardian ha corretto un'affermazione in questa bozza",
    "clients.profileEdited": "⚠ Hai corretto i dati della tua azienda dopo che questo testo è stato scritto — controlla i numeri prima di inviarlo",
    "clients.markSent": "Segna come inviato",
    "clients.copyIt": "Copia l'italiano",
    "clients.englishTranslation": "Traduzione in inglese",
    "clients.attachTitle": "Allega (non serve per questa demo)",
    "clients.typeHere": "Scrivi qui il tuo messaggio",
    "clients.sendTitle": "Invia",
    "clients.logiTitle": "Organizza la logistica per questo accordo",
    "clients.logiAria": "Organizza la logistica",
    "clients.copied": "Copiato",
    "clients.markedSent": "Segnato come inviato a {name}",

    "assist.newChat": "Nuova chat",
    "assist.thinking": "Fasto sta pensando…",
    "assist.chip1": "Agricoltore demo (EN)",
    "assist.chip2": "Contadino demo (IT)",
    "assist.chip3": "Castagne d'autunno",
    "assist.newChatTitle": "Nuova chat",
    "assist.chatCat": "Chat · {cat}",
    "assist.why": "Perché questi acquirenti?",
    "assist.editDetails": "Modifica i dati",
    "assist.stillEmpty": "Questa chat è ancora vuota — scrivi qui sotto per iniziare.",
    "assist.openedEmpty": "Ho aperto la tua chat vuota invece di crearne un'altra.",
    "assist.blocked": "Messaggio bloccato dal Guardian per sicurezza. Prova a riformularlo.",
    "assist.guardianRejected": "Il Guardian ha rifiutato il profilo: {errors}",
    "assist.brain2Analysing": "Il Cervello 2 sta analizzando {n} acquirenti verificati di Cassino…",
    "assist.finished": "Fatto! Ho trovato gli abbinamenti migliori per te — la bozza del messaggio è nella scheda Clienti.",
    "assist.greetOffline": "Buongiorno! (Demo offline) Sono l'assistente di Fasto Innova. Tocca uno degli esempi qui sotto oppure salutami per cominciare.",
    "assist.greetLive": "Buongiorno! Sono l'assistente di Fasto Innova. Aiuto i piccoli agricoltori intorno a Cassino a trovare gli acquirenti giusti — niente moduli, solo due parole. Come ti chiami e cosa coltivi?",

    "offline.q1": "Buongiorno! Sono l'assistente di Fasto Innova. Per cominciare — come ti chiami?",
    "offline.q2": "Piacere di conoscerti! Ora dimmi — cosa coltivi nella tua azienda?",
    "offline.q3": "Benissimo! E all'incirca quanti chili a settimana riesci a offrire, per ogni prodotto?",
    "offline.q4": "Ottimo. In quali mesi dell'anno è disponibile il tuo prodotto, e dove si trova l'azienda (paese e distanza approssimativa da Cassino)?",
    "offline.q5": "Ultima domanda: hai una certificazione biologica — sì, no, o solo in parte?",
    "offline.q6": "Perfetto, riassumo: pomodori ~80 kg a settimana e zucchine ~40 kg a settimana, da giugno a ottobre, vicino Sant'Elia Fiumerapido (~6 km), nessuna certificazione biologica. Cerco gli abbinamenti?",

    "match.title": "Perché questi acquirenti",
    "match.foot": "Ordinati dal motore di punteggio di Fasto, descritti dal Cervello 2, controllati dal Guardian. Ogni acquirente qui viene dal database verificato di Cassino — mai inventato.",
    "match.close": "Chiudi",
    "match.subtitle": "{title} · i migliori {n} su {pool} schede verificate di Cassino",
    "match.kmFrom": "{n} km da Cassino",
    "match.kgWeek": "{n} kg a settimana",
    "match.organic": "Biologico",
    "match.partlyOrganic": "In parte biologico",
    "match.notOrganic": "Senza certificazione bio",
    "match.channel": "Canale",
    "match.best": "Abbinamenti migliori",
    "match.ideas": "Idee da provare",
    "match.stale": "Hai cambiato questi dati dopo che Fasto aveva scritto le sue note. I punteggi e le motivazioni qui sopra sono stati ricalcolati sui numeri nuovi; le note scritte parlavano di quelli vecchi, quindi non vengono mostrate.",
    "match.noNotes": "Le note e le idee scritte dal Cervello 2 appartengono alla conversazione che le ha prodotte e non vengono ancora salvate, quindi una chat più vecchia mostra solo le motivazioni del punteggio.",
    "match.none": "Questa conversazione non ha ancora prodotto abbinamenti.",

    "logi.title": "Organizza la logistica",
    "logi.subtitle": "La tua azienda → {buyer}",
    "logi.submit": "Invia al partner logistico",
    "logi.sending": "Invio in corso…",
    "logi.foot": "Va al partner logistico di Fasto, che organizza ritiro e consegna. Da qui non viene inviato nulla all'acquirente.",
    "logi.intro": "Il partner logistico di Fasto organizza ritiro e consegna — non serve un furgone a nessuno. Controlla i dati, poi entrambe le parti confermano e la richiesta parte direttamente al partner.",
    "logi.whatMoving": "Cosa si sposta",
    "logi.fromChat": "Dalla tua conversazione",
    "logi.product": "Prodotto",
    "logi.productPh": "es. Pomodori",
    "logi.qty": "Quantità",
    "logi.qtyPh": "es. 80 kg a settimana",
    "logi.qtyValue": "{n} kg a settimana",
    "logi.months": "Mesi di disponibilità",
    "logi.monthsPh": "es. giugno, luglio, agosto",
    "logi.firstPickup": "Primo ritiro",
    "logi.pickupHead": "Ritiro — i tuoi dati",
    "logi.savedNextTime": "Salvati per la prossima volta",
    "logi.farmName": "Nome dell'azienda",
    "logi.contactName": "Nome del referente",
    "logi.vat": "Partita IVA",
    "logi.vatPh": "Lascia vuoto se non ce l'hai",
    "logi.phone": "Telefono",
    "logi.pickupAddress": "Indirizzo di ritiro",
    "logi.addressPh": "Via, comune, provincia",
    "logi.deliveryHead": "Consegna — dati dell'acquirente",
    "logi.demoData": "Dati di esempio",
    "logi.demoNote": "Gli acquirenti non hanno ancora un account Fasto, quindi questa metà parte con dati di esempio. Sovrascrivi tutto quello che hai davvero concordato con loro — l'email segnala quali campi sono rimasti di esempio.",
    "logi.businessName": "Ragione sociale",
    "logi.deliveryAddress": "Indirizzo di consegna",
    "logi.driverNotes": "Note per l'autista",
    "logi.driverNotesPh": "Accesso, catena del freddo, orario migliore…",
    "logi.confirmF": "L'agricoltore conferma questi dati",
    "logi.confirmB": "L'acquirente conferma questi dati",
    "logi.missing": "Manca ancora: {list}.",
    "logi.bothConfirm": "Entrambe le parti devono confermare prima che la richiesta vada al partner logistico.",
    "logi.needProduct": "il prodotto",
    "logi.needQty": "la quantità",
    "logi.needFarmName": "il nome della tua azienda",
    "logi.needContact": "il tuo nome",
    "logi.needPhone": "il tuo numero di telefono",
    "logi.needAddress": "il tuo indirizzo di ritiro",
    "logi.needBBusiness": "la ragione sociale dell'acquirente",
    "logi.needBContact": "il nome del referente dell'acquirente",
    "logi.needBPhone": "il telefono dell'acquirente",
    "logi.needBAddress": "l'indirizzo di consegna",
    "logi.sentToast": "Inviata al partner logistico. Ti contatteranno per organizzare il ritiro.",
    "logi.sentNote": "Richiesta logistica inviata al partner di Fasto — {product}, {qty}.",
    "logi.activation": "Questa casella deve ancora essere attivata una volta: FormSubmit ha inviato a {email} un link di conferma. Cliccalo, poi riprova a inviare.",
    "logi.failed": "Non sono riuscito a contattare il partner logistico ({error}). I tuoi dati sono stati salvati — riprova tra un momento.",

    "profile.title": "I dati della tua azienda",
    "profile.subtitle": "{title} · presi dalla tua conversazione con Fasto",
    "profile.save": "Salva le modifiche",
    "profile.foot": "Salvati nel tuo account e usati per ricalcolare i tuoi abbinamenti. Niente di tutto questo viene inviato a un acquirente.",
    "profile.intro": "Questo è ciò che Fasto ha capito dalla tua conversazione. Correggi quello che non va — i tuoi abbinamenti vengono ricalcolati non appena salvi.",
    "profile.yourFarm": "La tua azienda",
    "profile.name": "Il tuo nome",
    "profile.namePh": "Lascia vuoto per restare anonimo",
    "profile.village": "Paese o zona",
    "profile.villagePh": "es. Sant'Elia Fiumerapido",
    "profile.distance": "Distanza da Cassino (km)",
    "profile.distancePh": "all'incirca",
    "profile.organic": "Certificazione biologica",
    "profile.organicYes": "Sì, certificato",
    "profile.organicPartial": "In parte certificato",
    "profile.organicNo": "Nessuna certificazione",
    "profile.whatYouGrow": "Cosa coltivi",
    "profile.perWeek": "Le quantità sono settimanali",
    "profile.addProduct": "Aggiungi un prodotto",
    "profile.noProducts": "Qui non è rimasto niente da vendere — aggiungi almeno un prodotto, altrimenti Fasto non ha su cosa abbinarti.",
    "profile.productN": "Prodotto {n}",
    "profile.remove": "Rimuovi",
    "profile.whatIsIt": "Di cosa si tratta",
    "profile.whatIsItPh": "es. Pomodori",
    "profile.category": "Categoria",
    "profile.kgWeek": "Kg a settimana",
    "profile.kgWeekPh": "es. 80",
    "profile.monthsHead": "Mesi in cui puoi fornire",
    "profile.monthsHint": "Tutti spenti = tutto l'anno",
    "profile.gone": "Questa conversazione non è più aperta.",
    "profile.needName": "Il prodotto {n} deve ancora avere un nome.",
    "profile.needKg": "Quanti kg a settimana di {name}?",
    "profile.nothingChanged": "Non c'è niente da cambiare — questi dati sono già quelli che Fasto ha.",
    "profile.updated": "Ho aggiornato {list}.",
    "profile.rescored": " Abbinamenti ricalcolati.",
    "profile.staleDraft": " La tua bozza di messaggio ha ancora il testo vecchio — controllala prima di inviarla.",
    "profile.adjustedOne": "Salvato. Fasto ha corretto una cosa strada facendo: {list}",
    "profile.adjustedMany": "Salvato. Fasto ha corretto {n} cose strada facendo: {list}",
    "profile.fld.farmer_name": "il tuo nome",
    "profile.fld.village": "il tuo paese",
    "profile.fld.distance_km_from_cassino": "la distanza da Cassino",
    "profile.fld.organic": "il tuo stato biologico",
    "profile.fld.available_months": "i tuoi mesi di disponibilità",
    "profile.fld.products": "i tuoi prodotti",
    "list.and": "e",

    "admin.funnelTitle": "Imbuto — dove si fermano le conversazioni",
    "admin.everyConv": "Tutte le conversazioni",
    "admin.showAll": "Mostra tutte",
    "admin.colFarmer": "Agricoltore",
    "admin.colConversation": "Conversazione",
    "admin.colLocation": "Luogo",
    "admin.colProgress": "Avanzamento",
    "admin.colOutreach": "Contatto",
    "admin.empty": "Ancora nessuna attività degli agricoltori.",
    "admin.emptyStage": "Nessuna conversazione è ancora arrivata a questo punto.",
    "admin.loadFailed": "Non sono riuscito a caricare il quadro admin.",
    "admin.unnamed": "Agricoltore senza nome",
    "admin.stage.started": "Conversazioni iniziate",
    "admin.stage.profile": "Profilo azienda raccolto",
    "admin.stage.drafted": "Acquirenti abbinati, messaggio scritto",
    "admin.stage.sent": "Messaggio inviato",
    "admin.hint.started": "Un agricoltore ha aperto una chat con Fasto.",
    "admin.hint.profile": "Il Cervello 1 ha finito l'intervista e i dati dell'azienda sono stati salvati.",
    "admin.hint.drafted": "Il Cervello 2 ha ordinato gli acquirenti e scritto una bozza di messaggio.",
    "admin.hint.sent": "L'agricoltore ha segnato una bozza come inviata all'acquirente.",
    "admin.dropped": "<b>{n}</b> si sono fermate qui · il {pct}% è andato avanti",
    "admin.allCarried": "tutte e {n} sono andate avanti",
    "admin.farmers": "{n} agricoltore registrato",
    "admin.farmersPl": "{n} agricoltori registrati",
    "admin.drafts": "{n} bozza scritta · {sent} inviata",
    "admin.draftsPl": "{n} bozze scritte · {sent} inviate",
    "admin.orphan": "{n} bozza senza conversazione corrispondente",
    "admin.orphanPl": "{n} bozze senza conversazione corrispondente",
    "admin.titleN": "{label} ({n})",

    "save.couldnt": "Non sono riuscito a salvare {what} nel tuo account — per ora va bene, ma potrebbe non esserci la prossima volta.",
    "save.one": "1 modifica non è stata salvata nel tuo account. È ancora qui per questa sessione, ma potrebbe non esserlo la prossima volta.",
    "save.many": "{n} modifiche non sono state salvate nel tuo account. Sono ancora qui per questa sessione, ma potrebbero non esserlo la prossima volta.",
    "save.newChat": "questa nuova chat",
    "save.newChatMsg": "Non sono riuscito a salvare questa chat nel tuo account — durerà solo per questa sessione.",
    "save.message": "questo messaggio",
    "save.profile": "il profilo della tua azienda",
    "save.products": "la tua lista prodotti",
    "save.name": "il tuo nome",
    "save.progress": "l'avanzamento di questa chat",
    "save.matches": "i tuoi abbinamenti",
    "save.outreach": "la bozza del messaggio",
    "save.outreachMsg": "Non sono riuscito a salvare la bozza del messaggio nel tuo account — durerà solo per questa sessione.",
    "save.outreachUpdate": "la bozza aggiornata",
    "save.sentMark": "il segno «inviato» su questa bozza",
    "save.business": "i dati della tua attività",

    "cat.verdure": "verdure", "cat.pomodori": "pomodori", "cat.frutta": "frutta",
    "cat.legumi": "legumi", "cat.olio": "olio", "cat.vino": "vino", "cat.uova": "uova",
    "cat.formaggi": "formaggi", "cat.carne": "carne", "cat.erbe": "erbe",
    "cat.castagne": "castagne", "cat.miele": "miele", "cat.conserve": "conserve",

    "month.1": "gennaio", "month.2": "febbraio", "month.3": "marzo", "month.4": "aprile",
    "month.5": "maggio", "month.6": "giugno", "month.7": "luglio", "month.8": "agosto",
    "month.9": "settembre", "month.10": "ottobre", "month.11": "novembre", "month.12": "dicembre",

    "band.low": "basso", "band.medium": "medio", "band.high": "alto"
  }
};

/* ---------- which language ----------
   The browser first, not a hard-coded default. Nearly every real user of this
   app is on an Italian phone and gets Italian without anyone having decided to
   force it on the tutors and reviewers who are not. */
function detectLang() {
  try {
    var saved = localStorage.getItem(LANG_KEY);
    if (LANGS.indexOf(saved) !== -1) return saved;
  } catch (e) { /* storage blocked (private mode) — fall through to the browser */ }
  var nav = (typeof navigator !== "undefined" && (navigator.language || (navigator.languages || [])[0])) || "";
  return String(nav).toLowerCase().indexOf("it") === 0 ? "it" : "en";
}

var LANG = detectLang();
function currentLang() { return LANG; }

/* T is the lookup. Capital on purpose: several functions in app.js already have
   a local `const t = ...`, which would shadow a lowercase global and turn every
   string inside them into a TypeError. */
function T(key, vars) {
  var table = STRINGS[LANG] || STRINGS.en;
  var s = table[key];
  if (s == null) s = STRINGS.en[key];   // missing from a translation → fall back rather than vanish
  if (s == null) return key;            // missing everywhere → show the key, so it gets noticed
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, function (m, name) {
    return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
  });
}

/* ---------- applying it to the static markup ----------
   data-i18n               → textContent
   data-i18n-html          → innerHTML. Only ever fed from the dictionary
                             above, never from anything a user typed — the two
                             strings that need it contain a link and a <b>.
   data-i18n-ph/title/aria → placeholder / title / aria-label  */
function applyI18n(root) {
  var scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope || !scope.querySelectorAll) return;
  var each = function (attr, fn) {
    var list = scope.querySelectorAll("[" + attr + "]");
    for (var i = 0; i < list.length; i++) fn(list[i], list[i].getAttribute(attr));
  };
  each("data-i18n", function (el, k) { el.textContent = T(k); });
  each("data-i18n-html", function (el, k) { el.innerHTML = T(k); });
  each("data-i18n-ph", function (el, k) { el.setAttribute("placeholder", T(k)); });
  each("data-i18n-title", function (el, k) { el.setAttribute("title", T(k)); });
  each("data-i18n-aria", function (el, k) { el.setAttribute("aria-label", T(k)); });
  var docEl = scope.documentElement || (scope.ownerDocument && scope.ownerDocument.documentElement);
  if (docEl) docEl.setAttribute("lang", LANG);
}

/* Changes the language and says whether anything actually changed, so the
   caller can skip a full re-render when the answer is no. Storing is allowed to
   fail (private browsing) without taking the switch down with it. */
function setLangValue(lang) {
  if (LANGS.indexOf(lang) === -1 || lang === LANG) return false;
  LANG = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* session-only, better than refusing */ }
  return true;
}

/* Marks the pressed button on every language toggle on the page — there is one
   on each onboarding card and one in the topbar, and they have to agree. */
function paintLangToggles(scope) {
  var doc = scope || (typeof document !== "undefined" ? document : null);
  if (!doc || !doc.querySelectorAll) return;
  var btns = doc.querySelectorAll("[data-set-lang]");
  for (var i = 0; i < btns.length; i++) {
    var on = btns[i].getAttribute("data-set-lang") === LANG;
    if (on) btns[i].classList.add("active"); else btns[i].classList.remove("active");
    btns[i].setAttribute("aria-pressed", on ? "true" : "false");
  }
}

/* ---------- helpers over the dictionary ----------
   catLabel() is display only. The stored value stays the Italian key the
   database and the engine agree on (verdure / pomodori / …) — translating a
   label must never change what gets written to a row. */
function catLabel(key) { return key ? T("cat." + key) : ""; }
function monthName(n) { return T("month." + n); }
function monthNames() {
  var out = [];
  for (var i = 1; i <= 12; i++) out.push(monthName(i));
  return out;
}

/* ============================================================
   ENGINE STRINGS — translated at the boundary
   ------------------------------------------------------------
   js/core.js is the engine test_engine.js pins at 19/19 and that
   has been carried byte-for-byte since v0.2. It builds its
   scoring reasons and Guardian warnings as English sentences, and
   those sentences are shown to the farmer: the reason chips in
   the match sheet, and the "Fasto adjusted one thing" notice in
   the profile editor.

   Rather than reach into that file, each sentence is recognised
   here and rewritten. The obvious risk is that core.js changes
   and this quietly keeps showing English — so qa_check.js reads
   every string core.js pushes and fails if one of them is not
   matched by a pattern below. Falling back to the original
   English is the failure mode either way, which is the right one:
   an English chip is a blemish, a blank chip is a bug.
   ============================================================ */
var ENGINE_PATTERNS = [
  /* --- scoreBuyer reasons --- */
  { re: /^No products in profile$/, it: function () { return "Nessun prodotto nel profilo"; } },
  { re: /^Needs your main product \((.+)\)$/, it: function (m) { return "Cerca il tuo prodotto principale (" + m[1] + ")"; } },
  { re: /^Buys (.+)$/, it: function (m) { return "Compra " + m[1]; } },
  { re: /^No direct product overlap$/, it: function () { return "Nessuna corrispondenza diretta di prodotto"; } },
  { re: /^Volume fits \((\w+) ↔ (\w+)\)$/, it: function (m) { return "Volume adatto (" + T("band." + m[1]) + " ↔ " + T("band." + m[2]) + ")"; } },
  { re: /^Volume roughly compatible$/, it: function () { return "Volume grosso modo compatibile"; } },
  { re: /^Volume mismatch \((\w+) vs (\w+)\)$/, it: function (m) { return "Volume non compatibile (" + T("band." + m[1]) + " invece di " + T("band." + m[2]) + ")"; } },
  { re: /^Very close \((.+) km\)$/, it: function (m) { return "Molto vicino (" + m[1] + " km)"; } },
  { re: /^Values organic \/ km0 producers$/, it: function () { return "Apprezza i produttori bio / km 0"; } },
  { re: /^Quality-focused buyer$/, it: function () { return "Acquirente attento alla qualità"; } },
  { re: /^In season now$/, it: function () { return "Di stagione adesso"; } },
  { re: /^Supply starts later — plan ahead$/, it: function () { return "La disponibilità inizia più avanti — conviene pianificare"; } },
  /* --- guardianValidateProfile warnings and errors --- */
  { re: /^Village missing — defaulted to 'Cassino area'$/, it: function () { return "Paese mancante — impostato su «zona di Cassino»"; } },
  { re: /^Profile has no products — cannot match$/, it: function () { return "Il profilo non ha prodotti — impossibile fare abbinamenti"; } },
  { re: /^Unknown category '(.*)' for product (.*) — mapped to 'verdure'$/, it: function (m) { return "Categoria «" + m[1] + "» sconosciuta per il prodotto " + m[2] + " — assegnata a «verdure»"; } },
  { re: /^Invalid quantity for (.+)$/, it: function (m) { return "Quantità non valida per " + m[1]; } },
  { re: /^Quantity (.+) kg\/week for (.*) looks too high for a small farm — capped at 5000$/, it: function (m) { return "La quantità di " + m[1] + " kg a settimana per " + m[2] + " sembra troppo alta per una piccola azienda — limitata a 5000"; } },
  { re: /^Organic status unclear — set to 'no' \(never claim what we can't verify\)$/, it: function () { return "Stato biologico non chiaro — impostato su «no» (non dichiariamo mai ciò che non possiamo verificare)"; } },
  { re: /^Farm distance unclear — assumed 8 km$/, it: function () { return "Distanza dell'azienda non chiara — ipotizzati 8 km"; } }
];

/* One engine sentence, in the current UI language. Unrecognised text comes back
   untouched. */
function engineText(s) {
  var str = String(s == null ? "" : s);
  if (LANG === "en") return str;
  for (var i = 0; i < ENGINE_PATTERNS.length; i++) {
    var m = ENGINE_PATTERNS[i].re.exec(str);
    if (m) return ENGINE_PATTERNS[i].it(m);
  }
  return str;
}

/* Node export — qa_check.js loads this file to verify ENGINE_PATTERNS still
   covers everything core.js is able to say. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { STRINGS: STRINGS, LANGS: LANGS, ENGINE_PATTERNS: ENGINE_PATTERNS };
}
