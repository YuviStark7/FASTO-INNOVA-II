/* ============================================================
   FASTO INNOVA — Spotlight cards
   ------------------------------------------------------------
   A plain-JS port of the "SpotlightCard" hover effect from React Bits
   (reactbits.dev; the original is React, so it is rewritten here with no
   framework). A soft white light follows the pointer across any element
   with the class `spotlight-card`, the card's edge catches it, and it
   swells while the card is pressed. Cards near the pointer share one
   light (proximity), the keyboard focus ring lights the card too, and
   everything stands still under prefers-reduced-motion.

   Settings are the original's defaults for the dark theme with the
   values Yuvi chose: intensity .15, size 290, softness .7, edge .6,
   proximity 120, smoothing .3, flare on, grain off, circle shape.

   Cards are drawn by innerHTML, so nothing registers them: one listener
   on the window wakes a frame loop that finds every `.spotlight-card`
   on the page, adds its two light layers the first time the light
   reaches it, and goes back to sleep once everything has settled.
   ============================================================ */
var Spotlight = (function () {
  var CFG = { intensity: 0.15, size: 290, softness: 0.7, edge: 0.6, proximity: 120, smoothing: 0.3 };
  var STOPS = (function () {
    // The original's falloff curve: a smooth disc blended with a gaussian glow by `softness`.
    var soft = Math.min(1, Math.max(0, CFG.softness));
    var core = Math.pow(1 - soft, 1.5) * 0.85;
    function stops(blend) {
      var out = ["rgba(255,255,255,1) 0%"];
      for (var i = 0; i <= 14; i++) {
        var t = core + ((1 - core) * i) / 14, g = (t - core) / (1 - core);
        var smooth = 1 - g * g * (3 - 2 * g), glow = Math.exp(-4.6 * g * g) * (1 - Math.pow(g, 6));
        var a = smooth + (glow - smooth) * blend;
        out.push("rgba(255,255,255," + a.toFixed(3) + ") " + (t * 100).toFixed(2) + "%");
      }
      return out.join(", ");
    }
    return { fill: stops(soft), edge: stops(1) };
  })();

  var states = typeof WeakMap === "function" ? new WeakMap() : null;
  var pointer = { x: 0, y: 0, active: false };
  var pressed = null;          // the card under a held press
  var raf = 0, last = 0;
  var reduce = false;

  function stateOf(card) {
    var s = states.get(card);
    if (!s) { s = { x: 0, y: 0, presence: 0, flare: 0, light: null, edge: null }; states.set(card, s); }
    return s;
  }
  function layers(card, s) {
    if (s.light) return;
    s.light = document.createElement("span"); s.light.className = "spotlight-card__light"; s.light.setAttribute("aria-hidden", "true");
    s.edge = document.createElement("span"); s.edge.className = "spotlight-card__edge"; s.edge.setAttribute("aria-hidden", "true");
    card.insertBefore(s.light, card.firstChild);
    card.appendChild(s.edge);
  }
  function disc(size, x, y, stops) { return "radial-gradient(circle " + size.toFixed(1) + "px at " + x.toFixed(1) + "px " + y.toFixed(1) + "px, " + stops + ")"; }

  function focusedIn(card) {
    var f = document.activeElement;
    if (!f || f === document.body || !card.contains(f)) return null;
    try { return f.matches(":focus-visible") ? f : null; } catch (e) { return null; }
  }

  function tick(now) {
    raf = 0;
    var dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    var cards = document.querySelectorAll(".spotlight-card"), busy = false, vh = window.innerHeight || 800;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i], s = stateOf(card), rect = card.getBoundingClientRect();
      if ((rect.bottom < -CFG.proximity || rect.top > vh + CFG.proximity) && s.presence === 0 && s.flare === 0) continue;
      var tx = s.x, ty = s.y, target = 0, f = focusedIn(card);
      if (f) {
        var box = f.getBoundingClientRect();
        tx = box.left + box.width / 2 - rect.left; ty = box.top + box.height / 2 - rect.top; target = 1;
      } else if (pointer.active) {
        tx = pointer.x - rect.left; ty = pointer.y - rect.top;
        var gap = Math.hypot(Math.max(0, -tx, tx - rect.width), Math.max(0, -ty, ty - rect.height));
        if (gap === 0) target = 1; else target = Math.pow(Math.max(0, 1 - gap / CFG.proximity), 2);
      }
      if (s.presence < 0.02 && target > 0) { s.x = tx; s.y = ty; }   // a fresh light starts under the pointer
      var follow = reduce || CFG.smoothing === 0 ? 1 : 1 - Math.exp(-dt / (0.015 + CFG.smoothing * 0.22));
      s.x += (tx - s.x) * follow; s.y += (ty - s.y) * follow;
      var fade = reduce ? 1 : 1 - Math.exp(-dt / (target > s.presence ? 0.1 : 0.32));
      s.presence += (target - s.presence) * fade;
      if (Math.abs(target - s.presence) < 0.002) s.presence = target;
      var press = pressed === card && !reduce ? 1 : 0;
      s.flare += (press - s.flare) * (1 - Math.exp(-dt / (press ? 0.05 : 0.28)));
      if (Math.abs(press - s.flare) < 0.002) s.flare = press;
      if (s.presence > 0 || s.light) {
        layers(card, s);
        var size = CFG.size * (1 + 0.2 * s.flare), boost = 1 + 0.7 * s.flare;
        s.light.style.background = disc(size, s.x, s.y, STOPS.fill);
        s.edge.style.background = disc(size * 0.6, s.x, s.y, STOPS.edge);
        s.light.style.opacity = String(Math.min(1, s.presence * CFG.intensity * boost));
        s.edge.style.opacity = String(Math.min(1, s.presence * CFG.edge * boost));
      }
      if (Math.abs(tx - s.x) > 0.1 || Math.abs(ty - s.y) > 0.1 || s.presence !== target || s.flare !== press) busy = true;
    }
    if (busy) raf = requestAnimationFrame(tick);
  }
  function wake() { if (raf) return; last = performance.now(); raf = requestAnimationFrame(tick); }

  function init() {
    if (typeof window === "undefined" || !window.addEventListener || typeof document === "undefined" || !states) return;
    reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var cardOf = function (t) { return t && t.closest ? t.closest(".spotlight-card") : null; };
    window.addEventListener("pointermove", function (e) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; wake(); }, { passive: true });
    document.addEventListener("pointerdown", function (e) { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; pressed = cardOf(e.target); wake(); }, true);
    var up = function (e) { if (e.pointerType && e.pointerType !== "mouse") pointer.active = false; pressed = null; wake(); };
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    document.addEventListener("pointerout", function (e) { if (!e.relatedTarget) { pointer.active = false; wake(); } });
    window.addEventListener("scroll", function () { if (pointer.active) wake(); }, { capture: true, passive: true });
    document.addEventListener("focusin", wake); document.addEventListener("focusout", wake);
  }
  init();
  return { wake: wake };
})();
