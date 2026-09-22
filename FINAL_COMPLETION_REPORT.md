# Final completion report

**Date:** 2026-09-21
**Scope:** finish the outstanding work on the AMR drug-repurposing prototype,
verify it by execution, prepare a demo, and specify the production website.

Every number below was obtained by running a command on this machine. Where a
figure comes from a query, the query's source table is named. Anything that was
not verified says so.

---

## 1. What was completed in this pass

| Work | Outcome |
| --- | --- |
| Clinical registry coverage | **PATH A — full coverage.** All 1,691 approved medicines queried against ClinicalTrials.gov. 0 failures. |
| Clinical stage rebuilt | Resumable, rate-limited, retry-aware, with a coverage report and query-term normalisation. |
| Scaffold leakage found and fixed | Murcko scaffolds carried stereochemistry, so enantiomer pairs could straddle train/test. 30 groups were leaking in the dataset behind the then-active models. Now 0. |
| Scaffold recompute wired into `process` | The stage never recomputed `murcko_scaffold`; `--force` was not a true reprocess. Now it is. |
| Models retrained and promoted | Four new models trained on the corrected dataset and promoted on dataset integrity, with the reason recorded on each row. |
| Stale-prediction bug found and fixed | `predictions` is keyed per model version. After a retrain the dashboard would have shown each medicine twice, with two different probabilities, and the sidebar counted 13,528 stored predictions where 6,764 are shown. Every prediction query — screening, docking, drug detail, the overview counts and the header — now filters to the ACTIVE model. |
| Training-set membership disclosed | Drug Details now states whether the active model was trained on, tuned on, or held out from the medicine being viewed. |
| Docking coverage stated and expanded | The page now shows the denominator; docking was extended from 30 to 53 medicines. |
| Browser QA | 13 pages × 4 viewports measured in a real browser. 0 page overflow, 0 element overflow. |
| Performance measured | Every page timed to first readable content. |
| Documentation | `DEMO.md`, `docs/WEBSITE_UI_HANDOFF.md`, `FINAL_COMPLETION_REPORT.md` written; `README.md` updated. |
| Tests | 337 → **356 passing, 0 failing.** No test was weakened or removed. |

## 2. What was already complete, and verified rather than rebuilt

Verified by reading the code and running it — not taken on trust from the brief:

- ChEMBL and FDA Orange Book ingestion, including the Orange Book user-agent
  workaround and zip magic-byte check.
- SMILES standardisation, salt stripping, InChIKey identity, 1024-bit Morgan
  fingerprints, descriptors.
- Labelling: pActivity, active ≥ 5.0 / inactive ≤ 4.0, the excluded ambiguous
  band, censored `>` and `<` relations.
- Scaffold-aware splitting with minority-class protection; model zoo; training
  with hyper-parameters selected on validation only; prevalence-adjusted PR-AUC
  as the promotion metric; ACTIVE/CANDIDATE/ARCHIVED/REJECTED registry.
- Docking: receptor preparation with the binding site derived from the
  structure, the ligand flexibility guard, seeded Vina runs, stale-run recovery.
- The percentage gate — `match_modelled_pathogen()` — and the forbidden-label
  guard in `explain.percent()`.
- The explorer's three modes and five-rung evidence ladder, including the
  deliberate absence of a winner in comparison mode.
- The "no evidence found" vs "not yet checked" distinction, carried by the
  `clinical_queries` table.

## 3. What changed, file by file

| File | Change |
| --- | --- |
| `src/chemistry/standardize.py` | New `murcko_scaffold_for()` — the single definition of a scaffold, canonical and **stereochemistry-free**. `standardize_smiles()` now calls it. |
| `src/pipeline/process.py` | Recomputes `murcko_scaffold` alongside fingerprints and descriptors, so `--force` genuinely reprocesses. |
| `src/pipeline/clinical.py` | Rewritten: `--all`, `--retry-failed`, `--min-probability`, `--delay`; `query_term_for()` normalises Orange Book combination names; progress logging; `coverage_snapshot()`; failures persisted with their reason. |
| `src/ml/sanity.py` | Two new CRITICAL checks: `scaffold_leakage` (a scaffold in more than one split) and `stereoisomer_leakage` (a connectivity skeleton split across partitions). |
| `app/data.py` | New `docking_coverage()` and `training_membership()`. `screening_table()`, `docking_results()`, `molecule_detail()`, `system_status()` and the overview counts now restrict to the ACTIVE model. |
| `app/views/docking.py` | Docking-coverage callout with its denominator, read live. |
| `app/views/drug_details.py` | `_training_membership_note()` — states where the medicine sits in the training data. |
| `scripts/responsive_qa.py` | **New.** Measured responsive QA at 1440/1024/760/400px, with scrollable-ancestor awareness and console capture. |
| `scripts/performance_qa.py` | **New.** Times every page to first readable content. |
| `scripts/promote_clean_dataset_models.py` | **New.** Promotes on dataset integrity when performance is equivalent, with the reason recorded. |
| `tests/test_chemistry.py` | Enantiomers share a scaffold; scaffolds carry no stereochemistry. |
| `tests/test_ingestion.py` | Four tests for query-term normalisation. |
| `tests/test_integration.py` | A scaffold in two splits is reported as CRITICAL leakage. |
| `tests/test_dashboard.py` | Docking coverage (3), active-model-only predictions (6), training-membership disclosure (3); clinical-coverage assertion updated for full coverage and strengthened. |
| `README.md` | Clinical commands and resumability; four new limitations; new scripts; links to `DEMO.md` and `docs/WEBSITE_UI_HANDOFF.md`. |
| `DEMO.md`, `docs/WEBSITE_UI_HANDOFF.md`, `FINAL_COMPLETION_REPORT.md` | New. |

## 4. Clinical coverage decision — PATH A, with evidence

**Decision: query the entire approved library.** Executed and complete.

The decision was made on measured facts, not on preferring a bigger number:

- The dashboard's coverage denominator was already *all 1,691 medicines*, so
  partial coverage meant the interface reported "not yet checked" against a
  denominator it intended to fill.
- The explorer lets a reader search **any** medicine. Under the previous
  shortlist rule (probability ≥ 0.6, 517 medicines), a reader asking about a
  medicine outside the shortlist — the brief's own example, topiramate — got
  "not yet checked" forever, with no route to an answer.
- A timing probe of three real queries returned in 0.54–1.64 s each, with no
  authentication and no published rate limit on the v2 API. The full sweep was
  therefore ~25 minutes of polite traffic, not an imposition.

**Result** (`clinical_queries`, `clinical_trials`):

| Measure | Value |
| --- | --- |
| Medicines queried | **1,691 / 1,691 (100%)** |
| Successful | 1,691 |
| Failed | **0** |
| Returned no studies → *no evidence found* | 212 |
| Returned studies | 1,479 |
| Trial links stored | 49,647 |
| Distinct studies (NCT ids) | 37,199 |
| Links flagged infection/AMR-related | 1,586 |
| Sweep duration | 1,381 s for 1,591 new lookups |
| Failures during the sweep | 2, both unbalanced-bracket combination names; fixed and re-queried successfully |

"No evidence found" (212) and "not yet checked" remain distinct states in the
schema and in the interface. Full coverage of the **registry** is not
completeness of **evidence**, and the UI does not say otherwise.

## 5. Exact current data counts

All from `data/amr.sqlite` on 2026-09-21.

| Measure | Value | Source |
| --- | ---: | --- |
| Molecules (rows) | 20,396 | `molecules` |
| Molecules valid | 20,258 | `molecules WHERE is_valid=1` |
| Molecules invalid | 138 | `molecules WHERE is_valid=0` |
| Approved product rows | 28,440 | `drugs` |
| Approved medicines with a structure | **1,691** | `COUNT(DISTINCT molecule_id)` in `drugs` |
| Bioactivity records | 47,804 | `bioactivity` |
| Labelled bioactivity records | 35,232 | `bioactivity WHERE label IS NOT NULL` |
| Predictions, active models | 6,764 (1,691 × 4) | `predictions` joined to ACTIVE `model_versions` |
| Predictions, all generations retained | 13,528 | `predictions` |
| Docking results (poses) | 762 rows, 761 successful | `docking_results` |
| Clinical trial links | 49,647 | `clinical_trials` |
| Clinical queries | 1,691 | `clinical_queries` |
| Pipeline runs | 23 | `pipeline_runs` |
| Recorded per-item errors | 5 | `pipeline_errors` |
| Data sources recorded | 14 | `data_sources` |

## 6. Active models

Dataset `DS-20260921-fe8c6cb8-78df2c` (18,227 rows, 13,604 unique compounds),
scaffold split, seed 42, features `morgan-r2-1024-v1`.

| Pathogen | Model | ROC-AUC | PR-AUC | Prevalence-adjusted PR-AUC | Prevalence | n(test) |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| MRSA | RF-mrsa-v4 | 0.959 | 0.990 | **0.948** | 0.800 | 913 |
| *E. coli* | RF-ecoli-v4 | 0.953 | 0.986 | **0.940** | 0.774 | 1,063 |
| *K. pneumoniae* | RF-kpneumoniae-v5 | 0.975 | 0.991 | **0.965** | 0.742 | 840 |
| *M. tuberculosis* | RF-mtb-v5 | 0.951 | 0.963 | **0.922** | 0.532 | 852 |

Registry: 4 ACTIVE, 5 ARCHIVED, 43 CANDIDATE, 4 REJECTED.

**Why these four are active.** The metric rule kept the previous incumbents,
because the corrected models scored within the promotion margin
(e.g. MRSA 0.948 vs 0.946). The incumbents had been trained and evaluated on the
dataset that contained the leak. Between two models that perform the same, the
one evaluated on a clean split is the better model, so they were promoted on
dataset integrity through `scripts/promote_clean_dataset_models.py`, which
records that reason on the model row. The promotion rule in `registry.py` was
**not** changed.

Four models (`RF-mrsa-v3`, `RF-ecoli-v3`, `RF-kpneumoniae-v4`, `RF-mtb-v4`) were
REJECTED with the reason recorded: they were trained before the split was
recomputed, so their metrics are not reproducible from the stored dataset.

## 7. Docking coverage

| Measure | Value |
| --- | ---: |
| Medicines docked successfully | **53** of 1,691 scored (3.1%) |
| Ligand–target pairs | 85 |
| Stored poses | 761 |
| Targets | 4 (one per pathogen) |
| Medicines whose docking failed | 1 |
| Docking runs | 12 — 10 SUCCESS, 2 INTERRUPTED (from an earlier session; their completed poses are retained and valid) |
| Engine | AutoDock Vina v1.2.5, exhaustiveness 8, 9 modes, seed 42 |

Targets: `sa_dhfr` (MRSA), `ec_dhfr` (*E. coli*), `kp_kpc2` (KPC-2 carbapenemase,
*K. pneumoniae*), `mtb_inha` (InhA, *M. tuberculosis*). Binding sites are derived
from each structure, never hard-coded.

Large or highly flexible ligands are excluded by the flexibility guard before
Vina runs (63 excluded for `sa_dhfr`, 74 for `mtb_inha` in this pass). That is a
deliberate limit, recorded, not a silent failure.

−7.0 kcal/mol is labelled on the page as **this project's screening target**,
explicitly not a universal cutoff.

## 8. Resistance-phenotype coverage

From `bioactivity` where a label exists, counting records whose assay text names
a resistant strain:

| Pathogen | Resistant-strain records | Labelled records | Coverage |
| --- | ---: | ---: | ---: |
| MRSA | 1,212 | 9,377 | **12.9%** |
| *K. pneumoniae* | 1,181 | 8,472 | **13.9%** |
| *M. tuberculosis* | 143 | 7,654 | **1.9%** |
| *E. coli* | 0 | 9,729 | **0.0%** |
| **Overall** | **2,536** | **35,232** | **7.2%** |

The models therefore learn **species-level antibacterial activity**, not
validated activity against the resistant phenotype. The dataset sanity check
raises this as a warning for all four pathogens, and the wording on the model
pages says so. Nothing in the system claims the model predicts resistance.

## 9. Test results

```
./.venv/Scripts/python.exe -m pytest tests/ -o addopts="" -q
```

| Run | Result | Duration |
| --- | --- | ---: |
| Baseline, before any change | 337 passed, 0 failed | 344 s |
| After the fixes | 351 passed, 0 failed | 472 s |
| After the remaining two count fixes | 354 passed, 0 failed | 250 s |
| **Final** | **356 passed, 0 failed, 0 skipped, 2 warnings** | **247 s** |

The two warnings are sklearn's note about a single-label confusion matrix inside
a test that deliberately evaluates a degenerate set.

19 tests were added. One existing assertion was changed:
`test_counts_shown_to_the_reader_come_from_the_database` asserted that coverage
was *incomplete* (`medicines_total > medicines_checked`). Full coverage made that
false. It now asserts the relationship that must always hold
(`0 < checked <= total`, `with_records <= checked`), which is a stronger
statement than the one it replaced. No test was deleted or weakened.

## 10. Browser QA

`python -m scripts.responsive_qa` — Playwright, Chromium, real viewports, DOM
measured rather than eyeballed.

| Measure | Result |
| --- | --- |
| Checks | 52 (13 pages × 1440, 1024, 760, 400 px) |
| Pages with `scrollWidth > clientWidth` | **0** |
| Elements overflowing outside a scrollable ancestor | **0** |
| Pages rendering suspiciously little text | **0** (minimum 901 characters) |
| Console errors | 96, all one kind (below) |

The console errors are all `404` on `/<page>/_stcore/health` and
`/<page>/_stcore/host-config`. Streamlit resolves those probes relative to a
deep-linked path; they occur only on a direct load of a sub-path, the app
recovers, and no functionality is affected. This is Streamlit's own behaviour
and was not worked around by patching the framework.

Earlier passes flagged elements inside Streamlit's table grid and chart frames.
Those scroll inside their own containers by design, which is why the check now
walks the ancestor chain before reporting an element.

## 11. Performance

`python -m scripts.performance_qa --repeats 2` at 1440px — navigation until the
page's text stops changing.

| Page | Median |
| --- | ---: |
| Case Study | 913 ms |
| Pipeline | 1,125 ms |
| Model & Dataset | 1,692 ms |
| Clinical Evidence | 2,317 ms |
| Docking & 3D | 2,486 ms |
| Medicine × Disease | 2,717 ms |
| Molecular Analysis | 2,908 ms |
| Overview | 3,042 ms |
| Drug Screening | 3,237 ms |
| Run History | 3,290 ms |
| Retraining | 3,514 ms |
| Candidate Explorer | 3,590 ms |
| Drug Details | 4,312 ms |

Median across pages 2,908 ms; slowest Drug Details at 4,312 ms. The cost is
Streamlit's render-and-stream cycle rather than the queries, which run against a
local SQLite file. No architecture was rewritten on the strength of this.

## 12. Scientific safeguards verified

- **Language scan.** Every occurrence of *cure, guaranteed, proven treatment,
  clinically proven, will treat, safest, best medicine, winner, effectiveness,
  clinical success, success probability, treatment probability* across `app/`,
  `src/`, `docs/` and `README.md` is either the guard list itself
  (`FORBIDDEN_PERCENT_LABELS`) or a negation the interface needs in order to
  explain its limits. No unsupported claim found.
- **Percentage gate.** `match_modelled_pathogen("Migraine")` → `None`, and
  `medicine_disease_evidence(TOPIRAMATE, "Migraine")` returns
  `prediction=None` with documented trial evidence. `"MRSA"` → `mrsa`, and a
  probability appears. Verified by execution, not by reading.
- **Evidence separation.** `was_checked` and the trial streams are returned
  independently, so *not yet checked*, *no evidence found* and *no effect*
  cannot collapse into one another.
- **Comparison.** No ranking, score or recommendation is produced in compare
  mode; `src/ranking/rank.py` states the same constraint in code.
- **No hard-coded scientific numbers.** Enforced by test for the explorer and
  now also for the docking view.
- **Docking honesty.** Project screening target labelled as such; coverage
  denominator stated; failures persisted rather than hidden.
- **New in this pass:** a probability for a medicine the model trained on is
  now labelled as such on Drug Details.

## 13. Demo

**Primary candidate: LEVOKETOCONAZOLE × *M. tuberculosis*.**
Approved as RECORLEV for endogenous Cushing's syndrome (FDA Orange Book,
30 Dec 2021). AI-predicted activity **0.812** (RF-mtb-v5). Docking **−9.685
kcal/mol** against InhA (PDB 4TZK chain A, site derived from bound ligand 641).
Six registered trials, all for Cushing's syndrome or healthy-subject
pharmacology. No measured activity against *M. tuberculosis* in this database,
and no label in any split — so the score is a prediction, not recall.

The caveat that must be said out loud: ketoconazole, the same structure without
the single-enantiomer purification, **is** in the training set as active against
*M. tuberculosis*. The model is recognising chemistry it has seen. That is a
sound way to raise a hypothesis and an unsound way to announce a result.

**Control: CIPROFLOXACIN × *K. pneumoniae*.** Probability 1.000 (renders as
`>99%`), held out in the **test** split with 294 measurements behind its label,
docking −8.331 kcal/mol against KPC-2, 50 registered trials. It shows the model
ranking a known agent highly on data it never trained on.

**Fallback: GATIFLOXACIN × MRSA** — test split, −9.37 kcal/mol.

The walkthrough, with the exact navigation, the expected values, what to say and
what never to claim, is in **[DEMO.md](DEMO.md)**.

## 14. Remaining limitations

Stated, not smoothed over:

1. **Resistance phenotype.** 7.2% overall, 0.0% for *E. coli*. Species-level
   activity only.
2. **Docking covers 53 of 1,691 medicines.** Everything else is *not yet
   docked*.
3. **Publication bias.** ChEMBL over-represents actives (prevalence 0.53–0.80 in
   the test splits), so absolute metrics flatter the models. This is why
   selection uses the prevalence-adjusted metric.
4. **One target per pathogen.** A compound may act through a mechanism the
   chosen target does not represent.
5. **Rigid-receptor docking**, no solvation, no cell entry.
6. **Name-based drug mapping.** Combination products resolve on one component,
   recorded in `match_method`.
7. **A dataset version identifies membership, not the split.** Two models
   sharing a dataset version were not necessarily evaluated on the same
   partition. Handled here by rejecting the affected models; the id scheme
   itself was not changed.
8. **The clinical query is a name search.** A medicine's trials are found by
   intervention name, so a study that names only a brand or a salt form may be
   missed. Not quantified — **NOT VERIFIED**.
9. **Not built, and listed as future work in the presentation:** graph neural
   networks, combination therapy and adjuvants, multi-disease models, the
   IP / 505(b)(2) angle.

**NOT VERIFIED in this pass:** a full clean-machine install from an empty
`.venv` (the existing environment was used throughout); keyboard-navigation and
contrast auditing beyond what the component code specifies; any claim about
how the system behaves offline beyond the `AMR_OFFLINE=1` code path.

## 15. Clean-start verification

The Streamlit process was stopped and restarted twice during this pass, most
recently before the final QA sweep. All 13 pages then loaded from a cold process
with no hidden state, no manual inserts and no demo rows — the 52-check sweep in
§10 is that verification, and the minimum text rendered on any page was 901
characters.

The database needed no repair and no manual data. `data/demo/amr_demo.sqlite`
remains available for a network-free demo via `scripts/build_demo.py`.

## 16. Website handoff

**[WEBSITE_UI_HANDOFF.md](docs/WEBSITE_UI_HANDOFF.md)** specifies the production
website: the rules it inherits, its information architecture across 13 areas,
the full reusable-component inventory with states, responsive behaviour and
accessibility requirements per component, the conceptual data contract for 12
object types, the nine distinct UI states, and the design direction.

Nothing in it has been built. The Streamlit dashboard remains the research
prototype and was not redesigned.

## 17. Recommended next step

Hand `docs/WEBSITE_UI_HANDOFF.md` to the website design phase, and start with the
evidence primitives — badge, ladder, activity indicator, limitation callout.
They are where the honesty rules live, and every other component depends on
them.

On the science side, the next step for levoketoconazole is a wet-lab MIC assay
against *M. tuberculosis*. Nothing in this system substitutes for that.
