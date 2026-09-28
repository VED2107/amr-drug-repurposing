# Website UI handoff specification

**Status:** the rules in §0, §4 and §6 still govern the website. The
information architecture in §1 is **superseded** (2026-09-28): the production
site in `web/` is now two views. `/` is the search, three counts, the four
pathogens and the registered studies. `/investigate` covers a medicine or a
condition, and each condition lists documented medicines separately from
other medicines with AI-predicted activity ≥40%. The ≥40% floor is a website
discovery threshold only (`web/src/lib/science.ts:DISCOVERY_THRESHOLD`). It is
not the models' decision boundary and not the pipeline's 0.60 candidate
threshold.
**Audience:** whoever designs and builds the production website.
**Source of truth for behaviour:** the Streamlit research prototype in `app/`,
the scientific rules in `CLAUDE.md`, and `docs/LIMITATIONS.md`.

The Streamlit dashboard is a research instrument. It is correct and it is
honest, but it is laid out the way a tool is laid out. The production website
has a different job: explain an AMR drug-repurposing framework to people who are
not cheminformaticians, and let them interrogate real results without coming
away with a false belief.

This document describes what that website needs. It does not prescribe a visual
style beyond the constraints in §7, and it does not authorise any change to what
the system is allowed to claim.

---

## 0. The rules the website inherits

These are not design preferences. Each one is enforced in the prototype's code
and covered by a test, and the website must reproduce every one of them. A
design that breaks one of these is wrong, however good it looks.

1. **No number is fabricated.** Every figure on every screen comes from the
   database at render time. No placeholder metrics, no seeded example rows, no
   "illustrative" charts.
2. **A percentage always carries its meaning.** A bare `72%` next to a medicine
   name is forbidden. It renders as `72% AI-predicted activity` or not at all.
   Labels implying clinical benefit — effectiveness, success, cure, efficacy,
   treatment probability — are rejected at the component boundary.
3. **Only four bacteria may show a probability.** MRSA, *E. coli*,
   *K. pneumoniae*, *M. tuberculosis*. Every other condition gets documented
   evidence plus an explicit statement that no model exists for it. There is no
   fallback number, no extrapolation, no "estimated".
4. **Five states stay distinct and must never collapse into one another:**
   clinical evidence, experimental measurement, computational result,
   *no evidence found*, *not yet checked*.
5. **A registered trial is not a successful trial. FDA approval is not approval
   for a new indication. A docking score is not proof of binding. A prediction
   is not a treatment claim.**
6. **−7.0 kcal/mol is this project's screening target**, not a universal binding
   cutoff, and it is labelled that way wherever it appears.
7. **No winner.** Comparing two medicines produces two descriptions side by
   side. It never produces a ranking, a recommendation, a "better", or a score
   that implies one.

A component that displays a scientific quantity carries its own disclaimer. The
prototype deliberately puts the limitation next to the number rather than
collecting all limitations in a footer, because a page that only says what
happened at each step reads as a chain of proof. Keep that.

---

## 1. Information architecture

Thirteen areas, grouped. The prototype's grouping works and should survive.

| Group | Page | Job |
| --- | --- | --- |
| **Start** | Home / Overview | What this is, why AMR matters, the five stages, the four bacteria, live counts |
| **Screen** | Drug Screening | The whole scored approved library, filterable |
| | Candidate Explorer | Prioritised candidates per pathogen |
| **Explore** | Drug Details | One medicine, end to end |
| | Case Study | One candidate walked through all five stages |
| | Medicine × Disease | Three-mode evidence explorer |
| **Evidence** | Molecular Analysis | Structures and computed properties |
| | Docking & 3D | Poses, scores, targets |
| | Clinical Evidence | Registered trials and coverage |
| **System** | Models & Dataset | Metrics, benchmarks, validation method, sanity findings |
| | Pipeline | Five-stage status |
| | Retraining | What would trigger a retrain, and on what evidence |
| | Run History | Past runs, errors, provenance |
| **Future** | Research roadmap | GNN, combinations, multi-disease, IP — marked as not built |

### 1.1 Home / Overview

Components: hero; AMR problem statement; pipeline visualisation
(COLLECT → DECODE → PREDICT → VALIDATE → DELIVER); live dataset statistics;
four pathogen cards; active-model summary; one featured candidate; evidence
summary; limitations block; primary call to action into the explorer.

The hero must not carry a number that implies a result ("N cures found" is the
exact failure). It carries what the system is and what it screens.

### 1.2 Drug Screening

Search; pathogen selector; probability range filter; evidence filters (has
docking / has trials / has measurements); the activity table; sorting;
pagination; per-row activity indicator, evidence indicator, docking indicator;
row → Drug Details.

### 1.3 Candidate Explorer

Search; filters; candidate grid or list; the multi-pathogen matrix (one medicine
× four bacteria); activity indicators; evidence, docking and clinical badges;
navigation into detail. The matrix is the page's centrepiece and its cells are
the percentage-gated component (§3.9).

### 1.4 Drug Details

Medicine header (name, approved-use context, identifiers); molecule summary;
AI activity per pathogen; pathogen comparison; docking summary; clinical
evidence; evidence ladder; provenance block; an explicit
"what this page does not establish" section; related evidence.

### 1.5 Medicine × Disease Explorer

Medicine search; condition search; mode selector; the three modes
(Medicine → Condition, Condition → Medicines, Compare A vs B); the five-rung
evidence ladder; trial records; evidence badges; comparison cards; empty state;
and the unsupported-model notice that fires whenever the chosen condition is not
one of the four modelled bacteria.

Compare mode renders two independent evidence columns. No delta, no highlight of
the "stronger" side, no aggregate score.

### 1.6 Molecular Analysis

Molecule viewer (2D depiction); SMILES/InChIKey; descriptor table;
fingerprint explanation; physicochemical properties; Lipinski summary; a panel
explaining what a fingerprint is and what similarity does not imply.

ADMET indicators are listed in the brief; **the current system computes no ADMET
predictions.** Either omit the component or render it as an explicit future-work
placeholder. Do not populate it.

### 1.7 Docking & 3D

3D receptor + ligand viewer; binding-site display; pose selector; docking score;
target information (PDB id, binding-site derivation); the project-target
indicator for −7.0 kcal/mol; engine/version/seed provenance; the computational
evidence disclaimer; and the docking-coverage statement (only a subset of
candidates has been docked).

### 1.8 Clinical Evidence

Trial search; trial cards; trial table; condition; intervention; status; phase;
enrolment; dates; NCT link; evidence summary; coverage status; and the
*not yet checked* state as a first-class rendering, never an empty cell.

### 1.9 Models & Dataset

Model registry; model cards; metrics with the selection metric named
(prevalence-adjusted PR-AUC on the validation split); dataset statistics;
pathogen coverage; validation methodology; scaffold-split explanation; leakage
status from the sanity checks; provenance. Benchmarks of rejected models belong
here — showing what lost is part of showing the choice was made honestly.

### 1.10 Pipeline · 1.11 Retraining · 1.12 Run History

Five-stage flow with per-stage inputs, outputs, evidence level, limitation and
execution status; current vs candidate model with promotion criteria and
validation metrics; run table with timestamps, type, status, records processed,
errors, model and dataset versions, and drill-down to logs.

### 1.13 Future / Research

GNN, combination therapy and adjuvants, multi-disease expansion, translational
work, IP / 505(b)(2). Every item visibly marked as **not built**. This section
must be impossible to mistake for a feature list.

---

## 2. Component inventory

Each entry: what it is for, what it takes, its states, how it behaves on a small
screen, what accessibility it needs, whether it is reusable, and whether it must
carry disclaimer text.

Unless stated otherwise, every component has the seven states in §4, degrades to
a single column below 640px, keeps interactive targets at 44px or larger,
reaches AA contrast, and is reachable and operable by keyboard with a visible
focus ring.

### Shell and navigation

| Component | Purpose | Data in | Notes | Disclaimer |
| --- | --- | --- | --- | --- |
| **App shell** | Frame: header, nav, content, footer | route, build metadata | Reusable. Skip-to-content link. | — |
| **Header** | Identity, global search, page context | product name, dataset timestamp | Search collapses to an icon below 760px. | — |
| **Sidebar / nav** | The 13 areas, grouped | route tree, active route | Becomes a drawer below 1024px; focus trapped while open; Esc closes. | — |
| **Breadcrumb** | Depth and escape route | ancestor routes | Truncates the middle, never the last crumb. | — |
| **Page header** | Title, one-line purpose, provenance chip | title, subtitle, as-of timestamp | Reusable on every page. | — |
| **Footer** | Sources, version, the standing disclaimer | data sources, build version | Carries the "research prototype, not medical advice" line. | **Yes** |

### Display and metrics

| Component | Purpose | Data in | States and notes | Disclaimer |
| --- | --- | --- | --- | --- |
| **Hero** | What the system is | headline, subhead, CTA | No result-shaped number. | — |
| **KPI card** | One live count | label, value, source | Loading skeleton; error shows last-known with an explicit staleness note or nothing at all. Never a zero standing in for a failure. | Contextual |
| **Metric grid** | 2–6 KPI cards | list of metrics | 4-up → 2-up → 1-up. | — |
| **Pathogen card** | One of the four bacteria | key, names, plain description, resistance mechanism, counts | Reusable; colour is decorative only, never the sole carrier of meaning. | — |
| **Candidate card** | One prioritised medicine | medicine, pathogen, probability, badges | Percentage rendered only through the gated component. | **Yes** |
| **Medicine card** | Compact medicine reference | name, approved-use context, identifiers | — | — |
| **Comparison card** | One side of Compare A vs B | medicine, evidence streams | Two cards are peers. No winner treatment, no accent on the "better" one. | **Yes** |
| **Model card** | One model version | version, algorithm, metrics, dataset, status | Names the selection metric. | **Yes** |
| **Dataset card** | One dataset version | version, size, split sizes, method | — | — |
| **Trial card** | One registered study | NCT id, title, conditions, interventions, phase, status, enrolment, dates, link | Status never styled as success/failure. | **Yes** |
| **Provenance block** | Where a number came from | source, identifier, retrieved-at, model/dataset version, seed | Reusable under every scientific figure. | — |
| **Timeline** | Trial or run chronology | dated events | Horizontal scroll inside its own container on small screens. | — |

### Evidence and honesty components

These are the ones that carry the product's integrity. They are not decorative
and they are not optional.

| Component | Purpose | Data in | States and notes | Disclaimer |
| --- | --- | --- | --- | --- |
| **Activity indicator** | An AI probability, safely | value, pathogen key, label, model version | Renders **only** when a modelled pathogen is supplied. Label is mandatory; a forbidden label is a build-time error, not a runtime warning. `1.0` renders `>99%`, never `100%`. | **Yes** |
| **Evidence badge** | Which rung of the ladder | one of clinical / experimental / computational / none / unchecked | Five distinct visual treatments, each with its own text. `none` and `unchecked` are never the same badge. Shape or icon differs, not only colour. | **Yes** |
| **Docking badge** | Docking present and where it sits | score, target, project-target flag | Says "project screening target", never "passes" or "binds". | **Yes** |
| **Clinical badge** | Trial history present | count, AMR-related count | "N registered studies", never "N successes". | **Yes** |
| **Status badge** | Pipeline or run state | status enum | Neutral vocabulary. | — |
| **Evidence ladder** | The five rungs, with meanings | current rung | Each rung shows what it means **and** what it does not mean. The prototype's `content.EVIDENCE_LEVELS` is the copy source. | **Yes** |
| **Limitation callout** | A specific limit, in place | text, severity | Sits beside the thing it limits, not in a footer. | **Yes** |
| **Warning callout** | Something the reader could misread | text | — | **Yes** |
| **Scientific disclaimer** | The standing statement | — | Present on every page that shows a scientific quantity. | **Yes** |
| **Unsupported-condition notice** | No model exists for this condition | condition name | Fires whenever the percentage gate returns nothing. States plainly that no probability is shown and why. | **Yes** |
| **Coverage statement** | How much of the library was checked | checked, total, source | Reads from live counts. Never rounds up to "complete". | **Yes** |

### Input and navigation controls

| Component | Purpose | Notes |
| --- | --- | --- |
| **Search box** | Find a medicine or condition | Debounced; results announced to assistive tech via a live region; keyboard-navigable listbox; clear button; explicit no-results state. |
| **Filter bar** | Narrow a result set | Collapses into a sheet below 760px; applied filters always visible as chips. |
| **Filter chip** | One applied filter | Individually removable, labelled with its field. |
| **Sort control** | Reorder a table | Sort state announced; default sort stated in the UI. |
| **Mode selector** | Explorer's three modes | Radio-group semantics, not three loose buttons. |
| **Pose selector** | Choose a docking pose | Keyboard-operable; pose rank and score shown together. |
| **Metric switcher** | Choose a displayed metric | Changing it never changes which model is described as active. |
| **Pagination** | Page a long table | Announces "page N of M"; page size persisted per session. |
| **Tabs / Accordion** | Sections within a page | Real tab and disclosure semantics; content readable with JS-driven animation disabled. |
| **Modal / Drawer / Tooltip** | Secondary detail | Focus trapped and restored; Esc closes; tooltips reachable by keyboard and never the sole home of essential text. |

### Data display

| Component | Purpose | States and notes |
| --- | --- | --- |
| **Data table** | Rows of medicines, trials, runs | Absent values render as an em dash, never "None", "null", "NaN" or `0`. Scrolls inside its own container; the page itself never scrolls sideways. Below 760px the first two columns carry the reading priority, because they may be all that is visible. Header row is a real `<th>` scope row. |
| **Chart** | A distribution or curve | Axis labels and units always present. Accompanied by the numbers in text or a table — never the only route to a value. Respects reduced-motion. Colour is never the sole encoding. |
| **Multi-pathogen matrix** | Medicine × four bacteria | Each cell is an activity indicator; empty cells state why they are empty. |
| **Molecule viewer (2D)** | Structure depiction | Has a text alternative (name + SMILES). Fails to a structure-unavailable state, never a broken image. |
| **3D docking viewer** | Receptor, ligand, pose | Heavy: lazy-load, show a skeleton, and provide a static fallback plus the numeric score for anyone who cannot or does not want to run it. Not keyboard-essential — every fact it shows is also available as text. |
| **Log viewer** | Run output | Monospace, virtualised, copyable, searchable. |
| **Pipeline flow** | Five stages | Each stage shows what it establishes and what it does not. Horizontal on desktop, vertical below 760px. |
| **Run status** | One run at a glance | Distinguishes success, partial, failed, interrupted, skipped. |

### Feedback states

| Component | Purpose | Notes |
| --- | --- | --- |
| **Loading state / Skeleton** | Work in progress | Shaped like the content it replaces. Never a spinner over a stale number. |
| **Empty state** | Nothing to show | Says which of the §4 meanings applies and what the reader could do next. |
| **Error state** | Retrieval or processing failed | Names what failed and offers a retry. Never renders as zero or as "no evidence". |
| **Partial state** | Some stages done, others not | Explicit per-stage rendering, not a single ambiguous badge. |

---

## 3. Data contract

What the frontend needs from an API. **Not an instruction to build one** — the
current system has no HTTP API and does not need one until the website exists.
Field names follow the prototype's database columns so the mapping is obvious.

### 3.1 Medicine
`molecule_id` (InChIKey-based, the stable identity) · `generic_name` ·
`brand_name` · `chembl_id` · `approval_source` · `approval_status` ·
`application_no` · `marketing_status` · `dosage_form` · `route` ·
`approval_date` · `match_method` · `prediction_status`.

### 3.2 Condition / Disease
`name` · `normalised_name` · `source` (trial conditions vocabulary) ·
`study_count` · `modelled_pathogen_key` *(null for everything outside the four)*.

The null here is load-bearing. It is what tells the UI to render the
unsupported-condition notice instead of a number.

### 3.3 Pathogen
`key` · `organism` · `short_name` · `full_name` · `plain_description` ·
`resistance_mechanism` · `labelled_records` · `resistant_strain_records` ·
`resistant_strain_fraction` · `active_model_version`.

### 3.4 Prediction
`molecule_id` · `pathogen_key` · `probability` · `model_version` ·
`model_type` · `dataset_version` · `feature_version` · `predicted_at` ·
`label` *(always `"AI-predicted activity"`)* · `in_training_data`
*(whether this molecule carried a label in the dataset behind this model, and in
which split — see §6)*.

### 3.5 Model
`model_version` · `pathogen_key` · `model_type` · `is_baseline` ·
`dataset_version` · `feature_version` · `training_date` · `validation_method` ·
`split_method` · `random_seed` · `n_train` · `n_validation` · `n_test` ·
`metrics` (roc_auc, pr_auc, prevalence_adjusted_pr_auc, positive_prevalence,
calibration) · `curves` · `selection_reason` · `status` · `library_versions`.

### 3.6 MolecularProfile
`molecule_id` · `canonical_smiles` · `inchi` · `inchikey` · `mw` · `logp` ·
`tpsa` · `hbd` · `hba` · `rotatable_bonds` · `aromatic_rings` · `heavy_atoms` ·
`fraction_csp3` · `qed` · `lipinski_violations` · `murcko_scaffold` ·
`feature_version` · `depiction_svg`.

### 3.7 DockingResult
`run_id` · `molecule_id` · `target_key` · `pathogen_key` · `pose_rank` ·
`score_kcal_mol` · `rmsd_lb` · `rmsd_ub` · `pose_path` · `status` · `error` ·
plus the run's `engine`, `engine_version`, `exhaustiveness`, `num_modes`,
`energy_range`, `random_seed`, box centre and size, `receptor_pdbqt`.
Failures are records, not absences: a ligand that could not be docked is
returned with its status and reason.

### 3.8 ClinicalTrial
`nct_id` · `molecule_id` · `query_term` · `brief_title` · `conditions` ·
`interventions` · `phase` · `overall_status` · `study_type` · `start_date` ·
`completion_date` · `enrollment` · `url` · `amr_related` ·
`matched_keywords` · `retrieved_at`.

### 3.9 Evidence (the composite the explorer renders)
`molecule_id` · `disease` · `modelled_pathogen` *(nullable)* · `was_checked` ·
`checked_at` · `prediction` *(nullable object)* · `measured` *(list)* ·
`docking` *(nullable object)* · `trials` *(list)* · `rung`
*(clinical | experimental | computational | none | unchecked)*.

`was_checked` and `rung` together are what keep *not yet checked* separate from
*no evidence found*. An API that returns an empty list for both has destroyed
the distinction, and the website will then be lying whatever the design does.

### 3.10 Candidate
`molecule_id` · `pathogen_key` · `probability` · `best_docking_score` ·
`docking_target` · `trial_count` · `measurement_count` · `rank` ·
`ranking_inputs`. `rank` is an ordering for attention, not a score of merit.

### 3.11 Dataset
`dataset_version` · `created_at` · `pathogen_key` · `n_members` · split sizes ·
`split_method` · `random_seed` · `label_thresholds` · `sanity_findings`.

### 3.12 PipelineRun / RetrainingRun / Provenance
`run_id` · `stage` · `started_at` · `finished_at` · `duration_seconds` ·
`status` · `records_processed` · `records_new` · `records_skipped` ·
`error_count` · `message` · `params` · errors (`subject`, `error_type`,
`message`, `created_at`). Retraining adds `current_model`, `candidate_model`,
`comparison_metric`, `margin`, `decision`, `decision_reason`.
Provenance is the shared shape: `source_name`, `source_url`, `record_count`,
`retrieved_at`, `notes`.

---

## 4. State design

Nine states. They are semantically distinct and the design must keep them so —
distinct wording, and a distinct visual treatment that does not rely on colour
alone.

| State | Means | Must not read as |
| --- | --- | --- |
| **Loading** | The request is in flight | Empty |
| **Success** | Data present and current | — |
| **Empty** | The query returned nothing at all | Failure |
| **Not yet checked** | This medicine has never been queried | No evidence |
| **No evidence found** | Queried, and nothing matched | No effect |
| **Error** | Retrieval or processing failed | Empty, or zero |
| **Partial** | Some stages complete, others outstanding | Complete |
| **Computational only** | Prediction and/or docking exist; no lab or human data | Evidence of activity |
| **Clinical evidence available** | Registered studies exist for this pairing | Efficacy, or approval |

The three that get collapsed in practice are *not yet checked*, *no evidence
found* and *no effect*. Treat any design that renders two of them identically as
a defect, not a simplification.

---

## 5. Responsive and accessibility contract

**Breakpoints** follow the prototype: 1280 / 1024 / 760 / 460px. Verify at
**1440, 1024, 760 and 400px** by measuring `document.documentElement.scrollWidth`
against `clientWidth`, not by eye.

- No unintended horizontal page scroll at any width. A table or a 3D canvas may
  scroll **inside its own container**; the document may not.
- Primary metrics are never hidden behind a breakpoint. If something has to go,
  it is secondary detail, and it goes behind a disclosure the reader can open.
- Long medicine names wrap; they do not truncate away the distinguishing part.
  Orange Book combination names are long and they are real.
- Touch targets ≥ 44px. Focus visible on every interactive element. Tab order
  follows reading order.
- Semantic headings in order; one `h1` per page.
- Nothing essential conveyed by colour alone — evidence rungs carry an icon or
  a shape as well.
- `prefers-reduced-motion` respected: transitions become instant, nothing
  auto-animates, the 3D viewer does not auto-rotate.
- No emoji as functional icons. Use an inline SVG icon set.
- Every chart's numbers are also reachable as text.

---

## 6. Two things the website must say that the prototype learned the hard way

**A prediction for a molecule the model trained on is not a discovery.** Several
of the highest-scoring medicines in the current database carried a label in the
training split, and at least one high scorer is a stereoisomer of a training
molecule. The `in_training_data` field in §3.4 exists so the UI can say
"this molecule was in the training data for this model" beside the probability.
A website that shows `>99% AI-predicted activity` for a molecule the model
memorised, without saying so, is overstating the result even though every
individual number is true.

**The models are species-level.** Resistance-phenotype coverage in the
underlying assay data is low, and for *E. coli* it is zero. The correct wording
is: *"Resistance phenotype coverage is limited in the underlying data, so the
current models primarily represent pathogen/species-level activity."* Never
"the model predicts resistance". This belongs on the model pages, on the
pathogen cards, and anywhere a probability is explained — not only in a
limitations page nobody opens.

---

## 7. Design direction

The site should read as **scientific intelligence, evidence and transparency** —
not medical certainty, and not an AI product demo.

Do: generous type and space; a clear reading order; one idea per screenful;
tables that are pleasant to read; restraint in colour, with the evidence palette
carrying the only strong hues; motion only where it explains a state change.

Avoid: dashboard clutter; charts that decorate rather than inform; gradients and
glassmorphism used as atmosphere; "AI" visual clichés (neural-network filigree,
glowing particles, terminal-green); gamification; leaderboards; anything shaped
like a recommendation engine; emoji; unexplained jargon; a percentage without
its label.

The prototype's semantic colour system is worth carrying over, because the
meanings are already load-bearing: indigo = model prediction, teal = chemistry,
violet = structural/docking, emerald = human clinical evidence, amber =
limitation, rose = failure. Keep the mapping even if the hues change.

---

## 8. Build order

1. Shell, navigation, the evidence primitives (badge, ladder, activity
   indicator, limitation callout). Everything else depends on these, and they
   are where the honesty rules live.
2. Home, Drug Screening, Drug Details — the shortest path to a real answer.
3. Medicine × Disease explorer, including all five rungs and every empty state.
4. Evidence pages: molecular, docking, clinical.
5. System pages: models, pipeline, retraining, run history.
6. Case study and the research roadmap.

Ship the states before the polish. An interface that renders *not yet checked*
correctly and looks plain is finished work; one that looks excellent and renders
it as a blank cell is not.
