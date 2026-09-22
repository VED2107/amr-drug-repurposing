"""Run history: every pipeline execution, with its counts, duration and failures."""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from .. import components as ui
from .. import data, theme

_STATUS_COLOR = {
    "SUCCESS": theme.CLINICAL, "PARTIAL": theme.LIMIT, "FAILED": theme.FAILURE,
    "SKIPPED": theme.NEUTRAL, "RUNNING": theme.PREDICTION,
}


def render() -> None:
    ui.page_header(
        "Run History",
        "Every pipeline execution with its records, duration, errors and outcome. "
        "Failures are stored, never discarded.",
        meta=data.header_meta(),
    )

    runs = data.pipeline_runs(limit=200)
    if runs.empty:
        ui.empty_state("No pipeline run recorded", "Run the pipeline to populate this view.",
                       "python -m src.pipeline.run")
        return

    # ------------------------------------------------------------ headline --
    total_errors = int(runs["error_count"].fillna(0).sum())
    failed = int((runs["status"] == "FAILED").sum())
    partial = int((runs["status"] == "PARTIAL").sum())
    ui.metric_grid([
        ("Runs recorded", f"{len(runs):,}", "all stages", "flow", "neutral"),
        ("Succeeded", f"{int((runs['status'] == 'SUCCESS').sum()):,}", "clean runs",
         "check", "clinical"),
        ("Partial", f"{partial:,}", "completed with item errors", "alert", "limitation"),
        ("Failed", f"{failed:,}", "stage aborted", "cross",
         "failure" if failed else "neutral"),
        ("Item errors", f"{total_errors:,}", "recorded individually", "alert",
         "limitation" if total_errors else "neutral"),
    ], columns=5)

    # ------------------------------------------------------------- timeline --
    ui.section("Activity", "records processed per run")
    plot = runs.dropna(subset=["started_at"]).copy()
    plot["when"] = pd.to_datetime(plot["started_at"], errors="coerce", utc=True)
    plot = plot.dropna(subset=["when"])
    if not plot.empty:
        fig = px.bar(
            plot.sort_values("when"), x="when", y="records_processed", color="stage",
            hover_data={"run_id": True, "status": True, "error_count": True},
            labels={"when": "", "records_processed": "Records processed", "stage": "Stage"},
        )
        fig.update_layout(height=290, barmode="stack", legend_title_text="")
        st.plotly_chart(fig, use_container_width=True)

    # ---------------------------------------------------------------- table --
    ui.section("Runs")
    stages = ["All stages"] + sorted(runs["stage"].unique().tolist())
    cols = st.columns([1, 1, 2])
    stage_choice = cols[0].selectbox("Stage", stages, key="hist_stage")
    status_choice = cols[1].selectbox(
        "Status", ["All", "SUCCESS", "PARTIAL", "FAILED", "SKIPPED", "RUNNING"], key="hist_status")

    view = runs.copy()
    if stage_choice != "All stages":
        view = view[view["stage"] == stage_choice]
    if status_choice != "All":
        view = view[view["status"] == status_choice]

    if view.empty:
        ui.empty_state("No runs match this filter", "Clear the filter to see every run.")
        return

    ui.data_table(
        view[["run_id", "stage", "started_at", "finished_at", "duration_seconds", "status",
              "records_processed", "records_new", "records_skipped", "error_count"]].rename(
            columns={"run_id": "Run ID", "stage": "Stage", "started_at": "Started",
                     "finished_at": "Finished", "duration_seconds": "Duration (s)",
                     "status": "Status", "records_processed": "Records",
                     "records_new": "New", "records_skipped": "Skipped",
                     "error_count": "Errors"}),
        dash_columns=["Finished", "Duration (s)"],
        height=360,
    )

    # ------------------------------------------------------------ one run --
    ui.section("Inspect a run")
    run_id = st.selectbox("Run", view["run_id"].tolist(), key="hist_run")
    record = view[view.run_id == run_id].iloc[0]

    left, right = st.columns([1, 1.3], gap="medium")
    with left:
        ui.kv_block([
            ("Run ID", record["run_id"]),
            ("Stage", record["stage"]),
            ("Status", record["status"]),
            ("Started", record["started_at"]),
            ("Finished", record["finished_at"]),
            ("Duration", f"{record['duration_seconds']} s"
             if pd.notna(record["duration_seconds"]) else "—"),
            ("Processed", f"{int(record['records_processed']):,}"),
            ("New", f"{int(record['records_new']):,}"),
            ("Skipped", f"{int(record['records_skipped']):,}"),
            ("Errors", f"{int(record['error_count']):,}"),
        ])
    with right:
        if record["message"]:
            st.caption("Run detail")
            st.code(str(record["message"])[:4000])
        else:
            ui.empty_state("No run detail recorded",
                           "This stage completed without additional notes.")

    errors = data.run_errors(run_id)
    if errors.empty:
        ui.callout("This run recorded no per-item errors.", kind="clinical", label="Clean run")
    else:
        ui.section("Item errors", "one failed record never aborts a stage")
        ui.data_table(
            errors.rename(columns={"subject": "Subject", "error_type": "Type",
                                   "message": "Message", "created_at": "When"}),
            dash_columns=["Subject", "Type", "Message"], height=280,
            caption="Every failure is stored with its subject, so the gap in coverage is "
                    "visible rather than silent.",
        )
