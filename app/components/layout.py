"""Page header, sidebar identity and the shared data table."""

from __future__ import annotations

import logging
from typing import Any, Iterable, Sequence

import streamlit as st

from .. import theme
from .badges import dot_status
from .primitives import dash_na, esc


def page_header(
    title: str,
    subtitle: str,
    *,
    eyebrow: str = "Smart Screening",
    meta: Sequence[tuple[str, str]] = (),
) -> None:
    """Consistent header: eyebrow, title, one-line purpose, live meta values."""
    meta_html = ""
    if meta:
        items = "".join(
            f'<div class="item"><span class="k">{esc(k)}</span>'
            f'<span class="v">{esc(v)}</span></div>'
            for k, v in meta
        )
        meta_html = f'<div class="head-meta">{items}</div>'

    st.markdown(
        f'<div class="page-head">'
        f'<div class="eyebrow">{esc(eyebrow)}</div>'
        f'<h1>{esc(title)}</h1>'
        f'<div class="page-sub">{esc(subtitle)}</div>'
        f'{meta_html}</div>',
        unsafe_allow_html=True,
    )


def sidebar_identity() -> None:
    """Product identity block at the top of the navigation."""
    st.markdown(
        f"""
        <div style="padding:0 .25rem .9rem;border-bottom:1px solid var(--hairline);
                    margin-bottom:.75rem;">
          <div style="display:flex;align-items:center;gap:.5rem;">
            <span style="display:grid;place-items:center;width:26px;height:26px;
                         border-radius:7px;background:{theme.PREDICTION};color:#fff;
                         font-family:{theme.MONO};font-size:.7rem;font-weight:600;
                         letter-spacing:-.02em;">AI</span>
            <div style="line-height:1.15;">
              <div style="font-size:.95rem;font-weight:650;color:var(--ink);
                          letter-spacing:-.01em;">Smart Screening</div>
              <div style="font-size:.7rem;color:var(--ink-faint);">AI-Assisted Drug Repurposing</div>
            </div>
          </div>
          <div style="font-family:{theme.MONO};font-size:.64rem;color:var(--ink-faint);
                      margin-top:.6rem;letter-spacing:.04em;">v1.0 · Research prototype</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def sidebar_status(items: Iterable[tuple[str, str]]) -> None:
    """System status derived from real application state, never hard-coded."""
    rows = "".join(dot_status(label, kind) for label, kind in items)
    st.markdown(
        '<div style="padding:.75rem .25rem 0;border-top:1px solid var(--hairline);'
        'margin-top:.75rem;">'
        '<div style="font-family:' + theme.MONO + ';font-size:.6rem;letter-spacing:.14em;'
        'text-transform:uppercase;color:var(--ink-faint);margin-bottom:.4rem;">'
        'System status</div>' + rows + '</div>',
        unsafe_allow_html=True,
    )


def data_table(
    df: Any,
    *,
    dash_columns: Iterable[str] = (),
    column_config: dict[str, Any] | None = None,
    height: int | None = None,
    caption: str | None = None,
) -> None:
    """The one table used across the app.

    ``dash_columns`` are rendered with an explicit em dash where the value is
    missing, because Streamlit prints NaN and pd.NA as the literal text "None",
    which reads like a value rather than an absence.
    """
    if df is None or len(df) == 0:
        st.caption("No rows to display.")
        return

    prepared = dash_na(df, dash_columns) if dash_columns else df

    # Streamlit rejects height=None: it must be a positive int, "stretch" or
    # "content". Only pass it when the caller actually chose one.
    kwargs: dict[str, Any] = {
        "hide_index": True,
        "use_container_width": True,
        "column_config": column_config or {},
    }
    if height is not None:
        kwargs["height"] = int(height)

    try:
        st.dataframe(prepared, **kwargs)
    except Exception as exc:
        # A table that cannot render must not take the page down with a
        # traceback. The detail stays in the server log.
        logging.getLogger("amr.dashboard").exception("data_table failed to render")
        st.error(
            "This table could not be displayed. The underlying data is unaffected; "
            f"the failure was: {type(exc).__name__}."
        )
        return

    if caption:
        st.caption(caption)


def probability_column(label: str = "AI probability") -> Any:
    """Consistent rendering for a model probability wherever it appears."""
    return st.column_config.ProgressColumn(
        label, min_value=0.0, max_value=1.0, format="%.3f",
        help="Model-predicted probability of activity against the species. "
             "Not evidence of clinical efficacy.",
    )
