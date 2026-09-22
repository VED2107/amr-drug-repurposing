"""Metric cards, pathogen cards, candidate cards and pipeline stages."""

from __future__ import annotations

from typing import Any, Sequence

import streamlit as st

from .. import theme
from .icons import icon
from .primitives import esc, fmt

# A metric entry: (label, value, sub-caption, icon name, evidence kind)
Metric = tuple[str, Any, str | None, str, str]


def metric_grid(metrics: Sequence[Metric], columns: int | None = None) -> None:
    """A responsive row of metric cards.

    The column count travels as a CSS custom property so the stylesheet's media
    queries can still reflow the grid on a narrow screen.
    """
    cols = columns or len(metrics)
    cells = []
    for label, value, sub, icon_name, kind in metrics:
        accent, soft, _ = theme.EVIDENCE.get(kind, theme.EVIDENCE["neutral"])
        text = str(value)
        size = " sm" if len(text) > 12 else ""
        sub_html = f'<div class="sub">{esc(sub)}</div>' if sub else ""
        cells.append(
            f'<div class="metric">'
            f'<div class="top">'
            f'<span class="ico" style="background:{soft};">{icon(icon_name, accent)}</span>'
            f'<span class="label">{esc(label)}</span></div>'
            f'<div class="value{size}">{esc(text)}</div>{sub_html}</div>'
        )
    st.markdown(
        f'<div class="grid" style="--cols:{cols};">{"".join(cells)}</div>',
        unsafe_allow_html=True,
    )


def pathogen_card(summary: dict[str, Any]) -> None:
    """One pathogen's screening state, including its resistance-evidence share.

    The card is labelled with a resistant organism, so the strength of the
    evidence behind that label belongs on the card - not on another page.
    """
    color = theme.PATHOGEN_COLORS.get(summary["key"], theme.PREDICTION)

    resistant = summary.get("resistant_fraction")
    if resistant is None:
        strain_html = ""
    else:
        tone = theme.LIMIT if resistant < 0.25 else theme.INK_MUTED
        soft = theme.LIMIT_SOFT if resistant < 0.25 else theme.NEUTRAL_SOFT
        strain_html = (
            f'<div class="foot">'
            f'<span class="ev-tag" style="background:{soft};color:{tone};">'
            f'resistance evidence {resistant:.0%}</span></div>'
        )

    model = summary.get("model_version") or "no active model"
    model_html = (
        f'<div style="margin-top:.55rem;font-family:{theme.MONO};font-size:.72rem;'
        f'color:{color};font-weight:500;">{esc(model)}</div>'
    )

    roc = summary.get("roc_auc")
    adj = summary.get("pr_auc_adjusted")

    st.markdown(
        f"""
        <div class="pcard">
          <div class="strip" style="background:{color};"></div>
          <div class="body">
            <div class="name">{esc(summary['label'])}</div>
            <div class="latin">{esc(summary['organism'])}</div>
            <div class="rows">
              <div><div class="k">ROC-AUC</div><div class="v">{fmt(roc, '.3f')}</div></div>
              <div><div class="k">PR-AUC adj</div><div class="v">{fmt(adj, '.3f')}</div></div>
              <div><div class="k">Candidates</div><div class="v">{summary['candidates']:,}</div></div>
              <div><div class="k">Test set</div><div class="v">{fmt(summary.get('n_test'))}</div></div>
              <div><div class="k">Screened</div><div class="v">{summary['screened']:,}</div></div>
              <div><div class="k">Docked</div><div class="v">{summary['docking_results']:,}</div></div>
            </div>
            {model_html}
            {strain_html}
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def candidate_card(
    row: dict[str, Any],
    rank: int,
    *,
    predictions: dict[str, float] | None = None,
    evidence: dict[str, bool] | None = None,
    why: str | None = None,
) -> None:
    """A prioritised candidate, written for a non-specialist.

    Shows the medicine, one plain sentence on why it was surfaced, its predicted
    activity against each bacterium, and a checklist of which kinds of evidence
    exist. Model names, dataset ids and fingerprint dimensions stay on the
    details page - they are noise here.
    """
    from .. import content
    from .explain import evidence_checklist, format_probability

    predictions = predictions or {}
    evidence = evidence or {}

    rows = []
    for key in ("mrsa", "ecoli", "kpneumoniae", "mtb"):
        if key not in predictions:
            continue
        value = predictions[key]
        profile = content.pathogen(key)
        fraction = max(0.0, min(1.0, float(value)))
        accent = theme.PATHOGEN_COLORS.get(key, theme.PREDICTION)
        rows.append(
            f'<div style="display:flex;align-items:center;gap:.5rem;padding:.2rem 0;">'
            f'<span style="flex:1 1 auto;font-size:.8rem;color:var(--ink);min-width:0;'
            f'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
            f'{esc(profile["short"])}</span>'
            f'<span style="flex:0 0 58px;"><span class="ebar" style="height:5px;">'
            f'<span style="transform:scaleX({fraction:.4f});background:{accent};"></span>'
            f'</span></span>'
            f'<span style="flex:0 0 auto;font-family:{theme.MONO};font-size:.82rem;'
            f'font-weight:600;color:{accent};width:2.6rem;text-align:right;">'
            f'{format_probability(value)}</span></div>'
        )

    checklist = evidence_checklist([
        ("Molecular data", True, "molecular"),
        ("AI prediction", bool(predictions), "prediction"),
        ("Docking available", bool(evidence.get("docked")), "docking"),
        ("Clinical evidence", bool(evidence.get("clinical")), "clinical"),
    ])

    why_html = (
        f'<div style="font-size:.76rem;color:var(--ink-muted);line-height:1.45;'
        f'margin:.45rem 0 .6rem;">{esc(why)}</div>' if why else ""
    )

    st.markdown(
        f"""
        <div class="card" style="padding:.9rem 1rem;">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem;">
            <div style="min-width:0;">
              <div style="font-family:{theme.MONO};font-size:.6rem;color:var(--ink-faint);
                          letter-spacing:.1em;">RANK {rank:02d}</div>
              <div style="font-size:.95rem;font-weight:650;color:var(--ink);margin-top:.1rem;
                          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                   title="{esc(row.get('display_name'))}">{esc(row.get('display_name'))}</div>
            </div>
            <span class="ev-tag" style="background:{theme.PREDICTION_SOFT};
                  color:{theme.PREDICTION};flex:0 0 auto;">Prioritised</span>
          </div>
          {why_html}
          <div style="font-family:{theme.MONO};font-size:.58rem;letter-spacing:.1em;
                      text-transform:uppercase;color:var(--ink-faint);
                      margin:.2rem 0 .1rem;">AI-predicted activity</div>
          {"".join(rows)}
          <div style="border-top:1px solid var(--hairline);margin-top:.6rem;
                      padding-top:.5rem;">
            <div style="font-family:{theme.MONO};font-size:.58rem;letter-spacing:.1em;
                        text-transform:uppercase;color:var(--ink-faint);
                        margin-bottom:.2rem;">Evidence</div>
            {checklist}
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


#: (index, display name, pipeline stage key, evidence kind)
PIPELINE_STAGES = [
    ("01", "Ingest", "ingest", "molecular"),
    ("02", "Chemistry", "process", "molecular"),
    ("03", "Train", "train", "prediction"),
    ("04", "Screen", "predict", "prediction"),
    ("05", "Dock", "dock", "docking"),
    ("06", "Clinical", "clinical", "clinical"),
]

_STATUS_KIND = {
    "SUCCESS": "clinical", "PARTIAL": "limitation", "FAILED": "failure",
    "SKIPPED": "limitation", "RUNNING": "prediction", "INTERRUPTED": "limitation",
}


def pipeline_flow(stage_status: dict[str, dict[str, Any]]) -> None:
    """The COLLECT -> DELIVER strip, doubling as a live status display."""
    blocks = []
    for idx, name, key, default_kind in PIPELINE_STAGES:
        info = stage_status.get(key) or {}
        status = info.get("status")
        kind = _STATUS_KIND.get(str(status), "neutral") if status else "neutral"
        accent = theme.EVIDENCE[kind][0] if status else theme.HAIRLINE_STRONG

        if status is None:
            meta = "not yet run"
        else:
            processed = int(info.get("records_processed") or 0)
            errors = int(info.get("error_count") or 0)
            meta = f"{str(status).lower()} · {processed:,}"
            if errors:
                meta += f" · {errors} err"

        blocks.append(
            f'<div class="stage"><span class="bar" style="background:{accent};"></span>'
            f'<div class="idx">{idx}</div><div class="nm">{esc(name)}</div>'
            f'<div class="mt">{esc(meta)}</div></div>'
        )
    st.markdown(
        f'<div class="flow" style="--cols:{len(PIPELINE_STAGES)};">{"".join(blocks)}</div>',
        unsafe_allow_html=True,
    )
