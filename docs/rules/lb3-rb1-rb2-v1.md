# Queue-born rules, v1: LB3, RB1, RB2

**Source:** `data/zoning-code-pdfs/CH295-sub6.pdf` (Chapter 295 Subchapter 6, Commercial Districts; date stamp 7/15/2025; sha256 `198a9062664e…`).
**How these rows were made:** code read the canonical rows of Table 295-603-1 and Table 295-605-2 (`services/worker-py/app/candidates.py`), each candidate landed in the review queue with its page citation, and a reviewer signed it off in the app. Every row below is read back from `zoning_rules` by `app/rules_review_doc.py`; nothing is typed by hand.
**Generated:** 2026-09-22. Reviewer signature at the bottom.

"pdf p." is the page in the PDF file; "printed" is the number in the page footer. A cell the engine cannot read as a number becomes a *condition* that forces the category to "verify".

| Family | v | District | Category | Kind | Value | Criticality | Cell text (pdf p. / printed) | Conditions | Signed off by |
|---|---|---|---|---|---|---|---|---|---|
| `198a9062664e:295-603-1:allowed_use:LB3` | 1 | LB3 | use | allowed_use | office Y, retail L, live_work L, mixed_use L, commercial L, two_family L, multifamily L, adult_retail N, single_family L | critical | "Multi-family dwelling: LB3 L; Single-family dwelling: LB3 L; Two-family dwelling: LB3 L; Live-work unit: LB3 L" (p. 2 / 812)<br>"General office: LB3 Y; Retail establishment, general: LB3 L; Adult retail establishment: LB3 N" (p. 3 / 813) | `street_classification` (not evaluable → verify) | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:height_maximum_ft:LB3` | 1 | LB3 | height | max_height_ft | ≤ 75 ft | critical | "Height, maximum (ft.): LB3 75" (p. 16 / 824) | none | tarik-owner@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:height_minimum_ft:LB3` | 1 | LB3 | height | min_height_ft | ≥ 30 ft | critical | "Height, minimum (ft.): LB3 30" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:front_setback_minimum_ft_see_s_295_505_2_b:LB3` | 1 | LB3 | setback_front | min_setback_ft | ≥ 0 ft | high | "Front setback, minimum (ft.) (see s. 295-505-2-b): LB3 none" (p. 16 / 824) | `average_front_setback` (not evaluable → verify) | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:side_setback_minimum_ft:LB3` | 1 | LB3 | setback_side | min_setback_ft | ≥ 0 ft | high | "Side setback, minimum (ft.): LB3 none" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:rear_setback_minimum_ft:LB3` | 1 | LB3 | setback_rear | min_setback_ft | ≥ 0 ft | high | "Rear setback, minimum (ft.): LB3 none" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:lot_area_per_dwelling_unit_minimum_sq_ft:LB3` | 1 | LB3 | density | min_lot_area_per_unit | ≥ 300 sq ft lot area per unit | high | "Lot area per dwelling unit, minimum (sq. ft.): LB3 300" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-603-1:allowed_use:RB1` | 1 | RB1 | use | allowed_use | office Y, retail L, live_work Y, mixed_use L, commercial L, two_family Y, multifamily Y, adult_retail S, single_family Y | critical | "Multi-family dwelling: RB1 Y; Single-family dwelling: RB1 Y; Two-family dwelling: RB1 Y; Live-work unit: RB1 Y" (p. 2 / 812)<br>"General office: RB1 Y; Retail establishment, general: RB1 L; Adult retail establishment: RB1 S" (p. 3 / 813) | `street_classification` (not evaluable → verify) | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:height_maximum_ft:RB1` | 1 | RB1 | height | max_height_ft | ≤ 85 ft | critical | "Height, maximum (ft.): RB1 85" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:front_setback_minimum_ft_see_s_295_505_2_b:RB1` | 1 | RB1 | setback_front | min_setback_ft | ≥ 0 ft | high | "Front setback, minimum (ft.) (see s. 295-505-2-b): RB1 average" (p. 16 / 824) | `average_front_setback` (not evaluable → verify) | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:side_setback_minimum_ft:RB1` | 1 | RB1 | setback_side | min_setback_ft | ≥ 0 ft | high | "Side setback, minimum (ft.): RB1 none" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:rear_setback_minimum_ft:RB1` | 1 | RB1 | setback_rear | min_setback_ft | ≥ 0 ft | high | "Rear setback, minimum (ft.): RB1 none" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:lot_area_per_dwelling_unit_minimum_sq_ft:RB1` | 1 | RB1 | density | min_lot_area_per_unit | ≥ 1,200 sq ft lot area per unit | high | "Lot area per dwelling unit, minimum (sq. ft.): RB1 1,200" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-603-1:allowed_use:RB2` | 1 | RB2 | use | allowed_use | office Y, retail L, live_work Y, mixed_use L, commercial L, two_family Y, multifamily Y, adult_retail S, single_family Y | critical | "Multi-family dwelling: RB2 Y; Single-family dwelling: RB2 Y; Two-family dwelling: RB2 Y; Live-work unit: RB2 Y" (p. 2 / 812)<br>"General office: RB2 Y; Retail establishment, general: RB2 L; Adult retail establishment: RB2 S" (p. 3 / 813) | `street_classification` (not evaluable → verify) | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:height_maximum_ft:RB2` | 1 | RB2 | height | max_height_ft | ≤ 85 ft | critical | "Height, maximum (ft.): RB2 85" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:height_minimum_ft:RB2` | 1 | RB2 | height | min_height_ft | ≥ 24 ft | critical | "Height, minimum (ft.): RB2 24" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:front_setback_minimum_ft_see_s_295_505_2_b:RB2` | 1 | RB2 | setback_front | min_setback_ft | ≥ 0 ft | high | "Front setback, minimum (ft.) (see s. 295-505-2-b): RB2 none" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:front_setback_maximum_ft_see_s_295_505_2_b:RB2` | 1 | RB2 | setback_front | max_setback_ft | ≤ 70 ft | high | "Front setback, maximum (ft.) (see s. 295-505-2-b): RB2 70" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:side_setback_minimum_ft:RB2` | 1 | RB2 | setback_side | min_setback_ft | ≥ 0 ft | high | "Side setback, minimum (ft.): RB2 none" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:rear_setback_minimum_ft:RB2` | 1 | RB2 | setback_rear | min_setback_ft | ≥ 0 ft | high | "Rear setback, minimum (ft.): RB2 none" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |
| `198a9062664e:295-605-2:lot_area_per_dwelling_unit_minimum_sq_ft:RB2` | 1 | RB2 | density | min_lot_area_per_unit | ≥ 800 sq ft lot area per unit | high | "Lot area per dwelling unit, minimum (sq. ft.): RB2 800" (p. 16 / 824) | none | tarik@dev.local 2026-09-22 |

## Rejected candidates (kept so nobody assumes they were checked)

- LB3 density min_lot_area_per_unit: proposal 800 does not match the cell, which reads 300; re-extract in MOO-825 (tarik-owner@dev.local)

## Not modelled in v1

Side-street setback maximum (needs a corner-lot fact), glazing and build-out percentages, permanent supportive housing and transitional housing lot-area rows, sign table 295-605-5, conversion rule 295-605-2-h, height exemptions in 295-605-2-f.

## Reviewer sign-off

Interim reviewer (product owner, per MOO-795): ______ Date: ______ (signed on Linear MOO-825)
