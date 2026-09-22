"""Overview: what this software is, what it does, and what a result means.

Ordered for someone meeting the project for the first time. Technical depth
lives on the pages below this one.
"""

from __future__ import annotations

import plotly.graph_objects as go
import streamlit as st

from .. import components as ui
from .. import content, data, theme


def _hero(counts: dict, pathogens: list[dict]) -> None:
    chips = [
        (f"{counts['approved_products']:,}", "approved products"),
        (f"{counts['bioactivity_total']:,}", "bioactivity records"),
        (f"{len(pathogens)}", "pathogens"),
        (f"{len(counts['active_models'])}", "active models"),
    ]
    chip_html = "".join(
        f'<div><div style="font-family:{theme.MONO};font-size:1.2rem;font-weight:600;'
        f'color:var(--ink);letter-spacing:-.02em;">{ui.esc(v)}</div>'
        f'<div style="font-size:.72rem;color:var(--ink-faint);">{ui.esc(l)}</div></div>'
        for v, l in chips
    )
    st.markdown(
        f"""
        <div class="card pad-lg" style="background:
             linear-gradient(180deg, {theme.PREDICTION_SOFT} 0%, {theme.SURFACE} 62%);">
          <div class="eyebrow">{ui.esc(content.PRODUCT_NAME)}</div>
          <h1 style="max-width:26ch;">{ui.esc(content.PRODUCT_TAGLINE)}</h1>
          <div class="page-sub" style="margin-top:.5rem;">{ui.esc(content.WHAT_IS_THIS)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:2.25rem;margin-top:1.4rem;">{chip_html}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _concept() -> None:
    """The PPT's definition of repurposing, with its illustrative examples."""
    ui.section("What is drug repurposing?")
    left, right = st.columns([1, 1.25], gap="medium")
    with left:
        ui.callout(ui.esc(content.REPURPOSING_DEFINITION),
                   kind="molecular", label="The idea")
        ui.spacer(".5rem")
        rows = "".join(
            f'<div style="padding:.3rem 0;font-size:.82rem;">'
            f'<span style="font-weight:600;color:var(--ink);">{ui.esc(t)}</span> — '
            f'<span style="color:var(--ink-muted);">{ui.esc(d)}</span></div>'
            for t, d in content.WHY_REPURPOSING_WORKS
        )
        st.markdown(rows, unsafe_allow_html=True)
    with right:
        cards = "".join(
            f'<div style="padding:.6rem 0;border-bottom:1px solid var(--hairline);">'
            f'<div style="font-weight:600;color:var(--ink);font-size:.9rem;">{ui.esc(name)}</div>'
            f'<div style="font-size:.8rem;color:var(--ink-muted);margin-top:.15rem;">'
            f'Originally for {ui.esc(was)} &nbsp;→&nbsp; later used for {ui.esc(now)}</div></div>'
            for name, was, now in content.REPURPOSING_EXAMPLES
        )
        st.markdown(
            f'<div class="card"><div style="font-size:.8rem;color:var(--ink-faint);'
            f'margin-bottom:.35rem;">Well-known historical examples</div>{cards}</div>',
            unsafe_allow_html=True,
        )
        st.caption(
            "These are documented medical history, included to explain the idea. They are "
            "**not** outputs of this system and carry no predicted percentage."
        )


def _problem() -> None:
    ui.section("Why this matters")
    ui.metric_grid([
        (label, value, note, icon, kind)
        for (value, label, note), icon, kind in zip(
            content.CRISIS_FACTS,
            ["alert", "flask", "clock", "scale"],
            ["failure", "limitation", "limitation", "limitation"],
        )
    ], columns=4)
    ui.spacer(".6rem")
    st.caption(f"{content.CRISIS_SUMMARY} Figures as stated in the project presentation.")


def _how_it_works(stage_status: dict) -> None:
    ui.section("What this software does", "five stages, from database to dashboard")
    blocks = []
    for idx, name, key, plain, technical, kind in content.PIPELINE_STAGES:
        info = stage_status.get(key) or {}
        status = info.get("status")
        accent = theme.EVIDENCE[kind][0] if status else theme.HAIRLINE_STRONG
        meta = (f"{str(status).lower()} · {int(info.get('records_processed') or 0):,} records"
                if status else "not yet run")
        blocks.append(
            f'<div class="stage" style="padding:.85rem 1rem;">'
            f'<span class="bar" style="background:{accent};"></span>'
            f'<div class="idx">{idx}</div>'
            f'<div class="nm">{ui.esc(name)}</div>'
            f'<div style="font-size:.78rem;color:var(--ink-muted);margin-top:.3rem;'
            f'line-height:1.5;">{ui.esc(plain)}</div>'
            f'<div class="mt" style="margin-top:.45rem;">{ui.esc(meta)}</div></div>'
        )
    st.markdown(
        f'<div class="flow" style="--cols:{len(content.PIPELINE_STAGES)};">'
        f'{"".join(blocks)}</div>',
        unsafe_allow_html=True,
    )
    with ui.advanced_details("Technical detail for each stage"):
        for idx, name, _key, _plain, technical, _kind in content.PIPELINE_STAGES:
            st.markdown(f"**{idx} · {name}** — {technical}")


def _pathogens(pathogens: list[dict]) -> None:
    ui.section("What we are studying", "four drug-resistant bacteria")
    cols = st.columns(len(pathogens), gap="small")
    for col, summary in zip(cols, pathogens):
        profile = content.pathogen(summary["key"])
        with col:
            ui.pathogen_card(summary)
            st.markdown(
                f'<div style="font-size:.78rem;color:var(--ink-muted);line-height:1.5;'
                f'padding:.5rem .1rem 0;">{ui.esc(profile["plain"])}</div>',
                unsafe_allow_html=True,
            )
            if st.button(f"Explore {summary['label']}", key=f"explore_{summary['key']}",
                         use_container_width=True):
                st.session_state["selected_pathogen"] = summary["key"]
                st.switch_page(st.session_state["_pages"]["candidates"])

    ui.spacer(".5rem")
    ui.callout(ui.esc(content.WHY_THESE_FOUR), kind="molecular", label="Why these four")

    with ui.advanced_details("How each one resists treatment"):
        for summary in pathogens:
            profile = content.pathogen(summary["key"])
            st.markdown(f"**{profile['short']} — {profile['full']}** · {profile['armour']}")
            st.caption(profile["mechanism"])


def _resistance_evidence(pathogens: list[dict]) -> None:
    strain = data.strain_evidence()
    if strain.empty:
        return
    total = int(strain["labelled_records"].sum())
    resistant = int(strain["resistant_records"].sum())
    share = resistant / total if total else 0.0
    labels = {p["key"]: p["label"] for p in pathogens}

    ui.section("An important limitation", "what the evidence does not establish")
    left, right = st.columns([1.35, 1], gap="medium")
    with left:
        ui.callout(
            "The models learn from published experiments against these <strong>species</strong>. "
            f"Only <strong>{share:.1%}</strong> of those experiments ({resistant:,} of "
            f"{total:,}) were run on a strain the authors explicitly described as "
            "<strong>drug-resistant</strong>.<br><br>So a high score means "
            "<strong>predicted activity against the bacterium</strong> — not proof that the "
            "medicine defeats its resistance.",
            kind="limitation", label="Important limitation",
        )
    with right:
        order = sorted(strain.to_dict("records"),
                       key=lambda r: r["resistant_records"] / max(r["labelled_records"], 1))
        fig = go.Figure(go.Bar(
            x=[r["resistant_records"] / max(r["labelled_records"], 1) for r in order],
            y=[labels.get(r["pathogen_key"], r["pathogen_key"]) for r in order],
            orientation="h", marker_color=theme.LIMIT,
            text=[f"{r['resistant_records'] / max(r['labelled_records'], 1):.1%}" for r in order],
            textposition="outside", textfont=dict(family=theme.MONO, size=11),
            hovertemplate="%{y}: %{x:.1%} of experiments used a resistant strain<extra></extra>",
        ))
        fig.update_layout(height=200, showlegend=False, margin=dict(l=8, r=8, t=26, b=26),
                          xaxis=dict(range=[0, .3], tickformat=".0%",
                                     title="experiments using a resistant strain"),
                          title="Resistance evidence by bacterium")
        st.plotly_chart(fig, use_container_width=True)


def render() -> None:
    counts = data.overview_counts()
    pathogens = data.pathogen_summaries()
    stages = data.latest_stage_runs()
    stage_status = {r["stage"]: dict(r) for _, r in stages.iterrows()} if not stages.empty else {}

    _hero(counts, pathogens)

    if counts.get("demo_rows"):
        ui.spacer(".75rem")
        ui.callout("This database is a <strong>deterministic demo subset</strong> of a real "
                   "run. Every row is flagged as demo data.",
                   kind="limitation", label="Demo data")

    ui.spacer(".5rem")
    ui.callout(
        f"<strong>What a result means.</strong> {ui.esc(content.WHAT_IS_A_RESULT)}",
        kind="prediction", label="Read this first",
    )

    _concept()
    _problem()
    _how_it_works(stage_status)

    if not stage_status:
        ui.spacer(".75rem")
        ui.empty_state("No pipeline run recorded yet",
                       "The database is initialised but empty. Run the pipeline to populate it.",
                       "python -m src.pipeline.run")
        return

    _pathogens(pathogens)
    _resistance_evidence(pathogens)

    # ------------------------------------------------------- how to read --
    ui.section("How to read a result")
    ui.how_to_read()
    ui.spacer(".5rem")
    ui.disease_scope_notice()

    # ----------------------------------------------------------- holdings --
    ui.section("What the system holds today")
    ui.metric_grid([
        ("Approved products", f"{counts['approved_products']:,}",
         f"{counts['approved_with_structure']:,} matched to a structure", "pill", "molecular"),
        ("Medicines screened", f"{counts['screened_molecules']:,}",
         f"{counts['predictions_total']:,} predictions stored", "brain", "prediction"),
        ("Lab measurements", f"{counts['bioactivity_total']:,}",
         f"{counts['bioactivity_labelled']:,} usable for training", "flask", "molecular"),
        ("3D fits simulated", f"{counts['docking_results']:,}",
         f"{counts['docking_runs']:,} docking run(s)", "cube", "docking"),
        ("Trial records", f"{counts['clinical_records']:,}",
         f"{counts['clinical_queried']:,} medicines checked", "clipboard", "clinical"),
        ("Valid structures", f"{counts['molecules_valid']:,}",
         f"{counts['molecules_invalid']:,} rejected", "molecule", "molecular"),
    ], columns=6)

    # ------------------------------------------------------------- future --
    ui.section("Where this could go next", "planned, not available today")
    cols = st.columns(len(content.FUTURE_ASPECTS), gap="small")
    for col, (title, body) in zip(cols, content.FUTURE_ASPECTS):
        with col:
            st.markdown(
                f'<div class="card" style="height:100%;">'
                f'<span class="ev-tag" style="background:{theme.NEUTRAL_SOFT};'
                f'color:{theme.NEUTRAL};">Future</span>'
                f'<div style="font-weight:600;color:var(--ink);font-size:.88rem;'
                f'margin-top:.4rem;">{ui.esc(title)}</div>'
                f'<div style="font-size:.78rem;color:var(--ink-muted);margin-top:.3rem;'
                f'line-height:1.5;">{ui.esc(body)}</div></div>',
                unsafe_allow_html=True,
            )
