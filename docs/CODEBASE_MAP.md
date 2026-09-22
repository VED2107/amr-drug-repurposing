# Codebase map

Every file that matters in this project, what it does, and where the data sits.
Written for someone opening the repository for the first time, or coming back to
it after a gap.

Line counts are from 2026-09-21 and are there to signal weight, not to be kept
exact.

---

## Orientation

| You want to… | Start at |
| --- | --- |
| Run the whole thing | `README.md`, then `python -m src.pipeline.run` |
| Understand the pipeline | `docs/ARCHITECTURE.md` |
| Understand how a compound becomes active/inactive | `docs/LABELING.md` |
| Know what the system does **not** establish | `docs/LIMITATIONS.md` |
| Change what the dashboard says in words | `app/content.py` |
| Change what the dashboard queries | `app/data.py` |
| Add or edit a page | `app/views/`, then register in `app/streamlit_app.py` |
| Change thresholds, paths, model settings | `configs/config.yaml` |
| Change docking targets | `configs/targets.yaml` |

---

## Documentation

| File | Lines | What it is |
| --- | ---: | --- |
| `CONTEXT.MD` | 2,245 | The original build specification — what was asked for, including the scientific-honesty rules the code enforces. |
| `README.md` | 390 | Install, run, pipeline stages, dashboard page list, demo mode. |
| `docs/ARCHITECTURE.md` | 237 | Data flow through the six pipeline stages, and the database schema. |
| `docs/LABELING.md` | 178 | pActivity, the active/inactive thresholds, the excluded ambiguous band, censored relations. |
| `docs/LIMITATIONS.md` | 228 | Every limit worth stating: species vs resistant phenotype, docking rigidity, trial-history caveats. |
| `docs/CODEBASE_MAP.md` | — | This file. |
| `DEMO.md` | — | Scripted 5-10 minute walkthrough: navigation, demo candidate, expected values, what never to claim. |
| `docs/WEBSITE_UI_HANDOFF.md` | — | Specification for the future production website. Nothing in it is built. |
| `FINAL_COMPLETION_REPORT.md` | — | What was completed and verified on 2026-09-21, with the source of every number. |
| `AMR_Drug_Repurposing.pptx` | 10 slides | The product source of truth, separate from CONTEXT.MD. Slide 7 is the case study, slide 8 the future roadmap. |

---

## `src/` — the backend

Nothing in `src/` imports from `app/`. The dashboard reads what the pipeline
wrote; it never computes.

### Foundation

| File | Lines | Responsibility |
| --- | ---: | --- |
| `src/config.py` | 189 | Loads `configs/*.yaml`, resolves paths, exposes typed accessors. |
| `src/db.py` | 502 | Schema creation, migrations, connection handling, every table definition. |
| `src/logging_utils.py` | 55 | Structured logging shared by every stage. |

### Ingestion — `src/ingestion/`

| File | Lines | Responsibility |
| --- | ---: | --- |
| `http.py` | 107 | Retrying HTTP with backoff, user-agent handling, response validation. |
| `chembl.py` | 151 | ChEMBL bioactivity and molecule records for the four target organisms. |
| `orange_book.py` | 291 | FDA Orange Book download and parse. Needs a browser user-agent; the CDN 404s otherwise, so the zip magic bytes are checked. |

### Chemistry — `src/chemistry/`

| File | Lines | Responsibility |
| --- | ---: | --- |
| `standardize.py` | 184 | SMILES cleanup, salt stripping, tautomer handling, InChIKey generation. |
| `fingerprints.py` | 77 | 1024-bit Morgan fingerprints (radius 2), packed to 128-byte blobs. |
| `descriptors.py` | 103 | Molecular weight, logP, Lipinski, rotatable bonds, TPSA. |
| `depict.py` | 44 | 2D structure SVG for the dashboard. |

### Machine learning — `src/ml/`

| File | Lines | Responsibility |
| --- | ---: | --- |
| `labeling.py` | 200 | pActivity conversion, active ≥ 5.0 / inactive ≤ 4.0, ambiguous band excluded, censored `>` and `<` relations. |
| `splits.py` | 250 | Bemis-Murcko scaffold-aware train/validation/test splitting, with minority-class protection that refuses to drain a donor partition. |
| `dataset.py` | 387 | Assembles versioned datasets and records their membership. |
| `models.py` | 252 | Model zoo: random forest, extra trees, hist gradient boosting, logistic regression. |
| `train.py` | 392 | Training loop, hyper-parameter selection **on validation only**. |
| `evaluate.py` | 211 | ROC-AUC, PR-AUC, prevalence-adjusted PR-AUC, calibration, curves. |
| `registry.py` | 281 | ACTIVE / CANDIDATE / ARCHIVED / REJECTED lifecycle, promotion margin, absolute floors. `comparison_metric()` is prevalence-adjusted PR-AUC. |
| `sanity.py` | 270 | Leakage checks, class-balance checks, resistance-phenotype coverage warnings. |
| `predict.py` | 281 | Scores molecules with the ACTIVE model and stores provenance. |

### Docking — `src/docking/`

| File | Lines | Responsibility |
| --- | ---: | --- |
| `receptor.py` | 270 | PDB fetch and preparation. Binding site derived from the structure (`site_mode: ligand` or `residues`), never hard-coded. Handles altlocs and broken residues, and fails loudly if the damage is inside the pocket. |
| `ligand.py` | 78 | Meeko ligand preparation, plus the flexibility guard (max 10 rotatable bonds, 60 heavy atoms) that stops Vina stalling forever. |
| `vina_runner.py` | 124 | AutoDock Vina invocation, seeded and reproducible, 600 s per-ligand timeout. |

### Everything else

| File | Lines | Responsibility |
| --- | ---: | --- |
| `src/clinical/evidence.py` | 156 | ClinicalTrials.gov queries; records that a medicine was searched even when nothing was found. |
| `src/ranking/rank.py` | 228 | Combines prediction, docking and evidence into a candidate ordering. |

### Pipeline — `src/pipeline/`

One module per stage; each is runnable as `python -m src.pipeline.<name>`.

| File | Lines | Stage |
| --- | ---: | --- |
| `ingest.py` | 272 | **Collect** — ChEMBL + Orange Book. |
| `process.py` | 181 | **Decode** — standardize, fingerprint, describe. |
| `train.py` | 183 | **Predict (1)** — build datasets, train, evaluate, consider promotion. |
| `predict.py` | 102 | **Predict (2)** — score the approved library. |
| `dock.py` | 328 | **Validate** — prepare receptors, dock candidates, store poses. |
| `clinical.py` | 165 | **Deliver** — trial history for scored medicines. |
| `run.py` | 109 | Runs every stage in order. |
| `runlog.py` | 121 | Run records, error capture, and `mark_stale_runs()` for interrupted jobs. |

---

## `app/` — the dashboard

Streamlit. Opening it performs no computation beyond reading stored results.

| File | Lines | Responsibility |
| --- | ---: | --- |
| `streamlit_app.py` | 153 | Page registry (13 pages, four groups), branding, sidebar status. |
| `data.py` | 1,039 | Every query the UI makes, cached. Also `match_modelled_pathogen()` — the gate that decides whether a probability may be shown at all. |
| `content.py` | 340 | All plain-language text: product story, pathogen profiles, glossary, evidence ladder, disclaimers. No numbers live here. |
| `theme.py` | 398 | Light design system, semantic evidence colours, responsive breakpoints at 1280 / 1024 / 760 / 460px. |

### Components — `app/components/`

| File | Lines | Responsibility |
| --- | ---: | --- |
| `primitives.py` | 176 | Section headings, callouts, empty and error states, the standing disclaimers. |
| `layout.py` | 132 | Page header, sidebar, `data_table()` (renders absences as em dashes, never "None"). |
| `cards.py` | 224 | Metric grid, pathogen cards, candidate cards, pipeline strip. |
| `explain.py` | 224 | **The percentage rule in code.** `percent(value, label)` requires a label; `FORBIDDEN_PERCENT_LABELS` raises `MisleadingLabelError`; `format_probability()` renders 1.0 as `>99%`, never `100%`. |
| `badges.py` | 56 | Status and evidence tags. |
| `icons.py` | 50 | Inline SVG icon set. |

### Views — `app/views/`

| File | Lines | Page |
| --- | ---: | --- |
| `overview.py` | 256 | Overview — what this is, the crisis, the five stages, the four bacteria. |
| `screening.py` | 134 | Drug Screening — the scored library. |
| `candidates.py` | 214 | Candidate Explorer — prioritised candidates per pathogen. |
| `drug_details.py` | 414 | Drug Details — one medicine end to end, including what it does not prove. |
| `case_study.py` | 260 | Case Study — one real candidate through all five stages (PPT slide 7). |
| `explorer.py` | 520 | **Medicine × Disease** — three modes, five-rung evidence ladder. |
| `molecular.py` | 215 | Molecular Analysis — structures and descriptors. |
| `docking.py` | 274 | Docking & 3D — scores, poses, the −7.0 kcal/mol project target. |
| `clinical.py` | 118 | Clinical Evidence — registered trials. |
| `model.py` | 454 | Model & Dataset — metrics, curves, benchmarks, sanity findings. |
| `pipeline.py` | 117 | Pipeline — stage status. |
| `retraining.py` | 148 | Retraining — what would trigger a retrain. |
| `run_history.py` | 130 | Run History — past runs and their errors. |

---

## `tests/` — 356 tests

```bash
./.venv/Scripts/python.exe -m pytest tests/ -o addopts="" -q     # 356 tests, ~4-8 minutes
```

| File | Lines | Covers |
| --- | ---: | --- |
| `conftest.py` | 95 | Fixtures: config, temporary databases. |
| `helpers.py` | 142 | Synthetic chemistry generators (real SMILES, 27 scaffolds). |
| `test_dashboard.py` | 820 | Visual system, page registry, data-layer contract, percentage semantics, product-language guardrails. |
| `test_integration.py` | 515 | End-to-end pipeline on a temporary database. |
| `test_ml.py` | 460 | Splitting, leakage, training, metrics, promotion. |
| `test_docking.py` | 370 | Receptor prep, ligand guard, Vina parsing. |
| `test_ingestion.py` | 349 | ChEMBL and Orange Book parsing, HTTP retries. |
| `test_ranking_and_db.py` | 334 | Ranking, schema, migrations. |
| `test_chemistry.py` | 169 | Standardisation, fingerprints, descriptors. |
| `test_labeling.py` | 163 | Thresholds, censored relations, ambiguous band. |

---

## Data, models and tools

| Path | Contents |
| --- | --- |
| `data/amr.sqlite` | The live database. |
| `data/demo/amr_demo.sqlite` | Deterministic demo subset; every row flagged as demo data. |
| `data/raw/`, `data/processed/` | Downloaded payloads and derived artifacts; `processed/docking` holds poses. |
| `data/external/receptors/` | Prepared PDB receptors. |
| `models/*.joblib` | Every trained model, archived ones included. |
| `configs/config.yaml` | Thresholds, paths, model and docking settings. |
| `configs/targets.yaml` | One docking target per pathogen, with its binding-site definition. |
| `tools/vina.exe` | AutoDock Vina 1.2.5. |
| `scripts/build_demo.py` | Builds the demo database. |
| `scripts/check_environment.py` | Verifies RDKit, Vina, and the rest of the toolchain. |
| `scripts/backfill_curves.py` | Recomputes stored evaluation curves. |
| `scripts/responsive_qa.py` | Measured layout QA at 1440/1024/760/400px, plus console errors. |
| `scripts/performance_qa.py` | Times every page to first readable content. |
| `scripts/promote_clean_dataset_models.py` | Promotes on dataset integrity when metrics tie, with the reason recorded. |

### Database tables

`molecules`, `drugs`, `bioactivity`, `pathogens`, `targets`, `dataset_versions`,
`dataset_members`, `model_versions`, `model_benchmarks`, `predictions`,
`docking_runs`, `docking_results`, `clinical_queries`, `clinical_trials`,
`pipeline_runs`, `pipeline_errors`, `data_sources`, `settings`, `schema_info`.

`clinical_queries` is the one that is easy to overlook and matters most: it
records that a medicine *was searched*, which is what lets the interface say
"not yet checked" instead of implying no evidence exists.

---

## Rules the code enforces

These are not style preferences; they are the constraints the project is built
around, and each has a test.

1. **A percentage always carries its meaning.** `explain.percent()` takes the
   label as a required argument and rejects any label implying clinical benefit.
2. **Only four bacteria may show a probability.** `data.match_modelled_pathogen()`
   gates every prediction, docking and measurement lookup. Any other condition
   gets documented evidence and an explicit statement that no model exists.
3. **Absence of evidence is not evidence of absence.** "No evidence found",
   "not yet checked" and "no effect" are three different statements and the UI
   never collapses them.
4. **A study is not an outcome; an approval is not an indication.** Trial
   records and Orange Book status are presented as history, never as efficacy or
   as approval for the condition being explored.
5. **Model selection uses prevalence-adjusted PR-AUC**, on the validation split
   only. Raw PR-AUC is inflated by class balance and once kept a ROC-0.67 model
   in service.
6. **No number in the interface is hard-coded.** Every count is read from the
   database at render time.
7. **A scaffold carries no stereochemistry.** `chemistry.standardize.murcko_scaffold_for()`
   is the single definition. Two enantiomers are one scaffold, so they cannot be
   split across train and test. `ml/sanity.py` raises CRITICAL if a scaffold or a
   connectivity skeleton ever straddles a partition again.
8. **Only the ACTIVE model's predictions are shown.** `predictions` is unique per
   (molecule, pathogen, model version), so a retrain adds a generation rather than
   replacing one. Every query in `app/data.py` joins `model_versions` on
   `status = 'ACTIVE'`; without it a medicine appears twice with two probabilities.
