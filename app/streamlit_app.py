"""Smart Screening - AI-assisted drug repurposing against AMR threats.

Opening this app performs no computation beyond reading stored results: it never
retrains a model, reruns docking, refetches data or recomputes a fingerprint.

    streamlit run app/streamlit_app.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app import components as ui  # noqa: E402
from app import data, theme  # noqa: E402
from app.views import (  # noqa: E402
    candidates,
    case_study,
    clinical,
    docking,
    drug_details,
    explorer,
    model,
    molecular,
    overview,
    pipeline,
    retraining,
    run_history,
    screening,
)

st.set_page_config(
    page_title="Smart Screening",
    page_icon=None,
    layout="wide",
    # "auto" keeps navigation open on desktop and collapsed on a phone, where an
    # expanded sidebar would cover the whole viewport.
    initial_sidebar_state="auto",
)
theme.apply_theme()


def _navigation() -> st.navigation:
    """Thirteen pages in four levels: what is happening, which drugs, why, and how
    the system is operating.

    Icons come from Streamlit's own Material set via the ``:material/...:``
    syntax. Nothing in the stylesheet touches the icon font, which is what
    previously made ligature names such as ``keyboard_double_arrow_left``
    appear on screen instead of a glyph.
    """
    pages = {
        # Level 1 - what is happening
        "overview": st.Page(overview.render, title="Overview",
                            icon=":material/dashboard:", default=True),
        # Level 2 - which drugs
        "screening": st.Page(screening.render, title="Drug Screening",
                             icon=":material/search:", url_path="screening"),
        "candidates": st.Page(candidates.render, title="Candidate Explorer",
                              icon=":material/science:", url_path="candidates"),
        "drug_details": st.Page(drug_details.render, title="Drug Details",
                                icon=":material/description:", url_path="drug"),
        "case_study": st.Page(case_study.render, title="Case Study",
                              icon=":material/menu_book:", url_path="case-study"),
        "explorer": st.Page(explorer.render, title="Medicine × Disease",
                            icon=":material/travel_explore:", url_path="explorer"),
        # Level 3 - why
        "molecular": st.Page(molecular.render, title="Molecular Analysis",
                             icon=":material/hexagon:", url_path="molecular"),
        "docking": st.Page(docking.render, title="Docking & 3D",
                           icon=":material/view_in_ar:", url_path="docking"),
        "clinical": st.Page(clinical.render, title="Clinical Evidence",
                            icon=":material/clinical_notes:", url_path="clinical"),
        "model": st.Page(model.render, title="Model & Dataset",
                         icon=":material/analytics:", url_path="model"),
        # Level 4 - how the system operates
        "pipeline": st.Page(pipeline.render, title="Pipeline",
                            icon=":material/account_tree:", url_path="pipeline"),
        "retraining": st.Page(retraining.render, title="Retraining",
                              icon=":material/autorenew:", url_path="retraining"),
        "run_history": st.Page(run_history.render, title="Run History",
                               icon=":material/history:", url_path="runs"),
    }
    # Views navigate to one another by key rather than importing each other.
    st.session_state["_pages"] = pages

    return st.navigation(
        {
            "Screening": [pages["overview"], pages["screening"],
                          pages["candidates"], pages["drug_details"],
                          pages["case_study"]],
            "Explore": [pages["explorer"]],
            "Evidence": [pages["molecular"], pages["docking"],
                         pages["clinical"], pages["model"]],
            "System": [pages["pipeline"], pages["retraining"], pages["run_history"]],
        }
    )


ASSETS = Path(__file__).parent / "assets"


def main() -> None:
    # st.logo renders above the navigation, which is where the product identity
    # belongs; anything written to st.sidebar lands underneath the nav instead.
    logo, icon = ASSETS / "logo.png", ASSETS / "icon.png"
    if logo.exists() and icon.exists():
        st.logo(str(logo), icon_image=str(icon), size="large")
    else:
        with st.sidebar:
            ui.sidebar_identity()

    if not data.database_exists():
        ui.page_header(
            "Smart Screening",
            "AI-assisted screening of approved medicines against antimicrobial resistance.",
        )
        ui.empty_state(
            "No database yet",
            "The dashboard reads results the pipeline has already produced. Run the "
            "pipeline to create and populate the database, then reload this page.",
            "python -m src.pipeline.run",
        )
        ui.footer()
        return

    navigation = _navigation()

    try:
        status = data.system_status()
        with st.sidebar:
            st.markdown(
                '<div style="font-family:ui-monospace,monospace;font-size:.62rem;'
                'letter-spacing:.14em;color:#8E97A8;margin-top:.5rem;">'
                'v1.0 · RESEARCH PROTOTYPE</div>',
                unsafe_allow_html=True,
            )
            ui.sidebar_status(status["indicators"])
    except Exception:
        # A status panel must never be the reason a page fails to render.
        pass

    navigation.run()
    ui.footer()


main()
