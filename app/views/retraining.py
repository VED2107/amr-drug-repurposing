"""Retraining: the model lifecycle, and what does and does not trigger it."""

from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import components as ui
from .. import data, theme

#: The lifecycle, drawn as a flow so the promote/reject branch is obvious.
LIFECYCLE = [
    ("01", "Current model", "serving predictions", "prediction"),
    ("02", "New labelled data", "new bioactivity measurements", "molecular"),
    ("03", "Candidate model", "trained on a new dataset version", "prediction"),
    ("04", "Evaluation", "same split, same metrics", "prediction"),
    ("05", "Promote or reject", "margin and floors decide", "clinical"),
]


def _lifecycle_flow() -> None:
    blocks = []
    for idx, name, note, kind in LIFECYCLE:
        accent = theme.EVIDENCE[kind][0]
        blocks.append(
            f'<div class="stage"><span class="bar" style="background:{accent};"></span>'
            f'<div class="idx">{idx}</div><div class="nm">{ui.esc(name)}</div>'
            f'<div class="mt">{ui.esc(note)}</div></div>'
        )
    st.markdown(f'<div class="flow" style="--cols:{len(LIFECYCLE)};">{"".join(blocks)}</div>',
                unsafe_allow_html=True)


def render() -> None:
    cfg = data.get_config()
    labels = {p.key: p.label for p in cfg.pathogens}

    ui.page_header(
        "Retraining",
        "What triggers a new model, how a candidate is evaluated, and why a worse model "
        "never replaces a better one.",
        meta=data.header_meta(),
    )

    # ------------------------------------------------------- the two rules --
    left, right = st.columns(2, gap="medium")
    with left:
        ui.callout(
            "<strong>New drug → inference only.</strong> A newly approved drug is normalised, "
            "validated, fingerprinted and scored with the <em>existing</em> model. If 1,000 new "
            "drugs arrive, 1,000 predictions are produced and zero models are retrained.",
            kind="prediction", label="New drug ≠ retraining",
        )
    with right:
        ui.callout(
            "<strong>New labelled bioactivity → retraining evaluation.</strong> New experimental "
            "measurements create a new dataset version, train a candidate, evaluate it under the "
            "same protocol, and compare it with the incumbent.",
            kind="molecular", label="New labelled data → evaluation",
        )

    ui.section("Model lifecycle")
    _lifecycle_flow()

    # ---------------------------------------------------------- live status --
    status = data.retraining_status()
    ui.section("Retraining status")
    ui.metric_grid([
        ("Labelled records now", f"{status['labelled_records_now']:,}", "usable for training",
         "database", "molecular"),
        ("At last training", ui.fmt(status["labelled_records_at_last_training"],
                                    dash="never trained"), None, "clock", "neutral"),
        ("New labelled records", f"{status['new_labelled_records']:,}", "since last training",
         "refresh", "molecular"),
        ("Retraining", "READY" if status["retraining_recommended"] else "NOT DUE",
         "new labelled data present" if status["retraining_recommended"] else "no new labels",
         "check" if status["retraining_recommended"] else "clock",
         "clinical" if status["retraining_recommended"] else "neutral"),
    ], columns=4)

    ui.spacer(".75rem")
    ui.callout(
        f"<strong>Trigger rule.</strong> {ui.esc(status['trigger_rule'])}. A candidate is "
        "promoted only if it clears the absolute quality floors <em>and</em> beats the incumbent "
        "by the configured margin. Otherwise the incumbent stays active and the candidate is "
        "kept with its decision recorded.",
        kind="prediction", label="Promotion policy",
    )

    # ------------------------------------------------------ acceptance rules --
    ui.section("Acceptance criteria")
    selection = cfg.get("ml", "selection", default={}) or {}
    cols = st.columns([1, 1.4], gap="medium")
    with cols[0]:
        ui.kv_block([
            ("Primary metric", selection.get("primary_metric")),
            ("Compared as", "prevalence-adjusted PR-AUC"),
            ("Promotion margin", selection.get("promotion_margin")),
            ("Minimum PR-AUC", selection.get("min_acceptable_pr_auc")),
            ("Minimum ROC-AUC", selection.get("min_acceptable_roc_auc")),
            ("Tie breakers", ", ".join(selection.get("tie_breakers", []))),
        ])
    with cols[1]:
        ui.callout(
            "Raw PR-AUC is bounded below by class prevalence, so it is <strong>not comparable "
            "across datasets</strong> with different balance. A model scoring 0.994 on a "
            "98.5%-positive test set is near-random; 0.994 on a 75%-positive set is strong. "
            "Selection and the floors therefore use "
            "<code>(PR-AUC − prevalence) / (1 − prevalence)</code>.",
            kind="limitation", label="Why the adjusted metric",
        )

    # --------------------------------------------------------- per pathogen --
    ui.section("Current model per pathogen")
    per = pd.DataFrame(status["pathogens"])
    per["Pathogen"] = per["pathogen"].map(lambda k: labels.get(k, k))
    ui.data_table(
        per[["Pathogen", "active_model", "model_type", "dataset_version", "trained_at"]].rename(
            columns={"active_model": "Active model", "model_type": "Type",
                     "dataset_version": "Dataset version", "trained_at": "Trained"}),
        dash_columns=["Active model", "Type", "Dataset version", "Trained"],
    )

    # ------------------------------------------------------ decision record --
    ui.section("Promotion decisions", "every outcome is recorded, nothing is deleted")
    models = data.model_versions()
    decisions = models[models["selection_reason"].notna()
                       & (models["selection_reason"] != "benchmarked but not selected")]
    if decisions.empty:
        ui.empty_state("No promotion decision recorded yet",
                       "Train with the benchmark flag to produce one.",
                       "python -m src.pipeline.train --benchmark")
    else:
        view = decisions[["model_version", "pathogen_key", "model_type", "status",
                          "training_date", "selection_reason"]].copy()
        view["pathogen_key"] = view["pathogen_key"].map(lambda k: labels.get(k, k))
        ui.data_table(
            view.rename(columns={"model_version": "Version", "pathogen_key": "Pathogen",
                                 "model_type": "Type", "status": "State",
                                 "training_date": "Trained", "selection_reason": "Decision"}),
            dash_columns=["Decision"], height=300,
            caption="ARCHIVED models were superseded by a better one; CANDIDATE models were "
                    "evaluated and not promoted. Both retain the reason.",
        )

    st.code("python -m src.pipeline.train --check       # is retraining due?\n"
            "python -m src.pipeline.train --benchmark   # train, evaluate, compare, promote",
            language="bash")
