// DOM rendering for the Okey helper. Renders the 5-slot board, the 24-card
// palette, the all-combos list, and the sidebar. Pure DOM mutation — state
// changes flow through main.js, which calls render functions here.

import { COLORS, VALUES, parseCardId, BOARD_SIZE, HAND_SIZE, chestForScore } from "./game.js";
import { rankCombos, prettyCard } from "./solver.js";

// ---------- board (5 slots) ----------

export function renderBoard(boardEl, state, { picked, suggested, suggestionKind, onSlotClick, awaiting } = {}) {
  boardEl.innerHTML = "";
  for (let i = 0; i < BOARD_SIZE; i++) {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "slot";
    slot.dataset.slot = String(i);

    const card = state.board[i];
    if (card) {
      slot.classList.add("slot-filled");
      slot.dataset.color = card[0];
      slot.dataset.value = card.slice(1);
      slot.innerHTML = cardInnerHTML(card);
    } else {
      slot.classList.add("slot-empty");
      // `awaiting` = the game has already dealt a card into this position and
      // we are waiting for the user to tell us which one. Different from an
      // empty slot at the end of a run, where nothing is coming.
      if (awaiting) slot.classList.add("slot-awaiting");
      slot.innerHTML = awaiting
        ? `<span class="slot-placeholder">?</span>`
        : `<span class="slot-placeholder">${i + 1}</span>`;
    }

    if (picked && picked.has(i)) slot.classList.add("slot-picked");
    // Distinguish pick vs discard suggestion — different colors/badges in CSS.
    if (suggested && suggested.has(i)) {
      slot.classList.add(suggestionKind === "discard" ? "slot-suggested-discard" : "slot-suggested");
    }

    if (onSlotClick) slot.addEventListener("click", () => onSlotClick(i));
    boardEl.appendChild(slot);
  }
}

function cardInnerHTML(id) {
  const { value } = parseCardId(id);
  return `
    <span class="card-corner top-left">${value}</span>
    <span class="card-pip">${value}</span>
    <span class="card-corner bottom-right">${value}</span>
  `;
}

// ---------- palette (24 cards) ----------
//
// `usedCards` is a Set of card IDs already on the board. Those palette buttons
// get the .used class (greyed, click-disabled) so the user can see at a glance
// which cards they've already entered.

export function renderPalette(paletteEl, { onPaletteClick, usedCards, practiceMode } = {}) {
  paletteEl.innerHTML = "";
  for (const color of COLORS) {
    const row = document.createElement("div");
    row.className = "palette-row";
    row.dataset.color = color;
    for (const v of VALUES) {
      const id = `${color}${v}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "palette-card";
      btn.dataset.color = color;
      btn.dataset.value = String(v);
      btn.dataset.cardId = id;
      btn.innerHTML = cardInnerHTML(id);
      const isUsed = usedCards && usedCards.has(id);
      if (isUsed) {
        btn.classList.add("used");
        btn.disabled = true;
        btn.title = `${prettyCard(id)} is out of the deck`;
      } else if (practiceMode) {
        // Practice mode: palette is read-only — cards are auto-drawn from
        // the deck. We still show all 24 so the user can see the deck state,
        // but clicks do nothing.
        btn.disabled = true;
        btn.title = `Practice mode — cards are drawn automatically`;
      } else {
        btn.title = `Add ${prettyCard(id)} to next empty slot`;
        if (onPaletteClick) btn.addEventListener("click", () => onPaletteClick(id));
      }
      row.appendChild(btn);
    }
    paletteEl.appendChild(row);
  }
}

// ---------- sidebar ----------

export function updateSidebar(els, state, { picked } = {}) {
  els.score.textContent = String(state.score);

  // Floor / ceiling lines tell the user where they stand: floor = current
  // score, ceiling = score + best possible score from the cards on the board.
  // No round-based projection because there are no rounds.
  const bestNow = bestScoreOnBoard(state.board);
  const floor = state.score;
  const ceilingThisHand = state.score + bestNow;
  if (state.board.some(Boolean)) {
    els.scoreCeiling.textContent = `now ${floor} · +${bestNow} if you confirm best`;
  } else {
    els.scoreCeiling.textContent = `now ${floor}`;
  }

  // Chest "where you'd land if you stopped now" — fixed by current score only.
  const tier = chestForScore(state.score);
  els.chestProjection.textContent = chestProjLabel(tier, state.score);
  els.chestProjection.className = `chest-projection chest-${tier}`;

  // Current pick total (mid-selection feedback)
  if (picked && picked.size === HAND_SIZE) {
    const cards = [...picked].map((i) => state.board[i]);
    const r = scoreThreeFromCards(cards);
    els.pickTotal.textContent = `${r.score} pts`;
    els.pickLabel.textContent = r.label;
  } else {
    const n = picked ? picked.size : 0;
    els.pickTotal.textContent = `${n}/3`;
    els.pickLabel.textContent = n === 0 ? "Click cards on the board to pick." : `${HAND_SIZE - n} more to go.`;
  }

}

function bestScoreOnBoard(board) {
  const ranked = rankCombos(board);
  return ranked.length ? ranked[0].score : 0;
}

function chestProjLabel(tier, score) {
  switch (tier) {
    case "gold":   return `Gold (${score} ≥ 400)`;
    case "silver": return `Silver (${score})`;
    case "bronze":
    default:       return `Bronze (${score})`;
  }
}

function scoreThreeFromCards(cards) {
  if (cards.length !== HAND_SIZE) return { score: 0, label: "—" };
  const fakeBoard = [...cards, null, null];
  const ranked = rankCombos(fakeBoard);
  if (ranked.length === 0) return { score: 0, label: "—" };
  const r = ranked[0];
  return { score: r.score, label: r.label };
}

// ---------- session stats ----------

export function updateSessionStats(els, session) {
  els.sessionGames.textContent = String(session.games);
  els.sessionGold.textContent = String(session.gold);
  els.sessionSilver.textContent = String(session.silver);
  els.sessionBronze.textContent = String(session.bronze);
  const pct = (n) => session.games === 0 ? "" : `${Math.round((n / session.games) * 100)}%`;
  els.sessionPctGold.textContent = pct(session.gold);
  els.sessionPctSilver.textContent = pct(session.silver);
  els.sessionPctBronze.textContent = pct(session.bronze);
  if (els.sessionAvg) {
    els.sessionAvg.textContent = session.games === 0 ? "—" : String(Math.round(session.totalScore / session.games));
  }
}
