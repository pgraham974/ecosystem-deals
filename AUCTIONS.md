# Live residential auctions

## Operation

`index.html#auctions` reads `data/auctions/lots.json` and `coverage.json` without a login or browser-to-auctioneer requests. The workflow `.github/workflows/auctions.yml` runs at 00:23, 06:23, 12:23 and 18:23 UTC, plus manual dispatch and collector-code pushes. GitHub may delay scheduled jobs. Schedules only run on the default branch and may need enabling on a fork after merge.

The collector runs on Node 22 using built-ins only. No API keys, passwords, paid accounts or private endpoints. Run:

```sh
node --test scripts/auctions/*.test.mjs
node scripts/collect_auctions.mjs
```

The generated files are committed atomically in one commit. A GITHUB_TOKEN commit does not trigger legacy Pages automatically, so the workflow explicitly requests a Pages build. It also handles repositories already configured for Actions-based Pages deployment. The existing Pages configuration must be enabled and allow Actions to publish. No production branch is merged automatically.

## Source policy and coverage

The full audited registry is `scripts/auctions/sources.json`. Initially enabled: Auction House Manchester, Auction House South West (Bristol/Gloucestershire), Auction House Scotland, Future and Braveheart. These are public pages with no automation restriction found in the inspected pages/terms. This is NOT an open-data licence or a legal opinion. Only factual lot metadata is retained. No descriptions, photographs, legal packs or full catalogue copies are published. If the operator objects or new restrictions appear, disable that source immediately. Policy review expires on the registry's review_due date and collection then fails closed.

Allsop, Savills, Pugh, Bond Wolfe, Barnard Marcus, Mark Jenkinson, Strettons, Countrywide, Town & Country, Bruton Knowles, Moore Allen, Hollis Morgan, Maggs & Allen, iamsold, EIG and OPA are not scraped because of access/reuse restrictions. Clive Emson and SDL/Network/BTG routes remain disabled pending rights/route review. Bradleys was blocked; no bypass. Bristol Property Auctions and the exact-name Scottish Property Auctions are unresolved identities, not invented separate providers. No standalone Auction House Gloucestershire branch was verified; South West is the discovered route. SVA ceased auctions and is not a live source. These gaps remain visible in coverage rather than being silently omitted.

For enabled sources, every run checks robots.txt with the identified `LauritoAuctionsBot/1.0` agent, merges matching groups, applies longest-rule/allow-tie precedence and crawl-delay, and checks each redirect. Missing robots (404/410) is not treated as a licence; errors/challenges/denials fail closed. Cross-origin redirects, login walls, cookies, anti-bot bypasses, blocked paths, documents and EIG result iframes are not used. New restrictive terms stop a source for review. Request/page/detail/byte/time caps prevent runaway crawling, and capped or failed traversals are partial, never complete.

`coverage.json`/`coverage.md` report individual sources, checked times, errors, page counts, exclusions and fresh counts by town/status. Commercial exclusion counts cover inspected records only, not the whole auctioneer's database. Zero lots means no verified eligible records in the inspected coverage, not proof the town has no auctions. Initial empty bootstrap JSON deliberately contains no invented examples; the first Action replaces it with actual results.

## Data semantics

- Target post towns: Manchester, Glasgow, Edinburgh, Bristol, Cheltenham. A branch/region name alone never matches a property. Post towns can cross council boundaries; this is not a municipal-boundary filter.
- Types: Blocks, Houses, Flats (including studios), HMO, Portfolios, Mixed-use with residential parts, residential Development/conversions. Pure commercial, garages/parking, agricultural/bare land and ground-rent-only interests are excluded. Unknown classification/status is not guessed.
- Canonical statuses: upcoming, sold, unsold, withdrawn. A postponement without a new date/status is not silently made upcoming or withdrawn. Auction date is null if not published; an auction's bidding-open date is not its end date.
- A guide is not an opening/starting/current bid, reserve, valuation or hammer price. These are separate fields. Sold consideration is null unless explicitly published. A page's phrase 'auction results' or a 'last bid' alone is not a sale.
- Scraped times are observation times, not sale times. Unavailable/missing lots retain original scraped_at and are labelled stale; disappearance never implies sold/withdrawn. Non-sale stale rows expire after 30 days; historic sold rows after two years.
- Dedupe uses normalized full premise/street/postcode, unit identifiers and event date. Different flats and repeat auctions remain separate. Alternative sources and source-specific field/status observations stay in provenance.
- A/B/C are the existing distress bands, not investment recommendations: A verified live owner insolvency, B specifically evidenced receiver/lender instructed sale, C verified owner watchlist. Auction entry/low price/tenancy/EPC alone never creates a grade. Most auction lots should remain Ungraded.

## UI and verification

The Auctions view has five town filters, seven residential subtypes plus All, Upcoming/Sold tabs, outcome access, null-safe sorting, stale/error/empty states, per-lot original links and source coverage. It is independent of Supabase login. Edinburgh is unparked; existing Scottish evidence is shown without pretending missing English EPC/rent/ownership data exists. Glasgow is included for auctions without inventing missing whole-dashboard datasets.

Offline tests use clearly synthetic fixtures, never demo lots in production JSON. The workflow runs core transport/robots/normalization/dedupe tests, adapter tests and UI state/security/integration tests before collection. Complete collection failure preserves diagnostic files, marks the Action failed and does not replace unknowns with manufactured data.
