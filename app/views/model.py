"""Model and dataset: what was trained, how it was validated, and what it scored."""

from __future__ import annotations

import json

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from src.ml.evaluate import ensure_normalized

from .. import components as ui
from .. import data, theme

METRIC_COLUMNS = ["roc_auc", "pr_auc", "pr_auc_normalized", "f1", "precision", "recall",
                  "balanced_accuracy", "mcc"]
METRIC_LABELS = {
    "roc_auc": "ROC-AUC", "pr_auc": "PR-AUC", "pr_auc_normalized": "PR-AUC (adj.)",
    "f1": "F1", "precision": "Precision", "recall": "Recall",
    "balanced_accuracy": "Balanced acc.", "mcc": "MCC",
}


def _loads(value) -> dict:
    """Parse a stored metrics blob, deriving the adjusted PR-AUC when absent.

    Models trained before that metric existed still carry the raw PR-AUC and the
    prevalence it must be judged against, so every row is shown on one scale
    without rewriting stored evaluations.
    """
    try:
        parsed = json.loads(value or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    if isinstance(parsed, dict) and "pr_auc" in parsed:
        return ensure_normalized(parsed)
    return parsed if isinstance(parsed, dict) else {}


def _curve_figure(curves: dict, kind: str) -> go.Figure | None:
    if not curves:
        return None
    fig = go.Figure()
    if kind == "roc":
        roc = curves.get("roc")
        if not roc:
            return None
        fig.add_trace(go.Scatter(x=roc["fpr"], y=roc["tpr"], mode="lines", name="model",
                                 line=dict(color=theme.PREDICTION, width=2.2)))
        fig.add_trace(go.Scatter(x=[0, 1], y=[0, 1], mode="lines", name="chance",
                                 line=dict(color=theme.INK_FAINT, width=1, dash="dot")))
        fig.update_layout(xaxis_title="False positive rate", yaxis_title="True positive rate")
    else:
        pr = curves.get("pr")
        if not pr:
            return None
        fig.add_trace(go.Scatter(x=pr["recall"], y=pr["precision"], mode="lines", name="model",
                                 line=dict(color=theme.CLINICAL, width=2.2)))
        fig.update_layout(xaxis_title="Recall", yaxis_title="Precision")
    fig.update_layout(height=300, showlegend=False, xaxis_range=[0, 1], yaxis_range=[0, 1.02])
    return fig


def _active_model_cards(cfg, active: pd.DataFrame, labels: dict) -> None:
    cols = st.columns(len(cfg.pathogens), gap="small")
    for col, p in zip(cols, cfg.pathogens):
        row = active[active["pathogen_key"] == p.key]
        with col:
            if row.empty:
                ui.metric_grid([(p.label, "none", "no active model", "alert", "limitation")],
                               columns=1)
                continue
            record = row.iloc[0]
            metrics = _loads(record["metrics_json"])
            baseline = record["model_type"] == "random_forest"
            ui.metric_grid([(
                p.label,
                ui.fmt(metrics.get("pr_auc_normalized"), ".3f"),
                f"{record['model_version']} · {'baseline' if baseline else 'selected'}",
                "brain", "prediction",
            )], columns=1)


def render() -> None:
    cfg = data.get_config()
    labels = {p.key: p.label for p in cfg.pathogens}

    ui.page_header(
        "Model & Dataset",
        "Baseline, benchmark, selection and the data behind every reported number. "
        "Selection happens on validation; the test partition is scored once.",
        meta=data.header_meta(),
    )

    models = data.model_versions()
    if models.empty:
        ui.empty_state("No model has been trained",
                       "Training requires labelled bioactivity data with valid structures.",
                       "python -m src.pipeline.train --benchmark")
        return

    active = models[models["status"] == "ACTIVE"]
    fp = cfg.get("chemistry", "fingerprint", default={})

    # ------------------------------------------------------- active models --
    ui.section("Active models", "one per pathogen")
    _active_model_cards(cfg, active, labels)
    ui.spacer(".75rem")
    ui.callout(
        f"<strong>Baseline: Random Forest</strong>, fixed by the project methodology and always "
        f"trained. Features: {fp.get('n_bits')}-bit Morgan fingerprints, radius "
        f"{fp.get('radius')}. Where another model is active it won a like-for-like comparison "
        f"on the same dataset, split and metrics — a validated engineering extension, not part "
        f"of the original methodology.",
        kind="prediction", label="Baseline vs selected",
    )

    rows = []
    for p in cfg.pathogens:
        row = active[active["pathogen_key"] == p.key]
        if row.empty:
            rows.append({"Pathogen": p.label, "Active model": None, "Type": None,
                         "Role": None, "Dataset": None, "Trained": None})
        else:
            r = row.iloc[0]
            rows.append({
                "Pathogen": p.label, "Active model": r["model_version"], "Type": r["model_type"],
                "Role": "baseline" if r["model_type"] == "random_forest" else "selected challenger",
                "Dataset": r["dataset_version"], "Trained": r["training_date"],
            })
    ui.data_table(pd.DataFrame(rows),
                  dash_columns=["Active model", "Type", "Role", "Dataset", "Trained"])

    # -------------------------------------------------------- per pathogen --
    trained_keys = sorted(models["pathogen_key"].unique())
    chosen = st.selectbox("Pathogen", trained_keys, key="model_pathogen",
                          format_func=lambda k: labels.get(k, k))
    pathogen_models = models[models["pathogen_key"] == chosen]
    active_row = pathogen_models[pathogen_models["status"] == "ACTIVE"]

    # ---------------------------------------------------------- comparison --
    ui.section("Model comparison", "held-out test partition, like for like")
    bench = data.benchmark_table(chosen)
    if bench.empty:
        ui.empty_state("No benchmark recorded", "Run training with the benchmark flag.",
                       "python -m src.pipeline.train --benchmark")
    else:
        table_rows = []
        for _, record in bench.iterrows():
            metrics = _loads(record["metrics_json"])
            test = ensure_normalized(metrics.get("test") or {})
            entry = {"Model": record["model_type"], "Version": record["model_version"]}
            entry.update({METRIC_LABELS[m]: test.get(m) for m in METRIC_COLUMNS})
            status = []
            if record["is_baseline"]:
                status.append("Baseline")
            if record["selected"]:
                status.append("Selected")
            if metrics.get("error"):
                status.append("Failed")
            entry["Status"] = " / ".join(status) if status else "Benchmarked"
            table_rows.append(entry)

        ui.data_table(
            pd.DataFrame(table_rows), dash_columns=["Version"],
            column_config={METRIC_LABELS[m]: st.column_config.NumberColumn(
                METRIC_LABELS[m], format="%.3f") for m in METRIC_COLUMNS},
            caption="Every model was refit on train + validation and scored once on the same "
                    "held-out test partition. PR-AUC (adj.) is "
                    "(PR-AUC − prevalence) / (1 − prevalence): raw PR-AUC is bounded below by "
                    "class prevalence, so only the adjusted form is comparable across datasets. "
                    "Selection uses the adjusted value.",
        )

        if not active_row.empty:
            ui.callout(f"<strong>Selection:</strong> "
                       f"{ui.esc(active_row.iloc[0]['selection_reason'])}",
                       kind="prediction", label="Promotion decision")
        else:
            latest = pathogen_models.iloc[0]
            ui.callout(
                f"<strong>No model promoted for {ui.esc(labels.get(chosen, chosen))}.</strong> "
                f"{ui.esc(latest['selection_reason'] or 'Acceptance criteria were not met.')}",
                kind="limitation", label="Promotion decision")

    # ------------------------------------------------------------- metrics --
    if not active_row.empty:
        record = active_row.iloc[0]
        metrics = _loads(record["metrics_json"])

        ui.section(f"Held-out test performance", record["model_version"])
        ui.metric_grid([
            ("ROC-AUC", ui.fmt(metrics.get("roc_auc"), ".3f"), None, "chart", "prediction"),
            ("PR-AUC", ui.fmt(metrics.get("pr_auc"), ".3f"),
             f"random scores {metrics['positive_prevalence']:.3f}"
             if metrics.get("positive_prevalence") is not None else None, "chart", "prediction"),
            ("PR-AUC (adj.)", ui.fmt(metrics.get("pr_auc_normalized"), ".3f"),
             "used for selection", "scale", "prediction"),
            ("Precision", ui.fmt(metrics.get("precision"), ".3f"), "at threshold 0.5",
             "target", "prediction"),
            ("Recall / sensitivity", ui.fmt(metrics.get("recall"), ".3f"), None,
             "target", "prediction"),
            ("Specificity", ui.fmt(metrics.get("specificity"), ".3f"), None, "target", "prediction"),
            ("MCC", ui.fmt(metrics.get("mcc"), ".3f"), "balanced correlation", "scale", "prediction"),
            ("Test prevalence", ui.fmt(metrics.get("positive_prevalence"), ".1%"),
             "share of actives", "alert", "limitation"),
        ], columns=8)
        ui.spacer(".5rem")
        ui.metric_grid([
            ("Train", f"{int(record['n_train']):,}", "compounds", "database", "molecular"),
            ("Validation", f"{int(record['n_validation']):,}", "used for selection",
             "database", "molecular"),
            ("Test", f"{int(record['n_test']):,}", "scored once", "database", "molecular"),
            ("Split", str(record["split_method"]), "scaffold-aware", "layers", "molecular"),
            ("Seed", str(int(record["random_seed"])), "reproducible", "refresh", "neutral"),
            ("Dataset", str(record["dataset_version"]), None, "database", "molecular"),
        ], columns=6)

        # ---------------------------------------------------- sanity checks --
        ui.section("Scientific sanity checks")
        for finding in data.sanity_findings(record["model_version"]):
            kind = {"critical": "failure", "warning": "limitation"}.get(
                finding["severity"], "clinical")
            label = ("Clear" if finding["check"] == "all_clear"
                     else f"{finding['severity']} · {finding['check'].replace('_', ' ')}")
            ui.callout(ui.esc(finding["message"]), kind=kind, label=label)

        # ---------------------------------------------------------- curves --
        ui.section("Performance curves")
        curves = data.model_curves(record["model_version"])
        cm = metrics.get("confusion_matrix") or {}
        missing = ("Curve points were not stored for this model version. Retrain to record "
                   "them: python -m src.pipeline.train --benchmark")

        cols = st.columns(3, gap="medium")
        with cols[0]:
            fig = _curve_figure(curves, "roc")
            if fig:
                fig.update_layout(title="ROC curve")
                st.plotly_chart(fig, use_container_width=True)
            else:
                ui.empty_state("ROC curve unavailable", missing)
        with cols[1]:
            fig = _curve_figure(curves, "pr")
            if fig:
                fig.update_layout(title="Precision–recall")
                if metrics.get("positive_prevalence") is not None:
                    fig.add_hline(y=float(metrics["positive_prevalence"]), line_dash="dot",
                                  line_color=theme.INK_FAINT,
                                  annotation_text="no-skill (prevalence)",
                                  annotation_font_size=9,
                                  annotation_font_color=theme.INK_FAINT)
                st.plotly_chart(fig, use_container_width=True)
            else:
                ui.empty_state("Precision–recall unavailable", missing)
        with cols[2]:
            if cm:
                z = [[cm.get("tn", 0), cm.get("fp", 0)], [cm.get("fn", 0), cm.get("tp", 0)]]
                fig = go.Figure(go.Heatmap(
                    z=z, x=["Predicted inactive", "Predicted active"],
                    y=["Actual inactive", "Actual active"],
                    text=[[f"{v:,}" for v in r] for r in z], texttemplate="%{text}",
                    colorscale=[[0, theme.SURFACE], [1, theme.PREDICTION]], showscale=False))
                fig.update_layout(height=300, title="Confusion matrix (threshold 0.5)",
                                  yaxis=dict(autorange="reversed"))
                st.plotly_chart(fig, use_container_width=True)
            else:
                ui.empty_state("Confusion matrix unavailable", missing)

        # ------------------------------------------------ cross-validation --
        cv = _loads(record["cv_metrics_json"]).get("cv") or {}
        if cv and not cv.get("error"):
            ui.section("Cross-validation", "training partition only")
            cv_rows = [
                {"Metric": METRIC_LABELS[m], "Mean": s.get("mean"),
                 "Std dev": s.get("std"), "Folds": s.get("n_folds")}
                for m in ("roc_auc", "pr_auc", "f1")
                if isinstance((s := cv.get(m)), dict)
            ]
            if cv_rows:
                ui.data_table(
                    pd.DataFrame(cv_rows),
                    column_config={"Mean": st.column_config.NumberColumn(format="%.3f"),
                                   "Std dev": st.column_config.NumberColumn(format="%.3f")},
                    caption="Cross-validation estimates stability inside the training "
                            "partition. It never touches the test set.",
                )

        # ------------------------------------------------- explainability --
        importance = data.feature_importance(chosen, top_n=20)
        if importance:
            ui.section("Fingerprint bit importance")
            imp = pd.DataFrame(importance)
            fig = go.Figure(go.Bar(
                x=imp["importance"][::-1], y=[f"bit {b}" for b in imp["bit"]][::-1],
                orientation="h", marker_color=theme.PREDICTION))
            fig.update_layout(height=420, xaxis_title="Relative importance", yaxis_title="")
            st.plotly_chart(fig, use_container_width=True)
            st.caption("Which Morgan bits the model relies on. A bit encodes a local "
                       "substructural environment; high importance does not establish a "
                       "biological mechanism.")

    # --------------------------------------------------------- version log --
    ui.section("Model version history", "nothing is deleted")
    history = pathogen_models[
        ["model_version", "model_type", "is_baseline", "status", "dataset_version",
         "training_date", "n_train", "n_test", "selection_reason"]].copy()
    history["is_baseline"] = history["is_baseline"].map({1: "baseline", 0: ""})
    ui.data_table(
        history.rename(columns={
            "model_version": "Version", "model_type": "Type", "is_baseline": "Role",
            "status": "State", "dataset_version": "Dataset", "training_date": "Trained",
            "n_train": "Train n", "n_test": "Test n", "selection_reason": "Decision"}),
        dash_columns=["Role", "Decision"],
        caption="ACTIVE serves predictions · CANDIDATE was benchmarked but not promoted · "
                "ARCHIVED was superseded · REJECTED failed the acceptance criteria.",
    )

    # ------------------------------------------------------------- dataset --
    ui.section("Dataset versions")
    datasets = data.dataset_versions()
    if datasets.empty:
        ui.empty_state("No dataset version recorded", "Run training to build one.",
                       "python -m src.pipeline.train")
        return

    ui.data_table(
        datasets[["dataset_version", "created_at", "n_records", "n_compounds",
                  "n_pathogens", "notes"]].rename(columns={
            "dataset_version": "Version", "created_at": "Created", "n_records": "Rows",
            "n_compounds": "Unique compounds", "n_pathogens": "Pathogens", "notes": "Notes"}),
        dash_columns=["Notes"],
    )

    latest_dataset = datasets.iloc[0]
    quality = _loads(latest_dataset["quality_json"])
    labelling = _loads(latest_dataset["labeling_json"])

    tabs = st.tabs(["Data quality", "Resistance evidence", "Class distribution",
                    "Labelling strategy", "Dataset sanity"])

    with tabs[0]:
        if not quality:
            ui.empty_state("No audit stored", "This dataset version predates the quality audit.")
        else:
            ui.metric_grid([
                ("Molecules", f"{quality.get('molecules_total', 0):,}", None, "molecule", "molecular"),
                ("Valid", f"{quality.get('molecules_valid', 0):,}", None, "check", "molecular"),
                ("Invalid", f"{quality.get('molecules_invalid', 0):,}", None, "cross", "limitation"),
                ("Missing SMILES", f"{quality.get('molecules_missing_smiles', 0):,}", None,
                 "alert", "limitation"),
                ("Bioactivity", f"{quality.get('bioactivity_total', 0):,}",
                 f"{quality.get('bioactivity_labelled', 0):,} labelled", "database", "molecular"),
                ("Duplicate structures", f"{quality.get('duplicate_canonical_smiles_groups', 0):,}",
                 "groups sharing a SMILES", "layers", "limitation"),
            ], columns=6)
            ui.spacer(".75rem")
            if quality.get("per_pathogen"):
                per = pd.DataFrame(quality["per_pathogen"]).rename(columns={
                    "label": "Pathogen", "records": "Records", "actives": "Active",
                    "inactives": "Inactive", "ambiguous": "Unusable",
                    "unique_compounds": "Unique compounds"})
                ui.data_table(per[["Pathogen", "Records", "Active", "Inactive", "Unusable",
                                   "Unique compounds"]])
            cols = st.columns(2, gap="medium")
            with cols[0]:
                if quality.get("activity_units"):
                    st.caption("Activity units encountered")
                    ui.data_table(pd.DataFrame(quality["activity_units"]).rename(
                        columns={"units": "Units", "count": "Records"}), height=230)
            with cols[1]:
                if quality.get("activity_types"):
                    st.caption("Activity endpoints ingested")
                    ui.data_table(pd.DataFrame(quality["activity_types"]).rename(
                        columns={"type": "Endpoint", "count": "Records"}), height=230)
            if quality.get("invalid_reasons"):
                st.caption("Why structures were rejected")
                ui.data_table(pd.DataFrame(quality["invalid_reasons"]).rename(
                    columns={"reason": "Reason", "count": "Count"}))

    with tabs[1]:
        strain = data.strain_evidence()
        if strain.empty:
            ui.empty_state("No labelled bioactivity yet", "Run ingestion and processing first.")
        else:
            ui.callout(
                "An assay counts as resistant-strain evidence only when its own description "
                "names a resistant phenotype (MRSA, methicillin/oxacillin-resistant, ESBL, KPC, "
                "carbapenem-resistant, MDR/XDR). Everything else is activity against the species "
                "measured on whatever strain the authors used — usually a susceptible reference "
                "strain. <strong>Susceptible-strain activity does not establish activity against "
                "the resistant organism.</strong>",
                kind="limitation", label="What this table measures")
            ui.spacer(".5rem")
            view = strain.copy()
            view["Pathogen"] = view["pathogen_key"].map(lambda k: labels.get(k, k))
            view["Resistant-strain records"] = view.apply(
                lambda r: f"{int(r['resistant_records']):,} of {int(r['labelled_records']):,} "
                          f"({r['resistant_records'] / r['labelled_records']:.1%})"
                if r["labelled_records"] else "—", axis=1)
            view["Compounds with resistant evidence"] = view.apply(
                lambda r: f"{int(r['resistant_compounds']):,} of {int(r['compounds']):,} "
                          f"({r['resistant_compounds'] / r['compounds']:.1%})"
                if r["compounds"] else "—", axis=1)
            ui.data_table(view[["Pathogen", "Resistant-strain records",
                                "Compounds with resistant evidence"]],
                          caption="Where this fraction is low, treat the model as a predictor "
                                  "of antibacterial activity against the species.")

    with tabs[2]:
        dist = data.label_distribution()
        if dist.empty:
            ui.empty_state("No labelled records yet", "Run the processing stage.")
        else:
            dist = dist.copy()
            dist["Pathogen"] = dist["pathogen_key"].map(lambda k: labels.get(k, k))
            fig = go.Figure()
            fig.add_bar(x=dist["Pathogen"], y=dist["active"], name="Active",
                        marker_color=theme.CLINICAL)
            fig.add_bar(x=dist["Pathogen"], y=dist["inactive"], name="Inactive",
                        marker_color=theme.NEUTRAL)
            fig.add_bar(x=dist["Pathogen"], y=dist["unusable"], name="Unusable / ambiguous",
                        marker_color=theme.HAIRLINE_STRONG)
            fig.update_layout(barmode="stack", height=340, yaxis_title="Bioactivity records",
                              title="Label distribution")
            st.plotly_chart(fig, use_container_width=True)
            st.caption("Unusable records could not be converted to a comparable potency, or "
                       "fell between the active and inactive thresholds. They are stored but "
                       "excluded from training rather than forced into a class.")

    with tabs[3]:
        rules = labelling.get("labeling") or {}
        ui.kv_block([
            ("Active threshold", f"pActivity ≥ {rules.get('active_threshold_pactivity')}"),
            ("Inactive threshold", f"pActivity ≤ {rules.get('inactive_threshold_pactivity')}"),
            ("Ambiguous band", "stored, excluded from training"),
            ("Censored relations", "honoured" if rules.get("honour_censored_relations") else "ignored"),
            ("Duplicate aggregation", rules.get("duplicate_aggregation")),
            ("Minimum records", rules.get("min_records_per_pathogen")),
            ("Minimum minority class", rules.get("min_minority_class_records")),
            ("Config hash", latest_dataset["config_hash"]),
        ])
        st.caption("pActivity is −log10 of the molar potency: 5.0 is 10 µM, 6.0 is 1 µM. "
                   "MIC in µg/mL converts using the molecular weight computed from the "
                   "structure. See docs/LABELING.md for the full rationale.")

    with tabs[4]:
        for finding in data.dataset_sanity(latest_dataset["dataset_version"]):
            kind = {"critical": "failure", "warning": "limitation"}.get(
                finding["severity"], "clinical")
            label = ("Clear" if finding["check"] == "all_clear"
                     else f"{finding['severity']} · {finding['check'].replace('_', ' ')}")
            ui.callout(ui.esc(finding["message"]), kind=kind, label=label)
