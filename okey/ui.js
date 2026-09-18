// DOM rendering for the Okey helper. Renders the 5-slot board, the 24-card
// palette, the all-combos list, and the sidebar. Pure DOM mutation — state
// changes flow through main.js, which calls render functions here.

import { COLORS, VALUES, parseCardId, BOARD_SIZE, HAND_SIZE, chestForScore } from "./game.js";
import { rankCombos, prettyCard } from "./solver.js";
import { t } from "./i18n.js";

// ---------- board (5 slots) ----------

export function renderBoard(boardEl, state, { picked, suggested, suggestionKind, heuristicSuggested, heuristicKind, onSlotClick, onSlotRightClick, awaiting } = {}) {
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
    // Heuristic hint — dashed/faded while worker computes; disappears on strong answer.
    if (heuristicSuggested && heuristicSuggested.has(i)) {
      slot.classList.add(heuristicKind === "discard" ? "slot-heuristic-discard" : "slot-heuristic-pick");
    }

    // Desktop: click = pick, right-click = discard
    // Mobile:  tap = pick, long-press (500ms) = discard
    let lpTimer = null;
    let lpFired = false;

    if (onSlotClick) {
      slot.addEventListener("click", () => {
        if (lpFired) { lpFired = false; return; } // skip click after long-press
        onSlotClick(i);
      });
    }

    if (onSlotRightClick) {
      // Desktop right-click
      slot.addEventListener("contextmenu", (e) => { e.preventDefault(); onSlotRightClick(i); });

      // Mobile long-press
      slot.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch") return;
        if (!state.board[i]) return; // skip on empty/awaiting slots
        lpFired = false;
        slot.classList.add("slot-pressing");
        lpTimer = setTimeout(() => {
          lpFired = true;
          slot.classList.remove("slot-pressing");
          slot.releasePointerCapture(e.pointerId);
          onSlotRightClick(i);
        }, 500);
      });

      const cancelLp = () => {
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
        slot.classList.remove("slot-pressing");
      };
      slot.addEventListener("pointerup",     cancelLp);
      slot.addEventListener("pointercancel", cancelLp);
      slot.addEventListener("pointermove",   (e) => { if (e.pointerType === "touch" && lpTimer) cancelLp(); });
    }
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
    els.scoreCeiling.textContent = t('scoreCeilingFull', { floor, best: bestNow });
  } else {
    els.scoreCeiling.textContent = t('scoreCeilingEmpty', { floor });
  }

  // Chest "where you'd land if you stopped now" — fixed by current score only.
  const tier = chestForScore(state.score);
  const proj = chestProjLabel(tier, state.score);
  els.chestProjection.textContent = proj.label;
  els.chestProjection.className = `chest-projection chest-${proj.cls}`;
  // Score progress bar
  const barFill = document.getElementById("scoreBarFill");
  if (barFill) {
    const pct = Math.min(state.score / 400, 1) * 100;
    barFill.style.width = pct + "%";
	const barTier = state.score >= 400 ? "gold" : state.score >= 300 ? "silver" : "bronze";
	barFill.className = "score-bar-fill tier-" + barTier;
  }

}

function bestScoreOnBoard(board) {
  const ranked = rankCombos(board);
  return ranked.length ? ranked[0].score : 0;
}

function chestProjLabel(tier, score) {
  if (tier === "gold")    return { cls: "gold",          label: t("chestLabelGold",         { score }) };
  if (score >= 300)      return { cls: "silver-locked", label: t("chestLabelSilverLocked", { score }) };
  if (tier === "silver") return { cls: "silver",        label: t("chestLabelSilver",        { score }) };
  return                        { cls: "bronze",         label: t("chestLabelBronze",        { score }) };
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
