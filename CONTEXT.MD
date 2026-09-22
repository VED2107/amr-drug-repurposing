# AMR AI-DRIVEN DRUG REPURPOSING

# COMPLETE AUTONOMOUS BUILD + TEST + DASHBOARD PROMPT

You are the lead engineer responsible for taking the attached project presentation:

**AMR_Drug_Repurposing.pptx**

and turning it into a complete, working, tested, reproducible software prototype.

You are simultaneously acting as:

- Senior Python Engineer
- Machine Learning Engineer
- Data Engineer
- Computational Drug-Discovery Engineer
- Scientific Software Engineer
- Streamlit Developer
- QA/Test Engineer
- DevOps Engineer

Your job is NOT to merely explain the project.

Your job is to **inspect the presentation, design the implementation, write the code, run it, test it, find failures, fix them, retest, and leave behind a working project.**

Do not stop after generating code.

Do not claim something works unless you actually execute and verify it.

---

# ============================================================

# 1. SOURCE OF TRUTH

# ============================================================

First, read the ENTIRE attached PPTX from beginning to end.

Do not only read the methodology slide.

Extract:

- project objective
- problem statement
- target pathogens
- drug-repurposing concept
- methodology
- datasets/data sources
- molecular-processing requirements
- ML requirements
- docking requirements
- clinical-validation requirements
- dashboard requirements
- future aspects
- limitations/claims

The presentation describes the core pipeline:

COLLECT
→ DECODE
→ PREDICT
→ VALIDATE
→ DELIVER

with:

FDA Orange Book

- ChEMBL
  →
  RDKit
  →
  1024-bit Morgan Fingerprints
  →
  Random Forest
  →
  AutoDock Vina
- ClinicalTrials.gov
  →
  Streamlit Dashboard

The four target pathogens are:

1. MRSA
2. E. coli
3. Klebsiella pneumoniae
4. Mycobacterium tuberculosis

The goal is to identify existing drugs that may have antimicrobial activity and prioritize candidates for further investigation.

The system must NEVER claim that an AI prediction or docking result proves that a drug cures or treats a disease.

Use language such as:

- predicted candidate
- computationally promising
- candidate for experimental validation
- computational evidence

Never present computational predictions as clinical proof.

---

# ============================================================

# 2. DO NOT OVERENGINEER

# ============================================================

This is a prototype/research project.

Target a practical implementation that can be completed quickly.

Preferred stack:

Python
RDKit
pandas
NumPy
scikit-learn
joblib
AutoDock Vina
SQLite
Streamlit

Use FastAPI or PostgreSQL only if there is a clear reason.

Do NOT unnecessarily introduce:

- Kubernetes
- microservices
- distributed infrastructure
- complex cloud architecture
- unnecessary queues
- unnecessary frontend frameworks
- complicated MLOps platforms

The project should be simple, understandable, reproducible, and demonstrable.

---

# ============================================================

# 3. CORE ARCHITECTURE

# ============================================================

Implement:

```
                     DATA SOURCES
                          │
           ┌──────────────┴──────────────┐
           │                             │
        ChEMBL                     FDA Orange Book
           │                             │
           └──────────────┬──────────────┘
                          ↓
                   DATA INGESTION
                          ↓
                 DATA NORMALIZATION
                          ↓
                 APPROVED DRUG SET
                          ↓
                   SMILES PROCESSING
                          ↓
                        RDKit
                          ↓
              1024-BIT MORGAN FINGERPRINT
                          ↓
                   RANDOM FOREST
                          ↓
              PATHOGEN-SPECIFIC SCORES
                          ↓
                 CANDIDATE SCREENING
                          ↓
                   ADMET / PROPERTIES
                          ↓
                  AUTODOCK VINA
                          ↓
              CLINICALTRIALS.GOV
                          ↓
                   FINAL EVIDENCE
                          ↓
                 STREAMLIT DASHBOARD
```

The pipeline must be modular.

---

# ============================================================

# 4. DATA SOURCES

# ============================================================

Use the three sources specified by the project:

## A. ChEMBL

Primary molecular/bioactivity source.

Use it to construct the ML training dataset.

Collect, where available:

- ChEMBL compound ID
- molecule name
- canonical SMILES
- InChI
- InChIKey
- organism
- target
- assay
- activity type
- activity value
- activity units
- activity relation
- source/reference

Filter/identify records relevant to:

MRSA / Staphylococcus aureus
E. coli / Escherichia coli
Klebsiella pneumoniae
Mycobacterium tuberculosis

Do NOT blindly mix incompatible activity measurements.

Create a documented activity-labeling strategy.

---

## B. FDA Orange Book

Use this for identifying/filtering approved human drugs.

Do not assume every Orange Book entry automatically contains usable molecular structures.

Normalize drug names and map to molecular identifiers wherever possible.

Use it to create:

APPROVED HUMAN DRUG CANDIDATE LIBRARY

---

## C. ClinicalTrials.gov

Use this for retrospective clinical evidence/context.

Collect where available:

- trial ID
- drug/intervention
- indication
- phase
- study type
- status
- relevant information

IMPORTANT:

ClinicalTrials.gov evidence does NOT prove antimicrobial efficacy.

Clearly distinguish:

EXISTING HUMAN CLINICAL HISTORY

from:

AMR EFFICACY EVIDENCE

---

# ============================================================

# 5. IMPORTANT: TRAINING DATASET

# ============================================================

This is the most important scientific component.

The Random Forest requires real labeled data.

DO NOT invent labels.

DO NOT create fake:

Drug A → MRSA = 1

unless supported by actual experimental data.

Construct the training dataset from real bioactivity information.

The conceptual structure is:

compound

- pathogen/organism
- experimental activity
  →
  label

Keep raw activity values wherever possible.

The dataset should include:

compound_id
smiles
pathogen
organism
target
assay
activity_type
activity_value
activity_units
activity_relation
label

The activity-label threshold must be:

- scientifically defensible
- configurable
- documented
- reproducible

If data for a pathogen is insufficient, DO NOT fabricate a model.

Report that limitation clearly.

---

# ============================================================

# 6. MOLECULAR PROCESSING

# ============================================================

Use RDKit.

Pipeline:

SMILES
→ validation
→ sanitization
→ canonicalization
→ molecular identifiers
→ Morgan fingerprint
→ molecular descriptors

Use:

**1024-bit Morgan fingerprints**

as specified in the project.

Calculate useful descriptors such as:

- molecular weight
- LogP
- TPSA
- H-bond donors
- H-bond acceptors
- rotatable bonds
- Lipinski violations

Handle:

- invalid SMILES
- missing SMILES
- salts
- mixtures
- duplicates
- malformed molecules
- stereochemistry issues

Create reusable chemistry modules.

---

# ============================================================

# 7. MACHINE LEARNING

# ============================================================

Implement the project's Random Forest model.

Input:

1024-bit Morgan fingerprint

Output:

probability of activity

Support:

MRSA
E. coli
Klebsiella pneumoniae
M. tuberculosis

Prefer pathogen-specific models if that gives cleaner scientific behavior.

For example:

MRSA model
E. coli model
Klebsiella model
M. tuberculosis model

or another clearly documented architecture if justified.

Do not silently change the model type away from Random Forest.

---

# ML MODEL SELECTION — BASELINE + BEST AVAILABLE MODEL

The project presentation specifies Random Forest as the baseline AI model.

Implement Random Forest first.

However, do NOT assume Random Forest is automatically the best model.

After establishing the Random Forest baseline, evaluate other appropriate supervised ML models that are suitable for molecular fingerprints and the available dataset.

Potential models may include, where appropriate:

- Random Forest
- Extra Trees
- XGBoost
- LightGBM
- HistGradientBoosting
- Logistic Regression
- SVM
- other appropriate classical molecular-activity models

Do NOT add models simply for the sake of having more models.

Only evaluate models that are technically and scientifically appropriate for the available dataset.

---

## MODEL BENCHMARKING

Use the same:

- dataset
- preprocessing
- molecular representation
- train/validation/test split
- scaffold split where applicable
- evaluation methodology

for all candidate models.

This makes the comparison fair.

Evaluate using:

- ROC-AUC
- PR-AUC
- precision
- recall
- F1
- sensitivity
- specificity
- calibration where practical

Do not select a model based only on accuracy.

---

## MODEL SELECTION

Random Forest is the required baseline.

After benchmarking:

Random Forest
vs
Other suitable models

select the model that demonstrates the strongest validated performance while also considering:

- generalization
- class imbalance
- calibration
- stability
- interpretability
- computational cost
- reproducibility

Do NOT select a model simply because it produces the highest score on one metric.

The selection criteria must be documented.

---

## IMPORTANT

If Random Forest performs best:

Use Random Forest as the production model.

If another appropriate model clearly performs better under the same validation protocol:

Use that model as the active model.

Keep Random Forest as the documented baseline.

The dashboard must show:

Baseline Model:
Random Forest

Active Model:
[Selected model]

Model Comparison:
[comparison table]

---

## MODEL COMPARISON DASHBOARD

Add a section to the Model page:

| Model         | ROC-AUC | PR-AUC | F1  | Precision | Recall | Status   |
| ------------- | ------- | ------ | --- | --------- | ------ | -------- |
| Random Forest | ...     | ...    | ... | ...       | ...    | Baseline |
| Extra Trees   | ...     | ...    | ... | ...       | ...    | ...      |
| XGBoost       | ...     | ...    | ... | ...       | ...    | ...      |

Only display models that were actually trained and evaluated.

Never fabricate metrics.

---

## AUTOMATIC MODEL SELECTION

The training pipeline should support:

python -m src.pipeline.train --benchmark

This should:

1. Load the versioned dataset.
2. Generate the fixed molecular features.
3. Apply the exact same train/test methodology.
4. Train Random Forest.
5. Train appropriate alternative models.
6. Evaluate every model.
7. Generate comparison metrics.
8. Select the best validated model according to the configured selection criteria.
9. Save all model artifacts.
10. Save the selected model as the active model.
11. Save the comparison report.
12. Record the decision in the model registry.

---

## DO NOT OVERFIT

Never choose the model based on test-set performance repeatedly during development.

Use:

TRAIN
→ VALIDATION / CROSS-VALIDATION
→ FINAL TEST

The final test set should remain untouched until final model comparison.

Where feasible, use scaffold-aware splitting to evaluate molecular generalization.

---

## DATASET SIZE RULE

Do not automatically use complex boosting/deep-learning models if the dataset is too small.

For a small dataset:

Prefer robust classical models.

For a sufficiently large dataset:

More advanced models may be evaluated.

Do not use deep learning merely because it is called "AI."

---

## EXPLAINABILITY

For the selected model, provide useful model interpretation where practical.

For tree-based models, consider:

- feature importance
- permutation importance
- SHAP where appropriate

The goal is to understand which molecular fingerprint/features contribute to predictions.

Do not claim that feature importance proves biological mechanism.

---

## MODEL VERSIONING

Store:

model_version
model_type
dataset_version
feature_version
training_date
validation_method
metrics
selection_reason
artifact_path
status

Example:

RF-v1
XGB-v2
ET-v3

The active model must always be identifiable.

---

## FUTURE MODEL UPGRADE

The presentation mentions a future transition toward Graph Neural Networks.

Do NOT implement a GNN unless the dataset and project timeline justify it.

Keep the architecture extensible so a future model can replace the current model without rebuilding the entire pipeline.

Possible future architecture:

Molecular Graph
→ GNN
→ Activity Prediction

But V1 should remain focused and reproducible.

---

## FINAL RULE

Random Forest is the required BASELINE.

It is NOT necessarily required to remain the final production model.

The system must:

1. Build Random Forest.
2. Benchmark appropriate alternatives.
3. Compare them fairly.
4. Select the strongest validated model.
5. Keep Random Forest as the baseline.
6. Display the comparison in the dashboard.
7. Version the selected model.
8. Automatically evaluate future models when new labeled data triggers retraining.

Never fabricate a model improvement.

Never claim a model is better unless the evaluation demonstrates it.

# ============================================================

# 8. MODEL EVALUATION

# ============================================================

Do NOT report only accuracy.

Calculate:

- ROC-AUC
- PR-AUC
- precision
- recall
- F1
- confusion matrix
- sensitivity
- specificity
- calibration where practical

Investigate class imbalance.

Investigate chemical leakage.

Prefer a scaffold-aware split where feasible instead of blindly relying on random splitting.

Document:

- train size
- validation size
- test size
- split methodology
- random seed
- dataset version

Never fabricate metrics.

If the model performs poorly, report the real result and investigate why.

---

# ============================================================

# 9. MODEL VERSIONING

# ============================================================

Every trained model must have a version.

Example:

RF-v1
RF-v2
RF-v3

Store:

- model version
- dataset version
- feature version
- training timestamp
- metrics
- model artifact
- configuration

Maintain:

ACTIVE
ARCHIVED
CANDIDATE
REJECTED

model states.

Every prediction must store:

- drug ID
- pathogen
- prediction
- model version
- dataset version
- prediction timestamp

---

# ============================================================

# 10. NEW DRUG AUTOMATION

# ============================================================

IMPORTANT:

A newly added drug does NOT automatically require model retraining.

When a new drug appears:

NEW DRUG
→ detect
→ normalize
→ validate SMILES
→ RDKit
→ Morgan fingerprint
→ EXISTING MODEL
→ prediction
→ store result
→ dashboard update

This must happen automatically through the incremental pipeline.

If 1,000 new drugs appear, they should be screened using the existing model.

Do NOT retrain unnecessarily.

---

# ============================================================

# 11. AUTOMATIC MODEL RETRAINING

# ============================================================

Retraining happens when NEW LABELED BIOACTIVITY DATA becomes available.

Pipeline:

NEW LABELED DATA
→ validate
→ deduplicate
→ update dataset
→ new dataset version
→ train candidate model
→ evaluate
→ compare with current model
→ promote only if acceptance criteria pass

If the new model is worse:

KEEP OLD MODEL ACTIVE

Do not automatically replace a good model with a bad model.

Store all model versions.

---

# ============================================================

# 12. APPROVED DRUG SCREENING

# ============================================================

Pipeline:

ALL AVAILABLE MOLECULES
→ valid molecules
→ approved human drugs
→ deduplicate
→ molecular processing
→ ML prediction
→ candidate filtering
→ ranking

Do not repeatedly process unchanged molecules.

Use hashes/versioning.

Cache expensive computations.

---

# ============================================================

# 13. CANDIDATE RANKING

# ============================================================

Do not hide everything behind one arbitrary score.

Display evidence independently:

- ML probability
- molecular properties
- approval status
- docking score
- clinical evidence
- target information
- data quality

If a composite score is used:

- make formula explicit
- make weights configurable
- document it

Never label a candidate as:

"best drug"
"winner"
"confirmed treatment"
"cure"

Use:

"prioritized candidate"

or:

"computationally promising candidate"

---

# ============================================================

# 14. ADMET / DRUG-LIKENESS

# ============================================================

Implement computational drug-property filtering.

Show where available:

- molecular weight
- LogP
- TPSA
- HBD
- HBA
- rotatable bonds
- Lipinski violations

Clearly distinguish:

DRUG-LIKENESS
from
COMPUTATIONAL ADMET
from
HUMAN CLINICAL SAFETY

Do NOT say:

"SAFE"

merely because Lipinski rules pass.

---

# ============================================================

# 15. MOLECULAR DOCKING

# ============================================================

Implement AutoDock Vina.

Pipeline:

candidate
→ ligand preparation
→ receptor preparation
→ binding site
→ docking
→ poses
→ score
→ store result

Store:

- ligand
- receptor
- target
- structure identifier
- binding site
- grid parameters
- Vina parameters
- exhaustiveness
- docking score
- pose
- run ID
- software version

The presentation mentions a target around:

-7.0 kcal/mol

but DO NOT treat this as a universal scientific cutoff.

Make it configurable.

Do not claim docking proves biological activity.

---

# ============================================================

# 16. TARGET PROTEINS

# ============================================================

The project presentation describes pathogen mechanisms but does not fully specify every docking structure/configuration.

Therefore:

- identify appropriate targets
- identify reproducible structural sources
- store structure identifiers
- document target selection
- make target configuration editable

Do not invent protein structures or binding sites.

If a target cannot be obtained/reliably configured, record the limitation and continue with the rest of the pipeline.

---

# ============================================================

# 17. CLINICAL EVIDENCE

# ============================================================

For shortlisted candidates:

query ClinicalTrials.gov.

Display:

- trial ID
- indication
- intervention
- phase
- status
- study type
- relevant information

Clearly distinguish:

"Human clinical history exists"

from:

"Evidence of antimicrobial efficacy exists"

Do not infer AMR effectiveness from unrelated clinical trials.

---

# ============================================================

# 18. DATABASE

# ============================================================

Use SQLite for the prototype.

Create appropriate tables for:

drugs
molecules
bioactivity
pathogens
targets
models
model_versions
predictions
docking_runs
docking_results
clinical_trials
pipeline_runs
data_sources

Every result should have provenance.

---

# ============================================================

# 19. STREAMLIT DASHBOARD

# ============================================================

The dashboard is a PRIMARY deliverable.

Do NOT make a basic form.

Build a clean, professional scientific dashboard.

Pages:

1. Overview
2. Drug Screening
3. Candidate Explorer
4. Drug Details
5. Molecular Analysis
6. Docking / 3D
7. Clinical Evidence
8. Model & Dataset
9. Pipeline / Automation

---

# ============================================================

# 20. OVERVIEW DASHBOARD

# ============================================================

Header:

AMR DRUG REPURPOSING

Subtitle:

AI-Driven Drug Repurposing Against Antimicrobial Resistance

Show visual pipeline:

DATA
↓
MOLECULAR PROCESSING
↓
AI PREDICTION
↓
CANDIDATE SCREENING
↓
MOLECULAR DOCKING
↓
CLINICAL EVIDENCE

KPI cards:

- total compounds
- approved drugs
- valid molecules
- screened drugs
- candidates
- docking runs
- clinical records
- active model version

All numbers must come from actual stored data.

---

# ============================================================

# 21. PATHOGEN CARDS

# ============================================================

Create cards for:

MRSA
E. coli
Klebsiella pneumoniae
M. tuberculosis

Display:

- screened count
- candidate count
- highest prediction
- docking availability

Clicking should filter the candidate explorer.

---

# ============================================================

# 22. DRUG SCREENING PAGE

# ============================================================

Support:

- drug-name search
- SMILES search
- ChEMBL ID search
- InChIKey search
- pathogen filter
- probability filter
- approval filter
- docking filter
- clinical evidence filter

Table columns:

Drug
Pathogen
ML Probability
Approval
Docking Score
Clinical Evidence
Model Version
Updated

Allow sorting.

---

# ============================================================

# 23. CANDIDATE EXPLORER

# ============================================================

Allow sorting by:

- ML probability
- docking score
- pathogen
- clinical evidence
- molecular properties

Each candidate must have:

VIEW DETAILS

Do not call the top candidate "best."

Use scientifically neutral language.

---

# ============================================================

# 24. DRUG DETAILS PAGE

# ============================================================

Show:

## Identity

- generic name
- brand name
- ChEMBL ID
- approval status
- SMILES
- InChIKey

## Molecular structure

Render using RDKit.

## Properties

- molecular weight
- LogP
- TPSA
- HBD
- HBA
- rotatable bonds
- Lipinski violations

## AI predictions

MRSA
E. coli
Klebsiella pneumoniae
M. tuberculosis

Show probabilities visually.

Also show:

- model version
- dataset version
- prediction timestamp

---

# ============================================================

# 25. TOXICITY / ADMET DASHBOARD

# ============================================================

Show available computational evidence.

Distinguish:

Drug-likeness
Computational ADMET
Human clinical evidence

Never turn these into an unsupported "safe/unsafe" claim.

---

# ============================================================

# 26. DOCKING / 3D PAGE

# ============================================================

Show:

- target
- protein structure ID
- docking software/version
- docking score
- pose rank
- configuration

Provide 3D visualization where available.

Show:

DRUG + TARGET + DOCKING POSE

Use language:

"Computational docking result"

"Requires experimental validation."

---

# ============================================================

# 27. CLINICAL EVIDENCE PAGE

# ============================================================

Display:

- trial ID
- drug/intervention
- indication
- phase
- status
- study type
- relevant evidence

Provide public record links when available.

Clearly distinguish AMR evidence from unrelated clinical evidence.

---

# ============================================================

# 28. MODEL & DATASET PAGE

# ============================================================

Display:

Current model:
Random Forest

Features:
1024-bit Morgan fingerprints

Pathogens:
4 target pathogens

Dataset version
Training records
Unique compounds
Training date

Metrics:

ROC-AUC
PR-AUC
Precision
Recall
F1

Charts:

- ROC curve
- precision-recall
- confusion matrix
- class distribution

Dataset quality:

- missing SMILES
- invalid SMILES
- duplicates
- class distribution

---

# ============================================================

# 29. MODEL VERSION HISTORY

# ============================================================

Display:

RF-v1
RF-v2
RF-v3

with:

- training date
- dataset version
- metrics
- status

Make active model obvious.

---

# ============================================================

# 30. PIPELINE / AUTOMATION PAGE

# ============================================================

Show status of:

DATA INGESTION
MOLECULAR PROCESSING
ML PREDICTION
DOCKING
CLINICAL EVIDENCE

For each show:

- last run
- records processed
- new records
- skipped records
- errors
- status

---

# ============================================================

# 31. NEW DRUG PAGE

# ============================================================

Show newly detected drugs:

Drug
Source
Date detected
Processing status
Prediction status

New drugs should automatically use the existing model.

Provide a manual prediction action only as an optional control.

---

# ============================================================

# 32. RETRAINING PAGE

# ============================================================

Show:

Current model
Training dataset version
Last training
New labeled records
Retraining status

Example:

Current Model: RF-v3
New labeled records: 124
Retraining: READY

Make clear:

NEW DRUG ≠ RETRAIN

NEW LABELED BIOACTIVITY DATA → POSSIBLE RETRAIN

---

# ============================================================

# 33. PIPELINE RUN HISTORY

# ============================================================

Show:

Run ID
Start
End
Duration
Records
New drugs
Predictions
Docking
Errors
Status

Allow inspection of a run.

---

# ============================================================

# 34. VISUAL DESIGN

# ============================================================

Make the dashboard look like a professional scientific research product.

Use:

- clean typography
- consistent spacing
- restrained scientific color palette
- clear cards
- meaningful charts
- clean tables
- readable labels

Avoid:

- childish UI
- excessive gradients
- meaningless animations
- fake AI decoration
- clutter

The dashboard should feel like:

scientific research software

not:

a generic admin panel.

---

# ============================================================

# 35. PERFORMANCE

# ============================================================

Opening the dashboard must NOT:

- retrain the model
- rerun docking
- redownload everything
- recompute all fingerprints

Use caching and stored results.

Only process changed/new data.

---

# ============================================================

# 36. DEMO MODE

# ============================================================

Create a small deterministic demo dataset/configuration.

Demo mode must be clearly labeled:

DEMO DATA

Never mix fake demo results with real results without labeling them.

The dashboard must still work if external APIs are unavailable.

---

# ============================================================

# 37. PROJECT STRUCTURE

# ============================================================

Use a clean structure:

amr-drug-repurposing/

data/
raw/
processed/
external/

src/
ingestion/
chemistry/
ml/
docking/
clinical/
ranking/
pipeline/

models/

configs/

notebooks/

tests/

scripts/

app/
streamlit_app.py

docs/

README.md
pyproject.toml
Dockerfile
.env.example

Do not create unnecessary files.

---

# ============================================================

# 38. COMMANDS

# ============================================================

Provide simple commands such as:

python -m src.pipeline.ingest

python -m src.pipeline.process

python -m src.pipeline.train

python -m src.pipeline.predict

python -m src.pipeline.dock

python -m src.pipeline.clinical

python -m src.pipeline.run

python -m src.pipeline.run --incremental

streamlit run app/streamlit_app.py

Make commands actually work.

---

# ============================================================

# 39. TESTING

# ============================================================

You are NOT finished when the application runs once.

You must repeatedly:

BUILD
→ TEST
→ INSPECT
→ FIX
→ RETEST
→ VERIFY

Continue until stable.

---

# ============================================================

# 40. UNIT TESTS

# ============================================================

Test:

- SMILES validation
- canonicalization
- fingerprint generation
- descriptor generation
- data cleaning
- label generation
- model prediction
- ranking
- database operations
- API parsing

---

# ============================================================

# 41. INTEGRATION TESTS

# ============================================================

Test:

data ingestion
→ processing
→ model
→ predictions
→ database

Also:

candidate
→ docking
→ result storage

And:

candidate
→ ClinicalTrials
→ evidence storage

---

# ============================================================

# 42. END-TO-END TEST

# ============================================================

Run:

raw data
→ ingestion
→ processing
→ training
→ prediction
→ candidates
→ docking
→ clinical evidence
→ dashboard

Where external data/API is unavailable, use deterministic mocks for tests.

---

# ============================================================

# 43. TEST CASES

# ============================================================

Test all of the following:

1. valid drug
2. invalid SMILES
3. missing SMILES
4. duplicate molecule
5. new drug
6. existing drug
7. new labeled bioactivity
8. retraining trigger
9. model rejection
10. docking failure
11. missing protein
12. clinical API failure
13. no clinical result
14. malformed API response
15. empty dataset
16. imbalanced dataset

The application must fail gracefully.

---

# ============================================================

# 44. NEW DRUG TEST

# ============================================================

Add a drug that does not exist in the training set.

Verify:

new drug
→ detection
→ processing
→ fingerprint
→ existing model
→ prediction
→ database
→ dashboard

Verify that model training was NOT triggered.

---

# ============================================================

# 45. RETRAINING TEST

# ============================================================

Add a new labeled bioactivity record.

Verify:

new labeled data
→ dataset version increment
→ training candidate
→ evaluation
→ model version

Test both:

NEW MODEL BETTER
→ promote

NEW MODEL WORSE
→ keep existing model

---

# ============================================================

# 46. DATA QUALITY AUDIT

# ============================================================

Before training produce:

- total records
- unique compounds
- unique pathogens
- missing SMILES
- invalid SMILES
- duplicates
- class balance
- activity distributions
- units
- label distribution

Investigate suspicious data.

---

# ============================================================

# 47. SCIENTIFIC SANITY CHECK

# ============================================================

Check for:

- chemical leakage
- train/test duplicates
- scaffold leakage
- inconsistent units
- incorrect organism names
- impossible activity values
- duplicate assays
- invalid structures
- suspiciously high performance
- docking configuration problems

If something looks too good, investigate.

Do not manipulate the data to produce better results.

---

# ============================================================

# 48. ERROR HANDLING

# ============================================================

Handle:

- API timeout
- rate limiting
- malformed API response
- missing molecule
- invalid SMILES
- missing protein
- docking failure
- clinical API failure

One failed drug must not crash the entire pipeline.

Log the error and continue where safe.

---

# ============================================================

# 49. CACHING

# ============================================================

Cache:

- downloaded datasets
- processed molecules
- fingerprints
- predictions
- clinical lookups
- docking results

Never repeat expensive work unnecessarily.

---

# ============================================================

# 50. REPRODUCIBILITY

# ============================================================

Pin dependencies.

Record:

- Python version
- RDKit version
- scikit-learn version
- Vina version
- dataset version
- model version
- random seed
- configuration
- source versions

A clean environment must be able to reproduce the experiment.

---

# ============================================================

# 51. SECURITY

# ============================================================

Never hard-code API keys.

Use:

.env

Provide:

.env.example

Never commit secrets.

---

# ============================================================

# 52. DOCUMENTATION

# ============================================================

README must contain:

1. Project overview
2. Scientific concept
3. Architecture
4. Data sources
5. Dataset construction
6. Label methodology
7. Installation
8. Environment setup
9. Training
10. Prediction
11. Incremental updates
12. Retraining
13. Docking
14. Clinical evidence
15. Dashboard
16. Testing
17. Limitations
18. Scientific interpretation
19. Commands
20. Reproducibility

Document all assumptions.

---

# ============================================================

# 53. ACCEPTANCE CHECKLIST

# ============================================================

Do NOT consider the project complete until all applicable items pass:

[ ] Entire PPT analyzed

[ ] Requirements extracted

[ ] ChEMBL ingestion works

[ ] FDA approved-drug processing works

[ ] ClinicalTrials.gov integration works

[ ] Training dataset constructed from real data

[ ] No fabricated scientific labels

[ ] SMILES validation works

[ ] 1024-bit Morgan fingerprints work

[ ] Random Forest trains

[ ] Model evaluation works

[ ] Four pathogen predictions supported where sufficient data exists

[ ] Model versioning works

[ ] Dataset versioning works

[ ] New drugs are detected automatically

[ ] New drugs are predicted without retraining

[ ] New labeled data can trigger retraining

[ ] Better model can replace current model

[ ] Worse model is rejected

[ ] Candidate ranking works

[ ] ADMET/drug properties work

[ ] AutoDock Vina works where required structural data exists

[ ] Docking results are stored

[ ] Clinical evidence is stored

[ ] Streamlit dashboard works

[ ] Overview works

[ ] Drug screening works

[ ] Candidate explorer works

[ ] Drug details works

[ ] Molecular visualization works

[ ] Docking/3D works

[ ] Clinical evidence page works

[ ] Model page works

[ ] Dataset page works

[ ] Pipeline page works

[ ] Retraining status works

[ ] Pipeline history works

[ ] New-drug workflow works

[ ] Unit tests pass

[ ] Integration tests pass

[ ] End-to-end test passes

[ ] Error handling works

[ ] Caching works

[ ] README complete

[ ] Clean environment installation works

[ ] No hard-coded research results

[ ] No unsupported scientific claims

---

# ============================================================

# 54. AUTONOMOUS SELF-IMPROVEMENT LOOP

# ============================================================

After the first implementation, DO NOT stop.

Automatically perform this loop:

1. Inspect repository.
2. Run formatter/linter.
3. Run unit tests.
4. Run integration tests.
5. Run end-to-end tests.
6. Start Streamlit.
7. Test dashboard.
8. Test search.
9. Test filters.
10. Test candidate details.
11. Test molecular rendering.
12. Test ML results.
13. Test docking results.
14. Test clinical evidence.
15. Test incremental ingestion.
16. Test new-drug prediction.
17. Test retraining.
18. Inspect database.
19. Inspect logs.
20. Inspect model metrics.
21. Find failures.
22. Fix root causes.
23. Add regression tests.
24. Run everything again.

Repeat until stable.

Do NOT weaken tests just to make them pass.

Do NOT delete functionality to hide failures.

Do NOT fabricate successful output.

---

# ============================================================

# 55. FINAL REPORT

# ============================================================

When complete, provide:

## Implementation

- architecture
- major components
- files created

## Data

- sources
- dataset size
- usable compounds
- training records
- pathogens covered
- limitations

## ML

- model architecture
- features
- split methodology
- metrics
- model version

## Screening

- drugs screened
- candidates identified

## Docking

- targets
- runs
- successful/failed
- results

## Clinical

- records queried
- evidence available

## Dashboard

- pages implemented
- major functionality

## Automation

- new-drug behavior
- retraining behavior

## Testing

- unit tests
- integration tests
- end-to-end tests
- final status

## Limitations

Clearly state anything that could not be scientifically or technically verified.

## Commands

Provide exact commands to:

- install
- ingest
- process
- train
- predict
- dock
- run pipeline
- run dashboard
- run tests

---

# ============================================================

# 56. FINAL RULE

# ============================================================

DO NOT merely produce a plan.

IMPLEMENT THE PROJECT.

DO NOT merely write code.

RUN THE CODE.

DO NOT merely run it once.

TEST IT REPEATEDLY.

DO NOT fabricate scientific results.

USE REAL DATA WHERE AVAILABLE.

DO NOT claim computational results prove medical efficacy.

DO NOT retrain merely because a new drug appears.

DO automatically screen new drugs with the existing model.

DO automatically evaluate new models when new LABELED bioactivity data becomes available.

DO build the Streamlit dashboard as a first-class component.

DO maintain model/data/prediction provenance.

DO fix failures before declaring completion.

The final result should be a clean, working, tested, reproducible **AI-assisted AMR drug-repurposing prototype** that faithfully implements the attached project presentation.
