# AMR drug repurposing — working notes

Read `docs/CODEBASE_MAP.md` first. It lists every file, what it does, and where
the data lives.

## What this project is

An AI-assisted system that screens already-approved medicines for antibacterial
activity against four drug-resistant bacteria — MRSA, E. coli, K. pneumoniae and
M. tuberculosis — then checks the molecular fit by docking and looks up what the
medicine has already been studied for. The presentation
(`AMR_Drug_Repurposing.pptx`) is the product source of truth; `CONTEXT.MD` is the
build specification.

## Rules that are not negotiable

These exist because the interface shows computational results about medicines to
non-specialists. Each is enforced in code and covered by a test — do not work
around one to make a layout or a query simpler.

1. **Never fabricate a number.** No placeholder metrics, no synthetic CSVs, no
   invented labels, no example trial records.
2. **A percentage always carries its meaning.** Use
   `app/components/explain.py:percent(value, label)`. Labels implying clinical
   benefit (effectiveness, success, cure, efficacy) raise `MisleadingLabelError`.
3. **Only the four modelled bacteria may show a probability.** Everything else
   goes through `app/data.py:match_modelled_pathogen()` and gets documented
   evidence plus an explicit "no model exists for this condition".
4. **Keep these three apart:** "no evidence found", "not yet checked", and "no
   effect". Also: a registered trial is not a successful trial, and FDA approval
   is not approval for a new indication.
5. **Never claim a prediction or a docking score proves a medicine treats a
   disease.** −7.0 kcal/mol is this project's screening target, not a universal
   binding cutoff.
6. **Do not delete or weaken tests to make the suite pass.** If behaviour
   changed on purpose, update the expected value and keep the assertion strong.

## Working on it

```bash
./.venv/Scripts/python.exe -m pytest tests/ -o addopts="" -q   # 337 tests, ~5 min
./.venv/Scripts/streamlit.exe run app/streamlit_app.py --server.port 8501
```

- Open the dashboard at `http://127.0.0.1:<port>`. On this machine `localhost`
  serves the HTML but never completes the websocket, so the page hangs on its
  loading skeleton.
- Streamlit does not reliably reload edited modules or drop `st.cache_data`
  results. After changing `app/data.py` or a view, restart the process.
- Verify responsive layout with Playwright, not by resizing a browser window:
  compare `document.documentElement.scrollWidth` with `clientWidth` at 1440,
  1024, 760 and 400px. Only `dvn-stack` (Streamlit's table grid, inside its own
  scroll container) may exceed the viewport.
- Run the pipeline stage by stage while iterating:
  `python -m src.pipeline.<ingest|process|train|predict|dock|clinical>`.

## Known gaps — state these, do not paper over them

- ClinicalTrials.gov coverage is complete: all 1,761 of 1,761 approved
  medicines have been queried, with 0 failures. 212 of them returned nothing,
  which is "no evidence found" — not "not yet checked", and not "no effect".
  Full registry coverage is *not* completeness of evidence, and a registered
  trial is still not a successful trial nor an approval for a new indication.
- Resistance-phenotype coverage is 7.2% overall and 0.0% for E. coli, so the
  models predict activity against the *species*, not the resistant phenotype.
- Batch docking (`src/batchdock/`, `docs/BATCH_DOCKING.md`) docks all 1,761
  medicines x 4 targets = 7,044 AutoDock Vina jobs from a Postgres queue in the
  `docking` schema, with workers in Docker. Read progress from
  `python -m src.batchdock status` or `/api/docking/status`; never quote a count.
  The receptors keep their NADPH/NAD cofactor (redocking failed without it).
  The legacy `amr.docking_results` (53 medicines, apo pocket) are kept, not mixed in.
- "Already an antibacterial" comes from WHO ATC codes (via ChEMBL) and FDA
  pharmacologic classes (openFDA), never from a name. Medicines neither source
  classifies stay among the repurposing candidates, marked for review. The
  update worker does not classify new medicines yet; until
  `python -m src.pipeline.classify` runs, a new medicine reads "not yet
  checked" and is kept.
- Graph neural networks, combination therapy, multi-disease models and the
  IP angle are future work in the presentation, not features of this build.

Read live counts from `data.clinical_coverage()` and `data.strain_evidence()`
rather than quoting the numbers above — running a stage changes them.
