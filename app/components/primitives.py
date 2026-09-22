"""Shared primitives: escaping, number formatting, section rules, callouts.

The scientific-boundary vocabulary lives here too, so every page states the
limits of what it shows in the same words.
"""

from __future__ import annotations

import html
from typing import Any, Iterable

import streamlit as st

from .. import theme

# --------------------------------------------------------------- vocabulary --
# The only language this project uses for a highly ranked compound. There is no
# "best drug", no "winner", no "cure", no "confirmed treatment".
CANDIDATE_LABEL = "Prioritised candidate"

DISCLAIMER_GLOBAL = (
    "Model probabilities and docking scores are <strong>computational predictions</strong>, "
    "not evidence of clinical efficacy or safety. Compounds shown here are "
    "<strong>prioritised candidates for experimental validation</strong>."
)
DISCLAIMER_DOCKING = (
    "A docking score is a <strong>computational estimate of binding geometry and affinity</strong> "
    "for a rigid receptor. It does not demonstrate biological activity and requires "
    "experimental validation."
)
DISCLAIMER_CLINICAL = (
    "These records show that a compound has <strong>existing human clinical history</strong> for "
    "some indication. They are <strong>not evidence of antimicrobial efficacy</strong>, and "
    "unrelated trials must not be read as AMR evidence."
)
DISCLAIMER_ADMET = (
    "Drug-likeness and computed physicochemical properties are <strong>in-silico "
    "descriptors</strong>. Passing Lipinski's rules does not mean a compound is safe; human "
    "safety is established only by clinical evidence."
)
DISCLAIMER_RESISTANCE = (
    "These models are trained on published activity against the named <strong>species</strong>. "
    "A high probability indicates predicted antibacterial activity against the species, "
    "<strong>not</strong> demonstrated activity against the resistant phenotype."
)


def esc(value: Any) -> str:
    return html.escape(str(value)) if value is not None else ""


def fmt(value: Any, spec: str = "", dash: str = "—") -> str:
    """Format a number for display, with an explicit dash for missing data."""
    if value is None:
        return dash
    try:
        if isinstance(value, float) and value != value:  # NaN
            return dash
        if spec:
            return format(value, spec)
        if isinstance(value, int):
            return f"{value:,}"
        return str(value)
    except (TypeError, ValueError):
        return str(value)


def dash_na(df: Any, columns: Iterable[str], *, dash: str = "—") -> Any:
    """Replace missing values with an explicit dash for display.

    Streamlit prints both NaN and pd.NA as the literal text "None", which reads
    like a value. Absent evidence has to look absent - and must never look like
    a zero, which would read as a measured result.
    """
    import pandas as pd

    out = df.copy()
    for column in columns:
        if column in out.columns:
            out[column] = out[column].map(lambda v: dash if v is None or pd.isna(v) else v)
    return out


# ------------------------------------------------------------------ layout --
def section(title: str, note: str = "") -> None:
    """A titled rule that opens a block."""
    note_html = f'<span class="note">{esc(note)}</span>' if note else ""
    st.markdown(
        f'<div class="section"><span class="title">{esc(title)}</span>'
        f'{note_html}<span class="rule"></span></div>',
        unsafe_allow_html=True,
    )


def spacer(height: str = "1rem") -> None:
    st.markdown(f'<div style="height:{height}"></div>', unsafe_allow_html=True)


def kv_block(pairs: Iterable[tuple[str, Any]]) -> None:
    """Definition list used across detail pages."""
    rows = "".join(
        f'<div class="k">{esc(k)}</div><div class="v">{esc(v) if v not in (None, "") else "—"}</div>'
        for k, v in pairs
    )
    st.markdown(f'<div class="kv">{rows}</div>', unsafe_allow_html=True)


def callout(text: str, kind: str = "limitation", label: str | None = None) -> None:
    """A bounded-claim notice, tagged with the kind of evidence it concerns."""
    accent, soft, default_label = theme.EVIDENCE.get(kind, theme.EVIDENCE["neutral"])
    tag = label or default_label
    tag_html = (
        f'<span class="ev-tag tag" style="background:{soft};color:{accent};">{esc(tag)}</span>'
        if tag else ""
    )
    st.markdown(
        f'<div class="callout" data-kind="{kind}" '
        f'style="--kind:{accent};background:{soft};">'
        f'{tag_html}<div>{text}</div></div>',
        unsafe_allow_html=True,
    )


def evidence_bar(value: float | None, kind: str = "prediction") -> str:
    """A probability rendered as a measured quantity rather than a badge."""
    if value is None:
        return '<span style="color:var(--ink-faint);">—</span>'
    accent = theme.EVIDENCE.get(kind, theme.EVIDENCE["neutral"])[0]
    fraction = max(0.0, min(1.0, float(value)))
    return (
        f'<div style="font-family:{theme.MONO};font-size:.85rem;font-weight:500;'
        f'margin-bottom:.2rem;">{value:.3f}</div>'
        f'<div class="ebar"><span style="transform:scaleX({fraction:.4f});'
        f'background:{accent};"></span></div>'
    )


def structure_svg(svg: str | None, caption: str | None = None) -> None:
    if not svg:
        empty_state("Structure unavailable",
                    "No 2D depiction could be generated for this molecule.")
        return
    st.markdown(f'<div class="struct">{svg}</div>', unsafe_allow_html=True)
    if caption:
        st.caption(caption)


def empty_state(title: str, body: str, command: str | None = None) -> None:
    """Empty states explain how to populate the view instead of showing nothing."""
    st.markdown(
        f'<div class="empty"><div class="t">{esc(title)}</div>'
        f'<div class="d">{esc(body)}</div></div>',
        unsafe_allow_html=True,
    )
    if command:
        st.code(command, language="bash")


def error_state(title: str, detail: str, run_id: str | None = None) -> None:
    """A readable failure. Stack traces belong in the log, not on screen."""
    reference = f"<br><span style='font-family:{theme.MONO};font-size:.75rem;'>" \
                f"Reference: {esc(run_id)}</span>" if run_id else ""
    callout(
        f"<strong>{esc(title)}</strong><br>{esc(detail)}{reference}",
        kind="failure", label="Something went wrong",
    )


def footer() -> None:
    st.markdown(
        '<div class="foot">'
        '<span>Smart Screening · Research prototype</span>'
        '<span>Computational predictions require experimental validation.</span>'
        '</div>',
        unsafe_allow_html=True,
    )
