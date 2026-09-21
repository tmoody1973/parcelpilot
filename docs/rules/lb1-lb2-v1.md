# Hand-entered rules, v1: LB1 and LB2

**Source:** `data/zoning-code-pdfs/CH295-sub6.pdf` (Chapter 295 Subchapter 6, Commercial Districts; date stamp 7/15/2025; sha256 `198a9062664e…`), plus one pointer into `CH295-sub5.pdf` (4/22/2025; sha256 `fa92de2c8d86…`).
**Data file:** `packages/contracts/rules/lb1-lb2-v1.json`. Loaded into the database by `pnpm rules:seed`.
**Status:** drafted by Claude on 2026-09-21 from the pages below. Reviewer signature at the bottom.

Every row is one rule the engine can evaluate. "pdf p." is the page in the PDF file; "printed" is the number in the page footer. A footnote the engine cannot evaluate becomes a *condition* that forces the category to "verify" so nothing is silently assumed.

## Table 295-605-2 (pdf p. 16, printed 824): principal building design standards

| Rule id | District | Category | Value | Cell text | Footnote / condition |
|---|---|---|---|---|---|
| lb1-height-max | LB1 | height | ≤ 45 ft | "Height, maximum (ft.)" LB1 = 45 | none |
| lb1-front-min | LB1 | setback_front | ≥ 0 ft | "Front setback, minimum (ft.)" LB1 = none | see s. 295-505-2-b (definition of front) |
| lb1-front-max | LB1 | setback_front | ≤ 70 ft | "Front setback, maximum (ft.)" LB1 = 70 | none |
| lb1-side-min | LB1 | setback_side | ≥ 0 ft | "Side setback, minimum (ft.)" LB1 = none | none |
| lb1-rear-min | LB1 | setback_rear | ≥ 0 ft | "Rear setback, minimum (ft.)" LB1 = none | none |
| lb1-density | LB1 | density | ≥ 1,200 sq ft lot area per unit | "Lot area per dwelling unit, minimum (sq. ft.)" LB1 = 1,200 | permanent supportive housing row (600 / 1,200) not modelled |
| lb2-height-min | LB2 | height | ≥ 18 ft | "Height, minimum (ft.)" LB2 = 18 | measured per 295-605-2-f-5 (front façade) |
| lb2-height-max | LB2 | height | ≤ 60 ft | "Height, maximum (ft.)" LB2 = 60 | none |
| lb2-front-min | LB2 | setback_front | ≥ 0 ft | "Front setback, minimum (ft.)" LB2 = none | **maximum is "average"** (295-505-2-b, sub5 pdf p. 13): needs neighbours' setbacks → always `verify` |
| lb2-side-min | LB2 | setback_side | ≥ 0 ft | "Side setback, minimum (ft.)" LB2 = none | none |
| lb2-rear-min | LB2 | setback_rear | ≥ 0 ft | "Rear setback, minimum (ft.)" LB2 = none | none |
| lb2-density | LB2 | density | ≥ 800 sq ft lot area per unit | "Lot area per dwelling unit, minimum (sq. ft.)" LB2 = 800 | permanent supportive housing row (400 / 800) not modelled |

Not modelled in v1 (listed so nobody assumes they were checked): side-street setback maximum (LB1 25 ft, LB2 5 ft; needs a corner-lot fact), glazing and build-out percentages, conversion rule 295-605-2-h, height exemptions in 295-605-2-f.

## Table 295-603-1 (pdf p. 2–3, printed 812–813): commercial districts use table

Legend letters, as printed: Y permitted use · L limited use (standards in 295-603-2 apply, else board special-use permit) · S special use · N prohibited. The app stores the letters, never the words.

| Rule id | District | Scenario use value | Letter | Table row | pdf p. |
|---|---|---|---|---|---|
| lb1-use, lb2-use | LB1, LB2 | multifamily | Y | Multi-family dwelling | 2 |
| | | single_family | Y | Single-family dwelling | 2 |
| | | two_family | Y | Two-family dwelling | 2 |
| | | live_work | Y | Live-work unit | 2 |
| | | retail | L | Retail establishment, general | 3 |
| | | commercial | L | (form's catch-all; mapped to the retail row, the most restrictive common commercial use) | 3 |
| | | mixed_use | L | (dwellings Y over retail L; the L governs) | 2–3 |
| | | adult_retail | N | Adult retail establishment | 3 |

**Deliberately left out of v1:** `office` (General office = Y on pdf p. 3). Gold case G10 was drafted with office outside the rule set so the engine returns `unknown` for it. Reviewer decision: add `office: Y` (and correct G10) or keep it out. Both are safe; `unknown` routes to verify.

**Condition on both use rules:** `street_classification` (295-603-2-a-2, pdf p. 6, printed 816): "No dwelling unit shall be permitted in the street-level area on a principal arterial, minor arterial or collector street … Street-level dwelling units are permitted on local streets." Fires when the scenario's ground-floor use is residential; the street classification map is not a parcel fact yet, so the use category returns `verify`.

## Criticality

From `05_decisioning_design.md` §1.4 defaults: use and height critical; setbacks and density high. A critical or high `fail` blocks "proceed".

## Corrections to the gold drafts found while reading

- Gold citations say Table 295-605-2 is on printed page 823; the footer reads 824.
- Gold G10 assumes office is outside the rule set; the table lists General office = Y. Kept out of v1 pending the decision above.

## Reviewer sign-off

Interim reviewer (product owner, per MOO-795): _______________________ Date: ____________

Sign by commenting on Linear issue MOO-813 with "reviewed lb1-lb2-v1" and any rows to change. A changed value is a new version in the JSON (rows are append-only), never an edit.
