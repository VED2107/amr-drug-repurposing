# Architecture

## Pipeline

```
                        DATA SOURCES
                             |
        +--------------------+--------------------+
        |                    |                    |
     ChEMBL           FDA Orange Book      ClinicalTrials.gov
  (bioactivity)      (approved drugs)     (clinical history)
        |                    |                    |
        +--------------------+                    |
                             v                    |
                    1. DATA INGESTION             |
                             v                    |
                    2. MOLECULAR PROCESSING       |
                       RDKit standardisation      |
                       1024-bit Morgan FP         |
                       descriptors + labels       |
                             v                    |
                    3. AI PREDICTION              |
                       dataset versioning         |
                       scaffold split             |
                       RF baseline + benchmark    |
                       selection + promotion      |
                             v                    |
                    4. CANDIDATE SCREENING        |
                       approved-drug library      |
                             v                    |
                    5. MOLECULAR DOCKING          |
                       AutoDock Vina              |
                             v                    |
                    6. CLINICAL EVIDENCE  <-------+
                             v
                    7. STREAMLIT DASHBOARD
```

Each numbered stage is a standalone module under `src/pipeline/`, runnable on
its own and recorded in `pipeline_runs`.

## Module map

| Path | Responsibility |
|---|---|
| `src/config.py` | Typed configuration, path resolution, Vina discovery |
| `src/db.py` | SQLite schema, connections, provenance helpers |
| `src/logging_utils.py` | Console + file logging |
| `src/ingestion/http.py` | Retries, backoff, rate limits, offline mode |
| `src/ingestion/chembl.py` | Bioactivity and approved-molecule retrieval |
| `src/ingestion/orange_book.py` | FDA approved products; name→structure mapping |
| `src/chemistry/standardize.py` | Validate, sanitise, desalt, canonicalise, scaffold |
| `src/chemistry/fingerprints.py` | 1024-bit Morgan fingerprints, blob packing |
| `src/chemistry/descriptors.py` | Physicochemical properties, Lipinski |
| `src/chemistry/depict.py` | 2D SVG depiction |
| `src/ml/labeling.py` | pActivity conversion and label assignment |
| `src/ml/dataset.py` | Versioned datasets, quality audit |
| `src/ml/splits.py` | Scaffold-aware splitting, leakage checks |
| `src/ml/models.py` | Model zoo, availability gating |
| `src/ml/evaluate.py` | Metrics, curves, calibration |
| `src/ml/train.py` | Benchmark protocol, selection, artefacts |
| `src/ml/registry.py` | Versions, states, promotion rules |
| `src/ml/predict.py` | Screening with the active model |
| `src/ml/sanity.py` | Scientific sanity checks |
| `src/docking/receptor.py` | Structure fetch, binding site, receptor PDBQT |
| `src/docking/ligand.py` | 3D embedding, ligand PDBQT |
| `src/docking/vina_runner.py` | Vina execution and output parsing |
| `src/clinical/evidence.py` | ClinicalTrials.gov v2 client |
| `src/ranking/rank.py` | Evidence assembly, composite score |
| `app/` | Streamlit dashboard |

## Data model

Every result carries provenance. The joins that matter:

```
molecules (molecule_id = InChIKey)
   |  1:N   drugs              approved products mapped to this structure
   |  1:N   bioactivity        measured activity, labelled
   |  1:N   predictions        model output + model/dataset/feature version
   |  1:N   docking_results    pose scores + run parameters
   |  1:N   clinical_trials    registered human studies
   |  1:1   clinical_queries   records that a lookup happened at all
```

`molecule_id` is the standard InChIKey when RDKit can produce one, else a
`SMI-`-prefixed hash of the canonical SMILES, so the fallback is always visible
in the data.

`clinical_queries` exists so the dashboard can distinguish **"no trials found"**
from **"never looked"** — two very different states that a missing row would
conflate.

## Model selection protocol

1. **Split once**, scaffold-aware: TRAIN / VALIDATION / TEST.
2. **Train every candidate on TRAIN**, evaluate on VALIDATION.
3. **Cross-validate on TRAIN** for a stability estimate.
4. **Select on VALIDATION only.** The test set is never consulted while
   choosing a model — that is what makes the final number honest.
5. **Refit the selection on TRAIN + VALIDATION**, evaluate **once** on TEST.
   Every candidate is refit and scored at this same final step so the
   comparison table reports like-for-like numbers.
6. **Compare with the incumbent** and promote only if the acceptance criteria
   pass.

Random Forest is always trained and always recorded as the baseline, whether or
not it wins.

### Why selection compares prevalence-adjusted PR-AUC

PR-AUC is bounded below by the class prevalence: a random ranker scores exactly
the prevalence. Raw PR-AUC is therefore **not comparable across datasets with
different class balance**.

This is not hypothetical. During development, a K. pneumoniae model trained on a
small early dataset scored a raw PR-AUC of **0.994** — on a test set that was
**98.5% positive**, where random scores 0.985. A far better model trained on the
full dataset scored **0.9938** on a 75%-positive test set. Comparing the raw
values kept the weak model in service. The fix is to compare

```
pr_auc_normalized = (pr_auc - prevalence) / (1 - prevalence)
```

which rescales the achievable range to 0..1. On that scale the two models score
**0.63** and **0.98**. The acceptance floors apply to the adjusted value for the
same reason.

### Model states

| State | Meaning |
|---|---|
| `ACTIVE` | serves predictions; at most one per pathogen |
| `CANDIDATE` | benchmarked, not promoted |
| `ARCHIVED` | was active, superseded |
| `REJECTED` | failed the acceptance criteria |

### Promotion rules

A challenger is promoted only if **all** hold:

- prevalence-adjusted PR-AUC ≥ `min_acceptable_pr_auc`
- ROC-AUC ≥ `min_acceptable_roc_auc`
- it beats the incumbent by at least `promotion_margin`

Otherwise the incumbent stays active. **A worse model never replaces a better
one.**

## Automation rules

Two distinct events, deliberately kept separate:

| Event | Response |
|---|---|
| **A new drug appears** | normalise → validate SMILES → fingerprint → score with the **existing** model → store. **No retraining.** |
| **New labelled bioactivity data appears** | new dataset version → train candidate → evaluate → compare → promote only if better |

If 1,000 new drugs arrive, 1,000 predictions are produced and zero models are
retrained. Screening is incremental: a molecule already scored by the active
model is not rescored.

## Docking

The search box is **never hard-coded**. It is derived at preparation time from
the structure itself:

- `site_mode: ligand` — centroid of a named co-crystallised HETATM residue.
- `site_mode: residues` — centroid of named catalytic residues, used where the
  deposited structure has no informative bound ligand.

If a named ligand or residue is absent, preparation **fails loudly** rather than
silently docking into a shifted box, which would produce plausible but
meaningless scores.

Receptors are prepared as rigid single chains with Meeko (Gasteiger charges,
AutoDock atom typing). Waters, buffer molecules and cofactors are excluded, and
each target's notes state that, so a score is never read as including cofactor
contacts.

A ligand flexibility guard skips candidates above the configured rotatable-bond
and heavy-atom bounds, and a per-ligand timeout bounds the rest. Rotatable bonds
drive the cost: rifampin (59 heavy atoms, 4 rotatable bonds) docks in seconds,
telithromycin (58 heavy atoms, 11 rotatable bonds) did not converge within 600
seconds. Skipped compounds are counted and reported per target rather than
quietly dropped, and a ligand that does exceed the ceiling is recorded as a
timeout rather than reported with a partial score.

Docking runs left `RUNNING` by a process that ended are closed out as
`INTERRUPTED` at the start of the next run. Poses they had already scored are
kept: they are real results.

### Targets

| Pathogen | Protein | PDB | Site |
|---|---|---|---|
| MRSA | Dihydrofolate reductase (folA) | 3FRE | trimethoprim (TOP) |
| E. coli | Dihydrofolate reductase (folA) | 1RX2 | folate (FOL) |
| K. pneumoniae | KPC-2 carbapenemase | 2OV5 | catalytic residues 70, 73, 130, 166, 234 |
| M. tuberculosis | Enoyl-ACP reductase (InhA) | 4TZK | co-crystallised inhibitor (641) |

## Ranking

The composite score is an **explicit, configurable weighted sum** of normalised
evidence components, renormalised over the components actually available:

```
score = Σ(weight_i × component_i) / Σ(weight_i)   over present components only
```

Components: ML probability, docking score, drug-likeness, clinical history.
A missing component leaves a null rather than a zero, so **"not docked" never
looks like "docked badly"**. `evidence_weight` reports what fraction of the
configured evidence was actually available, so a score built from one weak
signal is visibly different from a complete one.

The score orders a worklist. It measures nothing biological.

## Performance

Opening the dashboard performs no computation beyond reading stored results. It
never retrains, redocks, refetches or recomputes a fingerprint. All views read
through `st.cache_data` with a short TTL.

Every stage is incremental:

- molecules are fingerprinted once, keyed on `feature_version`
- predictions are keyed on `(molecule_id, pathogen_key, model_version)`
- a compound already docked against a target is not redocked
- clinical lookups are recorded so they are not repeated

## Error handling

One failed record never aborts a batch. Per-item failures are written to
`pipeline_errors` with their subject and reason, and the stage finishes with
status `PARTIAL`. A stage that cannot run at all — no Vina binary, no network —
records `SKIPPED` with the reason and the rest of the pipeline continues.
