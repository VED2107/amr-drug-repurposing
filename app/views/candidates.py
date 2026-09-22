"""Candidate explorer: the prioritised worklist, with evidence shown openly."""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from .. import components as ui
from .. import content, data, theme

CARDS_PER_ROW = 4


def render() -> None:
    cfg = data.get_config()
    keys = [p.key for p in cfg.pathogens]
    labels = {p.key: content.pathogen(p.key)["short"] for p in cfg.pathogens}

    ui.page_header(
        "Candidate Explorer",
        "Prioritised candidates for experimental validation, ordered by combined "
        "computational evidence. Nothing here is a treatment recommendation.",
        meta=data.header_meta(),
    )
    ui.callout(ui.DISCLAIMER_GLOBAL, kind="prediction", label="AI prediction")

    default = st.session_state.get("selected_pathogen", keys[0])
    index = keys.index(default) if default in keys else 0

    controls = st.columns([1.3, 1.2, 1.2, 1])
    pathogen = controls[0].selectbox("Pathogen", keys, index=index,
                                     format_func=lambda k: labels[k], key="cand_pathogen")
    st.session_state["selected_pathogen"] = pathogen

    threshold = float(cfg.get("screening", "candidate_probability_threshold", default=0.6))
    min_probability = controls[1].slider("Min AI probability", 0.0, 1.0, threshold, 0.05,
                                         key="cand_prob")
    sort_by = controls[2].selectbox(
        "Sort by", ["Composite score", "AI probability", "Docking score",
                    "Clinical history", "Molecular weight"], key="cand_sort")
    limit = controls[3].selectbox("Max rows", [50, 100, 200, 500], index=2, key="cand_limit")

    df = data.candidates(pathogen, min_probability=min_probability, limit=int(limit))

    if df.empty:
        ui.empty_state(
            f"No candidates for {labels[pathogen]} above probability {min_probability:.2f}",
            "Either no model is active for this pathogen, or no compound clears the "
            "threshold. Lower the threshold, or run training and screening.",
            "python -m src.pipeline.train --benchmark && python -m src.pipeline.predict",
        )
        return

    sort_columns = {
        "Composite score": ("composite_score", False),
        "AI probability": ("ml_probability", False),
        "Docking score": ("docking_score", True),
        "Clinical history": ("n_clinical_trials", False),
        "Molecular weight": ("mw", True),
    }
    column, ascending = sort_columns[sort_by]
    if column in df.columns:
        df = df.sort_values(column, ascending=ascending, na_position="last").reset_index(drop=True)
        df["rank"] = range(1, len(df) + 1)

    # ----------------------------------------------------------- top cards --
    ui.section(f"{ui.CANDIDATE_LABEL}s", f"{len(df):,} for {labels[pathogen]}")
    st.caption(
        "Computationally promising; requires experimental validation. The composite score is "
        "an explicit weighted sum of the evidence beside it - it orders a worklist and "
        "measures nothing biological."
    )
    ui.spacer(".5rem")

    top = df.head(CARDS_PER_ROW).to_dict("records")
    ids = tuple(r["molecule_id"] for r in top)

    # All four bacteria per medicine, plus which evidence kinds exist - the card
    # answers "what do we know about this?", not "what does the model file say?".
    pred_frame = data.predictions_for(ids)
    by_molecule: dict[str, dict[str, float]] = {}
    for _, r in pred_frame.iterrows():
        by_molecule.setdefault(r["molecule_id"], {})[r["pathogen_key"]] = float(r["probability"])

    flag_frame = data.evidence_flags(ids)
    flags = {
        r["molecule_id"]: {"measured": bool(r["measured"]), "docked": bool(r["docked"]),
                           "clinical": bool(r["clinical"])}
        for _, r in flag_frame.iterrows()
    } if not flag_frame.empty else {}

    cols = st.columns(len(top), gap="small")
    for col, row in zip(cols, top):
        mid = row["molecule_id"]
        with col:
            ui.candidate_card(
                row, int(row["rank"]),
                predictions=by_molecule.get(mid, {}),
                evidence=flags.get(mid, {}),
                why=ui.why_flagged(
                    labels[pathogen], row.get("ml_probability"),
                    bool(flags.get(mid, {}).get("measured")),
                ),
            )
            if st.button("View drug", key=f"cand_open_{mid}", use_container_width=True):
                st.session_state["selected_molecule"] = mid
                st.switch_page(st.session_state["_pages"]["drug_details"])

    # ---------------------------------------------------------------- table --
    ui.section("Full list")
    columns = {
        "rank": "#", "display_name": "Compound", "ml_probability": "AI-predicted activity",
        "docking_score": "Predicted binding strength", "n_clinical_trials": "Clinical studies found",
        "n_amr_trials": "Infection studies", "lipinski_violations": "Drug-likeness breaks",
        "composite_score": "Composite", "evidence_weight": "Evidence coverage",
        "model_version": "AI model used",
    }
    present = {k: v for k, v in columns.items() if k in df.columns}
    table = df[list(present)].rename(columns=present).copy()

    for col in ("AI-predicted activity", "Composite", "Evidence coverage"):
        if col in table.columns:
            table[col] = pd.to_numeric(table[col], errors="coerce").fillna(0.0)

    def as_text(series: pd.Series, spec: str) -> pd.Series:
        numeric = pd.to_numeric(series, errors="coerce")
        return numeric.map(lambda v: "—" if pd.isna(v) else format(v, spec))

    for col, spec in (("Predicted binding strength", ".2f"),
                      ("Clinical studies found", ".0f"),
                      ("Infection studies", ".0f"), ("Drug-likeness breaks", ".0f")):
        if col in table.columns:
            table[col] = as_text(table[col], spec)

    ui.data_table(
        table, dash_columns=["AI model used"], height=430,
        column_config={
            "AI-predicted activity": ui.probability_column("AI-predicted activity"),
            "Composite": st.column_config.ProgressColumn(
                "Composite", min_value=0.0, max_value=1.0, format="%.3f",
                help="Configurable weighted sum of available evidence. A prioritisation aid."),
            "Evidence coverage": st.column_config.ProgressColumn(
                "Evidence coverage", min_value=0.0, max_value=1.0, format="%.0%%",
                help="Fraction of configured evidence streams actually available."),
            "Predicted binding strength": st.column_config.TextColumn(
                help="AutoDock Vina score in kcal/mol. More negative means a tighter "
                     "predicted fit. A dash means not docked - not a poor score."),
            "Clinical studies found": st.column_config.TextColumn(
                help="Registered human studies on record. A dash means not yet checked."),
        },
    )

    # ----------------------------------------------------------- evidence map --
    plot_df = df.dropna(subset=["ml_probability"]).copy()
    if not plot_df.empty and plot_df["docking_score"].notna().any():
        ui.section("Evidence map", "AI prediction against docking evidence")
        plot_df["has_docking"] = plot_df["docking_score"].notna().map(
            {True: "Docked", False: "Not docked"})
        fig = px.scatter(
            plot_df, x="ml_probability", y="docking_score",
            size=plot_df["n_clinical_trials"].fillna(0).clip(lower=0) + 5,
            color="has_docking", hover_name="display_name",
            labels={"ml_probability": "AI probability of activity",
                    "docking_score": "Best docking score (kcal/mol, lower is tighter)"},
            color_discrete_map={"Docked": theme.DOCKING, "Not docked": theme.INK_FAINT},
        )
        interest = float(cfg.get("docking", "interest_threshold_kcal_mol", default=-7.0))
        fig.add_hline(y=interest, line_dash="dot", line_color=theme.LIMIT,
                      annotation_text=f"configured display threshold {interest} kcal/mol",
                      annotation_font_color=theme.LIMIT, annotation_font_size=10)
        fig.update_layout(height=380, legend_title_text="")
        st.plotly_chart(fig, use_container_width=True)
        st.caption(
            "Point size reflects registered human trials. Compounds without a docking score "
            "are omitted from this chart rather than drawn at zero."
        )

    # ----------------------------------------------------------- inspection --
    ui.section("Inspect a candidate")
    pick = st.selectbox(
        "Candidate", df["molecule_id"].tolist(),
        format_func=lambda mid: str(df.loc[df.molecule_id == mid, "display_name"].iloc[0]),
        key="cand_pick",
    )
    row = df[df.molecule_id == pick].iloc[0]

    left, right = st.columns([1.35, 1], gap="medium")
    with left:
        ui.kv_block([
            ("Compound", row.get("display_name")),
            ("Molecule ID", row.get("molecule_id")),
            ("ChEMBL ID", row.get("chembl_id")),
            ("AI probability", ui.fmt(row.get("ml_probability"), ".4f")),
            ("Docking score", ui.fmt(row.get("docking_score"), ".2f")),
            ("Docking target", row.get("docking_target")),
            ("Composite score", ui.fmt(row.get("composite_score"), ".4f")),
            ("Score formula", row.get("score_formula")),
            ("Evidence used", row.get("components_used")),
            ("Model version", row.get("model_version")),
        ])
        if st.button("Open full drug details", key="cand_open"):
            st.session_state["selected_molecule"] = pick
            st.switch_page(st.session_state["_pages"]["drug_details"])
    with right:
        from src.chemistry.depict import mol_to_svg

        ui.structure_svg(mol_to_svg(row.get("canonical_smiles"), width=380, height=250),
                         caption="2D depiction generated with RDKit")

    st.download_button(
        "Download candidates (CSV)", table.to_csv(index=False).encode("utf-8"),
        file_name=f"amr_candidates_{pathogen}.csv", mime="text/csv",
    )
