// Guard against the two ways translations silently break: a key used in the
// page that no language defines, and a language missing a key the others have.
// Legal bodies are allowed to fall back to English, same as ctk and seer.
import fs from "node:fs";

const src = fs.readFileSync("okey/i18n.js", "utf8");
const html = fs.readFileSync("okey/index.html", "utf8");
const main = fs.readFileSync("okey/main.js", "utf8");

const used = new Set([...html.matchAll(/data-i18n(?:-html|-title)?="([^"]+)"/g)].map((m) => m[1]));
for (const m of main.matchAll(/\bt\("([a-zA-Z0-9]+)"/g)) used.add(m[1]);
used.delete("tier"); // built dynamically as tierGold / tierSilver / tierBronze

const blocks = src.split(/\n {2}(en|de|tr|ro|es|pl): \{/);
const defined = {};
for (let i = 1; i < blocks.length; i += 2) {
  defined[blocks[i]] = new Set(
    [...blocks[i + 1].matchAll(/(?:^|[{,]\s*|\n\s*)([a-zA-Z0-9]+):/g)].map((m) => m[1]),
  );
}

const LEGAL = ["impressumTitle", "impressumBody", "datenschutzTitle", "datenschutzBody"];
let bad = 0;

const undefinedKeys = [...used].filter((k) => !defined.en.has(k));
if (undefinedKeys.length) { console.log("used in the page but defined nowhere:", undefinedKeys); bad++; }
else console.log("every key used in the page is defined");

const unused = [...defined.en].filter((k) => !used.has(k) && !k.startsWith("tier") && !k.startsWith("hand") && !k.startsWith("advice") && !k.startsWith("odds"));
if (unused.length) console.log("defined but never used (dead strings):", unused);

for (const lang of ["de", "tr", "ro", "es", "pl"]) {
  const miss = [...defined.en].filter((k) => !defined[lang].has(k));
  const onlyLegal = miss.every((k) => LEGAL.includes(k));
  if (miss.length && !onlyLegal) { console.log(`${lang} missing:`, miss.filter((k) => !LEGAL.includes(k))); bad++; }
  else console.log(`${lang}: complete${miss.length ? " (legal texts fall back to EN by design)" : ""}`);
}

process.exit(bad ? 1 : 0);
