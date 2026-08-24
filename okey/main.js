// Wires okey-game state, okey-solver suggestions, and okey-ui rendering.
// No round structure — score accumulates until the user resets, which logs
// the final score into the session stats.

import {
  createState, addCard, discardSlot, confirmPick, undo, resetState,
  usedCardSet, autoFillBoardFromDeck, deckRemaining, BOARD_SIZE, HAND_SIZE,
  chestForScore,
} from "./game.js";
import { suggest, createPolicyCache, chestOutlook } from "./policy.js";
import { applyToDOM, setLang, onLangChange, t } from "./i18n.js";
import {
  renderBoard, renderPalette, updateSidebar, updateSessionStats,
} from "./ui.js";

const els = {
  board: document.getElementById("board"),
  palette: document.getElementById("palette"),
  score: document.getElementById("score"),
  scoreCeiling: document.getElementById("scoreCeiling"),
  chestProjection: document.getElementById("chestProjection"),
  pickTotal: document.getElementById("pickTotal"),
  pickLabel: document.getElementById("pickLabel"),
  suggestionNote: document.getElementById("suggestionNote"),
  practiceToggle: document.getElementById("practiceToggle"),
  confirmBtn: document.getElementById("confirmBtn"),
  acceptSuggestionBtn: document.getElementById("acceptSuggestionBtn"),
  undoBtn: document.getElementById("undoBtn"),
  resetBtn: document.getElementById("resetBtn"),
  sessionGames: document.getElementById("sessionGames"),
  sessionGold: document.getElementById("sessionGold"),
  sessionSilver: document.getElementById("sessionSilver"),
  sessionBronze: document.getElementById("sessionBronze"),
  sessionPctGold: document.getElementById("sessionPctGold"),
  sessionPctSilver: document.getElementById("sessionPctSilver"),
  sessionPctBronze: document.getElementById("sessionPctBronze"),
  sessionAvg: document.getElementById("sessionAvg"),
  sessionResetBtn: document.getElementById("sessionResetBtn"),
  toast: document.getElementById("toast"),
  twitchChatMount: document.getElementById("twitchChatMount"),
  chatBtn: document.getElementById("chatBtn"),
  minimalUiBtn: document.getElementById("minimalUiBtn"),
  likeBtn: document.getElementById("likeBtn"),
  runOverlay: document.getElementById("runOverlay"),
  runOverlayBody: document.getElementById("runOverlayBody"),
  runOverlayChest: document.getElementById("runOverlayChest"),
  runOverlayBtn: document.getElementById("runOverlayBtn"),
  runOverlayDismiss: document.getElementById("runOverlayDismiss"),
  likeCount: document.getElementById("likeCount"),
  twitchConsent: document.getElementById("twitchConsent"),
  twitchConsentBtn: document.getElementById("twitchConsentBtn"),
  revokeTwitchConsentBtn: document.getElementById("revokeTwitchConsentBtn"),
};

// ---------- state ----------

const state = createState();
let pickedSlots = new Set();
let session = loadSession();
let practiceMode = loadPracticeMode();
// Table for the exact endgame solver, valid for one game (see policy.js).
let policyCache = createPolicyCache();
let lastSuggestion = null;
// Suggestion cache + async upgrade, see computeSuggestion() below.
let suggestionCache = { key: null, move: null, strong: false };
let pendingKey = null;
// Set when the player dismisses the end-of-run overlay: the run is over by
// the numbers, but they asked to keep going, so stop nagging until reset.
let overlayDismissed = false;

const PRACTICE_KEY = "okey-helper.practice.v1";
function loadPracticeMode() {
  try { return localStorage.getItem(PRACTICE_KEY) === "1"; } catch { return false; }
}
function savePracticeMode() {
  try { localStorage.setItem(PRACTICE_KEY, practiceMode ? "1" : "0"); } catch {}
}

// ---------- session persistence ----------

const SESSION_KEY = "okey-helper.session.v1";
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return emptySession();
    return { ...emptySession(), ...JSON.parse(raw) };
  } catch { return emptySession(); }
}
function saveSession() {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
}
function emptySession() {
  return { games: 0, gold: 0, silver: 0, bronze: 0, totalScore: 0 };
}

// ---------- handlers ----------

function onPaletteClick(cardId) {
  const slot = addCard(state, cardId);
  if (slot < 0) {
    toast(t("fieldFull"));
    return;
  }
  refresh();
}

function onSlotClick(slotIndex) {
  const card = state.board[slotIndex];
  if (!card) return;

  // Toggle selection. Replacing the oldest pick when the user already has 3
  // selected feels nicer than ignoring the click.
  if (pickedSlots.has(slotIndex)) {
    pickedSlots.delete(slotIndex);
  } else if (pickedSlots.size < HAND_SIZE) {
    pickedSlots.add(slotIndex);
  } else {
    const first = pickedSlots.values().next().value;
    pickedSlots.delete(first);
    pickedSlots.add(slotIndex);
  }
  refresh();
}

// Right-click on a slot = discard that card. Goes into state.consumed so it
// stays greyed in the palette for the rest of this game.
function onSlotRightClick(slotIndex) {
  if (!state.board[slotIndex]) return;
  pickedSlots.delete(slotIndex);
  discardSlot(state, slotIndex);
  refresh();
}

function onConfirm() {
  if (pickedSlots.size !== HAND_SIZE) {
    toast(t("select3"));
    return;
  }
  const r = confirmPick(state, [...pickedSlots]);
  pickedSlots.clear();
  if (r.gained > 0) toast(t("scored", { gained: r.gained, label: handLabel(r) }));
  else toast(t("noCombo"));
  refresh();
}

function onAcceptSuggestion() {
  const move = lastSuggestion ?? suggest(state, { cache: policyCache });
  if (!move) { toast(t("addCardsFirst")); return; }
  if (move.kind === "pick") {
    pickedSlots = new Set(move.slots);
    refresh();
    return;
  }
  // Discard: actually perform the discards. Sort descending so each splice-
  // equivalent doesn't shift the next index — discardSlot leaves slot positions
  // alone, so order doesn't matter, but consistency is nice.
  pickedSlots.clear();
  const slotsDesc = [...move.slots].sort((a, b) => b - a);
  for (const i of slotsDesc) discardSlot(state, i);
  toast(t("discarded", { n: move.slots.length }));
  refresh();
}

function onUndo() {
  if (!undo(state)) { toast(t("nothingUndo")); return; }
  pickedSlots.clear();
  refresh();
}

// Reset = "this game is over, log it, start fresh". A run with no scoring
// picks doesn't count toward session stats — that'd inflate the bronze rate.
function onReset() {
  const finalScore = state.score;
  const hadPicks = state.log.length > 0;
  if (hadPicks) {
    const tier = chestForScore(finalScore);
    session.games += 1;
    session[tier] += 1;
    session.totalScore += finalScore;
    saveSession();
    updateSessionStats(els, session);
    recordGlobalCompletion(tier);
    toast(t("gameOver", { tier: t("tier" + tier[0].toUpperCase() + tier.slice(1)), score: finalScore }));
  }
  resetState(state);
  pickedSlots.clear();
  // New game, new deck: the exact solver's table belongs to the old one.
  policyCache = createPolicyCache();
  lastSuggestion = null;
  suggestionCache = { key: null, move: null, strong: false };
  pendingKey = null;
  overlayDismissed = false;
  hideRunOverlay();
  refresh();
}

function onSessionReset() {
  session = emptySession();
  saveSession();
  updateSessionStats(els, session);
}

// ---------- toast ----------
let toastTimer = 0;
function toast(msg) {
  if (!els.toast) return;
  els.toast.textContent = msg;
  els.toast.classList.add("toast-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("toast-show"), 1800);
}

// ---------- refresh ----------

// True while the game has dealt cards we have not been told about yet: the
// field is not full and the deck still holds cards. Any advice computed in this
// state would be advice about a board that does not exist, so the helper asks
// for the missing cards instead of guessing.
function awaitingCards() {
  if (practiceMode) return false;           // practice deals them itself
  const empty = state.board.filter((c) => !c).length;
  return empty > 0 && deckRemaining(state).length > 0;
}

function refresh() {
  // Practice mode: any time the board has empty slots and the deck still has
  // cards, auto-draw to keep the field at 5. Single place handles all cases
  // (after confirm, after discard, after toggle, after reset).
  if (practiceMode) autoFillBoardFromDeck(state);

  const waiting = awaitingCards();
  const move = waiting ? null : computeSuggestion();
  lastSuggestion = move;
  const suggested = move ? new Set(move.slots) : null;
  const suggestionKind = move ? move.kind : null;

  renderBoard(els.board, state, {
    picked: pickedSlots, suggested, suggestionKind, onSlotClick, awaiting: waiting,
  });
  els.board.querySelectorAll(".slot").forEach((slot, i) => {
    slot.addEventListener("contextmenu", (e) => { e.preventDefault(); onSlotRightClick(i); });
  });

  renderPalette(els.palette, {
    onPaletteClick: practiceMode ? null : onPaletteClick,
    usedCards: usedCardSet(state),
    practiceMode,
  });
  updateSidebar(els, state, { picked: pickedSlots });

  const missing = state.board.filter((c) => !c).length;
  els.suggestionNote.textContent = waiting
    ? t("awaitingCards", { n: missing })
    : (move ? adviceText(move) : t("suggestionPlaceholder"));
  els.suggestionNote.classList.toggle("awaiting", waiting);
  els.suggestionNote.classList.toggle("pending", !waiting && !!move && !suggestionCache.strong);
  document.body.classList.toggle("awaiting-cards", waiting);
  els.acceptSuggestionBtn.disabled = !move;
  if (move && move.kind === "discard") {
    els.acceptSuggestionBtn.textContent = t("discardCards", { n: move.slots.length });
  } else {
    els.acceptSuggestionBtn.textContent = t("useSuggestion");
  }
  els.confirmBtn.disabled = pickedSlots.size !== HAND_SIZE;
  els.undoBtn.disabled = state.history.length === 0;

  checkRunFinished();
}


// ---------- suggestion: cached per position, upgraded off the click ----------
//
// Two things used to make every click cost a full search:
//
//   1. refresh() ran the solver on every render — including renders where the
//      POSITION had not changed at all, such as selecting or deselecting a card
//      for your pick, switching language, or toggling practice mode.
//   2. the search ran synchronously inside the click handler, so the button
//      press itself waited for it.
//
// Now: a position is searched once and the answer is kept until the position
// actually changes; and when it does change, the instant heuristic answer is
// rendered first, with the strong search handed to a timeout so the click can
// finish painting. The user sees an answer immediately and a better one a
// moment later, instead of a frozen page.
//
// The key covers everything the engines look at: the field, the score, and how
// many cards have left the deck.
function positionKey() {
  return state.board.join(",") + "|" + state.score + "|" + state.consumed.size;
}

function computeSuggestion() {
  const key = positionKey();
  if (suggestionCache.key === key) return suggestionCache.move;

  // Instant answer so the UI has something to draw right now.
  const quick = suggest(state, { cache: policyCache, mode: "heuristic" });
  suggestionCache = { key, move: quick, strong: false };

  // Strong answer after the browser has painted this click.
  if (pendingKey !== key) {
    pendingKey = key;
    setTimeout(() => {
      if (pendingKey !== key) return;      // position moved on meanwhile
      const strong = suggest(state, { cache: policyCache });
      pendingKey = null;
      if (positionKey() !== key) return;   // ditto, after the search
      suggestionCache = { key, move: strong, strong: true };
      refresh();
    }, 0);
  }
  return quick;
}

// ---------- end of run ----------
//
// A run is over the moment no better chest can be reached: from there on no
// sequence of picks or discards changes the reward, so grinding on is wasted
// time. policy.js works that out exactly once the position is small enough,
// and from an optimistic bound before that — optimistic on purpose, so the
// overlay never appears while a better chest is still on.

function hideRunOverlay() {
  if (els.runOverlay) els.runOverlay.hidden = true;
}

function checkRunFinished() {
  if (!els.runOverlay || overlayDismissed) return;
  // chestOutlook can trigger the exact solve, which is the one expensive call
  // in here. Only run it on the render that already carries the strong
  // suggestion — that render happens off the click, so nothing blocks a button
  // press waiting for it.
  if (!suggestionCache.strong) return;
  // Nothing to announce before the run has actually started.
  if (state.log.length === 0) { hideRunOverlay(); return; }

  const outlook = chestOutlook(state, { cache: policyCache });
  if (outlook.canImprove) { hideRunOverlay(); return; }

  const tier = chestForScore(state.score);
  const tierName = t("tier" + tier[0].toUpperCase() + tier.slice(1));
  if (els.runOverlayChest) {
    els.runOverlayChest.textContent = tier === "gold" ? "🥇" : tier === "silver" ? "🥈" : "🥉";
  }
  if (els.runOverlayBody) {
    els.runOverlayBody.textContent = outlook.nextThreshold === null
      ? t("doneGold", { score: state.score })
      : t("doneBody", { score: state.score, tier: tierName, next: outlook.nextThreshold });
  }
  els.runOverlay.hidden = false;
}

if (els.runOverlayBtn) {
  els.runOverlayBtn.addEventListener("click", () => { hideRunOverlay(); onReset(); });
}
if (els.runOverlayDismiss) {
  els.runOverlayDismiss.addEventListener("click", () => {
    overlayDismissed = true;
    hideRunOverlay();
  });
}


// ---------- public counters (page opens + chests, everyone all time) ----------
//
// Same free counter host the other helpers use: abacus.jasoncameron.dev, a
// stateless integer counter. /get reads, /hit increments and returns the new
// value. Nothing but integers leaves the browser — no accounts, no ids, no
// analytics — and every network error is swallowed, because the helper has to
// work fine with the counters dead or blocked.
const ABACUS = "https://abacus.jasoncameron.dev";
const NS = "okey-helper-jogoe";

// One page-open per load, shown next to the version.
(async function bumpPageOpens() {
  const el = document.getElementById("versionViews");
  if (!el) return;
  try {
    const r = await fetch(`${ABACUS}/hit/${NS}/page-opens`);
    if (!r.ok) return;
    const d = await r.json();
    if (Number.isFinite(d.value)) el.textContent = `· ${d.value.toLocaleString()} page opens`;
  } catch { /* offline or blocked — the line just stays empty */ }
})();

const GLOBAL_KEYS = ["games", "gold", "silver", "bronze"];
const globalCounts = { games: null, gold: null, silver: null, bronze: null };

function renderGlobalStats() {
  const fmt = (v) => (v == null ? "…" : v.toLocaleString());
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("globalGames", fmt(globalCounts.games));
  set("globalGold", fmt(globalCounts.gold));
  set("globalSilver", fmt(globalCounts.silver));
  set("globalBronze", fmt(globalCounts.bronze));
  const pct = (n) => (globalCounts.games && n != null ? `(${Math.round((n / globalCounts.games) * 100)}%)` : "");
  set("globalPctGold", pct(globalCounts.gold));
  set("globalPctSilver", pct(globalCounts.silver));
  set("globalPctBronze", pct(globalCounts.bronze));
}

async function fetchGlobalCount(key) {
  try {
    const r = await fetch(`${ABACUS}/get/${NS}/${key}`);
    if (r.status === 404) return 0; // counter not created yet; /hit creates it
    if (!r.ok) return null;
    const d = await r.json();
    return Number.isFinite(d.value) ? d.value : null;
  } catch { return null; }
}

async function fetchAllGlobalCounts() {
  const results = await Promise.all(GLOBAL_KEYS.map(fetchGlobalCount));
  for (let i = 0; i < GLOBAL_KEYS.length; i++) {
    if (results[i] != null) globalCounts[GLOBAL_KEYS[i]] = results[i];
  }
  renderGlobalStats();
}

async function hitGlobal(key) {
  try {
    const r = await fetch(`${ABACUS}/hit/${NS}/${key}`);
    if (!r.ok) return;
    const d = await r.json();
    if (Number.isFinite(d.value)) { globalCounts[key] = d.value; renderGlobalStats(); }
  } catch { /* swallow */ }
}

// Called when a run is logged locally: bumps the games counter plus exactly one
// tier, so the percentages always add up.
function recordGlobalCompletion(tier) {
  hitGlobal("games");
  if (GLOBAL_KEYS.includes(tier)) hitGlobal(tier);
}

// Refresh while the tab is actually being looked at. Four GETs a minute is far
// inside the host's rate limit and keeps the panel alive during a session.
fetchAllGlobalCounts();
setInterval(() => {
  if (document.visibilityState === "visible") fetchAllGlobalCounts();
}, 60_000);


// ---------- advice wording ----------
//
// The engines return structure (which cards, what it scores, and — in the
// exact phase — the real chest probabilities). The sentence is written here so
// it can be translated, and so the solver files stay free of user-facing prose.

function handLabel(hand) {
  if (!hand || !hand.type) return t("handNone");
  const values = (hand.cards || []).map((c) => Number(c.slice(1))).sort((a, b) => a - b);
  if (hand.type === "three") return t("handThree", { value: values[0] });
  if (hand.type === "sameSeq") return t("handSameSeq", { low: values[0] });
  if (hand.type === "mixedSeq") return t("handMixedSeq", { low: values[0] });
  return t("handNone");
}

function adviceText(move) {
  const pct = (x) => Math.round(x * 100) + "%";
  let odds = "";
  if (move.exact) {
    odds = " " + t("oddsExact", { silver: pct(move.exact.pSilver), gold: pct(move.exact.pGold) });
  } else if (move.rollout && move.rollout.stats) {
    odds = " " + t("oddsEstimate", {
      silver: pct(move.rollout.stats.pSilver),
      gold: pct(move.rollout.stats.pGold),
    });
  }
  if (move.kind === "pick") {
    return t("advicePick", { hand: handLabel(move), score: move.score }) + odds;
  }
  return t("adviceDiscard", { card: move.cards[0] }) + odds;
}

// ---------- language ----------

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => setLang(btn.getAttribute("data-lang")));
});
// Static text is swapped by i18n itself; the dynamic parts (suggestion,
// button labels, session numbers) need a re-render.
onLangChange(() => refresh());
applyToDOM();

// ---------- modals (imprint / privacy) ----------

document.querySelectorAll("[data-open-modal]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const modal = document.getElementById(btn.getAttribute("data-open-modal"));
    if (!modal) return;
    modal.hidden = false;
    const card = modal.querySelector(".modal-card");
    if (card) card.focus();
  });
});
document.querySelectorAll(".modal [data-close]").forEach((el) => {
  el.addEventListener("click", () => { el.closest(".modal").hidden = true; });
});

// ---------- like button ----------

const LIKE_LOCAL = "okey-liked-v1";
function setLikeCount(n) {
  if (els.likeCount && Number.isFinite(n)) els.likeCount.textContent = n.toLocaleString();
}
function markLiked() {
  if (!els.likeBtn) return;
  els.likeBtn.classList.add("liked");
  els.likeBtn.disabled = true;
}
async function fetchInitialLikes() {
  try {
    const r = await fetch(`${ABACUS}/get/${NS}/likes`);
    if (r.status === 404) { setLikeCount(0); return; }
    if (!r.ok) return;
    const d = await r.json();
    setLikeCount(d.value);
  } catch {}
}
if (els.likeBtn) {
  if (localStorage.getItem(LIKE_LOCAL) === "1") markLiked();
  els.likeBtn.addEventListener("click", async () => {
    if (localStorage.getItem(LIKE_LOCAL) === "1") return;
    localStorage.setItem(LIKE_LOCAL, "1");
    markLiked();
    try {
      const r = await fetch(`${ABACUS}/hit/${NS}/likes`);
      if (r.ok) { const d = await r.json(); setLikeCount(d.value); }
    } catch {}
  });
  fetchInitialLikes();
}

// ---------- keyboard ----------

let pendingColor = null;
document.addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;

  if (e.key === "Backspace") { e.preventDefault(); onUndo(); return; }
  if (e.key === "Escape")    { onReset(); return; }
  if (e.key === "Enter")     { onConfirm(); return; }
  if (e.key === " ")         { e.preventDefault(); onAcceptSuggestion(); return; }

  const k = e.key.toUpperCase();
  if (k === "R" || k === "B" || k === "Y") { pendingColor = k; return; }
  if (pendingColor && /^[1-8]$/.test(e.key)) {
    onPaletteClick(`${pendingColor}${e.key}`);
    pendingColor = null;
  }
});

// ---------- twitch chat embed ----------

function mountTwitchChat() {
  if (!els.twitchChatMount) return;
  const host = location.hostname || "localhost";
  const parents = new Set([host, "localhost", "127.0.0.1"]);
  const parentParams = [...parents].map((p) => `parent=${encodeURIComponent(p)}`).join("&");
  const iframe = document.createElement("iframe");
  iframe.src = `https://www.twitch.tv/embed/jogoe/chat?darkpopout&${parentParams}`;
  iframe.title = "Twitch chat for jogoe";
  iframe.allow = "autoplay; encrypted-media";
  els.twitchChatMount.appendChild(iframe);
}

// ---------- toggles ----------

function bindToggles() {
  if (els.chatBtn) {
    els.chatBtn.addEventListener("click", () => document.body.classList.toggle("chat-hidden"));
  }
  if (els.minimalUiBtn) {
    els.minimalUiBtn.addEventListener("click", () => {
      document.body.classList.toggle("minimal-ui");
      els.minimalUiBtn.classList.toggle("off", !document.body.classList.contains("minimal-ui"));
    });
  }
}

// ---------- practice mode toggle ----------

function onPracticeToggle() {
  practiceMode = els.practiceToggle.checked;
  savePracticeMode();
  document.body.classList.toggle("practice-on", practiceMode);
  // Toggling clears selection — the board is about to mutate either way.
  pickedSlots.clear();
  refresh();
}

// ---------- bootstrap ----------

els.confirmBtn.addEventListener("click", onConfirm);
els.acceptSuggestionBtn.addEventListener("click", onAcceptSuggestion);
els.undoBtn.addEventListener("click", onUndo);
els.resetBtn.addEventListener("click", onReset);
els.sessionResetBtn.addEventListener("click", onSessionReset);
els.practiceToggle.checked = practiceMode;
els.practiceToggle.addEventListener("change", onPracticeToggle);
document.body.classList.toggle("practice-on", practiceMode);
bindToggles();

// The embed is third-party (Twitch/Amazon), so it loads only after an explicit
// click. The choice is remembered locally and can be revoked in the privacy
// dialog.
const TWITCH_CONSENT_KEY = "okey-twitch-consent.v1";
function twitchConsented() {
  try { return localStorage.getItem(TWITCH_CONSENT_KEY) === "1"; } catch { return false; }
}
function loadTwitchChat() {
  if (els.twitchConsent) els.twitchConsent.remove();
  mountTwitchChat();
}
if (els.twitchConsentBtn) {
  els.twitchConsentBtn.addEventListener("click", () => {
    try { localStorage.setItem(TWITCH_CONSENT_KEY, "1"); } catch {}
    loadTwitchChat();
  });
}
if (els.revokeTwitchConsentBtn) {
  els.revokeTwitchConsentBtn.addEventListener("click", () => {
    try { localStorage.removeItem(TWITCH_CONSENT_KEY); } catch {}
    toast(t("twitchConsentRevoked"));
  });
}
if (twitchConsented()) loadTwitchChat();

updateSessionStats(els, session);
refresh();
