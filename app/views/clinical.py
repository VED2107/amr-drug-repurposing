"""Clinical evidence: registered human studies, kept distinct from AMR efficacy."""

from __future__ import annotations

import plotly.express as px
import streamlit as st

from .. import components as ui
from .. import data, theme


def render() -> None:
    ui.page_header(
        "Clinical Evidence",
        "Registered human studies retrieved from ClinicalTrials.gov for shortlisted "
        "candidates. Clinical history is context, not proof of antimicrobial efficacy.",
        meta=data.header_meta(),
    )
    ui.callout(ui.DISCLAIMER_CLINICAL, kind="clinical", label="Clinical context")

    counts = data.overview_counts()
    if counts["clinical_records"] == 0:
        ui.empty_state(
            "No clinical record found",
            "No relevant ClinicalTrials.gov evidence is currently available. The clinical "
            "stage queries shortlisted candidates only.",
            "python -m src.pipeline.clinical --limit 50",
        )
        return

    all_trials = data.clinical_table(amr_only=False, limit=2000)
    n_amr = int(all_trials["amr_related"].sum())

    ui.section("Coverage")
    ui.metric_grid([
        ("Studies retrieved", f"{len(all_trials):,}", "registered records", "clipboard", "clinical"),
        ("Infection-related", f"{n_amr:,}", "conditions name an infection", "check", "clinical"),
        ("Other indications", f"{len(all_trials) - n_amr:,}", "not AMR evidence",
         "alert", "limitation"),
        ("Drugs queried", f"{counts['clinical_queried']:,}", "including zero-result queries",
         "search", "clinical"),
    ], columns=4)

    ui.spacer(".75rem")
    ui.callout(
        "<strong>How the two categories differ.</strong> &ldquo;Infection-related&rdquo; means "
        "the study's <em>own</em> stated condition or title mentions an infection or resistance "
        "context. It establishes that the compound has been given to humans in an infection "
        "setting. It does <strong>not</strong> establish activity against a resistant organism, "
        "and an unrelated trial establishes nothing about AMR at all.",
        kind="limitation", label="Limitation",
    )

    # ----------------------------------------------------------- breakdown --
    ui.section("Study characteristics")
    cols = st.columns(2, gap="medium")
    with cols[0]:
        phases = all_trials["phase"].fillna("Not applicable").value_counts().reset_index()
        phases.columns = ["phase", "n"]
        fig = px.bar(phases.head(10).iloc[::-1], x="n", y="phase", orientation="h",
                     labels={"n": "Studies", "phase": ""})
        fig.update_traces(marker_color=theme.CLINICAL)
        fig.update_layout(height=300, title="By phase")
        st.plotly_chart(fig, use_container_width=True)
    with cols[1]:
        statuses = all_trials["overall_status"].fillna("Unknown").value_counts().reset_index()
        statuses.columns = ["status", "n"]
        fig = px.bar(statuses.head(10).iloc[::-1], x="n", y="status", orientation="h",
                     labels={"n": "Studies", "status": ""})
        fig.update_traces(marker_color=theme.PREDICTION)
        fig.update_layout(height=300, title="By recruitment status")
        st.plotly_chart(fig, use_container_width=True)

    # --------------------------------------------------------------- table --
    ui.section("Records")
    controls = st.columns([1.1, 1, 2])
    amr_only = controls[0].toggle("Infection-related only", value=False, key="clin_amr")
    limit = controls[1].selectbox("Rows", [100, 250, 500, 1000], index=1, key="clin_limit")
    search = controls[2].text_input("Filter by drug or condition", key="clin_search",
                                    label_visibility="collapsed",
                                    placeholder="Filter by drug, condition or title")

    table = data.clinical_table(amr_only=amr_only, limit=int(limit))
    if search.strip():
        token = search.strip().lower()
        mask = (
            table["drug"].fillna("").str.lower().str.contains(token)
            | table["conditions"].fillna("").str.lower().str.contains(token)
            | table["brief_title"].fillna("").str.lower().str.contains(token)
        )
        table = table[mask]

    if table.empty:
        ui.empty_state("No records match this filter",
                       "Clear the filter to see all retrieved studies.")
        return

    table = table.copy()
    table["Evidence type"] = table["amr_related"].map(
        {1: "Infection-related study", 0: "Unrelated indication"})
    records = table[["nct_id", "drug", "brief_title", "conditions", "interventions", "phase",
                     "overall_status", "study_type", "Evidence type", "url"]].rename(columns={
        "nct_id": "Trial ID", "drug": "Drug", "brief_title": "Title",
        "conditions": "Condition", "interventions": "Intervention", "phase": "Phase",
        "overall_status": "Status", "study_type": "Study type", "url": "Public record"})

    ui.data_table(
        records,
        dash_columns=["Drug", "Title", "Condition", "Intervention", "Phase",
                      "Status", "Study type"],
        height=460,
        column_config={"Public record": st.column_config.LinkColumn(
            "Public record", display_text="open")},
        caption="A dash marks a field the registry does not provide for that study.",
    )

    st.download_button("Download records (CSV)", records.to_csv(index=False).encode("utf-8"),
                       file_name="amr_clinical_evidence.csv", mime="text/csv")
