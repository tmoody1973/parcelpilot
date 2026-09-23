# Citation-support check on the gold briefs — 2026-09-23

Measured by `pnpm citation-support:eval` (MOO-841, decision 017): the latest validated brief of each gold case (from `pnpm decision:gold`), run through the check live against JEV (`jev-1.13.0`). One request per brief; one Choice per (fact/code/finding sentence, cited excerpt). A sentence stays if any excerpt it cites supports it. Nothing was written back.

| | |
|---|---|
| Briefs checked | 15 |
| Pairs asked | 297 |
| supports / contradicts / says_nothing | 265 / 2 / 30 |
| Pairs below 0.8 confidence | 90 |
| Sentences removed | 24 |
| Of those, sent to review (a not-support answer below 0.8) | 18 |
| Briefs that would fall back to the template | 8 (G01, G03, G04, G05, G06, G10, G11, G14) |
| JEV failures | 0 |
| p95 latency per brief | 322 ms |
| Cost, all briefs | $0.00264 ($0.000176 per brief) |
| Planted pair ("minimum front setback in LB1 is 15 ft" vs the height row) | says_nothing at 1.00 (228 ms) |

| Case | Pairs | Removed | Review | Outcome |
|---|---|---|---|---|
| G01 | 25 | 2 | 1 | fallback |
| G02 | 21 | 2 | 2 | validated |
| G03 | 18 | 1 | 1 | fallback |
| G04 | 19 | 2 | 1 | fallback |
| G05 | 21 | 4 | 4 | fallback |
| G06 | 30 | 3 | 2 | fallback |
| G07 | 25 | 0 | 0 | validated |
| G08 | 27 | 0 | 0 | validated |
| G09 | 3 | 0 | 0 | validated |
| G10 | 19 | 2 | 2 | fallback |
| G11 | 20 | 1 | 1 | fallback |
| G12 | 22 | 2 | 1 | validated |
| G13 | 2 | 0 | 0 | validated |
| G14 | 43 | 5 | 3 | fallback |
| G15 | 2 | 0 | 0 | validated |

## Removed sentences, for the hand check

- **G01 status_explanation[1]** (finding): "Two checks failed: height and density."
  - says_nothing at 0.81 → 295-605-2: Table 295-605-2. Height, maximum (ft.) (Secondary Street). NS1: 45; NS2: 60; LB1: 45; LB2: 60; LB3: 75; RB1: 85; RB2: 85; CS: 60.
  - says_nothing at 0.29 → 295-605-2: Table 295-605-2. Lot area per dwelling unit, minimum (sq. ft.) (Secondary Street). NS1: 2,400; NS2: 1,200; LB1: 1,200; LB2: 800; LB3: 300; RB1: 1,200; RB2: 800; CS: 1,200.
  - Hand check: _(Tarik: supported or not?)_
- **G01 verified_findings[0].sentences[0]** (fact): "The parcel at 4843 N Green Bay Av is zoned LB1 with no overlays."
  - says_nothing at 0.85 → 295-603-1: Table 295-603-1. Multi-family dwelling (RESIDENTIAL USES). NS1: Y; NS2: Y; LB1: Y; LB2: Y; LB3: L; RB1: Y; RB2: Y; CS: Y.
  - Hand check: _(Tarik: supported or not?)_
- **G02 status_explanation[2]** (fact): "The parcel is zoned LB1 with no overlays, on a 7,000 sq ft lot."
  - says_nothing at 0.64 → 295-603-1: Table 295-603-1. Multi-family dwelling (RESIDENTIAL USES). NS1: Y; NS2: Y; LB1: Y; LB2: Y; LB3: L; RB1: Y; RB2: Y; CS: Y.
  - Hand check: _(Tarik: supported or not?)_
- **G02 verified_findings[6].sentences[1]** (code): "The ordinance says off-street parking in commercial districts follows s. 295-403-2 and the design standards of s. 295-403-3."
  - says_nothing at 0.59 → 295-605-4-b-1: General. Off-street parking spaces for uses in commercial zoning districts shall be provided in accordance with the requirements of s. 295-403-2 and shall meet the design standards of s. 295-403-3.
  - Hand check: _(Tarik: supported or not?)_
- **G03 status_explanation[2]** (finding): "The screen found the scenario's required lot area exceeds the lot area available on this parcel."
  - says_nothing at 0.52 → 295-605-2: Table 295-605-2. Lot area per dwelling unit, minimum (sq. ft.) (Secondary Street). NS1: 2,400; NS2: 1,200; LB1: 1,200; LB2: 800; LB3: 300; RB1: 1,200; RB2: 800; CS: 1,200.
  - Hand check: _(Tarik: supported or not?)_
- **G04 status_explanation[0]** (fact): "The parcel at 3905 N Martin L King Jr Dr is zoned LB1 with no overlays and has a lot area of 6,835 sq ft."
  - says_nothing at 0.88 → 295-605-2: Table 295-605-2. Lot area per dwelling unit, minimum (sq. ft.) (Secondary Street). NS1: 2,400; NS2: 1,200; LB1: 1,200; LB2: 800; LB3: 300; RB1: 1,200; RB2: 800; CS: 1,200.
  - Hand check: _(Tarik: supported or not?)_
- **G04 status_explanation[1]** (finding): "Every category the screen could evaluate passed, and no manual review triggers or missing inputs were recorded."
  - says_nothing at 0.46 → 295-603-1: Table 295-603-1. Multi-family dwelling (RESIDENTIAL USES). NS1: Y; NS2: Y; LB1: Y; LB2: Y; LB3: L; RB1: Y; RB2: Y; CS: Y.
  - says_nothing at 0.32 → 295-605-2: Table 295-605-2. Height, maximum (ft.) (Secondary Street). NS1: 45; NS2: 60; LB1: 45; LB2: 60; LB3: 75; RB1: 85; RB2: 85; CS: 60.
  - Hand check: _(Tarik: supported or not?)_
- **G05 executive_summary[0]** (finding): "This preliminary screen returns verify before committing, at medium risk, because the use finding for a five-unit multifamily building in LB1 came back as verify rather than pass."
  - says_nothing at 0.14 → 295-603-1: Table 295-603-1. Multi-family dwelling (RESIDENTIAL USES). NS1: Y; NS2: Y; LB1: Y; LB2: Y; LB3: L; RB1: Y; RB2: Y; CS: Y.
  - Hand check: _(Tarik: supported or not?)_
- **G05 verified_findings[0].sentences[0]** (finding): "The screen marked the use category as verify, not pass."
  - contradicts at 0.32 → 295-603-1: Table 295-603-1. Multi-family dwelling (RESIDENTIAL USES). NS1: Y; NS2: Y; LB1: Y; LB2: Y; LB3: L; RB1: Y; RB2: Y; CS: Y.
  - Hand check: _(Tarik: supported or not?)_
- **G05 verified_findings[0].sentences[3]** (fact): "The scenario puts residential use on the ground floor, with no ground-floor commercial space."
  - says_nothing at 0.69 → 295-603-2-a: Single-family Dwelling, Two-family Dwelling, Multi-family Dwelling, Attached Single family Dwelling or Live-work Unit.
  - Hand check: _(Tarik: supported or not?)_
- **G05 verified_findings[6].sentences[1]** (code): "Off-street parking in commercial districts must follow the requirements of s. 295-403-2 and the design standards of s. 295-403-3."
  - says_nothing at 0.34 → 295-605-4-b-1: General. Off-street parking spaces for uses in commercial zoning districts shall be provided in accordance with the requirements of s. 295-403-2 and shall meet the design standards of s. 295-403-3.
  - Hand check: _(Tarik: supported or not?)_
- **G06 executive_summary[0]** (finding): "The screen result is verify before committing, at medium risk, because the front setback could not be confirmed."
  - says_nothing at 0.30 → 295-605-2: Table 295-605-2. Front setback, maximum (ft.) (see s. 295-505-2-b) (Primary Street). NS1: 50; NS2: average; LB1: 70; LB2: average; LB3: average; RB1: none; RB2: 70; CS: average.
  - Hand check: _(Tarik: supported or not?)_
- **G06 status_explanation[0]** (finding): "The status is driven by one finding marked verify: the front setback."
  - says_nothing at 0.82 → 295-605-2: Table 295-605-2. Front setback, minimum (ft.) (see s. 295-505-2-b) (Primary Street). NS1: average; NS2: none; LB1: none; LB2: none; LB3: none; RB1: average; RB2: none; CS: none.
  - says_nothing at 0.82 → 295-605-2: Table 295-605-2. Front setback, maximum (ft.) (see s. 295-505-2-b) (Primary Street). NS1: 50; NS2: average; LB1: 70; LB2: average; LB3: average; RB1: none; RB2: 70; CS: average.
  - Hand check: _(Tarik: supported or not?)_
- **G06 verified_findings[6].sentences[1]** (code): "Commercial district parking must follow the requirements of s. 295-403-2, which is not in this screen's evidence."
  - says_nothing at 0.31 → 295-605-4-b-1: General. Off-street parking spaces for uses in commercial zoning districts shall be provided in accordance with the requirements of s. 295-403-2 and shall meet the design standards of s. 295-403-3.
  - Hand check: _(Tarik: supported or not?)_
- **G10 status_explanation[2]** (code): "Table 295-603-1 sets which uses are allowed in each commercial district, but the screen had no reviewed rule for a data center."
  - says_nothing at 0.27 → 295-603-1: Table 295-603-1 indicates the use classifications for various land uses in the commercial districts. The uses in this table are defined in s. 295-201. The following are the use classifications indicated in Table 295-603-1:
  - Hand check: _(Tarik: supported or not?)_
- **G10 verified_findings[5].sentences[0]** (finding): "Density passes: 0 sq ft of lot area required versus 7,000 sq ft of lot area available."
  - contradicts at 0.26 → 295-605-2: Table 295-605-2. Lot area per dwelling unit, minimum (sq. ft.) (Secondary Street). NS1: 2,400; NS2: 1,200; LB1: 1,200; LB2: 800; LB3: 300; RB1: 1,200; RB2: 800; CS: 1,200.
  - Hand check: _(Tarik: supported or not?)_
- **G11 verified_findings[2].sentences[3]** (finding): "The screen marked the front setback as verify: it produced no proposed or allowed value because the averaged maximum could not be determined."
  - says_nothing at 0.06 → 295-605-2: Table 295-605-2. Front setback, maximum (ft.) (see s. 295-505-2-b) (Primary Street). NS1: 50; NS2: average; LB1: 70; LB2: average; LB3: average; RB1: none; RB2: 70; CS: average.
  - Hand check: _(Tarik: supported or not?)_
- **G12 status_explanation[0]** (fact): "The parcel is zoned LB1 with a DPD overlay. The lot is 6,957 sq ft."
  - says_nothing at 0.81 → 295-601-2: These districts provide a wide range of goods and services to a large consumer population coming from an extensive area. Within these districts, motor-vehicle- related activities are of major significance. Good access by motor vehicle or public transit is important to local business districts, which are often located adjacent to intersections of major thoroughfares and in close proximity to bus transfer locations. The LB1 district is characterized by a more suburban development pattern, with larger lots and deeper setbacks, while the development pattern in the LB2 district tends to be more urban, with smaller lots and smaller setbacks. The LB3 district is the most urban and is characterized by design standards appropriate for neighborhood commercial hubs, centers, corridors and transit-oriented development areas that have a denser level of development and may have taller buildings, all of which promote compact, walkable, sustainable neighborhoods.
  - Hand check: _(Tarik: supported or not?)_
- **G12 verified_findings[0].sentences[0]** (fact): "The scenario proposes a 5-unit multifamily building with ground-floor retail."
  - says_nothing at 0.66 → 295-603-1: Table 295-603-1. Multi-family dwelling (RESIDENTIAL USES). NS1: Y; NS2: Y; LB1: Y; LB2: Y; LB3: L; RB1: Y; RB2: Y; CS: Y.
  - Hand check: _(Tarik: supported or not?)_
- **G14 executive_summary[0]** (finding): "Status: verify before committing, with high risk. Every checked category came back as verify, and the parcel is mapped to two base districts, LB1 and RT4."
  - says_nothing at 0.87 → 295-603-1: Table 295-603-1. Multi-family dwelling (RESIDENTIAL USES). NS1: Y; NS2: Y; LB1: Y; LB2: Y; LB3: L; RB1: Y; RB2: Y; CS: Y.
  - says_nothing at 0.67 → 295-501-2-c: The purpose of the RT4 district is to promote, preserve and protect neighborhoods intended primarily for 2-family dwellings while also permitting a mixture of single-family dwellings and small multi-family dwellings of 3 or 4 units. This district, much like the RT3 district, allows smaller lots, smaller setbacks and a higher lot coverage than the RT1 and RT2 districts. The neighborhoods found in this district were platted and developed, in large part, in the late 1800s and early 1900s. This district also allows traditional corner commercial establishments commonly found in urban neighborhoods.
  - Hand check: _(Tarik: supported or not?)_
- **G14 status_explanation[1]** (fact): "The ambiguity trigger is multiple base districts: the parcel record lists LB1 / RT4."
  - says_nothing at 0.98 → 295-603-1: Table 295-603-1. Multi-family dwelling (RESIDENTIAL USES). NS1: Y; NS2: Y; LB1: Y; LB2: Y; LB3: L; RB1: Y; RB2: Y; CS: Y.
  - says_nothing at 0.95 → 295-501-2-c: The purpose of the RT4 district is to promote, preserve and protect neighborhoods intended primarily for 2-family dwellings while also permitting a mixture of single-family dwellings and small multi-family dwellings of 3 or 4 units. This district, much like the RT3 district, allows smaller lots, smaller setbacks and a higher lot coverage than the RT1 and RT2 districts. The neighborhoods found in this district were platted and developed, in large part, in the late 1800s and early 1900s. This district also allows traditional corner commercial establishments commonly found in urban neighborhoods.
  - Hand check: _(Tarik: supported or not?)_
- **G14 status_explanation[5]** (finding): "The screen checked the LB1 standards but could not settle which district applies. For that reason, no category could be closed out."
  - says_nothing at 0.94 → 295-605-2: Table 295-605-2. Height, maximum (ft.) (Secondary Street). NS1: 45; NS2: 60; LB1: 45; LB2: 60; LB3: 75; RB1: 85; RB2: 85; CS: 60.
  - Hand check: _(Tarik: supported or not?)_
- **G14 verified_findings[0].sentences[0]** (finding): "Use is marked verify."
  - says_nothing at 0.57 → 295-603-1: Table 295-603-1. Multi-family dwelling (RESIDENTIAL USES). NS1: Y; NS2: Y; LB1: Y; LB2: Y; LB3: L; RB1: Y; RB2: Y; CS: Y.
  - Hand check: _(Tarik: supported or not?)_
- **G14 verified_findings[5].sentences[3]** (code): "No RT4 density standard is in the reviewed evidence, apart from the 4-unit-per-building cap."
  - says_nothing at 0.40 → 295-503-2-b-2: In the RT4 district, not more than 4 dwelling units shall be permitted in a single building. If this standard is not met, a multi-family dwelling is a prohibited use. b-3 In the RT5 district, not more than 8 dwelling units shall be permitted in a single building. If this standard is not met, a multi-family dwelling is a prohibited use.
  - Hand check: _(Tarik: supported or not?)_

## Hand check of five removals (Claude, 2026-09-23; Tarik to confirm)

| # | Removed sentence | What is actually true | Verdict |
|---|---|---|---|
| 1 | G01 status_explanation[1] (finding): "Two checks failed: height and density." | True: it comes from the run's findings. The cited excerpts are the height and density limit rows, which state limits, not results. | JEV is right that the excerpt does not say it; the sentence is true. Removing it fails the whole brief. |
| 2 | G01 verified_findings[0].sentences[0] (fact): "The parcel … is zoned LB1 with no overlays." | True: it comes from the parcel facts. The cited use table does not state the parcel's zoning. | JEV right about the excerpt; the sentence is true. |
| 3 | G02 verified_findings[6].sentences[1] (code): parking "follows s. 295-403-2 and the design standards of s. 295-403-3" | The excerpt says almost exactly this. | **JEV wrong** (says_nothing at 0.59; would go to review). |
| 4 | G05 verified_findings[6].sentences[1] (code): the same parking sentence | Same | **JEV wrong** (says_nothing at 0.34). |
| 5 | G14 status_explanation[1] (fact): "The ambiguity trigger is multiple base districts: … LB1 / RT4." | True: it comes from the routing triggers. The cited rows do not state it. | JEV right about the excerpt; the sentence is true. |

**Tally: 0 of 5 removed sentences were false.**
- In 3 of 5, the sentence is true and its citation points at ordinance text that doesn't state it. The sentence's real source is the contract (parcel facts, findings, triggers), not an excerpt.
- In 2 of 5, JEV missed support that was nearly word for word, at low confidence.

Across all 24 removals: 12 finding, 7 fact, 5 code. Of the 5 code removals, two are the parking false removals above. The other three are compound sentences that pair a supported clause with a note about the evidence (for example "…s. 295-403-2, which is not in this screen's evidence").

**Reading.** On a clear case the check catches an excerpt that is unrelated to its claim (the planted pair: says_nothing at 1.00). The formal hand check covers five of the 24 removals, and none of the five was false. The other 19 were read through but not checked one by one; most follow the same pattern of true sentences grounded in the contract, but that is an observation, not a verified count. Turning the check on would send 8 of 15 briefs to the template. It stays off (decision 017).

## Re-run after the brief-selection fix (same day, same 15 briefs, same 297 pairs)

The evaluator now takes the latest *validated* brief of each case across all its runs, not only the latest run's. All 15 cases had one on their latest run, so the same briefs were checked. JEV's answers still differed:

| | |
|---|---|
| Sentences removed | 25 |
| Of those, sent to review (a not-support answer below 0.8) | 21 |
| Briefs that would fall back to the template | 7 (G03, G04, G05, G06, G10, G11, G14) |
| p95 latency per brief | 336 ms |
| Cost, all briefs | $0.00264 ($0.000176 per brief) |

The difference is JEV's low-confidence answers varying between runs, not a change in the briefs: G01 kept its "Two checks failed" sentence this time. Repeat consistency is an M6 metric; this is a first data point. The hand check above refers to the first run.
