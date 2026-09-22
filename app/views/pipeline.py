"""Pipeline: stage status and the new-drug inference path."""

from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import components as ui
from .. import data

_STAGE_DETAIL = {
    "ingest": ("Ingest", "ChEMBL bioactivity, FDA Orange Book approvals", "molecular"),
    "process": ("Chemistry", "standardise, fingerprint, label", "molecular"),
    "train": ("Train", "dataset version, benchmark, promote", "prediction"),
    "predict": ("Screen", "score the approved library", "prediction"),
    "dock": ("Dock", "AutoDock Vina on top candidates", "docking"),
    "clinical": ("Clinical", "ClinicalTrials.gov evidence", "clinical"),
}


def render() -> None:
    ui.page_header(
        "Pipeline",
        "Stage status and the incremental path a newly approved drug takes through the "
        "system. Opening this page performs no computation.",
        meta=data.header_meta(),
    )

    stages = data.latest_stage_runs()
    stage_status = {r["stage"]: dict(r) for _, r in stages.iterrows()} if not stages.empty else {}

    ui.section("Stage status", "outcome of each stage's last run")
    ui.pipeline_flow(stage_status)

    if stages.empty:
        ui.spacer(".75rem")
        ui.empty_state("No stage has run yet", "Run the full pipeline to populate this view.",
                       "python -m src.pipeline.run")
        return

    ui.spacer(".75rem")
    detail = stages.copy()
    detail["Stage"] = detail["stage"].map(lambda s: _STAGE_DETAIL.get(s, (s, "", ""))[0])
    detail["Does"] = detail["stage"].map(lambda s: _STAGE_DETAIL.get(s, ("", "", ""))[1])
    ui.data_table(
        detail[["Stage", "Does", "status", "started_at", "finished_at", "duration_seconds",
                "records_processed", "records_new", "records_skipped", "error_count"]].rename(
            columns={"status": "Status", "started_at": "Last run", "finished_at": "Finished",
                     "duration_seconds": "Seconds", "records_processed": "Processed",
                     "records_new": "New", "records_skipped": "Skipped",
                     "error_count": "Errors"}),
        dash_columns=["Finished", "Seconds", "Does"],
        caption="A stage still marked RUNNING has no finish time yet; its counts are written "
                "when it completes.",
    )

    # ------------------------------------------------------------ new drugs --
    ui.section("New drugs", "inference only — never retraining")
    ui.callout(
        "<strong>A new drug does not trigger retraining.</strong> When a drug appears it is "
        "normalised, its SMILES validated, fingerprinted, and scored with the model that "
        "already exists. Retraining is a separate event driven by new labelled bioactivity "
        "data — see the Retraining page.",
        kind="prediction", label="Automation rule",
    )
    ui.spacer(".6rem")

    drugs = data.new_drugs(limit=300)
    if drugs.empty:
        ui.empty_state("No approved drugs ingested", "Run ingestion to build the drug library.",
                       "python -m src.pipeline.ingest")
        return

    pending = int((drugs["prediction_status"] == "pending").sum())
    predicted = int((drugs["prediction_status"] == "predicted").sum())
    unmatched = int((drugs["processing_status"] == "unmatched").sum())
    ui.metric_grid([
        ("Products listed", f"{len(drugs):,}", "most recently seen first", "pill", "molecular"),
        ("Structure matched", f"{len(drugs) - unmatched:,}", "mapped to a molecule",
         "layers", "molecular"),
        ("Screened", f"{predicted:,}", "scored with the existing model", "brain", "prediction"),
        ("Awaiting screening", f"{pending:,}", "run the predict stage", "clock", "limitation"),
    ], columns=4)
    ui.spacer(".75rem")

    ui.data_table(
        drugs[["generic_name", "brand_name", "approval_source", "first_seen_at",
               "processing_status", "prediction_status", "match_method",
               "n_predictions"]].rename(columns={
            "generic_name": "Drug", "brand_name": "Brand", "approval_source": "Source",
            "first_seen_at": "Detected", "processing_status": "Processing",
            "prediction_status": "Prediction", "match_method": "Structure match",
            "n_predictions": "Predictions"}),
        dash_columns=["Brand", "Source", "Structure match"],
        height=400,
        caption="Screening is incremental: a molecule already scored by the active model is "
                "not rescored.",
    )
    st.code("python -m src.pipeline.predict", language="bash")

    # ------------------------------------------------------------- commands --
    ui.section("Commands")
    st.code(
        "\n".join([
            "python -m src.pipeline.ingest              # ChEMBL + FDA Orange Book",
            "python -m src.pipeline.process             # standardise, fingerprint, label",
            "python -m src.pipeline.train --benchmark   # train, compare, promote",
            "python -m src.pipeline.predict             # screen with the active model",
            "python -m src.pipeline.dock                # AutoDock Vina on top candidates",
            "python -m src.pipeline.clinical            # ClinicalTrials.gov evidence",
            "",
            "python -m src.pipeline.run                 # everything, in order",
            "python -m src.pipeline.run --incremental   # only what is new",
            "python -m src.pipeline.train --check       # is retraining due?",
        ]),
        language="bash",
    )
