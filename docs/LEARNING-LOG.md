# Learning log

Dated entries. Each answers: what did we expect, what happened, what do we now believe. Tarik writes the retros; Claude may draft the "expected" line.

## 2026-09-21 — Planning pass

**Expected.** That the City's zoning-code PDFs and map services could be fetched by a scheduled job like any other public data.

**What happened.** The map services (milwaukeemaps.milwaukee.gov) answered every query and exposed everything we need: parcel polygons with the zoning code on each parcel, a base-zoning layer, planned-development and overlay layers, special districts, FEMA floodplain, and a TAXKEY geocoder. The ordinance PDFs on city.milwaukee.gov are behind a bot-challenge page, so automated download fails. Tarik's local copies in `data/` are native text with a printed "updated through" date on every page, which gives us a version marker without needing the website at all.

**What we now believe.** Source refresh must be browser-assisted or manual, with Legistar (which is fetchable) as the early-warning signal. Verifying sources before designing around them saved a design built on a cron job that would never have worked.

_(Tarik: add your own take.)_
