"""Drug screening: a search workspace over every scored compound."""

from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import components as ui
from .. import content, data


def render() -> None:
    cfg = data.get_config()
    pathogens = cfg.pathogens

    ui.page_header(
        "Drug Screening",
        "Search the scored approved-drug library by name, identifier or structure. "
        "Every probability is model output, not clinical evidence.",
        meta=data.header_meta(),
    )
    ui.callout(ui.DISCLAIMER_GLOBAL, kind="prediction", label="AI prediction")

    # --------------------------------------------------------------- filters --
    ui.section("Search and filter")
    row1 = st.columns([2.4, 1.1, 1.1, 0.9])
    search = row1[0].text_input(
        "Search", placeholder="Drug name, brand, ChEMBL ID, InChIKey or SMILES substring",
        key="screen_search", label_visibility="collapsed",
    )
    pathogen_labels = {"All pathogens": None} | {content.pathogen(p.key)["short"]: p.key for p in pathogens}
    pathogen_choice = row1[1].selectbox("Pathogen", list(pathogen_labels), key="screen_pathogen")
    min_probability = row1[2].slider("Min probability", 0.0, 1.0, 0.0, 0.05, key="screen_prob")
    limit = row1[3].selectbox("Rows", [100, 250, 500, 1000], index=2, key="screen_limit")

    row2 = st.columns(4)
    approved_only = row2[0].toggle("FDA-approved only", value=True, key="screen_approved")
    require_docking = row2[1].toggle("Has docking evidence", value=False, key="screen_dock")
    require_clinical = row2[2].toggle("Has clinical history", value=False, key="screen_clin")
    show_properties = row2[3].toggle("Show properties", value=False, key="screen_props")

    df = data.screening_table(
        pathogen=pathogen_labels[pathogen_choice],
        min_probability=min_probability,
        approved_only=approved_only,
        require_docking=require_docking,
        require_clinical=require_clinical,
        search=search,
        limit=int(limit),
    )

    ui.section("Results", f"{len(df):,} rows" if not df.empty else "")
    if df.empty:
        ui.empty_state(
            "No compounds match these filters",
            "Loosen the filters, or run the screening stage if no predictions exist yet.",
            "python -m src.pipeline.predict",
        )
        return

    label_by_key = {p.key: content.pathogen(p.key)["short"] for p in pathogens}
    strain = data.strain_evidence().set_index("pathogen_key")

    view = df.copy()
    view["pathogen"] = view["pathogen"].map(lambda k: label_by_key.get(k, k))
    view["clinical"] = view.apply(
        lambda r: "not checked" if not r["clinical_checked"]
        else f"{int(r['clinical_trials'])} ({int(r['amr_related_trials'])} infection)",
        axis=1,
    )
    # Resistance evidence is a property of the pathogen's training data, so it
    # belongs beside every prediction made for that pathogen.
    view["resistance"] = df["pathogen"].map(
        lambda k: f"{strain.loc[k, 'resistant_records'] / strain.loc[k, 'labelled_records']:.0%}"
        if k in strain.index and strain.loc[k, "labelled_records"] else "—"
    )

    columns = {
        "drug": "Drug", "brand_name": "Brand", "pathogen": "Pathogen",
        "ml_probability": "AI-predicted activity", "approval": "Approval",
        "docking_score": "Predicted binding strength", "clinical": "Clinical studies found",
        "resistance": "Resistance evidence", "model_version": "AI model used",
        "predicted_at": "Updated",
    }
    if show_properties:
        columns |= {"mw": "MW", "logp": "LogP", "lipinski_violations": "Drug-likeness breaks",
                    "chembl_id": "ChEMBL", "inchikey": "InChIKey"}

    table = view[list(columns)].rename(columns=columns).copy()
    table["AI-predicted activity"] = pd.to_numeric(
        table["AI-predicted activity"], errors="coerce").fillna(0.0)

    def as_text(series: pd.Series, spec: str) -> pd.Series:
        numeric = pd.to_numeric(series, errors="coerce")
        return numeric.map(lambda v: "—" if pd.isna(v) else format(v, spec))

    for column, spec in (("Predicted binding strength", ".2f"), ("MW", ".1f"),
                         ("LogP", ".2f"), ("Drug-likeness breaks", ".0f")):
        if column in table.columns:
            table[column] = as_text(table[column], spec)

    ui.data_table(
        table,
        dash_columns=["Brand", "Approval", "AI model used", "Updated", "ChEMBL", "InChIKey"],
        height=540,
        column_config={
            "AI-predicted activity": ui.probability_column("AI-predicted activity"),
            "Predicted binding strength": st.column_config.TextColumn(
                help="A dash means the compound has not been docked, not that it docked poorly."),
            "Resistance evidence": st.column_config.TextColumn(
                help="Share of this pathogen's labelled training records that come from an "
                     "assay naming a resistant strain."),
        },
        caption="Click a column header to sort. A dash marks evidence that does not exist; "
                "it never means zero.",
    )

    # ------------------------------------------------------------- drilldown --
    ui.section("Open a compound")
    options = view[["molecule_id", "drug"]].drop_duplicates("molecule_id")
    left, right = st.columns([3, 1])
    choice = left.selectbox(
        "Compound", options["molecule_id"].tolist(),
        format_func=lambda mid: f"{options.loc[options.molecule_id == mid, 'drug'].iloc[0]}",
        key="screen_pick", label_visibility="collapsed",
    )
    if right.button("View details", key="screen_open", use_container_width=True):
        st.session_state["selected_molecule"] = choice
        st.switch_page(st.session_state["_pages"]["drug_details"])

    st.download_button(
        "Download this table (CSV)", table.to_csv(index=False).encode("utf-8"),
        file_name="amr_screening.csv", mime="text/csv",
    )
