"""Plain-language presentation components.

The percentage rule lives here and is enforced structurally: :func:`percent`
takes the meaning as a required argument, so it is not possible to render a
bare number followed by a percent sign anywhere in the interface. A naked
percentage next to a medicine reads as an effectiveness claim, and this system
makes no such claim.
"""

from __future__ import annotations

from typing import Iterable, Sequence

import streamlit as st

from .. import content, theme
from .primitives import esc

#: Labels that would misrepresent a model probability as a clinical outcome.
#: Used by :func:`percent` and asserted against in the test suite.
FORBIDDEN_PERCENT_LABELS = (
    "effectiveness", "effective", "success", "cure", "cured", "efficacy",
    "chance of curing", "clinical success", "will treat", "guaranteed",
)


class MisleadingLabelError(ValueError):
    """Raised when a percentage is given a label that implies clinical benefit."""


def _check_label(label: str) -> None:
    lowered = label.lower()
    for banned in FORBIDDEN_PERCENT_LABELS:
        if banned in lowered:
            raise MisleadingLabelError(
                f"percentage label {label!r} implies clinical benefit; this system "
                "predicts antibacterial activity, it does not establish efficacy"
            )


def format_probability(value: float | None, decimals: int = 0) -> str:
    """A probability as text, without ever implying certainty.

    A Random Forest returns 1.0 when every tree votes the same way. That is
    unanimity among the trees, not certainty about the world, and printing
    "100%" beside a medicine would tell a non-specialist something the model
    cannot support. Saturated values therefore read as ">99%" and "<1%".
    """
    if value is None:
        return "—"
    fraction = max(0.0, min(1.0, float(value)))
    if fraction >= 0.995:
        return ">99%"
    if fraction <= 0.005 and fraction > 0:
        return "<1%"
    return f"{fraction * 100:.{decimals}f}%"


def percent(value: float | None, label: str, *, kind: str = "prediction",
            decimals: int = 0) -> str:
    """Render a percentage that always carries its meaning.

    ``label`` is required: a percentage with no stated meaning next to a
    medicine reads as an effectiveness figure.
    """
    _check_label(label)
    if value is None:
        return f'<span style="color:var(--ink-faint);">— {esc(label)}</span>'

    accent = theme.EVIDENCE.get(kind, theme.EVIDENCE["neutral"])[0]
    return (
        f'<span style="font-family:{theme.MONO};font-size:1.05rem;font-weight:600;'
        f'color:{accent};">{format_probability(value, decimals)}</span> '
        f'<span style="font-size:.8rem;color:var(--ink-muted);">{esc(label)}</span>'
    )


#: Bands used to describe a predicted activity in words as well as a number.
def activity_band(value: float | None) -> tuple[str, str]:
    """(plain wording, evidence kind) for a predicted-activity probability.

    Deliberately describes the *prediction*, never an outcome: "higher predicted
    activity", not "more effective".
    """
    if value is None:
        return "No prediction available", "neutral"
    if value >= 0.75:
        return "Higher predicted activity", "prediction"
    if value >= 0.50:
        return "Moderate predicted activity", "prediction"
    return "Lower predicted activity", "neutral"


def prediction_row(pathogen_key: str, value: float | None, *, show_plain: bool = True) -> str:
    """One pathogen's predicted activity, as a labelled bar with wording."""
    profile = content.pathogen(pathogen_key)
    band, kind = activity_band(value)
    accent = theme.EVIDENCE.get(kind, theme.EVIDENCE["neutral"])[0]
    fraction = 0.0 if value is None else max(0.0, min(1.0, float(value)))
    figure = format_probability(value)

    plain = (f'<div style="font-size:.76rem;color:var(--ink-faint);margin-top:.15rem;">'
             f'{esc(profile["plain"])}</div>') if show_plain else ""

    return (
        f'<div style="padding:.6rem 0;border-bottom:1px solid var(--hairline);">'
        f'<div style="display:flex;align-items:baseline;justify-content:space-between;gap:1rem;">'
        f'<span style="font-weight:600;color:var(--ink);">{esc(profile["short"])}</span>'
        f'<span style="font-family:{theme.MONO};font-size:1.15rem;font-weight:600;'
        f'color:{accent};">{figure}</span></div>'
        f'<div class="ebar" style="margin:.35rem 0 .25rem;">'
        f'<span style="transform:scaleX({fraction:.4f});background:{accent};"></span></div>'
        f'<div style="display:flex;justify-content:space-between;gap:1rem;">'
        f'<span style="font-size:.76rem;color:var(--ink-muted);">{esc(band)}</span>'
        f'<span style="font-size:.7rem;color:var(--ink-faint);">AI-predicted activity</span>'
        f'</div>{plain}</div>'
    )


def evidence_checklist(items: Sequence[tuple[str, bool, str]]) -> str:
    """A tick/dash list of which kinds of evidence exist for a candidate.

    Each row is (label, present, kind). A missing kind shows an em dash, never a
    zero or a cross that might read as a negative finding.
    """
    rows = []
    for label, present, kind in items:
        accent = theme.EVIDENCE.get(kind, theme.EVIDENCE["neutral"])[0]
        mark = "✓" if present else "—"
        colour = accent if present else theme.INK_FAINT
        weight = "600" if present else "400"
        rows.append(
            f'<div style="display:flex;align-items:center;gap:.45rem;font-size:.78rem;'
            f'color:{"var(--ink)" if present else "var(--ink-faint)"};line-height:1.75;">'
            f'<span style="font-family:{theme.MONO};color:{colour};font-weight:{weight};'
            f'width:.9rem;display:inline-block;">{mark}</span>{esc(label)}</div>'
        )
    return "".join(rows)


def why_flagged(pathogen_label: str, probability: float | None,
                has_measured: bool) -> str:
    """One sentence explaining, in ordinary words, why a medicine was surfaced."""
    if has_measured:
        return (
            f"This medicine was flagged because published laboratory experiments recorded "
            f"activity against {pathogen_label}, and its molecular structure resembles other "
            f"compounds with the same effect."
        )
    if probability is not None and probability >= 0.75:
        return (
            f"This medicine was flagged because its molecular structure closely resembles "
            f"compounds that showed antibacterial activity against {pathogen_label} in the "
            f"data the model learned from."
        )
    return (
        f"This medicine was included because its molecular structure shares features with "
        f"compounds associated with antibacterial activity against {pathogen_label}."
    )


def how_to_read() -> None:
    """The ten-second explainer. Shown wherever results are first presented."""
    rows = []
    for kind, title, body in content.HOW_TO_READ:
        accent, soft, _ = theme.EVIDENCE.get(kind, theme.EVIDENCE["neutral"])
        rows.append(
            f'<div style="display:flex;gap:.6rem;padding:.35rem 0;">'
            f'<span style="flex:0 0 auto;width:8px;height:8px;border-radius:2px;'
            f'background:{accent};margin-top:.42rem;"></span>'
            f'<div><span style="font-weight:600;color:var(--ink);font-size:.84rem;">'
            f'{esc(title)}</span>'
            f'<span style="font-size:.84rem;color:var(--ink-muted);"> — {esc(body)}</span>'
            f'</div></div>'
        )
    st.markdown(
        '<div class="callout" data-kind="neutral" '
        f'style="--kind:{theme.NEUTRAL};background:{theme.SURFACE};">'
        f'<span class="ev-tag" style="background:{theme.NEUTRAL_SOFT};'
        f'color:{theme.NEUTRAL};">How to read these results</span>'
        f'<div style="margin-top:.4rem;">{"".join(rows)}</div></div>',
        unsafe_allow_html=True,
    )


def glossary_note(keys: Iterable[str]) -> None:
    """Explain the technical terms used on a page, in ordinary words."""
    rows = []
    for key in keys:
        plain, technical, explanation = content.term(key)
        rows.append(
            f'<div style="padding:.3rem 0;font-size:.82rem;">'
            f'<span style="font-weight:600;color:var(--ink);">{esc(plain)}</span>'
            f'<span style="color:var(--ink-faint);font-family:{theme.MONO};'
            f'font-size:.72rem;"> · {esc(technical)}</span><br>'
            f'<span style="color:var(--ink-muted);">{esc(explanation)}</span></div>'
        )
    st.markdown("".join(rows), unsafe_allow_html=True)


def advanced_details(label: str = "Advanced technical details"):
    """Expander that keeps full scientific detail available but not mandatory."""
    return st.expander(label, expanded=False)


def why_am_i_seeing_this(text: str, *, label: str = "Why am I seeing this?"):
    """Expandable plain-language explanation attached to a result."""
    with st.expander(label, expanded=False):
        st.markdown(
            f'<div style="font-size:.86rem;color:var(--ink-muted);line-height:1.6;">{text}</div>',
            unsafe_allow_html=True,
        )


def disease_scope_notice() -> None:
    """State plainly which diseases this system does and does not cover."""
    st.markdown(
        '<div class="callout" data-kind="limitation" '
        f'style="--kind:{theme.LIMIT};background:{theme.LIMIT_SOFT};">'
        f'<span class="ev-tag" style="background:{theme.SURFACE};color:{theme.LIMIT};">'
        f'Scope of prediction</span>'
        f'<div style="margin-top:.35rem;">{esc(content.FUTURE_DISEASE_NOTICE)}</div></div>',
        unsafe_allow_html=True,
    )
