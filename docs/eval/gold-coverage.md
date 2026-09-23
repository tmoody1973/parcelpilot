# Gold set coverage (v1 draft)

Generated 2026-09-23 for MOO-842 from the 50 files in `packages/contracts/gold/`. Every case is `unreviewed` until MOO-843; G16–G50 are Claude drafts for reviewer correction. `gold.test.ts` reproduces every case through the live engine, citation gate and policy, and checks the minimums below.

## PRD case types

| Case type | Cases |
|---|---|
| Straightforward covered cases (every checked category passes) | G02, G04, G16–G25 (incl. boundaries: 45 ft exactly G04/G18/G21, front 70 ft exactly G20, lot area exactly used G23) |
| Height failures | G01, G08 (LB2 minimum), G10, G29, G30, G31 (LB2 maximum), G39 |
| Setback failures | G27, G32, G33, G34 (LB1 front maximum). Side and rear cannot fail under the seeded rules: both minimums are 0, none required |
| Density failures | G01, G03 (by a sliver), G07, G09 |
| Use not allowed | G26, G27, G28 (adult retail, N) |
| Mixed-use classification questions | G47 (mixed use: no row in Table 295-603-1; the seeded rule says L), G48 (retail as principal use, L), G05 and G50 (residential at street level) |
| Incomplete parking facts | G19 (parking spaces not given). Parking has no reviewed rule, so every case reports it as not checked |
| Missing inputs | G09 (height), G35 (units), G36 (front setback) |
| Floodplain or overlay triggers | G11 (SPROZ overlay, synthetic), G44 (FEMA flood hazard, synthetic) |
| Special districts and planned developments | G12 (DPD, synthetic), G41 and G43 (redevelopment plan, real), G42 (DPD, real), G45 (historic district, synthetic) |
| Stacked condominium ambiguity | G13 (three unit records), G37 (two) |
| Amended or superseded code | G15, G38, G39 (cited source superseded; synthetic source state) |
| Missing or unreliable source data | G40 (lot area flagged suspect), G10 (use outside the reviewed use list) |
| Conflicting evidence | G14 (LB1/RT4) and G46 (LB2/RS6): the parcel sits in two zoning polygons. Conflicting *sources* (two ordinance texts that disagree) cannot be expressed yet: the citation gate never reports conflicting sources |

## Routes (expected)

| Route | Cases | Minimum |
|---|---|---|
| proceed_to_concept_design | 12 | 12 |
| revise_scenario | 9 | 3 |
| engage_zoning_professional | 12 | 3 |
| contact_city | 9 | 3 |
| collect_missing_information | 5 | 3 |
| insufficient_evidence | 3 | 3 |

## Fails per category

| Category | Fail cases | Minimum |
|---|---|---|
| use | 3 | 3 |
| height | 7 | 3 |
| setback_front | 4 | 3 |
| setback_side | 0 | none (cannot fail: minimum 0) |
| setback_rear | 0 | none (cannot fail: minimum 0) |
| density | 4 | 3 |

## Parcels

- Real parcels: 41; synthetic: 9 (the reason is in each case title and review note).
- Districts: LB1 41, LB2 9. LB2 can never reach proceed: its front setback maximum is the average of neighbouring buildings, not a parcel fact yet.
- Real parcels for G16–G50 came from the City parcel layer (`parcels_mprop/MapServer/2`) on 2026-09-23. Each clean parcel was checked against the planned-development (zoning 1–2), overlay (zoning 4–10), special-district (6, 8, 17, 18, 23) and FEMA (1–2) layers and had no hit.

## Questions for the reviewer (MOO-843)

1. **Ground-floor retail in proceed cases.** "Retail establishment, general" is L (limited use) in Table 295-603-1, and the v1 engine checks only the principal use. So a multifamily building over retail proceeds without evaluating the retail limitations. This affects G02, G16, G18, G19, G21, G22, G23 and G24. If the right answer is verify, those cases change label and the engine needs a new rule. That would be a new issue, not an edit to the case.
2. **Mixed use has no row in Table 295-603-1.** The seeded use rule lists `mixed_use` (and `commercial`) as L with no table row behind it. G47 and G48 test that entry. Should it stay?
