# Diamant: implementation audit

Checked against publisher and designer sources on 2026-11-13. This note describes mechanics in original wording; it is not a transcription of a rulebook. Primary target: current IELLO edition (2024 artwork), matching Hobby World Russian rules v1.0 (©2026). Legacy IELLO 2016 is a distinct selectable rules profile, not an interchangeable name.

## Primary sources

| Source | URL | Local reference | Useful pages |
| --- | --- | --- | --- |
| Current English rules, IELLO | https://iellogames.com/wp-content/uploads/2016/10/Diamant_Rulebook_EN_V1_Light.pdf | `references/diamant-current-rules-en.pdf` | 3 exact deck; 5–7 play; 8 relics |
| Current Russian rules, Hobby World | https://hobbyworld.ru/download/rules/diamant-rules.pdf | `references/diamant-current-rules-ru.pdf` | 3 components; 5–7 play; 8 relic mode |
| Legacy French rules, IELLO 2016 | https://iello.fr/wp-content/uploads/2016/10/DIAMANT_rulebook_FR_light.pdf | `references/diamant-2016-rules-fr.pdf` | 5 initial 35-card deck; 7 relic scoring; 8 cleanup |
| Revised French rules, IELLO 2021 | https://iello.fr/wp-content/uploads/2016/10/DIAMANT_rulebook_FR_light-1.pdf | `references/diamant-2021-rules-fr.pdf` | 8 numbered relic variant |
| Designer explains relic revision (2017) | https://faidutti.com/blog/blog/2017/10/07/les-reliques-de-diamant-diamants-relics/ | URL only | Numbered relics enter in ascending round order; author corrects his own erroneous comment about reshuffling exposed relics |
| Original Schmidt rules, hosted by designer | https://www.faidutti.com/diamant/diamantrules.pdf | URL only | p4 explicitly recommends open chests, optional hidden chests by agreement |
| Current game page, IELLO | https://iellogames.com/jeux/diamant/ | URL only | 3–8 players, 8+, 30 min; creator and artist credits |
| Current Russian game page | https://hobbyworld.ru/diamant | URL only | Publisher download and component gallery |

Downloaded books are research references. They retain their publishers' copyrights and are not reusable app illustrations. In particular, the Russian book explicitly prohibits republication without permission. Keep them out of public asset bundles. Original illustrations should be used by the web adaptation. Game design credits: Alan R. Moon and Bruno Faidutti; published artwork: Paul Mafayon.

## Shared core

- Three to eight players, five expeditions. Everyone participates again at each expedition's start. First card is revealed automatically; decisions begin after a safe reveal.
- Fifteen treasure cards: `[1,2,3,4,5,5,7,7,9,11,11,13,14,15,17]`. A ruby is one point; a diamond is simply a five-point denomination, not a separate reward distribution.
- Fifteen danger cards: five types, three copies each. Current art uses scorpion, snake, lava, boulder and spikes. Legacy 2016 uses spider and wooden ram in place of scorpion and spikes; mechanics are unchanged.
- Revealed treasure `v` gives every active explorer `floor(v / activeCount)` carried points. Its remainder stays on the trail. Carried points remain vulnerable until the player returns.
- Each explorer still in the cave secretly chooses continue or return. Reveal all choices together. Returning players leave before the next card is revealed. Camped players cannot rejoin that expedition.
- Returners pool **all** trail remainders and divide the pooled total equally. Undivided points remain on the trail. Each returner banks their own carried points plus their share. Existing banked points remain safe throughout the game.
- First danger of a type is harmless. A second matching danger anywhere in the same expedition causes immediate failure; adjacency is irrelevant. All remaining explorers lose their carried points. Remove exactly one copy of that repeated danger permanently.
- A round also ends if everyone returns voluntarily. Discard unclaimed trail points; reshuffle surviving revealed expedition cards together with the undrawn cards. Do not restore permanently removed dangers. Reveal the first card of the next expedition with everyone active.
- After expedition five, greatest bank plus relic value wins. Ties are shared victories; no relic-count tiebreaker.

## Rules profiles

| Profile | Initial deck | Relics | Scoring |
| --- | --- | --- | --- |
| Modern base | 30 cards | None | Banked points |
| Modern relic variant / «Охота за золотом» | 31 cards | Add one at the beginning of each round: 5, then 7, 8, 10, 12 | Printed values, separate from gem bank |
| Legacy IELLO 2016 | 35 cards | All five identical relics shuffled in immediately | First three **claimed globally** give 5 each; fourth and fifth give 10 each |

In either relic profile, a revealed relic waits on the trail. Exactly one returner claims **all** available relics; two or more simultaneous returners claim none. The last remaining explorer can claim them by returning alone. Claimed relics never re-enter the deck. At round end, revealed unclaimed relics are removed permanently. Undrawn relics stay in the deck. In modern mode, the next numbered relic is added in addition to any surviving undrawn ones.

## Implementation checks derived from the rules

1. Treasure 9 with five explorers: one carried point each, four on trail.
2. Two returners, trail remainders 1+1+1: one extra point each, one left; do not divide each card separately.
3. One returner and several active explorers: returner receives every trail remainder and every exposed relic; only remaining explorers receive the next treasure.
4. Two returners and a relic: neither receives it. A later sole returner does.
5. Snake, treasure, snake fails just as snake, snake does; safe returners keep their bank.
6. One removed snake leaves two snake cards in future rounds; another snake failure leaves one, which can no longer cause a snake pair.
7. All return together with a relic exposed: relic is permanently lost, even though expedition ended voluntarily.
8. Modern first-round relic stays undrawn: round two contains both the 5 and 7 relics (subject to danger removal). A first-round exposed unclaimed relic never returns.
9. Legacy claimed count is two, one player now claims three relics: award 5+10+10, not 5+5+5 and not by the round number.
10. Decision values must remain private until the final active player commits. Revealing only the count of submitted choices does not change the decisions' secrecy.
11. Count five rounds exactly. Equal final scores produce all tied winners.
12. Ignore players already at camp when dividing new treasure or collecting decisions.

## Explicit scope / ambiguities

Current rulebook does not specify chest visibility. Original designer-hosted 2005 rules explicitly recommend visible totals and allow hidden totals by agreement; a visible/hidden lobby option is defensible. Bots, reconnect grace periods and lobby management are online conveniences, not tabletop rules. A timeout changing a player's decision is a house rule and must be labelled or disabled by default.

No official deck-exhaustion rule was found. In a legal five-round game, exhaustion is unreachable: at most four dangers have been removed before round five, leaving eleven danger cards over five types, so a repeated type must be revealed before the full deck can be consumed. A defensive engine guard should report inconsistent state rather than silently create a new scoring rule.

Incan Gold, 2005 Schmidt Diamant, IELLO 2016, later numbered-relic Diamant, and the separate Betrayal/Warnings expansions must not be silently mixed. The current 2026 micro-expansion has eight betrayal cards and nine warning tiles and is outside the base/relic rules above: https://iello.fr/jeux/diamant-mise-en-garde-et-trahison-nouvelle-edition/ .

## Online presentation choices

This implementation uses **closed chests**: each player sees their own bank and score; everyone sees exposed carried loot and acquired relics. Other banks and total scores are revealed at final scoring. This is a chosen visibility presentation, not a claim that modern rulebooks mandate hidden scores. Amounts earned while returning are public events, as around a physical table.

Any seated human can advance after the expedition-end summary. This affects pacing only and prevents an absent organiser from blocking the next round; lobby controls and rematch remain with the organiser. Decisions have no automatic deadline: a disconnected player keeps their seat and can reconnect, while a pending human decision waits. No automatic retreat or kick changes the tabletop outcome.
