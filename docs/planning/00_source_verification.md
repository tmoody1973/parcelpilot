# 00 — Source verification record (2026-09-21)

Evidence record behind `02_architecture.md` §6 and `04_zoning_rag_design.md` §2. Labels: **verified live** = fetched by this planning session; **local** = inspected from Tarik's copies in `data/`; **unverified** = not confirmed, do not build on it without a human check.


## A. Milwaukee ArcGIS REST (milwaukeemaps.milwaukee.gov) — ALL VERIFIED LIVE by direct ?f=pjson fetch
Root: https://milwaukeemaps.milwaukee.gov/arcgis/rest/services  (ArcGIS 10.91; folders incl. property, planning, Locator, LocatorV11, regulation, DPW, assessor, cadastral)
Native spatial reference on all layers: WKID 32054 (NAD83 Wisconsin State Plane South, US feet). Query supports outSR=4326 → reprojection to WGS84 confirmed by test query. Copyright field: "City of Milwaukee, Wisconsin". No lastEditDate exposed on layers; parcel layer has a GIS_DATETIME attribute per feature.

1. Parcels: https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/property/parcels_mprop/MapServer
   - Layer 2 "Parcels - MPROP_full" (polygon). Description verbatim: "City of Milwaukee parcel polygons - attribute table includes every field/column from the MPROP table - polygons representing condominiums are 'stacked' (one polygon per taxkey)"
   - maxRecordCount 200,000; pagination, statistics, distance queries supported; formats JSON/geoJSON/PBF.
   - Fields we will use: TAXKEY, HOUSE_NR_LO, HOUSE_NR_HI, HOUSE_NR_SFX, SDIR, STREET, STTYPE, UNIT, ZONING, LOT_AREA, CORNER_LOT, NR_UNITS, NR_STORIES, BLDG_AREA, BLDG_TYPE, YR_BUILT, LAND_USE, LAND_USE_GP, C_A_LAND, C_A_IMPRV, C_A_TOTAL, YR_ASSMT, HIST_CODE, PARKING_SPACES, PARKING_TYPE, OWNER_NAME_1 (display only), GEO_ALDER, GEO_ZIP_CODE, GIS_DATETIME, SHAPE. (121 fields total.)
   - Layer 22 "Address Points" (point).
   - Layer 1 MPROP_lite, Layer 0 no-MPROP variants exist.
2. Zoning: https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/zoning/MapServer  (also a FeatureServer twin)
   - Service description: "Zoning, zoning overlays, and planned developments"
   - Layer 11 "Zoning" (polygon) fields: OBJECTID, Zoning, ZoningCFN, ZoningCategory, ZoningType, SHAPE  ← base district code is field `Zoning`
   - Layer 12 "Zoning with downtown subdistricts" same fields.
   - Layer 1 DPD (Detailed planned development): DPD_NAME, CFN, CFN_LINK, CC_ACTION_TYPE. Layer 2 GPD: GPD_NAME, CFN, CFN_LINK, CC_ACTION_TYPE. ("one polygon per Council File Number")
   - Overlays: 4 DIZ (DIZ_NAME, CFN, CFN_LINK), 5 Interim Study (IS_NAME, CFN, IS_ID), 6 Lakefront (no attrs), 7 Master sign (NAME, BASE_ZONING, DIST_TYPE, CFN, CPC_APPROV), 8 Neighborhood Conservation (NAME, CFN_APPROVE), 9 SPROZ Site Plan Review (SPROD_NAME, CFN, CFN_LINK), 10 Shoreland/wetland (WETCODE, CLASS, ACRES, ...)
3. Special districts: https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/special_districts/MapServer
   - 1 ARB boundaries (NAME, CFN, CFN_LINK), 3 BID, 6 Redevelopment plans (REDEV_NAME, RACM_RESOLUTION, DOCUMENT_ID, CFN, CFN_LINK), 8 TID (TID, NAME, CREATE_DATE, DISSOLVE_DATE), 15 Local historic sites, 16 National historic sites (point; ADDRESS, NAME, DES_LIST_DATE, CFN_NRIS), 17 Local historic districts, 18 National historic districts, 23 Historic designation parcel classification, 2 Area Plans (URL, AREAPLAN).
4. Floodplain: https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/planning/FEMA_floodplain/MapServer
   - 1 FEMA Floodway, 2 FEMA Special Flood Hazard Areas – High Risk (fields FLD_ZONE, FLOODWAY, SFHA_TF, STATIC_BFE, SOURCE_CIT ...), 0 Approved FEMA CLOMRs.
5. Geocoders: https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/Locator/  (19 GeocodeServer services: Address, AddressLL, Taxkey, TaxkeyLL, Centerline, ... ) and a LocatorV11 folder (18 services incl. Top_1). Taxkey GeocodeServer: single-line input, ops Geocode/ReverseGeocode/Suggest, min score 80, batch 1,000. Which locator the City's own apps use by default: NOT verified.
6. Open data MPROP (attribute-only, no geometry): https://data.milwaukee.gov/dataset/mprop — CSV/JSON, "Daily" update, license Creative Commons Attribution (verified by agent fetch). ~160k rows, 90+ fields.
7. Terms of use for milwaukeemaps services: NOT verified (city.milwaukee.gov pages return HTTP 403 Cloudflare challenge to automated fetch). Only a secondhand disclaimer snippet exists. Needs a human in a browser.

Failure modes (all services): no SLA; no lastEditDate → detect change by content hash of a snapshot query; field renames break queries → registry stores expected field list and a CI contract test; 403/429 possible → cache + backoff; service down → serve from last parcel_snapshot with "stale" flag, never block on live call for a saved run.

## B. Chapter 295 ordinance PDFs
Official host: https://city.milwaukee.gov/ImageLibrary/Groups/ccClerk/Ordinances/Volume-2/CH295-sub{N}.pdf, CH295table.pdf, Master-V2.pdf (URLs from search index; direct fetch BLOCKED by Cloudflare 403 challenge from automated tools — a real browser works). Entry page https://city.milwaukee.gov/ZoningCode (redirect unverified). Amendments: https://milwaukee.legistar.com/Legislation.aspx (verified live). Possible changelog page city.milwaukee.gov/cityclerk/LRB/ordinances/CodeUpdates (unverified).
LOCAL COPIES provided by Tarik in repo `data/zoning-code-pdfs/` — inspected 2026-09-21 with pdfinfo/pdftotext. ALL NATIVE TEXT (no OCR needed). Each shows a date stamp on the first pages (looks like "updated through" marker):
| file | subchapter | pages | date stamp |
| CH295table.pdf | table of contents | 2 | 11/4/2025 |
| CH295-sub1.pdf | 1 Introduction | 4 | 4/22/2025 |
| CH295-sub2.pdf | 2 Definitions & Rules of Measurement | 42 | 7/15/2025 |
| CH295-sub3.pdf | 3 Administration, Enforcement, Appeals | 14 | 3/29/2016 |
| CH295-sub4.pdf | 4 General Provisions | 44 | 7/15/2025 |
| CH295-sub5.pdf | 5 Residential Districts | 35 | 4/22/2025 |
| CH295-sub6.pdf | 6 Commercial Districts | 24 | 7/15/2025 |
| CH295-sub7.pdf | 7 Downtown Districts | 18 | 7/15/2025 |
| CH295-sub8.pdf | 8 Industrial Districts | 20 | 7/15/2025 |
| CH295-sub9.pdf | 9 Special Districts (incl. PD) | 22 | 7/15/2025 |
| CH295-sub10.pdf | 10 Overlay Zones | 12 | 6/18/2019 |
| CH295-SUB11.pdf | 11 Floodplain Overlay Zones | 30 | 11/4/2025 |
District codes printed in sub5: RS1–RS6, RT1–RT5, RM1–RM7, RO1–RO2. In sub6: NS1, NS2, LB1, LB2, LB3, RB1, RB2, CS. Downtown C9x in sub7.
Use tables: Table 295-503-1 (residential) and Table 295-603-1 (commercial), with codes Y (permitted), L (limited), S (special use), N. Dimensional/design standards sections: 295-505 (residential) and 295-605 (commercial) — table ids and footnote structure to be confirmed in ingestion (see grep task).
Copyright/reuse terms for ordinance text: NOT verified.

## C. Other local material in `data/` (Tarik, 2026-09-21)
- data/plans/: 16 comprehensive/area plan PDFs (Citywide, Downtown, Near North, Near West, NE side, NW side, N side, SE, SW, Third Ward?, Walker's Point?, Housing Element, Menomonee Valley 2.0, Harbor District, Fondy & North), 5–60 MB each. These are POLICY context, not zoning rules: register as source_type comprehensive_plan, never feed the rules engine, exclude from rule-category retrieval; optional "policy context" evidence section in a later milestone.
- data/incentives/: HBA, STRONG Homes, down payment assistance, ARCH program (homeowner programs; mostly out of scope for infill developers; register but do not ingest in v1).
- data/forms/zoningchange/: zoning map amendment application, approval schedules, affidavit — useful for "contact_city" next-action links; register as procedure documents.

## D. JEV (docs.typesafe.ai, fetched live)
POST https://api.typesafe.ai/v1/systemone ; Bearer auth ; body {model:"jev-latest", state: string|object|array, questions:{key:{type, instructions, criteria}}}. Types: choice (criteria map, ≤255 options → choice, probabilities, confidence), noul (→ noul 0–1, no separate confidence), score (2–10 levels). Response {model:"jev-1.x.y", answers, usage}. Errors 401/422/429/529, backoff. Limits per agent report: 64k tokens per request, state+longest question ≤32k; rate 250k tok/s, 1,200 req/min "may change" (early access). Latency claim 70–500 ms (blog). Pricing $0.042/M input tokens (early access). NOT in docs: determinism guarantee, seed, calibration method. SDK @typesafe-ai/sdk (Node 20+), Python SDK, langchain-typesafe.

## E. Prior art (agent, gh api)
- No reusable open-source zoning RAG (Urban Institute UI-Research/llm-benchmarking: 1 star, no license). Build, don't fork.
- @esri/arcgis-rest-request + @esri/arcgis-rest-feature-service (Apache-2.0, Esri-maintained).
- PDF libs: pymupdf = AGPL-3.0 or commercial (constraint!); pdfplumber MIT; camelot-py MIT; ocrmypdf MPL-2.0; pypdfium2 (Apache/BSD) for page rendering.
- Queues: pg-boss (Postgres-only, SKIP LOCKED) vs Graphile Worker vs BullMQ (Redis).
- Rerankers: Cohere Rerank (hosted), Voyage rerank-2.5 (hosted), Jina v2 (CC-BY-NC, paid for commercial), bge-reranker-v2-m3 (Apache-2.0, self-host).
- Hybrid search reference: Supabase hybrid-search guide, ParadeDB "missing manual"; RRF = 1/(60+rank_lex)+1/(60+rank_vec).
