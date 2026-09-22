# Activity labelling methodology

This document describes exactly how a heterogeneous bioactivity measurement
becomes a binary training label. It is the most scientifically consequential
decision in the project, so every rule is stated, configurable and recorded on
each stored record.

Implementation: [`src/ml/labeling.py`](../src/ml/labeling.py).
Configuration: the `labeling:` block of [`configs/config.yaml`](../configs/config.yaml).

---

## 1. Why a labelling strategy is needed at all

ChEMBL records antibacterial activity in several incompatible ways:

| Endpoint | Meaning | Typical units |
|---|---|---|
| MIC, MIC50, MIC90, MBC | whole-organism growth inhibition | µg/mL, nM |
| IC50, EC50 | half-maximal effect | nM, µM |
| Ki, Kd | binding affinity to an isolated target | nM |

These cannot be pooled as raw numbers. A MIC of `4` in µg/mL and an IC50 of `4`
in nM differ by six orders of magnitude. Averaging them, or thresholding them
on the raw value, would produce labels that mean nothing.

## 2. The common scale: pActivity

Every measurement is converted to

```
pActivity = -log10(molar potency)
```

so that higher is more potent, and all endpoints live on one comparable scale.

| pActivity | Molar | Interpretation |
|---|---|---|
| 4.0 | 100 µM | weak |
| 5.0 | 10 µM | modest |
| 6.0 | 1 µM | potent |
| 9.0 | 1 nM | very potent |

This is the same convention as ChEMBL's own `pchembl_value`.

### Conversion rules

1. **`pchembl_value` wins when present.** It is ChEMBL's curated conversion and
   is preferred over recomputing from the raw value.
2. **Molar units** (M, mM, µM, nM, pM) convert directly.
3. **Mass-per-volume units** (µg/mL, mg/L, mg/mL, ng/mL) require the molecular
   weight:

   ```
   molar = (value × unit_to_grams_per_litre) / molecular_weight
   ```

   The molecular weight is computed with RDKit from the standardised structure.
   **A record whose structure cannot be parsed is dropped, never guessed.** In
   practice µg/mL dominates the whole-cell antibacterial literature, so this
   conversion carries most of the dataset.
4. **Non-positive or non-numeric values are refused.** `-log10` is undefined for
   them, and clipping would invent a potency.
5. **Unknown units are refused** rather than assumed.

## 3. Thresholds

```yaml
active_threshold_pactivity:   5.0   # 10 µM  -> ACTIVE
inactive_threshold_pactivity: 4.0   # 100 µM -> INACTIVE
```

| Condition | Label |
|---|---|
| pActivity ≥ 5.0 | active (1) |
| pActivity ≤ 4.0 | inactive (0) |
| 4.0 < pActivity < 5.0 | **ambiguous — stored, excluded from training** |

The deliberate gap between the two cuts is the important part. Forcing a binary
call on genuinely borderline chemistry injects noise into the labels that no
model can recover from. Ambiguous records are kept in the database with
`label = NULL` and a stated reason, so the loss is visible and auditable rather
than silent.

10 µM is a conventional and defensible activity cut for whole-cell
antibacterial screening. It is a configuration value, not a law of nature;
raising it produces a smaller, more stringent dataset.

## 4. Censored measurements

A large fraction of published MICs are inequalities, and reading them backwards
is one of the easiest ways to corrupt a dataset.

| Relation | Meaning | What it can support |
|---|---|---|
| `>` `>=` | no effect observed up to this dose | **inactive only** |
| `<` `<=` | active at least this strongly | **active only** |
| `=` | point measurement | either |
| `~` | approximate | either, flagged in `pactivity_method` |

Concretely:

- `MIC > 128 µg/mL` — the compound did nothing at a high dose. This supports an
  **inactive** call. It can never support "active".
- `MIC > 1 nM` — technically true of almost every compound ever tested. It
  excludes nothing useful, so the record is **uninformative** and is left
  unlabelled.
- `MIC < 0.5 µg/mL` — the compound was already fully active at the lowest dose
  tested. This supports an **active** call.

Treating `>` as an equality would label weak compounds as potent whenever the
tested ceiling happened to be low. The `honour_censored_relations` flag controls
this behaviour and defaults to on.

## 5. Aggregating repeat measurements

One compound is frequently tested against one pathogen in many papers.

- **pActivity**: the **median** of the measurements. Median rather than mean
  because a single mistyped or outlying assay should not move the value.
- **Label**: majority vote across the individual labels, with ties resolved
  towards **active** — a reproducible active reading in any assay is the more
  informative observation.
- `n_measurements` is stored so a compound supported by one paper is
  distinguishable from one supported by twenty.

## 6. Trainability gates

A pathogen does **not** get a model unless:

```yaml
min_records_per_pathogen:      150   # labelled compounds
min_minority_class_records:     30   # compounds in the smaller class
```

If either gate fails, the dataset is built and stored, the pathogen is marked
untrainable, and the reason is reported in the dashboard and the pipeline
output. Producing a model from insufficient data would be worse than producing
none, because it would look like a result.

## 7. What the labels do and do not mean

A label of `1` means: **in at least one published assay, this compound
inhibited this organism at or below the configured potency threshold.**

It does **not** mean:

- the compound is an effective antibiotic,
- the compound works against a *resistant* strain specifically,
- the compound is safe,
- the compound will work in an animal or a human.

The `strain_specific` flag records whether the assay description explicitly
named a resistant strain (MRSA, ESBL, KPC, MDR/XDR). Assays on susceptible
strains are still used for training — a susceptible-strain MIC is a legitimate
measurement of whether the chemistry has antibacterial activity at all — but the
flag makes the distinction visible.

## 8. Known biases

- **Publication bias towards actives.** ChEMBL is built from the medicinal
  chemistry literature, which reports compounds that worked far more often than
  compounds that did not. Across the four pathogens here the labelled data runs
  roughly 55–75% active. Absolute performance metrics must be read against that
  prevalence, which is why model selection compares **prevalence-adjusted
  PR-AUC** rather than raw PR-AUC (see [ARCHITECTURE.md](ARCHITECTURE.md)).
- **Assay heterogeneity.** Different laboratories, media, inocula and strains
  produce different MICs for the same compound. Median aggregation reduces but
  does not eliminate this.
- **Structure coverage.** Records without a parseable SMILES are unusable and
  are dropped. The count is reported in the data quality audit.

## 9. Reproducibility

Every parameter above is hashed into the `config_hash` of the dataset version.
Two runs with the same configuration and the same source data produce the same
dataset version identifier, and every model records the dataset version it was
trained on.
