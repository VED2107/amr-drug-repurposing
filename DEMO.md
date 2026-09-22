# Demo walkthrough

A 5–10 minute run through the system using real stored records. Every value
below was read from `data/amr.sqlite` on 2026-09-21. If a number on screen does
not match, the pipeline has been re-run since — read the screen, not this file,
and say so out loud rather than quoting the page you expected.

---

## 0. Before the room fills

```bash
cd C:\PROJECTS\AMR
./.venv/Scripts/python.exe scripts/check_environment.py     # RDKit, Vina, toolchain
./.venv/Scripts/streamlit.exe run app/streamlit_app.py --server.port 8501
```

Open **`http://127.0.0.1:8501`**.

Use `127.0.0.1`, not `localhost`. On this machine `localhost` serves the HTML but
the websocket never completes, and the page sits on its loading skeleton with no
error.

If a page shows stale numbers, stop the process and start it again — Streamlit
does not reliably reload edited modules or drop `st.cache_data` results.

No network access is needed to run the demo. Everything on screen is already in
the database.

**Demo candidate:** LEVOKETOCONAZOLE × *M. tuberculosis*
**Control candidate:** CIPROFLOXACIN × *K. pneumoniae*
**Fallback:** GATIFLOXACIN × MRSA

---

## 1. Overview  (1 min)

Landing page. Point at the live counts, not a slide.

- 20,258 molecules processed, 1,691 approved medicines with a structure
- Four bacteria, four ACTIVE models
- 1,691 of 1,691 medicines checked against ClinicalTrials.gov
- 49,647 stored trial links across 37,199 distinct studies

**Say:** this is a screening framework over medicines that are already approved
for something else. It looks for antibacterial activity, and it shows its
working at every step.

**Do not say:** that the system has found a treatment, or a cure, or that any
number on the page is an effectiveness figure.

## 2. The problem  (1 min)

Stay on Overview, scroll to the crisis section and the four pathogen cards.

**Say:** resistance is outrunning new antibiotics, and a new molecule takes a
decade. Repurposing starts from compounds whose human safety work already
exists — which shortens the road, and shortens it only up to a point.

## 3. The five stages  (1 min)

Overview → the pipeline strip: **COLLECT → DECODE → PREDICT → VALIDATE →
DELIVER**, then open **Pipeline** for the stage-by-stage status.

Each stage carries what it establishes *and* what it does not. Read one of the
limitation lines aloud — it sets the tone for everything that follows.

## 4. Drug Screening  (1 min)

Sidebar → **Drug Screening**. Pathogen selector → **M. tuberculosis**.

The whole scored library, one row per medicine, ranked by AI-predicted activity.
Every probability carries its label.

**Say:** the number is the model's estimate of antibacterial activity against
the species. It is not effectiveness and it is not a clinical outcome.

## 5. The candidate  (2 min)

Search `LEVOKETOCONAZOLE`, open **Drug Details**.

| Field | Value |
| --- | --- |
| Medicine | LEVOKETOCONAZOLE (brand RECORLEV) |
| Approved for | Endogenous Cushing's syndrome — FDA Orange Book, 30 Dec 2021, oral tablet |
| Pathogen | *M. tuberculosis* |
| AI-predicted activity | **0.812** |
| Model | RF-mtb-v5 (random forest), dataset DS-20260921-fe8c6cb8-78df2c |
| Feature version | morgan-r2-1024-v1 |
| In training data? | **No** — this molecule carried no label for *M. tuberculosis* in any split |
| Molecular weight | 531.44 |
| logP | 4.21 · TPSA 69.06 · 7 rotatable bonds · 1 Lipinski violation · QED 0.455 |
| Docking score | **−9.685 kcal/mol** (best pose, run DOCK-6c78d9abfe) |
| Docking target | InhA, enoyl-ACP reductase, PDB 4TZK chain A, site derived from bound ligand 641 |
| Registered trials | 6, all for Cushing's syndrome or healthy-subject pharmacology |
| Measured activity vs *M. tuberculosis* | none in this database |
| Evidence rung | **Computational** |

**Say:** this is why the medicine is worth a look — an approved endocrine drug
whose structure the model scores as likely antibacterial against *M. tb*, and
which docks well against a validated TB target. It is a **prioritised candidate
for further investigation**.

**Say the caveat, it is the most important sentence in the demo:**
ketoconazole — the same molecule without the single-enantiomer purification —
*is* in the training set as active against *M. tuberculosis*. So the model is
recognising chemistry it has already seen, not discovering something from
nothing. That is a reasonable way to generate a hypothesis and a bad way to
claim a finding.

## 6. Molecular analysis  (1 min)

**Molecular Analysis** → the 2D structure and the computed descriptors.

**Say:** the model sees a 1024-bit Morgan fingerprint — a list of which
substructures are present. Two molecules looking alike does not make them act
alike; the fingerprint is a description, not an explanation.

## 7. Docking  (1.5 min)

**Docking & 3D** → target `mtb_inha` → select LEVOKETOCONAZOLE → the pose.

The coverage callout at the top of the page states how many of the scored
medicines have been docked at all. Read it out. Docking is run over a shortlist,
and everything else is *not yet docked* — which is not the same as docked and
found unpromising.

**Say:** −7.0 kcal/mol is **this project's screening target**, taken from the
presentation. It is not a scientific threshold at which binding becomes real.
A score below it means the simulation produced a favourable fit against the
project's own criterion, in a rigid protein, with no water and no cell.

**Do not say:** that the medicine binds InhA, or that docking confirms anything.

## 8. Clinical evidence  (1.5 min)

**Clinical Evidence**, then back to the candidate's clinical block.

Levoketoconazole's six studies: two Phase 3 in endogenous Cushing's syndrome
(NCT01838551, 94 participants; NCT03277690, 84), one open-label Phase 3
(NCT03621280, 51), and three Phase 1 pharmacology studies in healthy subjects.
All completed. None of them is about tuberculosis.

**Say:** this is the repurposing argument in one screen. A medicine with a
completed human safety record, being considered for a different target. The
trials tell you the drug has been given to people safely under supervision.
They say nothing whatsoever about tuberculosis.

**Say:** FDA approval for Cushing's syndrome is not approval for an infection,
and a registered trial is not a successful trial.

## 9. Medicine × Disease explorer  (2 min)

Sidebar → **Medicine × Disease**. Show all three modes.

**Medicine → Condition.** Medicine `TOPIRAMATE`, condition `Migraine`.
Documented trial evidence appears. **No percentage is shown**, and the page says
why: migraine is not one of the four modelled bacteria, so there is no model and
therefore no number. This is the honesty rule working in public.

Then switch the condition to `MRSA` for the same medicine — now a probability
appears, because a model exists.

**Condition → Medicines.** Condition `MRSA`. Medicines that have trial history
mentioning the condition, each with its evidence streams and its rung on the
ladder.

**Compare A vs B.** `TOPIRAMATE` vs `ZONISAMIDE`. Two evidence columns, side by
side.

**Say:** there is deliberately no winner here. The comparison shows what is
known about each medicine. Declaring one better would be a clinical claim the
system cannot support.

## 10. The evidence ladder  (30 s)

Still on the explorer. Five rungs: **Clinical > Experimental > Computational >
No evidence found > Not yet checked.** Each says what it means *and* what it
does not.

**Say:** the bottom two rungs are different statements. "No evidence found"
means we looked and found nothing. "Not yet checked" means we have not looked.
Neither means the medicine has no effect.

Since the full sweep, every one of the 1,691 medicines has been checked, so
"not yet checked" now appears for conditions and pairings rather than for whole
medicines. Do not present that as completeness of *evidence* — 212 medicines
returned no studies at all, and that is "no evidence found".

## 11. The control — showing the model is not just agreeing with itself  (1 min)

Search `CIPROFLOXACIN`, pathogen *K. pneumoniae*.

| Field | Value |
| --- | --- |
| AI-predicted activity | **1.000** (renders as `>99%`, never `100%`) |
| Model | RF-kpneumoniae-v5 |
| Split membership | **test** — held out, with 294 measurements behind its label |
| Docking | −8.331 kcal/mol against KPC-2 carbapenemase, PDB 2OV5 chain A |
| Registered trials | 50 |

**Say:** this one is a known antibiotic, and the model never trained on it — it
sat in the held-out test split. Ranking it at the top is the kind of check that
makes the levoketoconazole score worth taking seriously as a hypothesis.

## 12. Models and data  (1 min)

**Model & Dataset**.

Selection is on **prevalence-adjusted PR-AUC**, on the validation split only.
Raw PR-AUC is inflated by how common actives are in a test set; on this project
it once kept a ROC-0.67 model in service.

Show the sanity findings, and read the resistance-phenotype line:

> Resistance phenotype coverage is limited in the underlying data, so the
> current models primarily represent pathogen/species-level activity.

Per pathogen: MRSA 12.9%, *K. pneumoniae* 13.9%, *M. tuberculosis* 1.9%,
*E. coli* **0.0%**.

**Do not say:** that the model predicts resistance. It does not.

## 13. Limitations, and what is not built  (1 min)

**Overview** → limitations, and the future-work section.

- Docking covers a shortlist, not the library.
- Resistance-phenotype coverage is low, and zero for *E. coli*.
- ChEMBL over-represents actives, so absolute metrics flatter the models.
- Graph neural networks, combination therapy, multi-disease models and the
  IP / 505(b)(2) angle are **future work in the presentation, not features of
  this build**.

## 14. Close

**Say:** the output of this system is a ranked list of hypotheses with their
evidence attached and their limits stated. The next step for a candidate like
levoketoconazole is a wet-lab MIC assay against *M. tuberculosis*, not a press
release.

---

## If something goes wrong

| Symptom | What to do |
| --- | --- |
| Page hangs on the loading skeleton | You are on `localhost`. Use `127.0.0.1`. |
| Numbers look stale after a code change | Stop the Streamlit process and start it again. |
| A candidate is missing from a table | The models were retrained; use the fallback, GATIFLOXACIN × MRSA (test split, −9.37 kcal/mol). |
| 3D viewer stays blank | It loads 3Dmol.js from a CDN. Without network, read the score and skip the viewer — the numbers are the evidence, the picture is not. |
| A page errors | **Run History** shows recent runs and their errors. Show it. A visible error is better than a smooth claim. |

## Phrases to use, and their opposites

| Use | Never |
| --- | --- |
| AI-predicted activity | effectiveness, success rate, cure probability |
| Computed molecular properties | proof of similarity |
| Computational docking evidence | proof of binding, "it binds" |
| Clinical-trial evidence | proof it works, approval for this disease |
| Prioritised candidate for further investigation | proven treatment, effective drug, cure |
| Project screening target (−7.0 kcal/mol) | binding cutoff, passing score |
| No evidence found / Not yet checked | no effect |
