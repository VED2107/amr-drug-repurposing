# Limitations

Everything below is a real constraint on what this system can support. It is
written plainly because a prototype that overstates what it shows is worse than
no prototype.

## Scientific

### The training data is publication-biased towards actives

ChEMBL is assembled from the medicinal chemistry literature, which reports
compounds that worked far more often than compounds that did not. Across the
four pathogens the labelled data runs roughly 55–75% active.

Consequences:

- Raw PR-AUC is inflated, because PR-AUC is bounded below by the class
  prevalence. The dashboard displays the prevalence next to every metric, and
  model selection compares the **prevalence-adjusted** value.
- The models see relatively few well-characterised inactives, which is the
  harder and more useful class to learn.

### Most measurements are on susceptible reference strains

This is the most important limitation in the project, and it is now measured
rather than merely asserted.

The four targets are named for resistant organisms, but most published MICs are
measured on laboratory reference strains. The `strain_specific` flag is set only
when the assay's **own description** names a resistant phenotype (MRSA,
methicillin/oxacillin-resistant, ESBL, KPC, carbapenem-resistant, MDR/XDR).

Measured across the 35,232 labelled records in the current database:

| Pathogen | Labelled records | From a resistant-strain assay | Compounds with resistant evidence |
|---|---|---|---|
| MRSA | 9,377 | 1,212 (12.9%) | 829 of 4,559 (18.2%) |
| E. coli | 9,729 | **0 (0.0%)** | 0 of 5,217 (0.0%) |
| K. pneumoniae | 8,472 | 1,181 (13.9%) | 97 of 4,192 (2.3%) |
| M. tuberculosis | 7,654 | 143 (1.9%) | 104 of 4,259 (2.4%) |
| **Overall** | **35,232** | **2,536 (7.2%)** | |

**A model trained on this data predicts antibacterial activity against the
species, not activity against the resistant phenotype.** For E. coli no
resistant-strain annotation exists in the ingested records at all, so **no claim
about resistant E. coli is supported by this data**.

Concretely: a high MRSA probability means the compound resembles chemistry that
inhibits *Staphylococcus aureus* in published assays. It does **not** mean the
compound overcomes methicillin resistance. That distinction is the difference
between an interesting hypothesis and a clinically relevant one, and this system
only supports the former.

The dashboard states this fraction on the Overview page, on each pathogen card,
and in a dedicated "Resistance evidence" tab on the Model and dataset page. The
dataset sanity checks raise a warning whenever the fraction falls below 25%.

### Assay heterogeneity is only partly controlled

MIC depends on strain, medium, inoculum density, incubation time and reading
method. The same compound can differ several-fold between laboratories. Median
aggregation across repeat measurements reduces this but does not remove it.

### The active/inactive thresholds are conventions

10 µM (active) and 100 µM (inactive) are defensible conventional cuts for
whole-cell antibacterial screening, not natural constants. Different thresholds
produce a different dataset and different models. They are configurable and
recorded in the dataset version hash.

### Endpoints are mixed

MIC, MBC, IC50, EC50, Ki and Kd measure related but distinct quantities.
Converting them all to pActivity puts them on one numeric scale but does not
make them biologically equivalent — a Ki against an isolated enzyme and a
whole-cell MIC answer different questions.

## Docking

### Rigid receptor, no cofactors

Receptors are prepared as rigid single chains. Waters, buffer molecules and
cofactors are excluded. For the two dihydrofolate reductase targets this means
the NADPH cofactor is absent and scores describe the apo folate pocket; for InhA
the NAD cofactor is likewise absent.

Not modelled: protein flexibility, induced fit, explicit solvation, entropy,
protonation-state variation.

### Docking scores are weak predictors of binding

AutoDock Vina's scoring function is a fast empirical approximation. Its
correlation with measured affinity is modest even in well-behaved systems. A
good score means the pose is geometrically and chemically plausible; it is not a
measurement.

The `-7.0 kcal/mol` figure from the project brief is exposed as a configurable
**display** threshold. It is not a scientific cutoff and should not be used as
one.

### One target per pathogen

Each pathogen has a single, well-validated docking target. A compound may be
antibacterial through an entirely different mechanism — cell wall synthesis,
membrane disruption, ribosomal inhibition, efflux inhibition — and would score
poorly here despite being active. **A weak docking score is not evidence of
inactivity.**

### Large, flexible ligands are excluded from docking

Vina's stochastic search cost and reliability are driven by ligand flexibility.
Candidates above `docking.max_ligand_rotatable_bonds` (default 10) or
`max_ligand_heavy_atoms` (default 60) are skipped, and the count of skipped
compounds is reported per target.

This is a real coverage gap and it is not random: it removes glycopeptides
(vancomycin, oritavancin), polymyxins and the larger macrolides — several of
which are clinically important antibacterials. Observed behaviour that set the
bound: rifampin (59 heavy atoms, 4 rotatable bonds) docks in about ten seconds,
while telithromycin (58 heavy atoms, 11 rotatable bonds) exceeded a 600-second
ceiling without converging. Any ligand that does exceed the ceiling is recorded
as a timeout rather than being reported with a partial score.

**These compounds still receive ML predictions and appear in the candidate
list**; they simply carry no docking evidence, which the dashboard shows as a
dash rather than as a poor score.

### Nothing models getting into the cell

Gram-negative outer membrane permeability and efflux are the dominant reasons
that otherwise potent compounds fail against E. coli and K. pneumoniae. Neither
the model nor the docking addresses them.

## Data mapping

### Orange Book products map to structures by name

The Orange Book contains ingredient names, not structures. Names are normalised
(salts and hydrates stripped, parentheticals removed) and matched against ChEMBL
preferred names and synonyms. The method used for each product is stored in
`match_method`.

- Combination products resolve on their first matchable component, recorded as
  `combination_component_N`. The other components are not structurally resolved.
- Unmatched products are kept with `match_method = 'unmatched'` and are not
  screened.
- Biologics, peptides and mixtures frequently have no usable small-molecule
  structure at all.

### Salt forms collapse to the parent

Standardisation strips counter-ions, so different salt forms of one drug become
one molecule. This is correct for structure-activity purposes but means the
dashboard shows one row where the Orange Book has several products.

## Clinical evidence

### A trial record is not efficacy evidence

Registered studies establish that a compound has been given to humans for some
indication. They say nothing about activity against a resistant organism.

The `amr_related` flag is set only when the study's own title or conditions name
an infection or resistance context. It means **"this trial concerns an
infection"**, not **"this drug treats resistant infection"**. Intervention text
is deliberately excluded from the match so that an antibiotic used as background
therapy in an unrelated trial is not miscounted.

### Coverage is partial by design

Only shortlisted candidates are queried, and the query is a drug-name search.
Name ambiguity and synonym coverage both limit recall.

## Machine learning

### Morgan fingerprints are a fixed, limited representation

1024-bit Morgan fingerprints (radius 2) are specified by the project. They
encode local substructural environments and are a strong, well-understood
baseline, but they are lossy — bit collisions occur, and they do not represent
3D conformation, stereochemistry (disabled by default), or physicochemical
context.

### Scaffold splits are pessimistic, random splits are optimistic

The scaffold split is used because a random split lets close analogues sit on
both sides and inflates the score. Scaffold splits are the stricter, more
honest choice, and reported metrics will be lower than a random split would
give. Neither is a substitute for prospective validation.

### Feature importance is not mechanism

Fingerprint-bit importance indicates which substructural patterns the model
relies on. It does not establish a biological mechanism, and the dashboard says
so wherever it is shown.

### No prospective validation

No prediction from this system has been tested experimentally. Every reported
metric is retrospective, on held-out data drawn from the same literature as the
training set.

## Engineering

### Ingestion is capped

`max_activities_per_pathogen` (default 12,000) bounds how much bioactivity is
pulled per pathogen so a first build completes in minutes. The full ChEMBL
corpus for these organisms is considerably larger. Raising the cap yields a
larger dataset and a longer run.

### SQLite, single machine

Appropriate for a prototype at this scale, and deliberately chosen over a
distributed setup. It is not a multi-writer production store.

### Demo mode is a subset, not a simulation

`scripts/build_demo.py` copies a deterministic slice of a real run and flags
every row `is_demo = 1`. It contains real data, clearly labelled. It does not
fabricate predictions, docking scores or trial records.

## What this system does not do

- It does not demonstrate that any drug treats any infection.
- It does not assess safety. Lipinski compliance is oral drug-likeness in
  silico, not an ADMET prediction and not a safety assessment.
- It does not replace experimental validation. It orders a worklist for it.
