# AMR Drug Repurposing

**AI-driven screening of approved drugs against antimicrobial-resistant pathogens.**

A working research prototype that ingests real bioactivity and regulatory data,
trains and benchmarks machine-learning models on 1024-bit Morgan fingerprints,
docks prioritised candidates with AutoDock Vina, attaches retrospective clinical
context, and presents everything in a scientific dashboard.

> **Scientific boundary.** Everything this system produces is a *computational
> prediction*. Model probabilities and docking scores are hypotheses for
> experimental validation. They are **not** evidence of clinical efficacy or
> safety, and nothing here should be read as a claim that a drug treats or cures
> any disease.

---

## 1. Project overview

Antimicrobial resistance outpaces new antibiotic discovery. Repurposing already
approved drugs shortens the path to the clinic because the pharmacology, dosing
and human safety profile are already characterised.

This project screens the FDA-approved drug library against four priority
pathogens:

| Pathogen | Organism |
|---|---|
| MRSA | *Staphylococcus aureus* (methicillin-resistant) |
| E. coli | *Escherichia coli* |
| K. pneumoniae | *Klebsiella pneumoniae* |
| M. tuberculosis | *Mycobacterium tuberculosis* |

## 2. Scientific concept

```
COLLECT  ->  DECODE  ->  PREDICT  ->  VALIDATE  ->  DELIVER
```

| Stage | What happens |
|---|---|
| **Collect** | ChEMBL bioactivity, FDA Orange Book approvals, ClinicalTrials.gov records |
| **Decode** | RDKit standardisation, 1024-bit Morgan fingerprints, descriptors |
| **Predict** | Random Forest baseline plus a benchmarked model zoo, per pathogen |
| **Validate** | AutoDock Vina against one validated protein target per pathogen |
| **Deliver** | Streamlit dashboard with full provenance on every number |

## 3. Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full module map, data
model, selection protocol and automation rules.

```
src/ingestion   ChEMBL, FDA Orange Book, HTTP client
src/chemistry   standardisation, fingerprints, descriptors, depiction
src/ml          labelling, datasets, splits, models, training, registry, sanity
src/docking     receptor prep, ligand prep, Vina
src/clinical    ClinicalTrials.gov
src/ranking     evidence assembly and composite scoring
src/pipeline    the runnable stages
app             Streamlit dashboard
```

## 4. Data sources

| Source | Endpoint | Used for |
|---|---|---|
| **ChEMBL** | `https://www.ebi.ac.uk/chembl/api/data` | bioactivity (training labels) and approved molecules with structures |
| **FDA Orange Book** | `https://www.fda.gov/media/76860/download?attachment` | approved human drug products |
| **openFDA Drugs@FDA** | `https://api.fda.gov/drug/drugsfda.json` | fallback approved-drug source |
| **ClinicalTrials.gov v2** | `https://clinicaltrials.gov/api/v2/studies` | retrospective human clinical history |
| **RCSB PDB** | `https://files.rcsb.org/download/{id}.pdb` | docking target structures |

No API keys are required. The source actually used for each record is stored in
`data_sources` and on the row itself, so the dashboard never overstates
provenance.

> The FDA content CDN returns 404 to non-browser user agents on its public data
> files, so the Orange Book fetch presents a browser UA. It is a public dataset
> with no authentication.

## 5. Dataset construction

Bioactivity records are filtered to whole-organism and direct-target endpoints
(MIC, MIC50, MIC90, MBC, IC50, EC50, Ki, Kd) with usable units, joined to a
parseable structure, labelled, then aggregated to **one row per
(compound, pathogen)**.

Each dataset version is content-addressed: identical data and configuration
produce an identical version identifier, and every model records the dataset
version it was trained on.

## 6. Label methodology

Full rationale: **[docs/LABELING.md](docs/LABELING.md)**. In brief:

- All potencies convert to `pActivity = -log10(molar)`.
- `pchembl_value` is used when ChEMBL provides it; µg/mL converts via the
  RDKit-computed molecular weight.
- **Active** ≥ 5.0 (10 µM), **inactive** ≤ 4.0 (100 µM); the band between is
  **ambiguous and excluded from training**, not forced into a class.
- **Censored relations are honoured**: `MIC > 128 µg/mL` can only support an
  inactive call; `MIC < 0.5 µg/mL` can only support an active one.
- Repeat measurements aggregate by **median**; labels by majority vote.
- A pathogen with insufficient data **gets no model**, and the reason is
  reported.

## 7. Installation

Requires Python 3.11+.

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -e .
pip install -e ".[dev]"        # test dependencies
```

Core dependencies are pinned in `pyproject.toml`: rdkit, pandas, numpy, scipy,
scikit-learn, joblib, streamlit, plotly, requests, PyYAML, meeko, py3Dmol.

### AutoDock Vina (optional but recommended)

Docking needs the Vina executable. Download the binary for your platform from
the [AutoDock Vina releases](https://github.com/ccsb-scripps/AutoDock-Vina/releases)
and either place it at `tools/vina` (`tools/vina.exe` on Windows) or point
`AMR_VINA_BIN` at it.

```bash
# Linux / macOS
mkdir -p tools && curl -L -o tools/vina \
  https://github.com/ccsb-scripps/AutoDock-Vina/releases/download/v1.2.5/vina_1.2.5_linux_x86_64
chmod +x tools/vina

# Windows
curl -L -o tools/vina.exe \
  https://github.com/ccsb-scripps/AutoDock-Vina/releases/download/v1.2.5/vina_1.2.5_win.exe
```

Receptor preparation additionally needs `gemmi`, which installs with Meeko:
`pip install gemmi`.

**If Vina is unavailable the pipeline still runs.** The docking stage records
the limitation and every other stage completes normally.

## 8. Environment setup

Copy `.env.example` to `.env`. Nothing is required; every variable is optional.

| Variable | Purpose |
|---|---|
| `AMR_CONTACT_EMAIL` | appended to the User-Agent sent to public APIs |
| `AMR_DB_PATH` | override the SQLite location (used for demo mode) |
| `AMR_VINA_BIN` | absolute path to the Vina executable |
| `AMR_OFFLINE` | `1` blocks all outbound network calls |

Never commit `.env`.

## 9. Training

```bash
python -m src.pipeline.train              # Random Forest baseline only
python -m src.pipeline.train --benchmark  # train and compare the full model zoo
python -m src.pipeline.train --check      # report whether retraining is due
```

Protocol: one scaffold-aware split; every candidate trained on TRAIN and scored
on VALIDATION; selection made on VALIDATION alone; the selection refit on
TRAIN+VALIDATION and scored **once** on TEST. Random Forest is always trained
and always recorded as the baseline.

Models are compared on **prevalence-adjusted PR-AUC**, because raw PR-AUC is
bounded below by class prevalence and is not comparable across datasets with
different balance. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 10. Prediction

```bash
python -m src.pipeline.predict                                  # screen what is new
python -m src.pipeline.predict --all                            # rescore everything
python -m src.pipeline.predict --smiles "CC(=O)Oc1ccccc1C(=O)O" # ad-hoc, nothing stored
```

## 11. Incremental updates

```bash
python -m src.pipeline.run --incremental
```

Refreshes the approved-drug library, processes only unprocessed molecules, and
screens only unscored ones. Bulk bioactivity is not re-pulled.

## 12. Retraining

**A new drug never triggers retraining.** It is fingerprinted and scored with
the model that already exists.

Retraining is driven by **new labelled bioactivity data**:

```bash
python -m src.pipeline.train --check       # is retraining due?
python -m src.pipeline.train --benchmark   # train, evaluate, compare, promote
```

A challenger is promoted only if it clears the absolute quality floors **and**
beats the incumbent by the configured margin. A worse model never replaces a
better one; it is kept as a `CANDIDATE` with the decision recorded.

## 13. Docking

```bash
python -m src.pipeline.dock                       # all targets
python -m src.pipeline.dock --target sa_dhfr --limit 10
```

Targets are declared in [`configs/targets.yaml`](configs/targets.yaml) with the
PDB entry, chain, binding-site definition and a written selection rationale. The
search box is computed from the structure itself, never hard-coded.

The `-7.0 kcal/mol` figure from the project brief is exposed as a **configurable
display threshold**, not a scientific cutoff.

Ligands above `docking.max_ligand_rotatable_bonds` / `max_ligand_heavy_atoms`
are skipped, because Vina's search neither converges nor stays reliable on very
flexible molecules. The number skipped is reported per target, and those
compounds still receive ML predictions — they simply carry no docking evidence.

## 14. Clinical evidence

```bash
python -m src.pipeline.clinical --limit 50          # shortlisted candidates only
python -m src.pipeline.clinical --all --limit 5000  # the whole approved library
python -m src.pipeline.clinical --retry-failed      # only the ones that errored
python -m src.pipeline.clinical --refresh --limit 200   # re-query, refresh records
```

The stage is **resumable**. Each medicine is committed before the next lookup
starts, and a medicine already recorded in `clinical_queries` is skipped, so an
interrupted sweep is restarted by running the same command again. `--delay`
(default 0.35 s) paces the requests; the full library takes roughly 25 minutes.

Orange Book ingredient strings are normalised into a registry search term before
the request — combination products are named like
`TRISULFAPYRIMIDINES (SULFADIAZINE; SULFAMERAZINE)`, and the bracket has to come
off or the registry answers HTTP 400.

A lookup that fails is stored with `status = 'failed'` and its error, not
silently dropped, which is what makes `--retry-failed` meaningful.

Queries ClinicalTrials.gov for the selected medicines. Trials are tagged
`amr_related` only when the study's **own** title or conditions name an
infection context — intervention text is deliberately excluded, so an antibiotic
given as background therapy in an oncology trial is not miscounted as AMR
evidence.

Drugs that return nothing are still recorded, so the dashboard distinguishes
**"no trials found"** from **"never looked"**.

## 15. Dashboard

```bash
streamlit run app/streamlit_app.py
```

See `docs/CODEBASE_MAP.md` for a file-by-file map of the repository.

Thirteen pages: Overview, Drug screening, Candidate explorer, Drug details,
Case study, Medicine x Disease, Molecular analysis, Docking and 3D, Clinical
evidence, Model and dataset, Pipeline, Retraining and Run history.

Medicine x Disease answers "could this medicine matter for this condition?" from
stored evidence only. It grades each pairing Clinical, Experimental,
Computational, No evidence found or Not yet checked, and shows a probability only
where a trained model exists - that is, for the four bacteria and nothing else.

Opening the dashboard performs **no computation** beyond reading stored results.

[DEMO.md](DEMO.md) is a scripted walkthrough of the dashboard with the exact
navigation, the demo candidate and the expected values.
[WEBSITE_UI_HANDOFF.md](docs/WEBSITE_UI_HANDOFF.md) specifies the production website
that will be built from this prototype; nothing in it is built yet.

### Demo mode

```bash
python scripts/build_demo.py
AMR_DB_PATH=data/demo/amr_demo.sqlite streamlit run app/streamlit_app.py
```

Builds a deterministic subset of a completed run with every row flagged
`is_demo = 1`, so the dashboard shows a **DEMO DATA** banner. It contains real
data, clearly labelled — nothing is fabricated — and needs no network access.

## 16. Testing

```bash
pytest                          # full suite
pytest tests/test_labeling.py   # one module
pytest -q --tb=short
```

The suite covers SMILES validation and canonicalisation, salt stripping,
fingerprint generation and round-tripping, descriptors, the full labelling
strategy including censored relations, scaffold-split integrity and leakage,
the model zoo, evaluation metrics on degenerate inputs, registry promotion
rules, ranking, database constraints, API parsing against malformed and failing
responses, docking site derivation and Vina output parsing, and an end-to-end
run from raw records to ranked candidates.

No test touches the network or the project database.

## 17. Limitations

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for the full statement. The most
important:

- **Publication bias.** ChEMBL over-represents actives; absolute metrics must be
  read against the class prevalence, which the dashboard displays.
- **Susceptible-strain data — the most important caveat.** Only **7.2%** of the
  35,232 labelled records come from an assay that explicitly names a resistant
  strain (MRSA 12.9%, K. pneumoniae 13.9%, M. tuberculosis 1.9%, **E. coli
  0.0%**). A model trained on them predicts *antibacterial activity against the
  species*, **not** *activity against the resistant phenotype*. A high MRSA
  probability means the compound resembles chemistry that inhibits
  *S. aureus* — not that it overcomes methicillin resistance. The dashboard
  states this fraction on the Overview page, on each pathogen card and in a
  dedicated Resistance evidence tab.
- **Rigid-receptor docking without cofactors.** Scores describe an apo pocket
  and do not model protein flexibility, solvation or entry into the bacterial
  cell.
- **One target per pathogen.** A compound may act through a mechanism this
  target does not represent.
- **Name-based drug mapping.** Orange Book ingredients map to structures by
  normalised name; combination products resolve on one component, recorded in
  `match_method`.
- **Docking covers a shortlist, not the library.** Only the top-ranked
  candidates per target are docked, and the ligand flexibility guard excludes
  anything too large or too flexible for a reliable Vina search. Everything else
  is *not yet docked*, which is not the same as docked and found unpromising.
  The Docking page states the live coverage and its denominator.
- **A dataset version identifies its membership, not its split.** The version id
  is a hash of the (molecule, pathogen, label) triples. The train/validation/test
  assignment is rewritten by each training run, so two models sharing a dataset
  version were not necessarily evaluated on the same partition. When a dataset is
  rebuilt, models trained against the previous split should be rejected rather
  than left as comparable candidates.
- **Superseded predictions stay in the database.** `predictions` is unique per
  (molecule, pathogen, **model version**), so a retrain adds a generation rather
  than replacing one. The dashboard filters every prediction query to the ACTIVE
  model; anything reading `predictions` directly must do the same or one medicine
  will appear with two different probabilities.

## 18. Scientific interpretation

| The system says | It means | It does **not** mean |
|---|---|---|
| ML probability 0.92 | structurally similar to compounds active against this **species** in published assays | the drug works, or that it overcomes resistance |
| Docking score −9.1 | the pose scored well in a rigid-receptor calculation | the drug binds in vivo |
| 12 clinical trials | the compound has registered human clinical history | it has been tested against resistant infection |
| Rank 1 | highest combined computational evidence in this run | it is the best drug |

Approved vocabulary: *predicted candidate*, *computationally promising*,
*prioritised candidate*, *candidate for experimental validation*. Never *best
drug*, *winner*, *confirmed treatment* or *cure*.

## 19. Commands

```bash
# Install
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# Pipeline stages
python -m src.pipeline.ingest              # ChEMBL + FDA Orange Book
python -m src.pipeline.process             # standardise, fingerprint, label
python -m src.pipeline.train --benchmark   # train, compare, promote
python -m src.pipeline.predict             # screen with the active model
python -m src.pipeline.predict --all       # rescore everything after a promotion
python -m src.pipeline.dock                # AutoDock Vina on top candidates
python -m src.pipeline.clinical            # ClinicalTrials.gov evidence

# Orchestration
python -m src.pipeline.run                 # everything, in order
python -m src.pipeline.run --incremental   # only what is new
python -m src.pipeline.run --skip-dock     # skip a stage
python -m src.pipeline.train --check       # retraining status

# Dashboard
streamlit run app/streamlit_app.py
python scripts/build_demo.py               # deterministic offline demo

# Utilities
python scripts/check_environment.py        # diagnose packages, Vina, network
python scripts/backfill_curves.py --active # regenerate stored ROC/PR curve points
python scripts/responsive_qa.py            # measured layout QA at 1440/1024/760/400px
python -m scripts.promote_clean_dataset_models --dry-run   # promote on dataset integrity

# Tests
pytest
```

`backfill_curves.py` recomputes a stored evaluation from the saved model
artefact and the recorded test partition. It verifies that the recomputed
ROC-AUC reproduces the stored value before writing anything, and skips the model
if it does not — so it can never attach a chart that disagrees with the metric
beside it.

## 20. Reproducibility

- Dependencies pinned in `pyproject.toml`.
- Every scientific threshold lives in `configs/config.yaml` and is hashed into
  the dataset version.
- A single `random_seed` governs splitting, model initialisation, conformer
  generation and the Vina search.
- Each model records its Python, NumPy, scikit-learn and RDKit versions, its
  dataset version, feature version, split method, partition sizes and the
  decision that promoted or rejected it.
- Each docking run records the engine version, exhaustiveness, seed, box centre
  and size, and the receptor file used.
- Each prediction records the model version, model type, dataset version,
  feature version and timestamp.

## Licence and data attribution

Code in this repository is a research prototype. The data it retrieves belongs
to its sources and remains under their terms: ChEMBL (EMBL-EBI, CC BY-SA), the
FDA Orange Book and openFDA (US public domain), ClinicalTrials.gov (NIH), and
the RCSB Protein Data Bank.
