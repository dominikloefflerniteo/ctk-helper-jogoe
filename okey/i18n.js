// Lightweight i18n for the Okey helper (mirrors ctk/i18n.js and seer/i18n.js).
// Static HTML carries data-i18n / data-i18n-html; dynamic strings go through
// t(key, params). DOM/localStorage access is guarded so it stays import-safe.
//
// Only en and de carry the legal bodies; the other languages fall back to
// English for those, same as the sibling helpers.

const STRINGS = {
  en: {
    subtitle: "pick the best 3 of 5",
    pageIntro:
      "Free helper for the <strong>Okey</strong> card event in Metin2. Enter the five cards on " +
      "the field and it tells you whether to take a hand now or throw a card and draw again. " +
      "Near the end it stops estimating and solves the position exactly.",

    practice: "Practice",
    awaitingCards: (p) => p.n === 1
      ? "Which card did the game deal? Click it below."
      : `Which ${p.n} cards did the game deal? Click them below.`,

    doneTitle: "Done — no better chest possible",
    doneBody: (p) => `You finished on ${p.score} points, which is a ${p.tier} chest. Even with the best of the cards still left, ${p.next} points can no longer be reached — so nothing you do from here changes the reward.`,
    doneGold: (p) => `You finished on ${p.score} points — a gold chest, the best there is. Nothing left to improve.`,
    doneNextRun: "Start the next run",
    doneKeepPlaying: "keep playing anyway",

    practiceTitle: "Practice mode — draws cards from the deck for you so you can play a full run",
    minimalUi: "Toggle minimal UI",

    boardLabel: "Cards on the field",
    paletteLabel: "Add a card to the next empty slot",

    helpIntro:
      "Pick the 3 cards that score the most. <em>Click a palette card</em> to drop it into the " +
      "next empty slot, then click cards on the field to mark your pick. Used cards grey out in " +
      "the palette so you can't enter the same card twice.",
    help1: "type a card directly",
    help2: "toggle a card on the field in your pick",
    help3: "right-click a card on the field to discard it (then enter the card the game gave you)",
    help4: "auto-select the suggested 3",
    help5: "confirm the pick",
    help6: "undo · reset (logs the run to your session)",

    chestRates: "Chest rates",
    colFollowing: "Following this",
    col678: "6-7-8 only",
    gold: "Gold", silver: "Silver", bronze: "Bronze",

    session: "Session", games: "Games", avgScore: "Avg score", reset: "Reset",
    globalAllTime: "Everyone, all time",
    globalNote: "Counted when a run is reset. Public counters, no accounts.",

    scoreLabel: "Score", scoreTarget: "target 400 (gold)",
    yourPick: "Your pick", pickHint: "Click cards on the field to pick.",
    suggestion: "Suggestion", useSuggestion: "Use suggestion", confirmPick: "Confirm pick",
    undo: "Undo",
    suggestionPlaceholder: "Add cards to the field to see a suggestion.",
    discardCards: (p) => `Discard ${p.n} card${p.n === 1 ? "" : "s"}`,

    // advice sentences, composed from the solver's structured answer
    advicePick: (p) => `Take ${p.hand} for ${p.score} points.`,
    adviceDiscard: (p) => `Throw ${p.card}.`,
    about: "About this project",
    aboutTitle: "About this project",
    aboutSolverHeading: "How the solver works",
    aboutSolverBody:
      "<p>The helper is a clean-room reimplementation of the Okey card event. It never reads the game &mdash; you tell it which five cards are on the field, and it tells you whether to take a hand or throw a card.</p>" +
      "<p>Three engines answer, depending on how much of the deck is left:</p>" +
      "<ul>" +
        "<li><b>Instant heuristic</b> &mdash; scores every hand against what its cards could have been worth instead, and every discard against what it gives up. Takes about a tenth of a millisecond, which is the answer you see the moment the fifth card lands.</li>" +
        "<li><b>Policy rollout</b> &mdash; for every candidate move it plays the rest of the run 96 times against random deck orders and counts how often that ends in a chest. Every candidate sees the <em>same</em> orders, so the comparison is not draw luck. The budget is spent in rounds: measure everything, drop the worse half, and the moves that are genuinely competing get several times the attention of the ones already settled.</li>" +
        "<li><b>Exact solver</b> &mdash; from 13 cards down the position is small enough to solve outright. Not an estimate: it computes the probability of reaching every possible score under perfect play, so the closing turns are provably right.</li>" +
      "</ul>" +
      "<p>The strong search runs in its own thread. That is why the suggestion appears instantly and sharpens a moment later, instead of the page freezing while it thinks.</p>" +
      "<p>One rule shapes all of it: your score never goes down, so crossing a chest threshold locks that chest in. Chests are thresholds, not averages &mdash; at 280 points a guaranteed 20 is the whole game, and at 220 the same 20 is worth nothing.</p>",
    aboutFindingsHeading: "What we tried",
    aboutFindingsBody:
      "<p><b>Worked:</b></p>" +
      "<ul>" +
        "<li>Scoring moves by <b>chest probability instead of points</b>. The single biggest jump: 46% to 66% silver-or-better.</li>" +
        "<li>The <b>exact endgame solver</b>. Measured afterwards: of the positions that reach the exact phase already won, it converts <b>100%</b>, and the undecided ones at exactly the rate it calculates.</li>" +
        "<li><b>More playouts, spent where the decision is close</b> &mdash; verified on decks the tuning never saw: silver-or-better 64.1% to 70.7%, gold 6.0% to 7.8%, measured over 3,000 identical decks.</li>" +
        "<li><b>Making the search twice as fast, then spending it.</b> Scoring three cards became a lookup instead of a computation &mdash; provably the same decisions, half the thinking time &mdash; and the freed budget went into more playouts: silver-or-better 70.6% to 71.6%, gold 7.5% to 8.0%, on 6,000 decks the tuning never saw.</li>" +
      "</ul>" +
      "<p><b>Didn&rsquo;t:</b></p>" +
      "<ul>" +
        "<li><b>Colour symmetry</b> in the exact solver. Red, blue and yellow are interchangeable, so this should have collapsed six states into one. It collapsed 1.03, and ran 10% slower.</li>" +
        "<li><b>A noise tolerance on the ranking.</b> It won silver (+3.3pp) and gave up gold (&minus;1.1pp). Shipped, then rolled back the same evening &mdash; gold is what you are playing for once it is in reach.</li>" +
        "<li><b>Ending every playout in the exact solver.</b> Looked good over 120 games, vanished over 5,000, and cost five times the thinking time.</li>" +
        "<li><b>A playout tail that knows what a chest needs.</b> Sound idea, no effect at all: across 1,439 positions where it could have applied it changed <b>zero</b> decisions.</li>" +
        "<li><b>Chasing gold for as long as it is arithmetically possible.</b> Loses both chests (60.9% against 65.8%). Giving up on gold at the right moment is worth more than hoping.</li>" +
      "</ul>",
    aboutLimitsHeading: "Why we can&rsquo;t be perfect",
    aboutLimitsBody:
      "<p>The deck is 24 cards and only its <em>order</em> is hidden, which makes the game small enough to solve exactly &mdash; eventually. The cost grows about 2.8&times; per extra card still in play: 13 cards take 0.4 seconds, 16 take 15 seconds, and 18 exhaust the search budget entirely. So the last turns are calculated and everything before them is estimated.</p>" +
      "<p>What that costs is measurable. Playing with the draw order known in advance averages <b>377 points</b> and reaches silver in <b>every single deck</b>. The helper averages around 310. The gap is not effort, it is information nobody has while playing.</p>" +
      "<p>Which also means: when a run ends in bronze, silver was reachable. We measured where it goes &mdash; the endgame plays those positions perfectly, so every lost run was decided earlier, while the deck was still too large to calculate. That is where the remaining work is.</p>",

    oddsExact: (p) => `Silver ${p.silver}, gold ${p.gold} — exact, not an estimate.`,
    oddsEstimate: (p) => `Silver about ${p.silver}, gold about ${p.gold}.`,
    handThree: (p) => `three ${p.value}s`,
    handSameSeq: (p) => `the same-colour ${p.low}-${p.low + 1}-${p.low + 2}`,
    handMixedSeq: (p) => `the mixed ${p.low}-${p.low + 1}-${p.low + 2}`,
    handNone: "no combination",

    likePrompt: "Enjoying the helper? Drop a like!",
    supportText:
      "<strong>This helper will never have ads.</strong> If you want to support the project, you " +
      "can donate on <a href='https://paypal.me/jogoe' target='_blank' rel='noopener'>PayPal</a> " +
      "&mdash; every bit truly means a lot. Thank you! &lt;3",
    otherHelpers: "See also the <a href='../ctk/'>Catch the King helper</a> and the <a href='../seer/'>Seer helper</a>.",

    twitchChat: "Chat",
    twitchConsentBody:
      "The chat is a Twitch embed. Loading it contacts Twitch (Amazon), which can process your IP " +
      "address and set cookies. Nothing loads until you click.",
    twitchConsentBtn: "Load Twitch chat",
    revokeTwitchConsent: "Revoke Twitch chat consent",
    twitchConsentRevoked: "Twitch chat consent revoked — reload the page.",

    footer: "Clean-room helper for Metin2 · Okey",
    allHelpers: "All helpers", impressum: "Imprint", privacy: "Privacy",

    // toasts
    fieldFull: "Field is full — take 3 to score, or throw a card first.",
    cardInPlay: "That card is already in play.",
    deckEmptyNoThrow: "Can't throw — the deck is empty, nothing would replace it.",
    pickScoresNothing: "Those 3 cards score nothing — not taken.",
    select3: "Select 3 cards first.",
    scored: (p) => `+${p.gained} (${p.label})`,
    noCombo: "No combination — 0 points",
    gameOver: (p) => `Run over — ${p.tier} chest (${p.score} points)`,
    nothingUndo: "Nothing to undo.",
    addCardsFirst: "Add cards to the field first.",
    discarded: (p) => `Thrown — now enter the card the game gave you.`,
    tierGold: "gold", tierSilver: "silver", tierBronze: "bronze",

    impressumTitle: "Imprint",
    impressumBody:
      "<p>Information per §5 TMG / §18 MStV:</p>" +
      "<p><b>Dominik Löffler</b><br>Roseggerstraße 21<br>4020 Linz<br>Österreich</p>" +
      "<p>Contact: discord <code>@jogoe</code></p>" +
      "<p>Responsible for content per §18 (2) MStV: same as above.</p>" +
      "<p><i>Disclaimer:</i> Despite careful editorial control, no liability is accepted for the content of external links.</p>",
    datenschutzTitle: "Privacy policy",
    datenschutzBody:
      "<p><b>1. Controller</b><br>See Imprint.</p>" +
      "<p><b>2. Hosting (GitHub Pages)</b><br>This site is hosted on GitHub Pages (GitHub, Inc., 88 Colin P Kelly Jr St, San Francisco, CA 94107, USA). GitHub processes visitors' IP addresses in server logs. " +
        "Privacy statement: <a href='https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement' target='_blank' rel='noopener'>docs.github.com</a>.</p>" +
      "<p><b>3. Local storage</b><br>Stored only in your browser, never sent to us: language preference, like state, practice-mode and minimal-UI preference, your session statistics, Twitch-chat consent flag, chat-hidden preference.</p>" +
      "<p><b>4. Public counters (abacus.jasoncameron.dev)</b><br>For the like button, the page-open counter and the global chest tally, the page sends HTTP requests to a free public counter service. The provider may process IP addresses while serving these requests. Only integers are stored — no identifiers. Legal basis: legitimate interest (Art. 6 (1) lit. f GDPR) in basic usage statistics.</p>" +
      "<p><b>5. Twitch chat</b><br>The chat embed loads only after you click the consent button. It then contacts Twitch (Amazon), which may process your IP address and set cookies. Legal basis: consent (Art. 6 (1) lit. a GDPR), revocable at any time via the button below.</p>" +
      "<p><b>6. Your rights</b><br>Access, rectification, erasure, restriction, objection and data portability under the GDPR, plus the right to complain to a supervisory authority (in Austria: Datenschutzbehörde).</p>",
  },

  de: {
    subtitle: "wähle die besten 3 von 5",
    pageIntro:
      "Kostenloser Helfer für das <strong>Okey</strong>-Kartenevent in Metin2. Gib die fünf Karten " +
      "auf dem Feld ein, und er sagt dir, ob du jetzt eine Hand nehmen oder eine Karte abwerfen und " +
      "nachziehen sollst. Gegen Ende schätzt er nicht mehr, sondern rechnet die Stellung exakt aus.",

    practice: "Übung",
    awaitingCards: (p) => p.n === 1
      ? "Welche Karte hat das Spiel gegeben? Klick sie unten an."
      : `Welche ${p.n} Karten hat das Spiel gegeben? Klick sie unten an.`,

    doneTitle: "Fertig — mehr ist nicht drin",
    doneBody: (p) => `Du stehst bei ${p.score} Punkten, das ist eine ${p.tier}truhe. Selbst mit den besten noch vorhandenen Karten sind ${p.next} Punkte nicht mehr erreichbar — ab hier ändert kein Zug mehr die Belohnung.`,
    doneGold: (p) => `Du stehst bei ${p.score} Punkten — Goldtruhe, mehr geht nicht. Es gibt nichts mehr zu verbessern.`,
    doneNextRun: "Nächste Runde starten",
    doneKeepPlaying: "trotzdem weiterspielen",

    practiceTitle: "Übungsmodus — zieht die Karten für dich, damit du eine ganze Runde durchspielen kannst",
    minimalUi: "Schlanke Ansicht umschalten",

    boardLabel: "Karten auf dem Feld",
    paletteLabel: "Karte in den nächsten freien Platz legen",

    helpIntro:
      "Nimm die 3 Karten, die am meisten bringen. <em>Klicke eine Karte in der Palette</em>, um sie " +
      "in den nächsten freien Platz zu legen, dann klicke Karten auf dem Feld, um deine Auswahl zu " +
      "markieren. Verbrauchte Karten werden ausgegraut, damit du keine doppelt eingibst.",
    help1: "Karte direkt tippen",
    help2: "Karte auf dem Feld in die Auswahl nehmen oder herausnehmen",
    help3: "Rechtsklick auf eine Karte am Feld wirft sie ab (danach die neue Karte eingeben)",
    help4: "die vorgeschlagenen 3 automatisch auswählen",
    help5: "Auswahl bestätigen",
    help6: "rückgängig · zurücksetzen (schreibt die Runde in deine Statistik)",

    chestRates: "Truhenquote",
    colFollowing: "Mit diesem Helfer",
    col678: "Nur 6-7-8",
    gold: "Gold", silver: "Silber", bronze: "Bronze",

    session: "Sitzung", games: "Runden", avgScore: "Ø Punkte", reset: "Zurücksetzen",
    globalAllTime: "Alle, seit jeher",
    globalNote: "Wird beim Zurücksetzen gezählt. Öffentliche Zähler, keine Konten.",

    scoreLabel: "Punkte", scoreTarget: "Ziel 400 (Gold)",
    yourPick: "Deine Auswahl", pickHint: "Klicke Karten auf dem Feld an.",
    suggestion: "Vorschlag", useSuggestion: "Vorschlag übernehmen", confirmPick: "Auswahl bestätigen",
    undo: "Rückgängig",
    suggestionPlaceholder: "Gib Karten auf dem Feld ein, um einen Vorschlag zu sehen.",
    discardCards: (p) => `${p.n} Karte${p.n === 1 ? "" : "n"} abwerfen`,

    advicePick: (p) => `Nimm ${p.hand} für ${p.score} Punkte.`,
    adviceDiscard: (p) => `Wirf ${p.card} ab.`,
    about: "Über dieses Projekt",
    aboutTitle: "Über dieses Projekt",
    aboutSolverHeading: "Wie der Solver arbeitet",
    aboutSolverBody:
      "<p>Der Helfer ist eine Clean-Room-Nachbildung des Okey-Kartenevents. Er liest das Spiel nicht &mdash; du sagst ihm, welche fünf Karten auf dem Feld liegen, und er sagt dir, ob du eine Hand nehmen oder eine Karte werfen sollst.</p>" +
      "<p>Je nachdem, wie viel vom Deck noch übrig ist, antworten drei Verfahren:</p>" +
      "<ul>" +
        "<li><b>Sofort-Heuristik</b> &mdash; bewertet jede Hand daran, was ihre Karten <em>stattdessen</em> hätten bringen können, und jeden Wurf daran, was er aufgibt. Braucht etwa eine zehntel Millisekunde &mdash; das ist die Antwort, die dasteht, sobald die fünfte Karte liegt.</li>" +
        "<li><b>Policy-Rollout</b> &mdash; für jeden möglichen Zug spielt er den Rest der Runde 96-mal gegen zufällige Deckreihenfolgen durch und zählt, wie oft eine Truhe herauskommt. Alle Züge sehen <em>dieselben</em> Reihenfolgen, damit der Vergleich nicht am Ziehungsglück hängt. Das Budget wird in Runden vergeben: erst alles messen, die schlechtere Hälfte fällt raus, und die Züge, die wirklich konkurrieren, bekommen ein Vielfaches der Aufmerksamkeit derer, die längst entschieden sind.</li>" +
        "<li><b>Exakter Solver</b> &mdash; ab 13 Karten ist die Stellung klein genug, um sie vollständig auszurechnen. Keine Schätzung: er berechnet die Wahrscheinlichkeit für jeden erreichbaren Punktestand bei perfektem Spiel. Die letzten Züge sind damit beweisbar richtig.</li>" +
      "</ul>" +
      "<p>Die starke Suche läuft in einem eigenen Thread. Deshalb erscheint der Vorschlag sofort und wird einen Moment später schärfer, statt dass die Seite beim Nachdenken hängt.</p>" +
      "<p>Eine Regel prägt alles: dein Punktestand sinkt nie, eine überschrittene Truhenschwelle ist also endgültig gesichert. Truhen sind Schwellen, keine Durchschnitte &mdash; bei 280 Punkten sind sichere 20 das ganze Spiel, bei 220 sind dieselben 20 nichts wert.</p>",
    aboutFindingsHeading: "Was wir probiert haben",
    aboutFindingsBody:
      "<p><b>Hat funktioniert:</b></p>" +
      "<ul>" +
        "<li>Züge nach <b>Truhen-Wahrscheinlichkeit statt nach Punkten</b> bewerten. Der größte Einzelsprung: von 46&nbsp;% auf 66&nbsp;% Silber-oder-besser.</li>" +
        "<li>Der <b>exakte Endspiel-Solver</b>. Nachträglich gemessen: von den Stellungen, die bereits gewonnen ins Endspiel kommen, verwertet er <b>100&nbsp;%</b> &mdash; und die offenen genau zu der Quote, die er selbst ausrechnet.</li>" +
        "<li><b>Mehr Playouts, verteilt dorthin, wo es eng ist</b> &mdash; bestätigt auf Decks, die beim Tuning nie vorkamen: Silber-oder-besser von 64,1&nbsp;% auf 70,7&nbsp;%, Gold von 6,0&nbsp;% auf 7,8&nbsp;%, gemessen über 3.000 identische Decks.</li>" +
        "<li><b>Die Suche doppelt so schnell machen &mdash; und den Gewinn ausgeben.</b> Drei Karten zu bewerten ist jetzt Nachschlagen statt Rechnen &mdash; beweisbar dieselben Z&uuml;ge, halbe Denkzeit &mdash; und das frei gewordene Budget floss in mehr Playouts: Silber-oder-besser von 70,6&nbsp;% auf 71,6&nbsp;%, Gold von 7,5&nbsp;% auf 8,0&nbsp;%, auf 6.000 Decks, die beim Tuning nie vorkamen.</li>" +
      "</ul>" +
      "<p><b>Hat nicht funktioniert:</b></p>" +
      "<ul>" +
        "<li><b>Farbsymmetrie</b> im exakten Solver. Rot, Blau und Gelb sind austauschbar, das hätte sechs Zustände zu einem zusammenfallen lassen müssen. Es waren 1,03 &mdash; und 10&nbsp;% langsamer.</li>" +
        "<li><b>Eine Rauschtoleranz beim Ranking.</b> Sie gewann Silber (+3,3&nbsp;Punkte) und gab Gold ab (&minus;1,1). Ausgeliefert und noch am selben Abend zurückgerollt &mdash; Gold ist das, worauf man spielt, sobald es in Reichweite ist.</li>" +
        "<li><b>Jedes Playout im exakten Solver enden lassen.</b> Sah über 120 Spiele gut aus, verschwand über 5.000 &mdash; und kostete das Fünffache an Rechenzeit.</li>" +
        "<li><b>Ein Playout-Schwanz, der die Truhenschwellen kennt.</b> Vernünftige Idee, null Wirkung: von 1.439 passenden Stellungen hat er <b>keine einzige</b> Entscheidung geändert.</li>" +
        "<li><b>Gold jagen, solange es rechnerisch möglich ist.</b> Verliert beide Truhen (60,9&nbsp;% gegen 65,8&nbsp;%). Gold rechtzeitig aufzugeben ist mehr wert als zu hoffen.</li>" +
      "</ul>",
    aboutLimitsHeading: "Warum es nicht perfekt sein kann",
    aboutLimitsBody:
      "<p>Das Deck hat 24 Karten, und verborgen ist nur seine <em>Reihenfolge</em> &mdash; das macht das Spiel klein genug, um es exakt zu lösen. Irgendwann. Der Aufwand wächst je zusätzlicher Karte im Spiel um etwa das 2,8-Fache: 13 Karten brauchen 0,4&nbsp;Sekunden, 16 schon 15&nbsp;Sekunden, bei 18 ist das Suchbudget erschöpft. Die letzten Züge werden also gerechnet, alles davor geschätzt.</p>" +
      "<p>Was das kostet, ist messbar. Wer die Ziehungsreihenfolge vorher kennt, kommt im Schnitt auf <b>377 Punkte</b> und erreicht Silber in <b>jedem einzelnen Deck</b>. Der Helfer liegt bei rund 310. Die Lücke ist kein Fleiss-, sondern ein Informationsproblem &mdash; niemand kennt die Reihenfolge beim Spielen.</p>" +
      "<p>Das heißt aber auch: endet eine Runde in Bronze, wäre Silber erreichbar gewesen. Wir haben nachgemessen, wo es verloren geht &mdash; das Endspiel spielt diese Stellungen fehlerfrei, jede verlorene Runde wurde also früher entschieden, als das Deck noch zu groß zum Rechnen war. Genau dort liegt die verbleibende Arbeit.</p>",

    oddsExact: (p) => `Silber ${p.silver}, Gold ${p.gold} — exakt gerechnet, nicht geschätzt.`,
    oddsEstimate: (p) => `Silber etwa ${p.silver}, Gold etwa ${p.gold}.`,
    handThree: (p) => `den Drilling ${p.value}`,
    handSameSeq: (p) => `die farbgleiche ${p.low}-${p.low + 1}-${p.low + 2}`,
    handMixedSeq: (p) => `die gemischte ${p.low}-${p.low + 1}-${p.low + 2}`,
    handNone: "keine Kombination",

    likePrompt: "Gefällt dir der Helfer? Lass ein Like da!",
    supportText:
      "<strong>Dieser Helfer wird nie Werbung haben.</strong> Wenn du das Projekt unterstützen " +
      "willst, kannst du auf <a href='https://paypal.me/jogoe' target='_blank' rel='noopener'>PayPal</a> " +
      "spenden &mdash; jeder Beitrag bedeutet mir wirklich viel. Danke! &lt;3",
    otherHelpers: "Schau dir auch den <a href='../ctk/'>Catch-the-King-Helfer</a> und den <a href='../seer/'>Seher-Helfer</a> an.",

    twitchChat: "Chat",
    twitchConsentBody:
      "Der Chat ist eine Twitch-Einbettung. Beim Laden wird Twitch (Amazon) kontaktiert; dabei " +
      "können deine IP-Adresse verarbeitet und Cookies gesetzt werden. Vor deinem Klick wird nichts geladen.",
    twitchConsentBtn: "Twitch-Chat laden",
    revokeTwitchConsent: "Twitch-Einwilligung widerrufen",
    twitchConsentRevoked: "Einwilligung widerrufen — bitte Seite neu laden.",

    footer: "Clean-Room-Helfer für Metin2 · Okey",
    allHelpers: "Alle Helfer", impressum: "Impressum", privacy: "Datenschutz",

    fieldFull: "Feld ist voll — nimm 3 Karten oder wirf zuerst eine ab.",
    cardInPlay: "Diese Karte liegt bereits im Spiel.",
    deckEmptyNoThrow: "Kein Abwerfen — der Stapel ist leer, es käme nichts nach.",
    pickScoresNothing: "Diese 3 Karten geben 0 Punkte — nicht genommen.",
    select3: "Wähle zuerst 3 Karten aus.",
    scored: (p) => `+${p.gained} (${p.label})`,
    noCombo: "Keine Kombination — 0 Punkte",
    gameOver: (p) => `Runde vorbei — ${p.tier}truhe (${p.score} Punkte)`,
    nothingUndo: "Nichts rückgängig zu machen.",
    addCardsFirst: "Gib zuerst Karten auf dem Feld ein.",
    discarded: () => `Abgeworfen — gib jetzt die neue Karte aus dem Spiel ein.`,
    tierGold: "Gold", tierSilver: "Silber", tierBronze: "Bronze",

    impressumTitle: "Impressum",
    impressumBody:
      "<p>Angaben gemäß §5 TMG / §18 MStV:</p>" +
      "<p><b>Dominik Löffler</b><br>Roseggerstraße 21<br>4020 Linz<br>Österreich</p>" +
      "<p>Kontakt: discord <code>@jogoe</code></p>" +
      "<p>Verantwortlich für den Inhalt nach §18 (2) MStV: wie oben.</p>" +
      "<p><i>Haftungsausschluss:</i> Trotz sorgfältiger inhaltlicher Kontrolle übernehmen wir keine Haftung für die Inhalte externer Links.</p>",
    datenschutzTitle: "Datenschutzerklärung",
    datenschutzBody:
      "<p><b>1. Verantwortlicher</b><br>Siehe Impressum.</p>" +
      "<p><b>2. Hosting (GitHub Pages)</b><br>Diese Seite wird über GitHub Pages gehostet (GitHub, Inc., 88 Colin P Kelly Jr St, San Francisco, CA 94107, USA). GitHub verarbeitet IP-Adressen der Besucher in Server-Logs. " +
        "Datenschutzerklärung: <a href='https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement' target='_blank' rel='noopener'>docs.github.com</a>.</p>" +
      "<p><b>3. Lokale Speicherung</b><br>Nur in deinem Browser gespeichert, nie an uns gesendet: Sprachwahl, Like-Status, Übungsmodus- und Ansichtseinstellung, deine Sitzungsstatistik, Twitch-Chat-Einwilligung, Chat-ausgeblendet-Einstellung.</p>" +
      "<p><b>4. Öffentliche Zähler (abacus.jasoncameron.dev)</b><br>Für den Like-Button, den Seitenaufruf-Zähler und die weltweite Truhen-Zählung sendet die Seite HTTP-Anfragen an einen kostenlosen öffentlichen Zählerdienst. Der Anbieter kann dabei IP-Adressen verarbeiten. Gespeichert werden ausschließlich ganze Zahlen, keine Kennungen. Rechtsgrundlage: berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO) an einfacher Nutzungsstatistik.</p>" +
      "<p><b>5. Twitch-Chat</b><br>Die Chat-Einbettung lädt erst nach deinem Klick auf die Einwilligungsschaltfläche. Danach wird Twitch (Amazon) kontaktiert, wobei deine IP-Adresse verarbeitet und Cookies gesetzt werden können. Rechtsgrundlage: Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), jederzeit über die Schaltfläche unten widerrufbar.</p>" +
      "<p><b>6. Deine Rechte</b><br>Auskunft, Berichtigung, Löschung, Einschränkung, Widerspruch und Datenübertragbarkeit nach DSGVO sowie das Recht auf Beschwerde bei einer Aufsichtsbehörde (in Österreich: Datenschutzbehörde).</p>",
  },

  // The four languages below cover the interface. The legal bodies
  // (impressumBody / datenschutzBody) intentionally fall back to English,
  // same as in ctk and seer.
  tr: {
    subtitle: "5 karttan en iyi 3'ünü seç",
    pageIntro:
      "Metin2'deki <strong>Okey</strong> kart etkinliği için ücretsiz yardımcı. Alandaki beş kartı " +
      "gir; sana şimdi el alman mı yoksa bir kart atıp yeniden çekmen mi gerektiğini söyler. " +
      "Sona doğru tahmin etmeyi bırakır ve pozisyonu tam olarak hesaplar.",
    practice: "Alıştırma",
    awaitingCards: (p) => p.n === 1
      ? "Oyun hangi kartı verdi? Aşağıdan tıkla."
      : `Oyun hangi ${p.n} kartı verdi? Aşağıdan tıkla.`,

    doneTitle: "Bitti — daha iyi sandık mümkün değil",
    doneBody: (p) => `${p.score} puanda bitirdin, bu bir ${p.tier} sandık. Kalan kartların en iyisiyle bile ${p.next} puana ulaşılamaz — buradan sonrası ödülü değiştirmez.`,
    doneGold: (p) => `${p.score} puanda bitirdin — altın sandık, en iyisi. Geliştirecek bir şey kalmadı.`,
    doneNextRun: "Sonraki turu başlat",
    doneKeepPlaying: "yine de devam et",

    practiceTitle: "Alıştırma modu — kartları senin için çeker, tam bir tur oynayabilirsin",
    minimalUi: "Sade görünüm",
    boardLabel: "Alandaki kartlar",
    paletteLabel: "Bir sonraki boş yuvaya kart ekle",
    helpIntro:
      "En çok puan getiren 3 kartı seç. <em>Paletten bir karta tıkla</em>, bir sonraki boş yuvaya " +
      "düşsün; sonra alandaki kartlara tıklayarak seçimini işaretle. Kullanılan kartlar palette " +
      "soluklaşır, aynı kartı iki kez giremezsin.",
    help1: "kartı doğrudan yaz",
    help2: "alandaki bir kartı seçime al veya çıkar",
    help3: "alandaki bir karta sağ tıkla, at (sonra oyunun verdiği kartı gir)",
    help4: "önerilen 3 kartı otomatik seç",
    help5: "seçimi onayla",
    help6: "geri al · sıfırla (turu istatistiğine yazar)",
    chestRates: "Sandık oranları",
    colFollowing: "Bunu takip ederek",
    col678: "Sadece 6-7-8",
    gold: "Altın", silver: "Gümüş", bronze: "Bronz",
    session: "Oturum", games: "Tur", avgScore: "Ort. puan", reset: "Sıfırla",
    globalAllTime: "Herkes, tüm zamanlar",
    globalNote: "Tur sıfırlanınca sayılır. Herkese açık sayaçlar, hesap yok.",
    scoreLabel: "Puan", scoreTarget: "hedef 400 (altın)",
    yourPick: "Seçimin", pickHint: "Seçmek için alandaki kartlara tıkla.",
    suggestion: "Öneri", useSuggestion: "Öneriyi uygula", confirmPick: "Seçimi onayla",
    undo: "Geri al",
    suggestionPlaceholder: "Öneri için alana kart gir.",
    discardCards: (p) => `${p.n} kart at`,
    advicePick: (p) => `${p.hand} al, ${p.score} puan.`,
    adviceDiscard: (p) => `${p.card} at.`,
    about: "Proje hakkında",
    aboutTitle: "Proje hakkında",
    aboutSolverHeading: "Solver nasıl çalışır",
    aboutFindingsHeading: "Neler denedik",
    aboutLimitsHeading: "Neden kusursuz olamaz",

    oddsExact: (p) => `Gümüş ${p.silver}, altın ${p.gold} — tahmin değil, kesin hesap.`,
    oddsEstimate: (p) => `Gümüş yaklaşık ${p.silver}, altın yaklaşık ${p.gold}.`,
    handThree: (p) => `üç ${p.value}`,
    handSameSeq: (p) => `aynı renk ${p.low}-${p.low + 1}-${p.low + 2}`,
    handMixedSeq: (p) => `karışık ${p.low}-${p.low + 1}-${p.low + 2}`,
    handNone: "kombinasyon yok",
    likePrompt: "Yardımcıyı beğendin mi? Bir like bırak!",
    supportText:
      "<strong>Bu yardımcıda asla reklam olmayacak.</strong> Projeyi desteklemek istersen " +
      "<a href='https://paypal.me/jogoe' target='_blank' rel='noopener'>PayPal</a> üzerinden " +
      "bağış yapabilirsin &mdash; her katkı gerçekten çok değerli. Teşekkürler! &lt;3",
    otherHelpers: "<a href='../ctk/'>Catch the King</a> ve <a href='../seer/'>Seer</a> yardımcılarına da bak.",
    twitchChat: "Sohbet",
    twitchConsentBody:
      "Sohbet bir Twitch gömmesidir. Yüklenince Twitch (Amazon) ile bağlantı kurulur; IP adresin " +
      "işlenebilir ve çerez konabilir. Sen tıklamadan hiçbir şey yüklenmez.",
    twitchConsentBtn: "Twitch sohbetini yükle",
    revokeTwitchConsent: "Twitch iznini geri al",
    twitchConsentRevoked: "İzin geri alındı — sayfayı yenile.",
    footer: "Metin2 için bağımsız yardımcı · Okey",
    allHelpers: "Tüm yardımcılar", impressum: "Künye", privacy: "Gizlilik",
    fieldFull: "Alan dolu — 3 kart al ya da önce bir kart at.",
    cardInPlay: "Bu kart zaten oyunda.",
    deckEmptyNoThrow: "Atılamaz — deste boş, yerine kart gelmez.",
    pickScoresNothing: "Bu 3 kart puan getirmiyor — alınmadı.",
    select3: "Önce 3 kart seç.",
    scored: (p) => `+${p.gained} (${p.label})`,
    noCombo: "Kombinasyon yok — 0 puan",
    gameOver: (p) => `Tur bitti — ${p.tier} sandık (${p.score} puan)`,
    nothingUndo: "Geri alınacak bir şey yok.",
    addCardsFirst: "Önce alana kart gir.",
    discarded: () => `Atıldı — şimdi oyunun verdiği kartı gir.`,
    tierGold: "altın", tierSilver: "gümüş", tierBronze: "bronz",
  },

  ro: {
    subtitle: "alege cele mai bune 3 din 5",
    pageIntro:
      "Ajutor gratuit pentru evenimentul de cărți <strong>Okey</strong> din Metin2. Introdu cele " +
      "cinci cărți de pe teren și îți spune dacă să iei o mână acum sau să arunci o carte și să " +
      "tragi din nou. Spre final nu mai estimează, ci rezolvă poziția exact.",
    practice: "Exersare",
    awaitingCards: (p) => p.n === 1
      ? "Ce carte ți-a dat jocul? Dă clic mai jos."
      : `Ce ${p.n} cărți ți-a dat jocul? Dă clic mai jos.`,

    doneTitle: "Gata — un cufăr mai bun nu mai e posibil",
    doneBody: (p) => `Ai terminat cu ${p.score} puncte, adică un cufăr de ${p.tier}. Nici cu cele mai bune cărți rămase nu se mai pot atinge ${p.next} puncte — de aici înainte nimic nu mai schimbă recompensa.`,
    doneGold: (p) => `Ai terminat cu ${p.score} puncte — cufăr de aur, mai bine nu se poate. Nu mai e nimic de îmbunătățit.`,
    doneNextRun: "Începe runda următoare",
    doneKeepPlaying: "continuă oricum",

    practiceTitle: "Mod exersare — trage cărțile pentru tine, ca să joci o rundă întreagă",
    minimalUi: "Interfață simplă",
    boardLabel: "Cărțile de pe teren",
    paletteLabel: "Adaugă o carte în următorul loc liber",
    helpIntro:
      "Alege cele 3 cărți care aduc cele mai multe puncte. <em>Dă clic pe o carte din paletă</em> " +
      "ca să ajungă în următorul loc liber, apoi dă clic pe cărțile de pe teren ca să îți " +
      "marchezi alegerea. Cărțile folosite se estompează, ca să nu introduci aceeași carte de două ori.",
    help1: "scrie o carte direct",
    help2: "adaugă sau scoate o carte din alegerea ta",
    help3: "clic dreapta pe o carte de pe teren o aruncă (apoi introdu cartea primită)",
    help4: "selectează automat cele 3 sugerate",
    help5: "confirmă alegerea",
    help6: "anulează · resetează (trece runda în statistica ta)",
    chestRates: "Rate cufere",
    colFollowing: "Urmând ajutorul",
    col678: "Doar 6-7-8",
    gold: "Aur", silver: "Argint", bronze: "Bronz",
    session: "Sesiune", games: "Runde", avgScore: "Punctaj mediu", reset: "Resetează",
    globalAllTime: "Toți, din totdeauna",
    globalNote: "Se numără la resetarea rundei. Contoare publice, fără conturi.",
    scoreLabel: "Punctaj", scoreTarget: "țintă 400 (aur)",
    yourPick: "Alegerea ta", pickHint: "Dă clic pe cărțile de pe teren.",
    suggestion: "Sugestie", useSuggestion: "Folosește sugestia", confirmPick: "Confirmă alegerea",
    undo: "Anulează",
    suggestionPlaceholder: "Introdu cărți pe teren ca să vezi o sugestie.",
    discardCards: (p) => `Aruncă ${p.n} ${p.n === 1 ? "carte" : "cărți"}`,
    advicePick: (p) => `Ia ${p.hand} pentru ${p.score} puncte.`,
    adviceDiscard: (p) => `Aruncă ${p.card}.`,
    about: "Despre acest proiect",
    aboutTitle: "Despre acest proiect",
    aboutSolverHeading: "Cum funcționează solverul",
    aboutFindingsHeading: "Ce am încercat",
    aboutLimitsHeading: "De ce nu poate fi perfect",

    oddsExact: (p) => `Argint ${p.silver}, aur ${p.gold} — calcul exact, nu estimare.`,
    oddsEstimate: (p) => `Argint aproximativ ${p.silver}, aur aproximativ ${p.gold}.`,
    handThree: (p) => `trei de ${p.value}`,
    handSameSeq: (p) => `secvența de aceeași culoare ${p.low}-${p.low + 1}-${p.low + 2}`,
    handMixedSeq: (p) => `secvența mixtă ${p.low}-${p.low + 1}-${p.low + 2}`,
    handNone: "nicio combinație",
    likePrompt: "Îți place ajutorul? Lasă un like!",
    supportText:
      "<strong>Acest ajutor nu va avea niciodată reclame.</strong> Dacă vrei să susții proiectul, " +
      "poți dona pe <a href='https://paypal.me/jogoe' target='_blank' rel='noopener'>PayPal</a> " +
      "&mdash; orice contribuție contează enorm. Mulțumesc! &lt;3",
    otherHelpers: "Vezi și <a href='../ctk/'>Catch the King</a> și <a href='../seer/'>Seer</a>.",
    twitchChat: "Chat",
    twitchConsentBody:
      "Chatul este o încorporare Twitch. La încărcare se contactează Twitch (Amazon), care îți " +
      "poate procesa adresa IP și seta cookie-uri. Nimic nu se încarcă până nu dai clic.",
    twitchConsentBtn: "Încarcă chatul Twitch",
    revokeTwitchConsent: "Retrage acordul Twitch",
    twitchConsentRevoked: "Acord retras — reîncarcă pagina.",
    footer: "Ajutor independent pentru Metin2 · Okey",
    allHelpers: "Toate ajutoarele", impressum: "Imprint", privacy: "Confidențialitate",
    fieldFull: "Terenul e plin — ia 3 cărți sau aruncă mai întâi una.",
    cardInPlay: "Cartea este deja în joc.",
    deckEmptyNoThrow: "Nu poți arunca — pachetul e gol, nu vine nimic în loc.",
    pickScoresNothing: "Aceste 3 cărți nu aduc puncte — nu au fost luate.",
    select3: "Alege mai întâi 3 cărți.",
    scored: (p) => `+${p.gained} (${p.label})`,
    noCombo: "Nicio combinație — 0 puncte",
    gameOver: (p) => `Rundă încheiată — cufăr de ${p.tier} (${p.score} puncte)`,
    nothingUndo: "Nimic de anulat.",
    addCardsFirst: "Introdu mai întâi cărți pe teren.",
    discarded: () => `Aruncată — acum introdu cartea primită de la joc.`,
    tierGold: "aur", tierSilver: "argint", tierBronze: "bronz",
  },

  es: {
    subtitle: "elige las mejores 3 de 5",
    pageIntro:
      "Ayudante gratuito para el evento de cartas <strong>Okey</strong> de Metin2. Introduce las " +
      "cinco cartas del campo y te dice si conviene coger una mano ahora o descartar una carta y " +
      "robar de nuevo. Cerca del final deja de estimar y resuelve la posición de forma exacta.",
    practice: "Práctica",
    awaitingCards: (p) => p.n === 1
      ? "¿Qué carta te dio el juego? Haz clic abajo."
      : `¿Qué ${p.n} cartas te dio el juego? Haz clic abajo.`,

    doneTitle: "Listo — no hay cofre mejor posible",
    doneBody: (p) => `Terminas con ${p.score} puntos, es decir un cofre de ${p.tier}. Ni con las mejores cartas que quedan se pueden alcanzar ${p.next} puntos — a partir de aquí nada cambia la recompensa.`,
    doneGold: (p) => `Terminas con ${p.score} puntos — cofre de oro, el mejor que hay. No queda nada por mejorar.`,
    doneNextRun: "Empezar la siguiente ronda",
    doneKeepPlaying: "seguir jugando igualmente",

    practiceTitle: "Modo práctica — roba las cartas por ti para que juegues una ronda completa",
    minimalUi: "Vista mínima",
    boardLabel: "Cartas en el campo",
    paletteLabel: "Añade una carta al siguiente hueco libre",
    helpIntro:
      "Coge las 3 cartas que más puntúen. <em>Haz clic en una carta de la paleta</em> para " +
      "colocarla en el siguiente hueco libre y luego haz clic en las cartas del campo para marcar " +
      "tu elección. Las cartas usadas se atenúan para que no introduzcas la misma dos veces.",
    help1: "escribe una carta directamente",
    help2: "añade o quita una carta del campo de tu elección",
    help3: "clic derecho en una carta del campo para descartarla (luego introduce la carta nueva)",
    help4: "selecciona automáticamente las 3 sugeridas",
    help5: "confirma la elección",
    help6: "deshacer · reiniciar (registra la ronda en tu estadística)",
    chestRates: "Tasa de cofres",
    colFollowing: "Siguiendo esto",
    col678: "Solo 6-7-8",
    gold: "Oro", silver: "Plata", bronze: "Bronce",
    session: "Sesión", games: "Rondas", avgScore: "Puntos medios", reset: "Reiniciar",
    globalAllTime: "Todos, desde siempre",
    globalNote: "Se cuenta al reiniciar la ronda. Contadores públicos, sin cuentas.",
    scoreLabel: "Puntos", scoreTarget: "objetivo 400 (oro)",
    yourPick: "Tu elección", pickHint: "Haz clic en las cartas del campo.",
    suggestion: "Sugerencia", useSuggestion: "Usar sugerencia", confirmPick: "Confirmar elección",
    undo: "Deshacer",
    suggestionPlaceholder: "Introduce cartas en el campo para ver una sugerencia.",
    discardCards: (p) => `Descartar ${p.n} carta${p.n === 1 ? "" : "s"}`,
    advicePick: (p) => `Coge ${p.hand} por ${p.score} puntos.`,
    adviceDiscard: (p) => `Descarta ${p.card}.`,
    about: "Sobre este proyecto",
    aboutTitle: "Sobre este proyecto",
    aboutSolverHeading: "Cómo funciona el solver",
    aboutFindingsHeading: "Qué probamos",
    aboutLimitsHeading: "Por qué no puede ser perfecto",

    oddsExact: (p) => `Plata ${p.silver}, oro ${p.gold} — cálculo exacto, no una estimación.`,
    oddsEstimate: (p) => `Plata en torno a ${p.silver}, oro en torno a ${p.gold}.`,
    handThree: (p) => `el trío de ${p.value}`,
    handSameSeq: (p) => `la escalera del mismo color ${p.low}-${p.low + 1}-${p.low + 2}`,
    handMixedSeq: (p) => `la escalera mixta ${p.low}-${p.low + 1}-${p.low + 2}`,
    handNone: "ninguna combinación",
    likePrompt: "¿Te gusta el ayudante? ¡Deja un like!",
    supportText:
      "<strong>Este ayudante nunca tendrá publicidad.</strong> Si quieres apoyar el proyecto, " +
      "puedes donar en <a href='https://paypal.me/jogoe' target='_blank' rel='noopener'>PayPal</a> " +
      "&mdash; cada aportación significa muchísimo. ¡Gracias! &lt;3",
    otherHelpers: "Mira también <a href='../ctk/'>Catch the King</a> y <a href='../seer/'>Seer</a>.",
    twitchChat: "Chat",
    twitchConsentBody:
      "El chat es una inserción de Twitch. Al cargarlo se contacta con Twitch (Amazon), que puede " +
      "tratar tu dirección IP y poner cookies. No se carga nada hasta que hagas clic.",
    twitchConsentBtn: "Cargar chat de Twitch",
    revokeTwitchConsent: "Revocar el consentimiento de Twitch",
    twitchConsentRevoked: "Consentimiento revocado — recarga la página.",
    footer: "Ayudante independiente para Metin2 · Okey",
    allHelpers: "Todos los ayudantes", impressum: "Aviso legal", privacy: "Privacidad",
    fieldFull: "El campo está lleno — coge 3 cartas o descarta una primero.",
    cardInPlay: "Esa carta ya está en juego.",
    deckEmptyNoThrow: "No puedes descartar — el mazo está vacío, no habría reemplazo.",
    pickScoresNothing: "Esas 3 cartas no puntúan — no se han tomado.",
    select3: "Selecciona primero 3 cartas.",
    scored: (p) => `+${p.gained} (${p.label})`,
    noCombo: "Ninguna combinación — 0 puntos",
    gameOver: (p) => `Ronda terminada — cofre de ${p.tier} (${p.score} puntos)`,
    nothingUndo: "Nada que deshacer.",
    addCardsFirst: "Introduce primero cartas en el campo.",
    discarded: () => `Descartada — ahora introduce la carta que te dio el juego.`,
    tierGold: "oro", tierSilver: "plata", tierBronze: "bronce",
  },

  pl: {
    subtitle: "wybierz najlepsze 3 z 5",
    pageIntro:
      "Darmowy pomocnik do karcianego wydarzenia <strong>Okey</strong> w Metin2. Wpisz pięć kart " +
      "na stole, a powie ci, czy wziąć układ teraz, czy odrzucić kartę i dobrać nową. Pod koniec " +
      "przestaje szacować i liczy pozycję dokładnie.",
    practice: "Trening",
    awaitingCards: (p) => p.n === 1
      ? "Jaką kartę dała gra? Kliknij ją poniżej."
      : `Jakie ${p.n} karty dała gra? Kliknij je poniżej.`,

    doneTitle: "Koniec — lepsza skrzynia nie jest możliwa",
    doneBody: (p) => `Kończysz z wynikiem ${p.score} punktów, czyli ${p.tier} skrzynia. Nawet z najlepszymi pozostałymi kartami ${p.next} punktów już nie osiągniesz — od tego momentu nic nie zmieni nagrody.`,
    doneGold: (p) => `Kończysz z wynikiem ${p.score} punktów — złota skrzynia, najlepsza z możliwych. Nie ma czego poprawiać.`,
    doneNextRun: "Zacznij następną rundę",
    doneKeepPlaying: "graj mimo to",

    practiceTitle: "Tryb treningowy — dobiera karty za ciebie, żebyś mógł rozegrać całą rundę",
    minimalUi: "Prosty widok",
    boardLabel: "Karty na stole",
    paletteLabel: "Dodaj kartę na następne wolne miejsce",
    helpIntro:
      "Weź 3 karty, które dają najwięcej punktów. <em>Kliknij kartę w palecie</em>, żeby trafiła " +
      "na następne wolne miejsce, a potem klikaj karty na stole, aby zaznaczyć swój wybór. Zużyte " +
      "karty szarzeją, więc nie wpiszesz tej samej dwa razy.",
    help1: "wpisz kartę bezpośrednio",
    help2: "dodaj lub usuń kartę ze swojego wyboru",
    help3: "prawy przycisk na karcie na stole ją odrzuca (potem wpisz nową kartę)",
    help4: "zaznacz automatycznie sugerowane 3",
    help5: "zatwierdź wybór",
    help6: "cofnij · zresetuj (zapisuje rundę w twojej statystyce)",
    chestRates: "Skrzynie",
    colFollowing: "Z pomocnikiem",
    col678: "Tylko 6-7-8",
    gold: "Złota", silver: "Srebrna", bronze: "Brązowa",
    session: "Sesja", games: "Rundy", avgScore: "Śr. punkty", reset: "Reset",
    globalAllTime: "Wszyscy, od zawsze",
    globalNote: "Liczone przy resecie rundy. Publiczne liczniki, bez kont.",
    scoreLabel: "Punkty", scoreTarget: "cel 400 (złota)",
    yourPick: "Twój wybór", pickHint: "Kliknij karty na stole.",
    suggestion: "Podpowiedź", useSuggestion: "Użyj podpowiedzi", confirmPick: "Zatwierdź wybór",
    undo: "Cofnij",
    suggestionPlaceholder: "Wpisz karty na stole, aby zobaczyć podpowiedź.",
    discardCards: (p) => `Odrzuć ${p.n} kart${p.n === 1 ? "ę" : "y"}`,
    advicePick: (p) => `Weź ${p.hand} za ${p.score} punktów.`,
    adviceDiscard: (p) => `Odrzuć ${p.card}.`,
    about: "O tym projekcie",
    aboutTitle: "O tym projekcie",
    aboutSolverHeading: "Jak działa solver",
    aboutFindingsHeading: "Czego próbowaliśmy",
    aboutLimitsHeading: "Dlaczego nie może być idealny",

    oddsExact: (p) => `Srebrna ${p.silver}, złota ${p.gold} — dokładny wynik, nie szacunek.`,
    oddsEstimate: (p) => `Srebrna około ${p.silver}, złota około ${p.gold}.`,
    handThree: (p) => `trójkę ${p.value}`,
    handSameSeq: (p) => `sekwens w jednym kolorze ${p.low}-${p.low + 1}-${p.low + 2}`,
    handMixedSeq: (p) => `mieszany sekwens ${p.low}-${p.low + 1}-${p.low + 2}`,
    handNone: "brak układu",
    likePrompt: "Podoba ci się pomocnik? Zostaw like!",
    supportText:
      "<strong>Ten pomocnik nigdy nie będzie miał reklam.</strong> Jeśli chcesz wesprzeć projekt, " +
      "możesz wpłacić na <a href='https://paypal.me/jogoe' target='_blank' rel='noopener'>PayPal</a> " +
      "&mdash; każda złotówka wiele znaczy. Dziękuję! &lt;3",
    otherHelpers: "Zobacz też <a href='../ctk/'>Catch the King</a> i <a href='../seer/'>Seer</a>.",
    twitchChat: "Czat",
    twitchConsentBody:
      "Czat to osadzenie Twitcha. Po załadowaniu następuje połączenie z Twitchem (Amazon), który " +
      "może przetwarzać twój adres IP i ustawiać ciasteczka. Nic nie ładuje się przed kliknięciem.",
    twitchConsentBtn: "Załaduj czat Twitcha",
    revokeTwitchConsent: "Cofnij zgodę na Twitcha",
    twitchConsentRevoked: "Zgoda cofnięta — odśwież stronę.",
    footer: "Niezależny pomocnik do Metin2 · Okey",
    allHelpers: "Wszystkie pomocniki", impressum: "Impressum", privacy: "Prywatność",
    fieldFull: "Stół jest pełny — weź 3 karty albo najpierw jedną odrzuć.",
    cardInPlay: "Ta karta jest już w grze.",
    deckEmptyNoThrow: "Nie możesz odrzucić — talia jest pusta, nic nie dojdzie.",
    pickScoresNothing: "Te 3 karty nie dają punktów — nie zostały wzięte.",
    select3: "Najpierw wybierz 3 karty.",
    scored: (p) => `+${p.gained} (${p.label})`,
    noCombo: "Brak układu — 0 punktów",
    gameOver: (p) => `Koniec rundy — ${p.tier} skrzynia (${p.score} punktów)`,
    nothingUndo: "Nie ma czego cofnąć.",
    addCardsFirst: "Najpierw wpisz karty na stole.",
    discarded: () => `Odrzucone — teraz wpisz kartę, którą dała gra.`,
    tierGold: "złota", tierSilver: "srebrna", tierBronze: "brązowa",
  },
};

const LANG_KEY = "okey-helper.lang.v1";
let lang = "en";
const listeners = new Set();

(function initLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && STRINGS[saved]) lang = saved;
    else if (typeof navigator !== "undefined") {
      const code = (navigator.language || "").slice(0, 2).toLowerCase();
      if (STRINGS[code]) lang = code;
    }
  } catch {}
})();

export function getLang() { return lang; }

export function setLang(next) {
  if (!STRINGS[next] || next === lang) return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, lang); } catch {}
  applyToDOM();
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function t(key, params) {
  const v = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key] ?? key;
  return typeof v === "function" ? v(params || {}) : v;
}

export function applyToDOM() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
  });
}
