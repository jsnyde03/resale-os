  # Resale OS — MASTER PLAN

**The queue.** Terse by rule. Detail, rationale and completed narrative live in
[MASTER_PLAN_LOG.md](MASTER_PLAN_LOG.md). Specs live in [docs/](docs/).

Exactly **one** decomposed section on this page — the active item's.

---

## ACTIVE

### Gate 5 — THE PHONE IS THE SYSTEM ✅ **BUILT 2026-09-10**

⚡ **The fund lives on the phone, knows its exact position offline, and the
desktop is gone.** 44/44 against Apple's SQLite over the commit that deleted it;
shipped to TestFlight on Codemagic's first run. `core + scoring + domain` — 4,878
lines — moved with **zero edits**, and `node:sqlite` really was confined to one
file, as `ASSUMPTIONS_AND_RISKS` A1 predicted.

⚠️ **The exit criteria were incomplete**, which the phase after-scan found:
"the desktop is gone" was satisfied while a capability only the desktop had went
with it, so **5.12** put the settings screen back. Every item's detail, every
decision and every plant is in **MASTER_PLAN_LOG.md** — 5.1 through 5.12, plus
the phase after-scan.

**What Gate 5 cost that was not the port:** a hash chain quietly importing
`node:crypto`, four platform couplings in the store, two screens that gated a
purchase differently (**D14**), an export carrying a tax profile toward a public
repo, and a CLI that could fork the ledger the moment the fund left. **None were
portability problems. They were things the port made visible.**

---

### Gate 6 — SOURCING: THE APP FINDS AND RECOMMENDS

The data route is settled (**D12**): Browse API to find,
SoldComps to value, own history to accumulate, manual as the fallback that stays
wired.

- [x] **6.0** ✅ **Done 2026-09-10. 47/47 on device.** The aisle screen names the
      FIX and not just the failing gate (**B70**), takes condition and hassle as
      words anchored so the default reproduces the old score (**B64**, **B71**),
      and **records every decision including the walk-aways** (**B68**) — so
      **B3**'s histogram has something to count and **6.5**'s watchlist something
      to watch. Scores are device-local by decision (**D15**).

- [x] **6.1** ✅ **Done 2026-09-11. 51/51 on device. Closes B77-B80, B82.** The
      data route: SoldComps behind an adapter, ACTIVE called first and SOLD
      pinned to the category it declares, an unparseable count refused rather
      than defaulted, and a floor that the gate will not pass on. The screen
      fills what it can, says which market it measured, shows what is left of
      the month, and answers exactly as well as it does today with no signal.

- [x] **6.2** ✅ **Done 2026-09-10. Closes B3.** *What is stopping you* — the
      binding gate, from the record. ⚡ **The codes are stored STRUCTURALLY now**;
      the histogram used to regex-parse them out of prose, so a reworded reason
      would have emptied the chart in silence (older rows still fall back).
      ⛔ It carries a **denominator**: refusals that yield no code are reported as
      a **bug**, because an empty chart and a broken reader are the same picture.
      ⚠️ And it **reports a tie as a tie** — the first measured case had four gates
      firing on all six candidates, and naming the alphabetically-first one hid
      the only dial that moves. Found by a case failing, not by reading.

**Exit:** the fund can answer *"why is nothing passing?"* from its own record
instead of from a hunch.

### Gate 6.5 — NOT YET, OR NEVER? ✅ **DONE 2026-09-10, 50/50 on device**

⚡ **The before-scan disproved the premise.** Filed as *"the watchlist that
unlocks"*; measured, most refusals never clear at **any** bankroll, so the
valuable answer is *"put it down"* and the watchlist is the leftover. The unlock
is **not monotonic** — GROWTH is stricter — so it scans rather than bisects, and
the screen warns when growing would LOSE a buy. Detail in the log.

---

### Gate 6.6 — A GATE THAT ABSTAINS MUST SAY SO ✅ **DONE 2026-09-11, 52/52 on device**

⚡ **Closes B66.** Every gate field is required, so a caller that forgets one
fails to compile; the one gate that may decline to run **declares it with a
reason**, and the screen says *"not tested"* rather than showing a figure. Every
code is now accounted for as a result or an abstention, swept across 11 candidate
shapes.

⚠️ **Both of its premises were stale and the switch-in scan caught both** — D14
had already removed the second surface, so this was prevention, not repair. ⛔ It
also deleted `quote.candidate`, a second way to build the object that decides
whether money moves, which nothing had assessed since D14. Detail, and the three
plants (one of which corrected me), in the log.

### Gate 6.7 — THE ALLOCATION BLOCK ✅ **DONE 2026-09-11, 53/53 on device**

⚡ **Closes B73, and unblocks D2.** The owner split and the set-aside threshold
are editable on the phone, refused in the operator's words before the engine's,
and the screen says the split is **dormant at the live $50** so an edit does not
read as having done nothing. ⚡ **The other mode is configurable too** — the
model always took one; only the screen was pinned to the active mode.

⛔ `allocation.tax` left off deliberately: read by nothing outside `policy.ts`
(**B86**). Detail and the two plants in the log.

---

### Gate 6.8 — A TEST MAY NOT ASSERT ON THE CACHE ✅ **DONE 2026-09-11, 53/53 on device**

⚡ **Closes B54, and the filed fix was wrong.** "Ban `state()` in tests" would
have red-gated 16 legitimate uses; the enforceable rule is **a test may not
ASSERT on it**, which cut 75 sites to 29. Swapping all 29 was a free audit and
**one reddened correctly** — the case whose subject IS the stale cache, now
exempted by a `cache-assertion` marker on the line and given the control it
lacked. Planted three ways including the control. Detail in the log.

---

### Gate 6.9 — A LEAKED HANDLE WAS REPLACING REAL FAILURES ✅ **DONE 2026-09-11**

⚡ **Closes B55, and the bug was proven rather than argued.** The same planted
failure in both shapes: old, the `AssertionError` **never appears** and
`EBUSY` replaces it; new, it surfaces cleanly. Seven closes moved into a
`finally`. ⛔ `maxRetries: 5` did not save the old shape and now says so.
⚡ **6.9.4 audited to "no change needed"** — 5.5.1 had already fixed the one
stale list. Detail in the log.

---

### Gate 6.10 — THE RULES GOT AN IDENTITY ✅ **DONE 2026-09-11, 54/54 on device**

⚡ **Closes B88.** A fingerprint taken from BEHAVIOUR — the evaluator run over a
fixed reference candidate — because hashing `CONSTRAINT_CODES` would have caught
6.1.0 and missed 6.6, the change that motivated it. Stored per score, NULL reads
as stale, and the histogram says when it is mixing rule sets. Detail in the log.

---

### Gate 6.11 — THE SCAN FLOW ✅ **BUILT 2026-09-11** *(6.11.6 awaits the deploy)*

⚡ **Closes D18, B84, B89.** Barcode → identity → a keyword that is **proposed
and editable** → market → verdict, with the tag price the only typed field.
⛔ A scan never overwrites a judgement and never picks the keyword: two
defensible searches from one barcode measured **68% apart** in median sold price.
⚠️ **6.11.6 is the one item the lane structurally cannot close** — a simulator
has no camera — so it verifies at the deploy, on a real device with a real
barcode. Everything below the camera is covered. Detail in the log.

---

### Gate 7.5 — DROP INTEL ⚡ **ACTIVE BUILD**

🎯 **Jason 2026-09-11:** *"Most of my highest returns were not off the clearance
rack previously. They were online drops."*

⚡ **A drop has no discovery problem** — product, retailer, date and price are
announced publicly before it happens, so **D16 does not touch it**. ⛔ **It has a
VALUATION problem**: the thing has never been sold, so it is priced by analogy,
and `compConfidence` measures **precision, not accuracy** — a tight comp set for
last year's model scores near the top while describing something nobody is
buying.

- [x] **7.5.1** ✅ **Done 2026-09-11.** `core/drop.ts` + `CompEvidence.analogous`,
      which **caps** an analogy rather than scaling it. ⛔ Caught a real bug: a
      drop happening **today** read as passed, because a date was diffed against
      a moment. 736 tests (+14).
- [x] **7.5.2** ✅ **Done 2026-09-11.** `screens/drops.ts` — judged **at MSRP** on
      the comparable's market, four states, and a **dated** shortfall.
      ⛔ Wired `evidenceIsAnalogous` end to end: 7.5.1's cap could reach no
      evaluator, and it decides the confidence gate. Caps the **demand** half
      too (Jason). 757 tests (+21).
- [x] **7.5.3** ✅ **[DECISION] answered 2026-09-11 — a scraped release feed
      (D19).** ⚠️ I recommended manual-first; Jason chose the feed.
- [x] **7.5.4** ✅ **Done 2026-09-11.** Migration 008, a repository, and
      `mobile/app/drops.tsx` — add a drop, value it against the comparable's
      market, remove it. ⛔ **The table stores no verdict**, which is what
      settled the id question: a drop is in the future, so the screen
      recomputes. 774 tests (+17), and a 56th device case — **56/56 on the
      lane, confirmed by name**.
- [ ] **7.5.5** ⛔ **BLOCKED — the switch-in scan found no reachable source.**
      Per vertical: **cards** has the one properly-documented free API with a
      `releaseDate` field (pokemontcg.io) and it returned **502 then 500 when
      queried on 2026-09-11** — a hobbyist API, down at the moment of asking;
      **LEGO** has Brickset API v3 (JSON) but it needs an account and a
      requested key, so nothing can be verified without Jason; **sneakers** and
      **consoles** have no free structured source found at all. ⚠️ **And the
      decisive property is unverified for both survivors: whether either lists
      releases that have NOT happened yet.** A catalogue of what already came
      out is not a calendar. **Needs Jason: request a free Brickset key**
      — 100 `getSets` calls a day, ample. ⚠️ **Brickset states the API is for apps
      that "enhance the Brickset experience", and NOT for scraping the database or
      building competing sites.** Resale OS clears both prohibitions — a handful of
      sets, no public surface, nothing republished — and is honestly not an
      enhancement to their community either, so the request says so plainly and
      lets them decline. ⛔ **If they decline, that is the answer** (**D16**): LEGO
      falls back to the manual entry 7.5.4 already supports, which fits a few drops
      a month.
      ⛔ Structured sources only — the phone has no DOM, so an HTML scrape is
      regex over markup and breaks silently.
- [ ] **7.5.6** Alerting. ⚠️ `expo-notifications` is a second native module;
      **D13 bounds this to monitoring and alerting, never checkout.**
- [ ] **7.5.7** On-device verification.

**Exit:** the app says what is coming, what it would pay, and what the fund must
reach by the date — and never tries to buy anything.

---

## Queue

| # | Gate | State |
|---|---|---|
| 1 | Architecture, schema, deterministic capital engine, tests | ✅ Done 2026-09-08 |
| 2 | Opportunity + Buy/Risk score + eligibility + recommendation | ✅ Done 2026-09-08 |
| 3 | Inventory & sale lifecycle, expenses, reserves, distributions, charge-offs, recoveries | ✅ Done 2026-09-08 |
| 4 | Dashboard + rules/config UI | ✅ Done 2026-09-08 |
| 5 | **The phone is the system** — engine ported, ledger on-device, desktop retired | ✅ **Done 2026-09-10**, phase after-scan included |
| 6 | **Sourcing: the app values and recommends** — ⛔ the FINDING half was struck as UNAVAILABLE, not deferred (**D16**, Jason 2026-09-11); the operator finds | ✅ **Done 2026-09-11**, 51/51 on device |
| 6.5 | **Not yet, or never?** — ⚡ the before-scan disproved the "watchlist that unlocks" premise: most refusals never clear at any bankroll | ✅ **Done 2026-09-10**, 50/50 on device |
| 6.6 | **A gate that abstains must say so** (**B66**) | ✅ **Done 2026-09-11**, 52/52 on device |
| 6.7 | **The allocation block** (**B73**) — owner split and set-aside threshold; **unblocks D2** | ✅ **Done 2026-09-11**, 53/53 on device |
| 6.8 | **A test may not assert on the cache** (**B54**) | ✅ **Done 2026-09-11**, 53/53 on device |
| 6.9 | **A leaked handle was replacing real failures** (**B55**) | ✅ **Done 2026-09-11** |
| 6.10 | **The rules got an identity** (**B88**) | ✅ **Done 2026-09-11**, 54/54 on device |
| 6.11 | **The scan flow** (**D18**) — barcode → identity → keyword → verdict | ✅ **Built 2026-09-11**; 6.11.6 needs a real device |
| 7 | **Radar over the fund's OWN HISTORY** — scarcity, demand, momentum, confidence, from what the operator has actually seen. ⛔ Not market-wide; that premise died with **D16** | ⏸️ **PARKED until there is history** (**D17**) |
| 7.5 | **Drop intel** — dated retail drops, monitoring and alerting. ⛔ Checkout automation is OUT, see **D13** | ⚡ **ACTIVE BUILD** |
| 7.6 | **Restock monitors + notifications** (Jason, 2026-09-11). ⚡ **Researched: the monitoring is not ours to build** — free vendors already do it, and the half nobody else does is judging the buy. ⛔ Same D13 boundary: alert, never checkout | 🟠 **Open — D20 waits on Jason trying TYPA** |
| 8 | *(architecture only until 1–7 are reliable)* authorization states, drop intel, autonomy | Not started, not startable |

**Gate exit criteria are in the log**, one entry per gate.

---

## Owned by Jason — do not decide these

| # | Decision | State |
|---|---|---|
| D1 | What the tax reserve covers | ✅ **Incremental annual tax, 2026-09-08.** SE tax + federal brackets + QBI + state. ⚠️ Income tax abstains until a `TaxProfile` is set — **D7** |
| D14 | Which gate set decides a purchase, given the two paths disagree | ✅ **One evaluator everywhere — 2026-09-10.** `evaluateOpportunity` gates every purchase, typed or scored; `assessQuote`'s candidate stops being a decision path. ⚠️ **Deliberately stricter on the live fund:** a buy typed with no comps and middling sell-through now needs **D4**'s override with a reason. Measured first — 64 divergences in 96 cases, both directions (**B58**) |
| D20 | Where a restock monitor RUNS | 🟠 **OPEN — vendors AND transports researched 2026-09-11.** ⛔ **X is the expensive door, and it just closed.** X killed the free tier for new developers on **2026-02-06**; everyone is on pay-per-use at **$0.005 per post read**, legacy Basic ($200/mo) was force-migrated, legacy Pro deprecated 2026-08-14. Modest use — five tracker accounts — is **$15-30 a month against a $75 bankroll**, which is the recurring cost Jason just deferred to NAV $500. ⚡ **Discord is free, and the restock community already lives there** — the trackers run servers (TCGTracker, Pokemon Restocks and Alerts), and X-only accounts can be bridged in by a relay bot (TweetShift), so the X API is never touched. ⚡⚡ **And DisTrackers covers LEGO and Trading Cards** — *Funko, Disney, Marvel, Star Wars, Pokémon, Anime, **Lego**, Trading Cards* — which is exactly the gap TYPA's marketing left. **Jason's instinct about coverage was right; the transport was the part to change.** ⛔ **The zero-build shape:** Follow their announcement channels into a server Jason owns, let **Discord's own mobile push** do the alerting, and resale-os judges the buy. No bot to host, no scraping, no proxies, no API bill. ⚠️ **A user token reading a server is against Discord's ToS** — the legitimate path is Follow → own server → own notifications. ⚠️ Not every server exposes followable announcement channels; that is the thing to check. **vendors researched 2026-09-11, and the finding reshapes 7.6.** ⛔ **The two free vendors are opposites and neither is both.** **TYPA** is free, covers Pokémon TCG, Pop Mart, Jordans and GPUs across Amazon/Target/Walmart/Best Buy/Pokémon Center, and claims alerts *"well under a minute"* — but delivers only to **its own app and Discord: no webhook, no email**, so nothing it knows can reach resale-os. **PageCrawl** has webhooks on every tier including free, but the free tier is **220 checks a MONTH** (~7 a day, all monitors combined) — too slow to catch a restock. ⚡ **So the alert cannot usefully come to us, and it does not need to**: TYPA's own push already solves notification by installing an app. ⛔ **First-party notify-me is weaker than it sounds** — LEGO's is **one-time-only** (miss the email and you must re-subscribe), and Best Buy's is shipping-only, not in-store, not open-box, and inconsistent. ⚠️ **Every latency figure above is the vendor's own marketing claim**, unverifiable without a real restock. **What needs Jason: install TYPA (free) and report whether it actually covers his verticals.** ⚡ **And the reframe: a restock is a DROP WITH AN UNKNOWN DATE** — same product, retailer, price and comparable-based valuation, minus the date. 7.6's real build is not a monitor; it is making the judgement instant when someone else's alert fires. | Jason asked for restock monitors and notifications, 2026-09-11, and pushed back that *"my gig apps send out alerts all the time"*. ⚡ **He is right that a workaround exists, and the gig apps show its shape: they RECEIVE a server push.** The phone is never the monitor. ⚡ **Researched 2026-09-11 — the ALERT half is free and solved**: the Expo Push Service takes one POST, charges nothing per notification, and iOS-only means no FCM. ⛔ **The MONITORING half is the arms race**: bots poll listings every ~6.5s and outnumber humans 10:1, Walmart rate-limits repeated inventory hits, Shopify drops block monitors outright, and the tools that work run **locally, from residential IPs**. A datacenter cron gets blocked, and the fix for that is proxy rotation — which **D13 already forbids**. ⚡ **Free vendors already monitor**: TYPA ($0, 100+ retailers) and PageCrawl's free tier (6 pages, 220 checks/mo, webhook + Discord on every plan). ⚠️ **60-minute free-tier checks will not win a console drop** — nothing legal will; the realistic scope is restocks that sit for an hour, which is most LEGO and collectibles. |
| D19 | Where the drop calendar comes from | ⚡ **A SCRAPED RELEASE FEED — 2026-09-11.** ⚠️ **Recommended against, and overruled**: I argued manual entry first — zero vendor risk after **D16**, and the storage shape is identical whichever feeds it, so a feed would be an addition rather than a rewrite. Jason chose the feed. ⛔ **What it commits to:** a THIRD outside dependency after SoldComps and UPCitemdb, a source that differs per vertical (sneakers, consoles, LEGO, cards), and a scrape whose breakage is silent. It goes behind `src/adapters/` for exactly the reason D16 made that seam load-bearing. **Which source, per vertical, is 7.5.4** |
| D18 | Whether to build the full barcode-scan flow now | ⚡ **YES — build it, Jason 2026-09-11.** *"Without scanning at Walmart it'll be too tedious to go through the clearance rack and type everything in."* ⚠️ **I recommended the cheaper half first** (derive resale from comps, default the category — free, no camera, no second vendor) and measuring whether typing a short name was really the tedium; Jason chose the full flow. Recorded because the concern stands: **SoldComps takes no barcode** (no UPC/GTIN/EAN parameter — verified in its docs), so the scan needs a SECOND vendor to turn a UPC into a title. ⚡ **De-risked first rather than assumed**: UPCitemdb's keyless trial round-tripped three real LEGO UPCs to title **plus brand and category**, so the resolver works and kills the category field too. ⛔ **But the keyword derived from that title is a MONEY decision** — see **B89**. ⚡ **Jason's reasoning, and it reframes the app:** *"Scanning is vital to this app until I actually get recommendations of what to purchase."* Today the app is a **checker** — you bring it an item and it judges. He wants a **recommender**. ⛔ D16 killed market-wide discovery, but **scan-the-rack-and-rank IS a recommender** scoped to the shelf in front of him, and that version survives. So 6.11 builds single-item scan and **keeps the session additive** rather than precluding it — scored opportunities already persist, so "rank what I scanned today" is mostly free afterwards. ⚠️ Batch scanning makes the quota binding immediately: 40 items = 80 requests against a free tier of 100. |
| D17 | What Gate 7 becomes, now that its premise is gone | ⛔ **PARKED, and re-premised — 2026-09-11.** D12 chose *"Browse to find, SoldComps to value"* and **D16 deleted the finding half**, so Market Radar's input is one metered vendor at 2 requests per item. ⚡ **Gate 7 is re-premised as radar over the fund's OWN HISTORY** — D12's third leg, free, specific to what the operator actually encounters in stores, and better every flip — and **parked until there IS history**, because the fund has never bought anything. ⛔ **Building it now would mean guessing at its inputs.** ⚠️ Market-wide radar on the paid tier was considered and declined: 2,000 requests is 1,000 items a month, every tier caps at 60/min so a plan buys quota and never speed, and it would bet more of the product on the single vendor D16 just exposed. **Meanwhile the build stream takes the correctness backlog, starting with B54.** |
| D16 | Whether to keep pursuing first-party eBay API access | ⛔ **NO — treat it as UNAVAILABLE, 2026-09-11.** The developer account was denied outright with a generic *"mismatched data"* reason, and Jason's reading is that eBay is issuing **blanket denials to individual developers**. ⚠️ **Do not re-apply, and do not design around getting in.** It is not an application-quality problem to fix. ⚡ This is what **D12** predicted — *"the resellers work around eBay and the direction of travel is tightening"* — arriving sooner than expected. Consequence: **SoldComps is the only automated route**, the manual path is not a fallback but a second leg, and `src/adapters/` stops being good practice and becomes the thing that makes a vendor swap survivable |
| D15 | Whether a backup carries scoring history | ✅ **No — scores are DEVICE-LOCAL, 2026-09-10.** The export is the commands plus config, and **everything in it is verified by regenerating it**. Opportunities are neither, and not derivable — a score records what was decided, when, under which policy — so carrying them would spend that guarantee on advisory data. ⚠️ A lost phone loses the rejection histogram and the watchlist, and **none of the fund**. The app says so on the backups screen |
| D13 | How far the app goes in online drops | ⏳ **SCOPE QUESTION RAISED AND DEFERRED 2026-09-11 — re-evaluate at NAV $500** (see Recurring). Jason: *"proxies should be reevaluated when the bankroll can support them."* ⛔ **Until then D13 stands whole**, proxy rotation included, so nothing in the interim builds toward one. Jason: *"I've built discord restock bots in the past but they involve scraping and proxies."* ⛔ D13 forbids proxy rotation **by name** — so building one is D13 reopened, not a workaround. ⚡ **But D13's stated harm is a CHECKOUT harm**: *cancelled orders, banned accounts, flagged payment rails* — the accounts the whole operation runs on. A **read-only monitor** behind proxies does not touch the payment rails; it risks blocked IPs and a retailer login nobody has to be signed into. **The prohibition may therefore be wider than its own rationale**, and that is Jason's to decide, not a session's. ⚠️ Two costs independent of the principle: residential proxies are billed per GB — real money against a **$75** bankroll — and a scraper is a maintenance treadmill that breaks silently when a selector moves. **Test TYPA first: if it covers his verticals, a self-built monitor reproduces a free thing at cost.** ⛔ **Monitoring and alerting IN; checkout automation OUT — 2026-09-09.** Being first to KNOW is clean and is most of the edge; automating checkout violates retailer terms, and the penalty is order cancellations, account bans and flagged payment methods. **For a fund that is a capital event** — risking the accounts and payment rails the whole operation runs on, to win one console. ⛔ Nothing that defeats anti-bot systems: no CAPTCHA solving, fingerprint spoofing, proxy rotation or multiple accounts. ⚡ And the strategy points the same way: online drops are where the competition is scripts; **in-store allocation is where it is people, and Jason is in stores all day** |
| D12 | How the app values what it finds | ✅ **Browse API to find, SoldComps to value, own history to accumulate, manual as fallback — 2026-09-09.** ⛔ Sold comps are gated (Marketplace Insights is Limited Release and individual devs are denied; the logged-out sold search hit a login wall Aug 2026), and **without them the 45% confidence gate refuses nearly every purchase** — so this is a precondition, not an enhancement. Start on the free tier (100/mo); **Jason: "9 bucks is nothing"**, so Starter (2,000/mo) is pre-approved when it bites. ⚠️ The resellers work around eBay and the direction of travel is tightening — the manual path stays wired |
| D11 | When the fund starts buying | ⛔ **Not until the system is ready, and never arbitrarily** (Jason 2026-09-09): *"It doesn't make sense to arbitrarily buy something."* A purchase this system cannot justify is the exact thing it exists to prevent, so "exercise it with a real buy" is not a reason. **Ready means the phone can decide, not just record** — 5.9c |
| D2 | Owner split of after-tax profit (default 20/10/70) | ⚙️ **Default stands, revisit at $100 NAV** (Jason 2026-09-09). Not live: set-aside is off below $100 and the fund is at $50.00. ⚠️ That is four to six flips away, so decide it against the first real sales rather than in the abstract |
| D3 | Real starting bankroll and start date | ✅ **$50, live 2026-09-08.** ⚡ **RAISED TO $75, 2026-09-11** (Jason: *"Then let's make the initial bankroll $75. I can work with that."*) ⛔ **This replaced a policy change, and was strictly better.** BOOTSTRAP was measured to buy **nothing at all** at $50 — a $40 purchase with excellent evidence was refused by three capital gates — and **$50 is the ONLY bankroll where that is true**: at $75 the same rules permit a $30 buy returning $26.71. I had drafted a relaxed BOOTSTRAP and then a SEED mode below $100; Jason changed the INPUT instead. ⚡ **No new mode, no stored-policy migration, no capital safety given up, and nothing to defend later.** ⚠️ **And `policy.ts` already said so** — `maxCapitalPerItemBps: 4_000, // 40% of NAV — $30 on a $75 fund`. The rules were designed against $75 and the fund was funded at $50; the mismatch was never a design flaw. ⏳ **Action: record a $25 CONTRIBUTION in the app.** The live fund is $50 until that lands. |
| D4 | Whether a constraint override is ever allowed, and what it must record | ✅ **Allowed, and it must say so, 2026-09-09.** A purchase carries `overrodeGates` + `overrideReason`; the engine refuses an override with no reason, the item keeps both for life, and `items` prints them. `--force` now needs `--reason`. Unblocks 5.6 |
| D5 | What to source against | ✅ **Sell-through gate, category-neutral, 2026-09-08.** The hold time is derived from comps; categories deferred until the bankroll supports them |
| D6 | When profit starts being set aside | ✅ **At $100 of NAV, 2026-09-08.** Below it, owner + operating reserve are skipped and everything after tax compounds. Tax still accrues |
| D7 | The tax profile | ✅ **Set 2026-09-08.** Filing status, other income, W-2 wages and a combined state+local rate, plus standard deduction and QBI claimed federally and added back for the state. ⛔ **The figures live in `data/resale.db`, not in this repo** — `TaxProfile` is an input for exactly that reason |
| D8 | The 2025 tax tables | ✅ **Accepted as adequate for 2026, 2026-09-08.** ⚠️ Acceptance is not verification — `verified` stays false, and the acceptance expires at the 2027 year boundary |
| D10 | ✅ **Copy the figures, cite the sources, 2026-09-08.** How resale-os should take GigWorkTracker's verified 2026 tax tables | ✅ Done in 4.6 |
| A4 | How the phone reaches the dashboard, given nothing can be installed on it | ⛔ **MOOT, closed 2026-09-09.** Answered by the architecture rather than by a decision: Gate 5 puts the ledger ON the phone and 5.10 retires `src/app`, so there is no dashboard to reach. The VPN constraint that reopened it still stands and is recorded in `phone-cannot-run-vpn-apps` |
| D9 | How to clear the $1.50 of smoke-test SUPPLIES on the live book | ✅ **Add the no-cash correction, 2026-09-08.** `EXPENSE_CORRECTION` settles an expense against the event that already returned its cash, or reclassifies it between categories. Live book cleared; `evt_000005`/`evt_000006` |

---

### ⏳ Waiting on Jason — the one that unblocks the fund

**Record a $25 CONTRIBUTION, taking the bankroll $50 → $75** (**D3**, decided
2026-09-11). ⛔ **Until it lands, the fund can buy nothing**: measured, BOOTSTRAP
at $50 NAV refuses a $40 purchase carrying excellent evidence, and its ceiling
is $20 against a $24.51 modelled downside. At $75 the same rules permit a $30
buy returning $26.71. ⛔ **It needed code, and nobody had noticed** (**B95**): no screen could issue
a contribution after the CLI was deleted at 5.10. **Money in** now exists —
record it there once the next build is installed. Every figure in the docs that
says $50 stays true until it is recorded.

---

## Recurring — fires on a date or a THRESHOLD, not on a gate

⚠️ **Deliberately NOT in the queue above.** A recurring obligation with a
checkbox gets ticked once and then never fires again; these need to survive
being "done".

⚡ **Widened 2026-09-11 to carry a bankroll threshold.** A deferral whose
trigger is a feeling — *"when we can afford it"* — never fires, because nothing
ever announces that the day arrived. A threshold the app already computes does.

| when | what |
|---|---|
| **Every January** | **The tax-table review.** A new tax year means new federal brackets, a new standard deduction and a new SS wage base. Add `TAX_TABLES_<year>`, generate it from GigWorkTracker's config **by script**, and re-run the 65-figure comparison — nothing re-checks that transcription automatically, because a cross-repo test would red-gate this project whenever the other app moves *(was B47)*. ⚠️ **GigWorkTracker needs the same review in the same month** — its ROADMAP §6 describes its half. Do them together or they drift *(was B48)*. |
| **Every 80 days** | **Rebuild and re-publish to TestFlight.** Builds expire after **90 days**, so this fires before the expiry rather than after it. ⚠️ **Not a CI cron** — Jason deploys Codemagic manually (2026-09-10), so this is a reminder, not a workflow. The plan previously assumed a second scheduled workflow; that assumption is retired. First publish: **2026-09-10**, so the next is due **2026-11-29**. |
| **At NAV $500 — the GROWTH promotion** | **Re-evaluate proxies for restock monitoring** (Jason, 2026-09-11: *"proxies should be reevaluated when the bankroll can support them"*). ⚡ **Pinned to `promoteAtCents` (50,000) rather than to a judgement call**, because the app already computes that line, already shows it, and already changes its own rules at it — so the fund reaches the trigger instead of someone remembering it. ⛔ What to re-ask then: whether **D13**'s ban on proxy rotation should stay whole-cloth or narrow to checkout only *(its stated harm is a checkout harm — see the D13 row)*, and whether a **monthly, recurring** proxy bill is covered several times over by **monthly realised profit** — not by NAV. ⚠️ At $50 the fund can buy nothing; at $500 in GROWTH the per-item cap is $100 and the minimum profit $15, which is the first bankroll where a subscription is arithmetic rather than absurd. |
| **At each year boundary** | Any `TaxTablesAcceptance` expires by design. If the tables for the new year are not in yet, `tax show` starts warning again — that is the system asking, not a bug. |

---

## Deferred backlog (v1)

Filed, not forgotten. Nothing here is in a gate until it is promoted.

- ~~**B95**~~ ✅ **Closed 2026-09-11.** ⛔ **The fund could not receive money on
  the phone.** No screen issued a contribution after 5.10, so D3's $25 sat under
  "waiting on Jason" while being impossible to record. **Money in** mirrors
  Money out: zero refused, the after-figure shown before the button, and a
  warning when an amount would cross into GROWTH. Found by the deploy check.
- ~~**B93**~~ ✅ **Closed 2026-09-11.** The impossible advice is gone, the three
  screens read one module, and Settings reports which keys this build carries —
  read-only, because they cannot be changed on a device. ⚠️ **The filing said
  two screens and "a third will"; the third already existed** (scan, on the
  barcode key). Detail in the log.
- **B94** ⛔ **Both vendor keys ship in PLAIN TEXT inside the app.** Expo inlines
  every `EXPO_PUBLIC_*` variable into the client bundle and its own docs say not
  to put secrets there. B93 made the app honest about this; it did not fix it.
  ⚠️ **And the obvious fix is a trap**: `portable.ts` exports config **wholesale**
  (`SELECT key, value_json FROM config`, no whitelist), so a key stored there
  travels in every backup and every export — files that leave the phone. A real
  fix means runtime entry plus storage that a backup cannot carry
  (`expo-secure-store`, a second native module) — **a decision, not a text
  field.** ⚠️ Blast radius today is one operator's own TestFlight binary.
- **B91** ⚠️ **A dated shortfall inherits `SCAN_NAVS_CENTS`'s grid.** 7.5.2 tells
  the operator the next bankroll on that ladder at which a drop clears — so at
  small NAV it can say *"you need $100 by Dec 1"* when $92 would do, and the
  target is a savings goal with a date on it. ⛔ Bisection is invalid (the unlock
  is not monotonic); a denser ladder near the current NAV is the fix. → 7.5 or
  later.
- **B92** `screens/sourcing.ts` carries a private `medianCents` that duplicates
  `core/math.ts`'s `median` (it rounds; core's does not). Two implementations of
  the number that sets the resale estimate. Surfaced by 7.5.2, which used core's.

- ~~**B3**~~ ✅ **Closed 2026-09-10 in 6.2**, on the phone, once **B68** gave it
  something to count.
- **B4** Prediction-accuracy calibration loop (expected vs actual days and
  proceeds feeding back into confidence). → Gate 6.
- **B5** Period-close event for reserve true-ups (monthly). → post-Gate 4.
- **B6** Schedule-C-shaped expense export. → post-Gate 4.
- **B7** Multi-currency / sub-cent support. Only if selling internationally.
- **B8** Postgres driver implementation. Only when SQLite actually hurts.
- ~~**B9**~~ ✅ closed 2026-09-09 in **5.5.1**. Not a new event type in the end — an override is a property OF the purchase, and a separate event would have let the two drift apart.
- **B10** `channel_quotes` + marketplace routing comparison. → post-Gate 5.
- **B11** Backtest harness: replay historical opportunities against a new policy
  version to see what it would have bought. → Gate 6.
- ~~**B12**~~ ✅ **Moot 2026-09-10** — the CLI that printed the warning is deleted.
- **B13** `BUSINESS_EXPENSE` with an `itemId` that does not exist fails on the
  foreign key with a raw SQLite error rather than an EngineError. → Gate 3.
- **B14** Revisit Vitest 5 once rolldown ships a working Windows binding (see
  log D-02).
- **B16** Reopen **D1** before year end: decide `incomeTaxBps` with real numbers
  in hand rather than a guess. The reserve currently covers SE tax only.
- ~~**B17**~~ ✅ **Answered 2026-09-10.** `data/resale.db` is a retired snapshot,
  not the fund. The live ledger is on the phone, backed up on-device after every
  write, with a copy shared off it. The open half is **B32**.
- **B18** Category-specific eBay fee rates and any store-subscription rate.
  `src/core/fees.ts` uses the standard 13.25% + $0.40 for everything. → Gate 5.
- **B19** Make the per-item cap scale differently at tiny bankrolls — 40% of NAV
  is a diversification rule, and two items is not diversification.
- ~~**B15**~~ ✅ closed 2026-09-08 — the Social Security wage base is modelled.
- ~~**B21**~~ ✅ closed 2026-09-08 — the $400 threshold is modelled, so the
  reserve is genuinely zero below it rather than conservatively positive.
- **B22** Estimated quarterly payment scheduling: `tax show` knows the year's
  liability, so it could name the four due dates and amounts. → post-Gate 4.
- **B23** A `tax year-end` report shaped like a Schedule C, using the same
  model. Supersedes **B6**. → post-Gate 4.
- ~~**B24**~~ ✅ closed 2026-09-08 — the local rate looked up; combined rate set.
- ~~**B47**, ~~**B48**~~ ⚡ promoted into **Recurring** above — they fire on a date, not on a gate.
- **B46** ⚡ **GigWorkTracker's `services/tax-engine` already has VERIFIED 2026
  tables**, and resale-os is running unverified 2025 ones. Sourced there to IRS
  Rev. Proc. 2025-32, the SSA 2026 COLA fact sheet, Maryland statute, and the
  DLS/Comptroller local-rate table. Measured differences: SS wage base
  $176,100 → **$184,500**; single standard deduction $15,000 → **$16,100**;
  every federal bracket shifted up. All of it makes resale-os **over**-reserve,
  which is the safe direction — so this is accuracy and provenance, not a leak.
  ⚡ **The local rate is CONFIRMED** by that source, which answers **B26**'s
  county half. ✅ **Taken in 4.6** — D10 answered: copy the figures, cite the sources.
- **B26** ⚠️ **Half closed 2026-09-08.** The local rate is **CONFIRMED**
  against the published county table via GigWorkTracker. ⚠️ The **state
  marginal is still unchecked** — GigWorkTracker models Maryland as 10 statutory
  brackets rather than a flat rate, so the right fix is **B25**, not a lookup.
- ~~**B1**~~ ✅ closed — `verify` walks the hash chain and `reconcile()` cross-checks.
- ~~**B2**~~ ✅ closed — `npm run lint:imports`, planted and verified.
- ~~**B13**~~ ✅ closed — an unknown `itemId` on an expense is now an `EngineError`.
- ~~**B17**~~ ✅ closed — `backup` copies and **verifies** the copy; live ledger backed up.
- **B29** A passive recovery sets no `daysToSale`, so recovered items contribute
  nothing to prediction accuracy. Surfaced by the accuracy tests. → Gate 4.
- ~~**B30**~~ ✅ closed in 4.11 — one completeness check, derived from the defaults.
- **B30 (was)** Unify the config-drift defence. Four variants shipped in two days
  (policy repair, tax-profile repair, tax-table year, a validator that fell
  behind). Each is fixed; the *pattern* is not. One versioned-config helper with
  a validator driven off the default would close the class. → Gate 4.
- ~~**B31**~~ ✅ closed 2026-09-08 — automatic after every money-moving command,
  to OneDrive, verify-then-promote, dated dailies with 90-day retention, and
  staleness on `status`.
- ~~**B33**~~ ✅ closed 2026-09-08 — an `ADJUSTMENT` carries `reversesEventId`,
  the store writes a compensating expense row, and `verify` gained a drift
  control. ⚠️ It cannot see a reversal that does not DECLARE itself, which is
  why the legacy live residue is **D9** and not a bug.
- ~~**B36**~~ ⚡ promoted into **4.2.4**.
- **B36 (was)** ⚠️ **The CLI has no tests at all.** `src/cli/index.ts` is 1,200 lines
  routing every command, and nothing exercises it — the raw-stack-trace bug on a
  refused command shipped because no test opens the CLI. Gate 4 adds a second
  interface over the same functions, so a thin harness now serves both. → Gate 4,
  alongside 4.2.
- **B41** Visual design pass — re-pointed 2026-09-10 from the deleted dashboard to
  the **phone app**. The screens are correct and plain; nothing asserts legibility
  (**B60**), and that judgement is Jason's. → Gate 6.
- **B51** Anne Arundel and Frederick counties are **graduated**, not flat, and
  are deliberately absent from `MD_2026.localRateBps` — a flat approximation of
  a graduated rate is the exact error 4.8 removed. They fall back to the flat
  profile rate. Only matters if the operator moves. → if ever needed.
- ~~**B49**~~ ✅ closed in 4.9 — it did, and 4.9 was mostly a screen.
- **B49 (was)** ⚡ **`rejectionHistogram()` already exists** on the repository and is
  now reachable read-only — **4.9 is mostly a screen**, not a build. Noticed
  during 4.7's before-scan.
- **B50** Nothing can change an opportunity's status — re-pointed 2026-09-10: the
  premise was the read-only WEB surface, which is gone. The phone can write, but
  nothing saves a score to change the status OF. Folded behind **B68**. → Gate 6.5.
- **B52** `headroom` has no screen. ⚠️ Half stale 2026-09-10: `ledger` DOES have
  one on the phone. Headroom is covered by what the sourcing screen prints.
  → Gate 6.
- ~~**B44**~~ ✅ **Merged into B64 2026-09-10** — the same defaults, one item.
- ~~**B45**~~ ✅ **Superseded 2026-09-10 by B68.** The premise was the WEB screen
  recomputing from a URL; the phone screen has no URL. Saving a score is B68.
- ⛔ ~~**B42**~~ **DEAD 2026-09-09. Tailscale cannot be used at all.** Jason
  drives for **Spark Driver**, which flags VPN and mesh apps as "manipulation
  apps" — installing one risks the driver account, which is real income. **No
  phone-side VPN, ever**, in this project or any other. **A4 is reopened.**
- ~~**B43**~~ ✅ **Moot 2026-09-10** — the session cookie went with the auth gate.
- ~~**B53**~~ ✅ **Moot 2026-09-10** — the password gate is deleted.
- ~~**B39**~~ ✅ **Moot 2026-09-10** — the dashboard is deleted. The phone's
  styling is unasserted for the same reason and that is **B60**.
- ~~**B40**~~ ✅ **Moot 2026-09-10** — no dashboard, and no CLI to be stale against.
  The phone reads its own ledger.
- **B38** **Metro** needs an `extensionAlias` resolver for this repo's
  `.js`-for-`.ts` imports. ⚠️ Re-pointed 2026-09-10: the Turbopack half died with
  Next.js; the Metro half is live and the phone depends on it.
- **B37** `#claimedAgainst` scans every EXPENSE_CORRECTION payload in the ledger
  on each settlement. Fine at 6 events, linear forever. Index it if corrections
  ever become common — they should not.
- **B35** The drift control covers the `expenses` projection only. It is the one
  analytic table `reconcile` never saw; if another is added, it needs its own
  two-source check rather than inheriting this one. → whenever a projection is
  added.
- **B32** ⚠️ **Re-pointed 2026-09-10: this is about the PHONE now.** The desktop
  OneDrive path is gone. The app writes backups on-device and can share one out,
  but it can only observe that a file was OFFERED — never that it arrived. There
  is no recurring off-device guarantee, and the phone is the only home.
- **B27** 7-day listing engagement as the fast feedback loop — watchers and views
  within a week, rather than waiting for a sale to close. Needs listing tracking.
  → Gate 5.
- **B28** Revisit categories (books as a margin play, per-category risk inputs)
  when the bankroll supports the hold tolerance. → Growth mode.
- ~~**B25**~~ ✅ closed in **4.8**.
- **B63** `store.events()` loads the whole ledger to render the last 40. Fine
  at 55 events and linear forever. Add a limit/offset read when the ledger is
  big enough to notice — not before, and the ledger screen already caps what it
  DRAWS. → post-Gate 5.
- ~~**B62**~~ ✅ **Closed 2026-09-10 in 5.10.3.** `views.ts` is now
  `src/screens/views.ts` — it moved rather than went, as filed.
- ~~**B61**~~ ⚡ **Promoted to 5.9b, 2026-09-09** — the lane is green, so a
  native module can be validated.
- **B60** ⚙️ **Half closed 2026-09-09** (Jason: *both — contract now, RNTL
  later*). The form models are pure, tested and executed on-device. ⚠️ **What
  is still uncovered is the JSX binding** — whether the price box is wired to
  `price`. Add `@testing-library/react-native` only if a wiring bug actually
  reaches the device; until then the gap is named rather than guessed at.
  → Gate 5.
- ~~**B59**~~ ✅ **Answered 2026-09-09: record it, and split the report.** The
  risk pointed the other way — after 5.10 the scorer is the rare path, so a
  report that ignores the prediction the operator actually decided from is
  blind, not conservative. Built in 5.6.7.
- ~~**B58**~~ ✅ **Closed 2026-09-10 by D14 in 5.9c.** One gate set; `assessQuote`
  deleted; `tests/purchase-parity.test.ts` compares the two doors.
- ~~**B64**~~ ✅ **Closed 2026-09-10 in 6.0.2.**
- ~~**B67**~~ ✅ **Closed 2026-09-10 in 5.11.1.** Not by generating the YAML —
  by making it ANSWER to the discovered closure. `check-phone-bundle.mjs
  --print-layers` emits the layers the phone reaches; `tests/ci-scope.test.ts`
  fails if the filter misses one. The two sides are an import-graph walk and a
  hand-typed list, which is what makes it a control. ⚠️ Scoped to the `paths:`
  block, not a grep of the file — every one of those directories is also named
  in a comment there.
- **B72** ⚡ **The scorer has four verdicts and can produce two.** Measured
  2026-09-10: 15,360 evaluations returned **BUY and REJECT only**; `WATCH` and
  `PASS` never occurred and no test had ever asserted either. **Mechanism proven
  by plant:** every score threshold `recommend()` checks — buy score, risk,
  confidence — is ALSO a capital gate on the same `ModePolicy` field, and a
  failed gate short-circuits to REJECT; disabling the buy-score gate made both
  verdicts appear immediately. ⚠️ **So the Buy and Risk scores inform but never
  decide** — anything they would reject, a gate already did.
  ⛔ **Not deleted:** `opportunities.recommendation` has a CHECK naming all four
  and old rows may carry them. Pinned by `tests/verdict-reachability.test.ts`,
  which asserts the INVARIANT rather than the dead code. → read before **6.5**.
- ~~**B73**~~ ⚡ **Promoted to Gate 6.7, 2026-09-11.** Premises verified against the code first.
- **B87** ⛔ **THE DEVICE LANE IS ~3-IN-5 AND THE CAUSE IS UNIDENTIFIED.**
  Supersedes **B75**, whose diagnosis was wrong. ⚠️ **`Status=4294967295,
  isTerminal=YES` is NORMAL on this image** — measured 2026-09-11 across five
  runs, it appears in every one, including the three that passed 52/52 (the
  green 13:22 run booted 6m43s and ended with exactly that status).
  ⛔ **Two fixes were built on that misread**: 2026-09-10 guarded
  `bootstatus`'s exit code; 2026-09-11 saw the exit code was 0, made the STATUS
  actionable, and **made the lane worse** by tearing down a simulator that was
  merely slow. Both are reverted; the guard is back to the exit code alone.
  ⛔ **The error in both was never running the control** — each looked at a
  FAILING run and neither at a PASSING one, where the same status sits in the
  log. The real failure is `No result file after 180s` with an empty app
  console, and nothing yet separates a run that does that from one that does
  not. ⚠️ **Re-running is the mitigation. Do not write a third guard without
  first checking what a GREEN run prints.** → when the lane costs more than
  re-running does.
- **B76** ⚠️ **The watchlist recomputes 21 evaluations per saved row.** Measured
  2026-09-10 on desktop: **62 ms at 10 rows, 91 ms at 50, 277 ms at 200** — fine
  at the scale the fund is at, noticeable on a phone at the cap. ⚠️ **And the
  cap is a silent truncation**: `list({ limit: 200 })` drops row 201 without
  saying so, which is the class this project keeps being bitten by. Cache by
  `(input, policy version, NAV)` or page it, and make the cap speak. → when the
  list gets long, not before.
- ~~**B78**~~ ✅ **Closed 2026-09-11 in 6.1.3.** The screen shows lookups left this month, and an exhausted quota degrades to typing instead of breaking.
- ~~**B79**~~ ✅ **Closed 2026-09-11 in 6.1.1.** `src/core/counts.ts` — and the vendor documents a THIRD form, `null`, refused like any other.
- ~~**B80**~~ ✅ **Closed 2026-09-11 in 6.1.1/6.1.3.** The reading carries `provenance` and the screen shows it. ⚡ **And the risk turned out to be self-penalising**: a broad keyword returns comps spanning 643x, which zeroes the dispersion term and caps confidence. Measured on real bytes.
- **B83** ⚠️ **Two implementations of dollars→cents.** `parseDollars` in
  `core/money.ts` throws; `dollars()` in `screens/sourcing.ts` returns a form
  problem instead. Both are correct and both avoid `Math.round(n * 100)`, so
  this is duplication rather than drift — but "a second implementation of a
  number the engine already owns" is the exact class this project gates against
  elsewhere. Fix is a core parser returning a result union, with the form
  wording layered on top. → when a third caller appears, not before.
- **B84** ⛔ **PROMOTED FROM "when someone mis-searches" TO A PREREQUISITE,
  2026-09-11.** The search term and the item name are the same field, and
  **B89** measured what that costs once a scan fills the name: two defensible
  keywords from one barcode gave medians 68% apart. A separate *"search as"*
  field, defaulting to the derived keyword and editable, is what stops the scan
  flow from being a confident wrong number delivered faster. → **inside the scan
  flow (D18), not after it.**
- **B85** ⚠️ **Nothing stops a second lookup of the SAME keyword.** *Look up the
  market* costs 2 of ~100 monthly requests per press. A double-tap is guarded
  (`if (looking) return`), and a press after EDITING the name is correct — but a
  press with nothing changed spends two requests to re-fetch what is already on
  screen. ⛔ **Not obviously a cache**: market data goes stale, and a cache that
  lies is worse than a request that costs. The honest fix is probably to say
  *"already looked up — press again to refresh"* rather than to silently serve
  a stale answer. → when the quota is actually felt, not before.
- **B86** ⚠️ **`allocation.tax` is validated, required, and read by nothing.**
  Found in 6.7's before-scan: `selfEmploymentBaseBps`, `selfEmploymentRateBps`,
  `incomeTaxBps` and `deductHalfSelfEmploymentTax` appear **nowhere outside
  `policy.ts`** — the flat model was replaced by the incremental annual one
  (`core/tax/annual.ts`) and the config block survived it. ⛔ **Kept off the
  settings screen deliberately**: a UI for a number that changes nothing is the
  same trap as editing a `policy.ts` default on a fund that already exists.
  ⚠️ **Not simply deletable** — `validatePolicy` requires it and stored policies
  carry it, so removing it is a config migration, and this repo's rule is that a
  repair path must not depend on the broken thing. → when a policy migration is
  needed for another reason.
- ~~**B88**~~ ⚡ **Promoted to Gate 6.10, 2026-09-11**, the day it was filed — the histogram is the instrument for *"why is nothing passing?"* and it is currently mixing rule sets.
- **B89** ⛔ **THE KEYWORD DERIVED FROM A SCAN IS A 68% SWING IN THE RESALE
  PRICE.** Measured 2026-09-11 on one real product, LEGO set 75038, resolved
  from its UPC: the resolver's raw title *"LEGO Star Wars 75038 - Jedi
  Interceptor"* returns **96 sold, median $47.50**; cleaned to the set number,
  *"lego 75038"* returns **147 sold, median $80.00**. ⚠️ **Same object, same
  scan, 68% apart** — and that median sets the resale price, which sets profit,
  ROI and the price ceiling. ⛔ **So a scan cannot silently produce an answer.**
  The cleaning rule in the middle is not a formatting detail, it is the thing
  that decides which market is measured (**B80**), and neither reading is
  obviously right: the long title may be matching loose and incomplete sets
  while the set number matches sealed ones, or the reverse. ⚡ **Consequence:
  B84 stops being optional** — the operator must see the derived keyword and be
  able to correct it, or the scan is a confident wrong number arriving faster.
  → **a prerequisite of the scan flow, not a follow-up.**
- **B90** ⛔ **THE DATA ROUTE FETCHES COMPS OF EVERY CONDITION, AND THEY ARE
  STATISTICALLY WORTHLESS.** Measured 2026-09-11 on LEGO 75038: unfiltered, 40
  comps span **$1.99–$465** (234×) with **CV 1.24**; filtered to
  `itemCondition=new`, 25 comps span **$60–$179.95** (3×) with **CV 0.26**.
  ⛔ `COMP_CV_WORTHLESS` is **0.50**, so the unfiltered set scores a dispersion
  term of **exactly zero** — every comp set 6.1 has fetched for a product with a
  used market has contributed **nothing** to confidence, and **D14 made
  confidence decisive**. The app has been refusing items on dispersion it
  manufactured itself by mixing sealed sets with loose parts and instruction
  booklets. ⚠️ **And the median is 3× wrong** — $40 against $120 — which is the
  difference between REJECT and BUY on a sealed item.
  ⚡ **The fix uses a control that already exists**: the operator picks
  `SEALED` / `LIKE_NEW` / `USED_CHECKED`, and that drives `itemCondition` on the
  sold search. Comps then describe the thing actually being valued.
  → **folded into 6.11.3**, because it is what makes filling the resale price
  legitimate at all.
- **B81** ⚠️ **One more page would turn some B77 refusals back into decisions.**
  ACTIVE caps at 200/page, so an item with 250 active is refused for being a
  floor when **one extra request** would have the true count. ⛔ Not general:
  72,000 active would need 360 requests, and the quota is 100/month. The rule
  worth having is *page once when `hasNextPage` is set and page 2 is likely to
  end it*, which needs a measured hit rate the fund does not have yet. → when
  6.1 has run against real racks, not before.
- ~~**B82**~~ ✅ **Closed 2026-09-11 in 6.1.1.** ACTIVE is called first and SOLD is pinned to the category it declares, so both halves of the ratio count the same population.
- ~~**B77**~~ ✅ **Closed 2026-09-11 in 6.1.0.** `VELOCITY_COUNTS_UNBOUNDED` — a count that is a floor makes the hold a LOWER bound and sell-through an UPPER one, and the gate refuses to pass on it. ⚠️ Its worked example was wrong (the `+ 1` was dropped); the log has the corrected arithmetic.
- ~~**B74**~~ ✅ **Answered 2026-09-11 by real requests, and spent in 6.1.1.** `totalResults` is populated on a SOLD search, so the count costs one request and an item costs two. ⚠️ It IGNORES `soldAfter` — the total is sold-in-90 by accident of eBay's ~90-day retention rather than by our parameter, which is **luck, and luck changes**. Detail in the log.
- **B69** ⚡ **Barcode scanning in the aisle** (Jason, 2026-09-10). ⛔ **NOT
  BUILT** — verified 2026-09-11: no `expo-camera` dependency, no scan code
  anywhere. Roughly one screen; `expo-camera` reads a barcode offline.
  ⚠️ **Its blocking trigger ("after D12's data route") FIRED today when 6.1
  shipped — and re-reading it, HALF ITS VALUE DIED WITH D16.** The entry argued
  a GTIN beats a keyword because **Browse API's `gtin` filter** would take it;
  Browse is gone, and SoldComps takes a **`keyword`** — a UPC pasted in as a
  keyword matches only listings whose seller happened to type it. ⚡ **The
  surviving justification is the better one and is not ready either**: scan →
  OWN HISTORY, where a UPC is a stable key. **The fund has zero purchases, so
  that history is empty.** → after the fund has bought things, not before.
- ~~**B70**~~ ✅ **Closed 2026-09-10 in 6.0.1.**
- ~~**B71**~~ ✅ **Closed 2026-09-10 in 6.0.2.**
- ~~**B68**~~ ✅ **Closed 2026-09-10 in 6.0.3.** ⚠️ The backup half is **6.0.5**.
- ~~**B66**~~ ✅ **Closed 2026-09-11 in Gate 6.6**, 52/52 on device. Every gate
  field is required so a forgetting caller fails to compile; the one gate that
  may decline to run declares it with a reason; every code is accounted for as
  a result or an abstention.
- ~~**B65**~~ ✅ **Closed 2026-09-10 in 5.10.3**, alongside **B62**.
- **B57** ⏸️ **Deferred indefinitely by Jason, 2026-09-11: not important unless
  this is ever published for public consumption.** The app has no icon — a white
  square on the home screen. ⛔ **Its old trigger was wrong from the start**:
  *"before any TestFlight build"* imported an assumption from public app
  development, where a build implies an audience. Here TestFlight is only how the
  app reaches the operator's own phone, and `CLAUDE.md` has said **"no SaaS, no
  App Store, no multi-user"** since day one. ⚠️ A cosmetic item became "overdue"
  purely because its trigger described somebody else's project.
  → **only if this is ever published publicly.**
- **B56** ⚠️ **The pre-publish scrub covered `src/` and `data/` and MISSED the
  planning docs.** `MASTER_PLAN`, the log, `CLAUDE.md` and `FINANCIAL_SPEC` were
  public for a day carrying filing status, income, county and a
  `C:/Users/<name>/` path. Scrubbed 2026-09-09, and `CLAUDE.md` now carries the
  rule. ⚠️ **The old objects stay fetchable by SHA** — hence the fresh repo.
  Anything published from here gets a whole-tree sweep, not a directory list.
  ⏳ **Needs Jason: delete `resale-os-prescrub-2` and `resale-os-prescrub-private`**
  — both private, both still holding the data, and the CLI token cannot delete.
- ~~**B54**~~ ⚡ **Promoted to Gate 6.8, 2026-09-11.** Measured at switch-in: 75 `store.state()` sites against 7 `derivedState()`, no lint.
- ~~**B55**~~ ⚡ **Promoted to Gate 6.9, 2026-09-11**, premises measured first: seven handles closed inside a try body, and nine pinned migration names.
- ~~**B20**~~ ✅ **Superseded 2026-09-10 by 5.12.** `policy set` is deleted; the
  need it named is now the whole missing surface.