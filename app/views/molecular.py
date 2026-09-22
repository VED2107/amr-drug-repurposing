"""Molecular analysis: a computational chemistry workspace over the library."""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from src.chemistry.depict import mol_to_svg

from .. import components as ui
from .. import data, theme


@st.cache_data(ttl=data.CACHE_TTL)
def _library_properties(approved_only: bool) -> pd.DataFrame:
    join = "JOIN drugs d ON d.molecule_id = m.molecule_id" if approved_only else ""
    return data._df(
        f"""SELECT m.molecule_id, m.pref_name, m.mw, m.logp, m.tpsa, m.hbd, m.hba,
                   m.rotatable_bonds, m.aromatic_rings, m.fraction_csp3, m.qed,
                   m.lipinski_violations, m.murcko_scaffold
            FROM molecules m {join}
            WHERE m.is_valid = 1 AND m.mw IS NOT NULL
            GROUP BY m.molecule_id"""
    )


@st.cache_data(ttl=data.CACHE_TTL)
def _validation_audit() -> pd.DataFrame:
    return data._df(
        """SELECT COALESCE(validation_error, 'valid') AS reason, COUNT(*) AS n
           FROM molecules GROUP BY reason ORDER BY n DESC"""
    )


@st.cache_data(ttl=data.CACHE_TTL)
def _scaffold_counts(limit: int = 15) -> pd.DataFrame:
    return data._df(
        """SELECT murcko_scaffold, COUNT(*) AS n
           FROM molecules WHERE is_valid = 1 AND murcko_scaffold IS NOT NULL
             AND murcko_scaffold <> '__acyclic__'
           GROUP BY murcko_scaffold ORDER BY n DESC LIMIT ?""",
        (int(limit),),
    )


def _predict_panel(cfg) -> None:
    st.caption(
        "Score an arbitrary structure with the active models. This is an exploratory "
        "query: nothing is written to the database."
    )
    smiles = st.text_input("SMILES", value="", key="mol_smiles",
                           placeholder="CC(=O)Oc1ccccc1C(=O)O")
    if not smiles.strip():
        ui.empty_state("Prediction unavailable",
                       "Enter a SMILES string above to score it against the active models.")
        return

    from src.ml.predict import predict_smiles

    conn = data.open_conn()
    try:
        with st.spinner("Standardising structure and scoring with the active models…"):
            result = predict_smiles(conn, cfg, smiles)
    finally:
        conn.close()

    if not result["ok"]:
        ui.error_state("Structure rejected", str(result["error"]))
        return

    left, right = st.columns([1, 1.3], gap="medium")
    with left:
        ui.structure_svg(mol_to_svg(result["canonical_smiles"], 360, 250))
    with right:
        ui.kv_block([
            ("Canonical SMILES", result["canonical_smiles"]),
            ("InChIKey", result["inchikey"]),
            ("Molecule ID", result["molecule_id"]),
        ])

    labels = {p.key: p.label for p in cfg.pathogens}
    rows = [
        {"Pathogen": labels.get(key, key),
         "Probability": value.get("probability"),
         "Model": value.get("model_version") or value.get("reason")}
        for key, value in result["predictions"].items()
    ]
    ui.data_table(pd.DataFrame(rows), dash_columns=["Model"],
                  column_config={"Probability": ui.probability_column("Probability")})
    ui.callout(ui.DISCLAIMER_GLOBAL, kind="prediction", label="AI prediction")


def render() -> None:
    cfg = data.get_config()
    fp = cfg.get("chemistry", "fingerprint", default={})

    ui.page_header(
        "Molecular Analysis",
        "Chemistry of the processed library: property space, scaffolds, structure "
        "quality and ad-hoc scoring.",
        meta=data.header_meta(),
    )
    ui.callout(
        f"Molecular representation: <strong>{fp.get('n_bits')}-bit Morgan fingerprint, "
        f"radius {fp.get('radius')}</strong>, computed with RDKit from canonicalised, "
        f"salt-stripped structures. Feature version "
        f"<code>{ui.esc(cfg.get('ml', 'feature_version'))}</code>.",
        kind="molecular", label="Molecular evidence",
    )

    tabs = st.tabs(["Property space", "Scaffolds", "Structure quality", "Predict a structure"])

    # ---------------------------------------------------------- properties --
    with tabs[0]:
        approved_only = st.toggle("Approved drugs only", value=True, key="mol_approved")
        df = _library_properties(approved_only)
        if df.empty:
            ui.empty_state("No processed molecules",
                           "Run the processing stage to compute descriptors and fingerprints.",
                           "python -m src.pipeline.process")
        else:
            ui.metric_grid([
                ("Molecules", f"{len(df):,}", "with descriptors", "molecule", "molecular"),
                ("Median MW", f"{df['mw'].median():.1f}", "Da", "scale", "molecular"),
                ("Median LogP", f"{df['logp'].median():.2f}", "Crippen", "flask", "molecular"),
                ("Rule-of-five pass", f"{(df['lipinski_violations'] == 0).mean():.0%}",
                 "0 violations", "check", "molecular"),
            ], columns=4)
            ui.spacer(".75rem")

            cols = st.columns(2, gap="medium")
            with cols[0]:
                fig = px.histogram(df, x="mw", nbins=46,
                                   labels={"mw": "Molecular weight (Da)"})
                fig.update_traces(marker_color=theme.MOLECULAR)
                fig.update_layout(height=290, bargap=.04, yaxis_title="Compounds",
                                  title="Molecular weight distribution")
                st.plotly_chart(fig, use_container_width=True)
            with cols[1]:
                fig = px.histogram(df, x="logp", nbins=46, labels={"logp": "LogP"})
                fig.update_traces(marker_color=theme.PREDICTION)
                fig.update_layout(height=290, bargap=.04, yaxis_title="Compounds",
                                  title="Lipophilicity distribution")
                st.plotly_chart(fig, use_container_width=True)

            sample = df.sample(min(len(df), 4000), random_state=cfg.seed)
            fig = px.scatter(
                sample, x="mw", y="logp", color="lipinski_violations", hover_name="pref_name",
                labels={"mw": "Molecular weight (Da)", "logp": "LogP",
                        "lipinski_violations": "Lipinski violations"},
                color_continuous_scale=[theme.CLINICAL, theme.LIMIT, theme.FAILURE],
            )
            fig.update_traces(marker=dict(size=5, opacity=.55))
            fig.update_layout(height=420, title="Chemical space of the processed library")
            st.plotly_chart(fig, use_container_width=True)
            st.caption("Colour encodes rule-of-five violations, which describe oral "
                       "drug-likeness in silico only.")

    # ----------------------------------------------------------- scaffolds --
    with tabs[1]:
        scaffolds = _scaffold_counts(15)
        if scaffolds.empty:
            ui.empty_state("No scaffolds computed", "Run the processing stage first.",
                           "python -m src.pipeline.process")
        else:
            st.caption(
                "Bemis-Murcko scaffolds drive the train/test split: molecules sharing a "
                "scaffold stay on the same side, so reported metrics measure generalisation "
                "to new chemistry rather than recall of close analogues."
            )
            left, right = st.columns([1.6, 1], gap="medium")
            with left:
                fig = px.bar(scaffolds.iloc[::-1], x="n", y="murcko_scaffold",
                             orientation="h", labels={"n": "Compounds", "murcko_scaffold": ""})
                fig.update_traces(marker_color=theme.MOLECULAR)
                fig.update_layout(height=460, yaxis=dict(tickfont=dict(size=9)),
                                  title="Most frequent scaffolds")
                st.plotly_chart(fig, use_container_width=True)
            with right:
                top = scaffolds.iloc[0]
                ui.structure_svg(
                    mol_to_svg(top["murcko_scaffold"], width=320, height=240),
                    caption=f"Most frequent scaffold: {int(top['n']):,} compounds",
                )

    # ----------------------------------------------------- structure quality --
    with tabs[2]:
        audit = _validation_audit()
        if audit.empty:
            ui.empty_state("No molecules ingested", "Run ingestion first.",
                           "python -m src.pipeline.ingest")
        else:
            valid = int(audit.loc[audit["reason"] == "valid", "n"].sum())
            invalid = int(audit.loc[audit["reason"] != "valid", "n"].sum())
            ui.metric_grid([
                ("Valid structures", f"{valid:,}", "passed standardisation", "check", "molecular"),
                ("Rejected", f"{invalid:,}", "with a recorded reason", "cross", "limitation"),
                ("Rejection rate", f"{invalid / max(valid + invalid, 1):.1%}", None,
                 "scale", "limitation"),
            ], columns=3)
            ui.spacer(".75rem")
            st.caption("Every rejected structure is stored with the reason it failed, so the "
                       "loss is auditable rather than silent.")
            rejected = audit[audit["reason"] != "valid"].rename(
                columns={"reason": "Rejection reason", "n": "Count"})
            if rejected.empty:
                ui.empty_state("No rejected structures",
                               "Every ingested structure passed standardisation.")
            else:
                ui.data_table(rejected, height=260)

    # ------------------------------------------------------- ad-hoc predict --
    with tabs[3]:
        _predict_panel(cfg)
