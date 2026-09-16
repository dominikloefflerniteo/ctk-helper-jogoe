// Pure state model for the Metin2 Okey card minigame.
// 24 unique cards: values 1..8 across three colors (R/B/Y). The game shows 5
// cards on the field; you can either discard cards (any subset, even just one)
// to draw replacements, or pick 3 to score. There's no fixed round structure —
// you keep playing until you decide to finish.
//
// No DOM, no I/O. Exports state/transition functions consumed by ui + solver.

export const COLORS = ["R", "B", "Y"];
export const COLOR_NAMES = { R: "Red", B: "Blue", Y: "Yellow" };
export const VALUES = [1, 2, 3, 4, 5, 6, 7, 8];
export const BOARD_SIZE = 5;
export const HAND_SIZE = 3;

export const CHEST_THRESHOLDS = { gold: 400, silver: 300, bronze: 0 };

export function cardId(color, value) { return `${color}${value}`; }
export function parseCardId(id) {
  return { color: id[0], value: Number(id.slice(1)) };
}

// ----- scoring -----
//
// Three-of-a-kind (all same value, any colors): 20 + (value-1) * 10
//   1→20, 2→30, …, 8→90
// Same-color sequence (3 consecutive, all same color):
//   low=1 → 50, low=2 → 60, …, low=6 → 100  (formula: 50 + (low-1)*10)
// Mixed-color sequence (3 consecutive, NOT all same color):
//   low=1 → 10, low=2 → 20, …, low=6 → 60   (formula: low * 10)
// No combination → 0.

export function scoreThreeOfAKind(value) {
  return 20 + (value - 1) * 10;
}
export function scoreSameColorSeq(low) {
  return 50 + (low - 1) * 10;
}
export function scoreMixedSeq(low) {
  return low * 10;
}

// Score a 3-card hand. Returns { score, type, label } where type ∈
// {"three", "sameSeq", "mixedSeq", "none"} and label is human-readable.
// The score of three cards is a pure function of those three cards, and there
// are only 24 cards — so it is a lookup, not a computation. The old version
// allocated three objects (parseCardId), three arrays (map/map/sort) and a
// template-literal label on EVERY call, and a 2026-09-15 CPU profile put it at
// 20% of all search time: it runs in the innermost loop of every playout.
//
// The table is built once over every a <= b <= c triple (duplicates included,
// so degenerate input behaves exactly as it did before) and holds SHARED frozen
// result objects. A lookup therefore allocates nothing at all.
//
// Exhaustively verified identical to the old implementation over all 24^3
// ordered triples by bench/scorehand-equiv.mjs.

const CARD_INDEX = new Map();
for (let ci = 0; ci < COLORS.length; ci++) {
  for (let vi = 0; vi < VALUES.length; vi++) {
    CARD_INDEX.set(cardId(COLORS[ci], VALUES[vi]), ci * 8 + vi);
  }
}

const INVALID_HAND = Object.freeze({ score: 0, type: "none", label: "—" });
const NO_COMBO = Object.freeze({ score: 0, type: "none", label: "No combo" });

// Indexed by a * 576 + b * 24 + c with a <= b <= c (indices, not values).
const COMBO_TABLE = new Array(24 * 24 * 24).fill(NO_COMBO);
for (let a = 0; a < 24; a++) {
  for (let b = a; b < 24; b++) {
    for (let c = b; c < 24; c++) {
      const va = (a & 7) + 1, vb = (b & 7) + 1, vc = (c & 7) + 1;
      const values = [va, vb, vc].sort((x, y) => x - y);
      let entry = NO_COMBO;
      if (values[0] === values[1] && values[1] === values[2]) {
        const v = values[0];
        entry = Object.freeze({ score: scoreThreeOfAKind(v), type: "three", label: `Three ${v}s` });
      } else if (values[1] === values[0] + 1 && values[2] === values[1] + 1) {
        const low = values[0];
        const sameColour = (a >> 3) === (b >> 3) && (b >> 3) === (c >> 3);
        entry = sameColour
          ? Object.freeze({ score: scoreSameColorSeq(low), type: "sameSeq", label: `${low}-${low + 1}-${low + 2} same color` })
          : Object.freeze({ score: scoreMixedSeq(low), type: "mixedSeq", label: `${low}-${low + 1}-${low + 2} mixed` });
      }
      COMBO_TABLE[a * 576 + b * 24 + c] = entry;
    }
  }
}

export function scoreHand(cards) {
  if (!cards || cards.length !== 3) return INVALID_HAND;
  let a = CARD_INDEX.get(cards[0]);
  let b = CARD_INDEX.get(cards[1]);
  let c = CARD_INDEX.get(cards[2]);
  // An id the table does not know (malformed input) must not silently score 0
  // against a wrong slot, so it takes the same "no combo" answer as before.
  if (a === undefined || b === undefined || c === undefined) return NO_COMBO;
  // Sort three integers without allocating an array.
  let t;
  if (a > b) { t = a; a = b; b = t; }
  if (b > c) { t = b; b = c; c = t; }
  if (a > b) { t = a; a = b; b = t; }
  return COMBO_TABLE[a * 576 + b * 24 + c];
}

export function chestForScore(score) {
  if (score >= CHEST_THRESHOLDS.gold) return "gold";
  if (score >= CHEST_THRESHOLDS.silver) return "silver";
  return "bronze";
}

// ----- state -----
//
// board:    array of 5 slots, each cardId or null
// score:    running score for the current game
// consumed: Set of cardIds permanently out of the deck this game (discarded
//           or scored) — these stay greyed in the palette
// history:  stack of past actions (for undo)
// log:      confirmed picks for the current game (in order)

export function createState() {
  return {
    board: Array(BOARD_SIZE).fill(null),
    score: 0,
    consumed: new Set(),
    history: [],
    log: [],
  };
}

export function setSlot(state, slotIndex, cardId) {
  if (slotIndex < 0 || slotIndex >= BOARD_SIZE) return state;
  state.history.push({ kind: "setSlot", slotIndex, prev: state.board[slotIndex] });
  state.board[slotIndex] = cardId;
  return state;
}

export function clearSlot(state, slotIndex) {
  return setSlot(state, slotIndex, null);
}

// discardSlot: remove the card AND mark it as consumed (out of deck for the
// rest of this game). Distinct from clearSlot, which just empties the slot
// without affecting the deck — that path is reserved for setSlot/undo.
export function discardSlot(state, slotIndex) {
  const card = state.board[slotIndex];
  if (!card) return false;
  state.history.push({ kind: "discard", slotIndex, card });
  state.consumed.add(card);
  state.board[slotIndex] = null;
  return true;
}

export function firstEmptySlot(state) {
  return state.board.findIndex((c) => c === null);
}

// addCard: place into the first empty slot. Returns slot index used, or -1
// if board is full.
// Returns the slot used, -1 if the field is full, and -2 if that exact card is
// already in play.
//
// The palette greys out cards that are on the board or already consumed, but
// the keyboard path (press R, then 6) never goes through the palette — so R6
// could be entered twice. Two copies of one card cannot exist in the real game,
// and every solver number downstream is computed from the card set, so a
// duplicate silently corrupts the rest of the run.
// Reported by Flavius (flaviusrzv/metin2-okey-helper), 2026-09-15.
export function addCard(state, cardId) {
  if (state.consumed.has(cardId)) return -2;
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i] === cardId) return -2;
  }
  const idx = firstEmptySlot(state);
  if (idx < 0) return -1;
  setSlot(state, idx, cardId);
  return idx;
}

// confirmPick: lock in a 3-card selection, score it, remove the picked cards
// from the board. Returns {gained, hand, type, label}.
export function confirmPick(state, pickedSlots) {
  if (!pickedSlots || pickedSlots.length !== HAND_SIZE) {
    return { gained: 0, hand: [], type: "none", label: "Need 3 cards" };
  }
  const hand = pickedSlots.map((i) => state.board[i]);
  if (hand.some((c) => !c)) {
    return { gained: 0, hand: [], type: "none", label: "Empty slots in pick" };
  }
  const { score: gained, type, label } = scoreHand(hand);

  state.history.push({
    kind: "confirm",
    prevBoard: [...state.board],
    prevScore: state.score,
    pickedSlots: [...pickedSlots],
    hand: [...hand],
    gained, type, label,
  });

  // Picked cards leave the board AND the deck — scored cards never come back.
  for (const i of pickedSlots) {
    state.consumed.add(state.board[i]);
    state.board[i] = null;
  }
  state.score += gained;
  state.log.push({ hand, gained, type, label });

  return { gained, hand, type, label };
}

export function undo(state) {
  // Step over auto-fills from practice mode — they belong to the prior user
  // action, not their own undo step. Without this, undo would unwind one
  // random draw at a time, which feels broken to the user.
  while (state.history.length > 0 && state.history[state.history.length - 1].auto) {
    const auto = state.history.pop();
    if (auto.kind === "setSlot") state.board[auto.slotIndex] = auto.prev;
  }
  const last = state.history.pop();
  if (!last) return false;
  if (last.kind === "setSlot") {
    state.board[last.slotIndex] = last.prev;
    return true;
  }
  if (last.kind === "discard") {
    state.board[last.slotIndex] = last.card;
    state.consumed.delete(last.card);
    return true;
  }
  if (last.kind === "confirm") {
    state.board = last.prevBoard;
    state.score = last.prevScore;
    state.log.pop();
    for (const c of last.hand) state.consumed.delete(c);
    return true;
  }
  return false;
}

export function resetState(state) {
  state.board = Array(BOARD_SIZE).fill(null);
  state.score = 0;
  state.consumed = new Set();
  state.history = [];
  state.log = [];
}

export function isBoardFull(state) {
  return state.board.every((c) => c !== null);
}

export function filledCards(state) {
  return state.board.filter((c) => c !== null);
}

// Set of card IDs the palette should grey out — currently-on-board union with
// consumed (discarded or scored). Both are out of the deck for this game.
export function usedCardSet(state) {
  const out = new Set(state.consumed);
  for (const c of state.board) if (c) out.add(c);
  return out;
}

// Cards still in the deck (not on the board and not consumed). Used by the
// solver for discard EV and by practice mode for random draws.
// Every card id in the canonical order (colours outer, values inner). Callers
// depend on that order being stable, so it is the same order the old nested
// loop produced.
export const ALL_CARD_IDS = [];
for (const color of COLORS) for (const v of VALUES) ALL_CARD_IDS.push(cardId(color, v));

// Called several times per decision and once per playout step. The old version
// allocated a fresh Set (copying `consumed`) and built all 24 ids as template
// literals on EVERY call — 8.4% of search time in the 2026-09-15 profile, all
// of it rebuilding constants. The ids are now shared, and with a board of at
// most five slots a linear scan beats constructing a Set to query it.
export function deckRemaining(state) {
  const consumed = state.consumed;
  const board = state.board;
  const out = [];
  for (let i = 0; i < ALL_CARD_IDS.length; i++) {
    const id = ALL_CARD_IDS[i];
    if (consumed.has(id)) continue;
    let onBoard = false;
    for (let s = 0; s < board.length; s++) {
      if (board[s] === id) { onBoard = true; break; }
    }
    if (!onBoard) out.push(id);
  }
  return out;
}

// Practice mode: fill empty slots with random cards from deckRemaining.
// History entries get `auto: true` so undo() can step over them and treat
// the entire user-action-plus-refill as one "round" boundary.
//
// `rand` is plug-in for testing; defaults to Math.random.
export function autoFillBoardFromDeck(state, rand = Math.random) {
  while (true) {
    const slot = firstEmptySlot(state);
    if (slot < 0) break;
    const deck = deckRemaining(state);
    if (deck.length === 0) break;
    const card = deck[Math.floor(rand() * deck.length)];
    state.history.push({ kind: "setSlot", slotIndex: slot, prev: null, auto: true });
    state.board[slot] = card;
  }
}
