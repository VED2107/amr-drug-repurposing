"""Case study: one real candidate walked through the five-stage pipeline.

This is slide 7 of the project presentation - "A Drug Repurposed Through AI" -
rendered from live database records rather than written up by hand. Every figure
on this page is read back from the same tables the rest of the dashboard uses.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from src.chemistry.depict import mol_to_svg

from .. import components as ui
from .. import content, data, theme


def _pick_candidate(cfg) -> tuple[str, str] | None:
    """Offer the best-evidenced candidates: docked, scored, clinically checked."""
    docked = data.docking_results(limit=200)
    if docked.empty:
        return None

    labels = {p.key: content.pathogen(p.key)["short"] for p in cfg.pathogens}
    docked = docked.sort_values("score_kcal_mol")
    options = docked[["molecule_id", "drug", "pathogen_key", "score_kcal_mol"]].drop_duplicates(
        "molecule_id")

    default = st.session_state.get("case_molecule")
    ids = options["molecule_id"].tolist()
    index = ids.index(default) if default in ids else 0

    chosen = st.selectbox(
        "Walk through a candidate",
        ids, index=index, key="case_pick",
        format_func=lambda mid: (
            f"{options.loc[options.molecule_id == mid, 'drug'].iloc[0]} — "
            f"{labels.get(options.loc[options.molecule_id == mid, 'pathogen_key'].iloc[0], '')}"
        ),
    )
    st.session_state["case_molecule"] = chosen
    pathogen = options.loc[options.molecule_id == chosen, "pathogen_key"].iloc[0]
    return chosen, pathogen


def _stage_header(index: str, title: str, plain: str, kind: str,
                  stage_key: str | None = None) -> None:
    """One stage of the walkthrough: what happened, and what it does not establish.

    The limitation is rendered with the stage rather than collected at the bottom
    of the page. A walkthrough that only says what happened at each step reads as
    a chain of proof, which is exactly what this pipeline does not produce.
    """
    accent, soft, _ = theme.EVIDENCE[kind]
    st.markdown(
        f'<div style="display:flex;gap:.75rem;align-items:flex-start;margin:1.6rem 0 .75rem;">'
        f'<span style="flex:0 0 auto;display:grid;place-items:center;width:30px;height:30px;'
        f'border-radius:8px;background:{soft};color:{accent};font-family:{theme.MONO};'
        f'font-size:.78rem;font-weight:600;">{index}</span>'
        f'<div><div style="font-size:1.02rem;font-weight:600;color:var(--ink);">'
        f'{ui.esc(title)}</div>'
        f'<div style="font-size:.84rem;color:var(--ink-muted);line-height:1.5;'
        f'max-width:74ch;">{ui.esc(plain)}</div></div></div>',
        unsafe_allow_html=True,
    )
    limit = content.STAGE_LIMITS.get(stage_key or "")
    if limit:
        st.markdown(
            f'<div style="margin:-.35rem 0 .6rem 2.4rem;font-size:.78rem;'
            f'color:{theme.LIMIT};max-width:74ch;line-height:1.5;">'
            f'<strong>What this step does not prove:</strong> {ui.esc(limit)}</div>',
            unsafe_allow_html=True,
        )


def render() -> None:
    cfg = data.get_config()

    ui.page_header(
        "Case Study",
        "One real candidate followed from database record to AI score to 3D fit to "
        "clinical history — the whole pipeline on a single medicine.",
        meta=data.header_meta(),
    )

    picked = _pick_candidate(cfg)
    if picked is None:
        ui.empty_state(
            "No walkthrough available yet",
            "A case study needs a candidate that has been scored and docked. Run the "
            "screening and docking stages first.",
            "python -m src.pipeline.predict && python -m src.pipeline.dock",
        )
        return

    molecule_id, pathogen_key = picked
    detail = data.molecule_detail(molecule_id)
    if not detail:
        ui.error_state("Candidate unavailable",
                       "The selected medicine is no longer in the database.")
        return

    mol = detail["molecule"]
    drugs = detail["drugs"]
    name = (drugs[0]["generic_name"] if drugs else None) or mol.get("pref_name") or molecule_id
    profile = content.pathogen(pathogen_key)
    measured = data.measured_activity_pathogens(molecule_id)

    prediction = next((p for p in detail["predictions"] if p["pathogen_key"] == pathogen_key), None)
    docking = next((d for d in detail["docking"] if d["pathogen_key"] == pathogen_key),
                   detail["docking"][0] if detail["docking"] else None)

    st.markdown(
        f'<div class="card pad-lg" style="background:linear-gradient(180deg,'
        f'{theme.PREDICTION_SOFT} 0%, {theme.SURFACE} 70%);">'
        f'<div class="eyebrow">Case study</div>'
        f'<h1 style="font-size:1.6rem;">{ui.esc(name)}</h1>'
        f'<div class="page-sub">An approved medicine, evaluated against '
        f'<strong>{ui.esc(profile["short"])}</strong> — {ui.esc(profile["plain"])}</div></div>',
        unsafe_allow_html=True,
    )

    # ------------------------------------------------------- 01 COLLECT ----
    idx, title, _key, plain, technical, kind = content.PIPELINE_STAGES[0]
    _stage_header(idx, title, plain, kind, _key)
    left, right = st.columns([1.4, 1], gap="medium")
    with left:
        approvals = sorted({d["approval_source"] for d in drugs if d.get("approval_source")})
        brands = sorted({d["brand_name"] for d in drugs if d.get("brand_name")})
        ui.kv_block([
            ("Medicine", name),
            ("Also sold as", ", ".join(brands[:4]) if brands else None),
            ("Approval record", ", ".join(approvals) if approvals else "not FDA-matched"),
            ("Approved products", f"{len(drugs):,}" if drugs else None),
        ])
        st.caption(f"Found in the approved-drug library. {technical}")
    with right:
        ui.structure_svg(mol_to_svg(mol.get("canonical_smiles"), width=340, height=220),
                         caption="Chemical structure on record")

    # -------------------------------------------------------- 02 DECODE ----
    idx, title, _key, plain, technical, kind = content.PIPELINE_STAGES[1]
    _stage_header(idx, title, plain, kind, _key)
    ui.metric_grid([
        ("Molecular weight", ui.fmt(mol.get("mw"), ".1f"), "Da", "scale", "molecular"),
        ("Fat solubility", ui.fmt(mol.get("logp"), ".2f"), "LogP", "flask", "molecular"),
        ("Drug-likeness", ui.fmt(mol.get("lipinski_violations")), "rule breaks (0 is best)",
         "check", "molecular"),
        ("Structure valid", "Yes" if mol.get("is_valid") else "No",
         "passed chemical checks", "molecule", "molecular"),
    ], columns=4)
    ui.spacer(".5rem")
    st.caption(f"The structure is turned into a {content.plain_label('fingerprint').lower()} "
               f"the model can compare. {content.tooltip('fingerprint')}")

    # ------------------------------------------------------- 03 PREDICT ----
    idx, title, _key, plain, technical, kind = content.PIPELINE_STAGES[2]
    _stage_header(idx, title, plain, kind, _key)
    if prediction is None:
        ui.empty_state("Prediction unavailable",
                       "This medicine has not been scored against this bacterium.")
    else:
        left, right = st.columns([1.3, 1], gap="medium")
        with left:
            st.markdown(
                f'<div class="card">'
                f'{ui.prediction_row(pathogen_key, prediction["probability"])}</div>',
                unsafe_allow_html=True)
            ui.spacer(".5rem")
            ui.callout(
                ui.why_flagged(profile["short"], prediction["probability"],
                               pathogen_key in measured),
                kind="prediction", label="Why the model flagged it")
        with right:
            ui.kv_block([
                (content.plain_label("model_version"), prediction["model_version"]),
                ("Algorithm", prediction["model_type"]),
                (content.plain_label("dataset_version"), prediction["dataset_version"]),
                ("Scored on", prediction["predicted_at"]),
            ])
        st.caption("This is the AI's estimate of antibacterial activity. It is not a "
                   "success rate, and it does not establish that the medicine treats "
                   "an infection in patients.")

    # ------------------------------------------------------ 04 VALIDATE ----
    idx, title, _key, plain, technical, kind = content.PIPELINE_STAGES[3]
    _stage_header(idx, title, plain, kind, _key)
    if docking is None:
        ui.empty_state("No docking result available",
                       "This candidate has not been docked against the configured target.",
                       "python -m src.pipeline.dock")
    else:
        threshold = float(cfg.get("docking", "interest_threshold_kcal_mol", default=-7.0))
        score = docking["score_kcal_mol"]
        meets = score is not None and score <= threshold
        ui.metric_grid([
            (content.plain_label("docking"), f"{score:.2f}", "kcal/mol — lower is a tighter fit",
             "cube", "docking"),
            ("Target protein", str(docking.get("target_name") or "—"),
             f"structure {docking.get('pdb_id') or '—'}", "target", "docking"),
            ("Meets project goal", "Yes" if meets else "No",
             f"goal from the presentation: below {threshold} kcal/mol", "check",
             "docking" if meets else "limitation"),
        ], columns=3)
        ui.spacer(".5rem")
        ui.callout(ui.DISCLAIMER_DOCKING, kind="limitation", label="Important limitation")

    # ------------------------------------------------------- 05 DELIVER ----
    idx, title, _key, plain, technical, kind = content.PIPELINE_STAGES[4]
    _stage_header(idx, title, plain, kind, _key)
    trials = detail["trials"]
    if not trials:
        ui.callout(
            "No registered human studies were found for this medicine, or it has not been "
            "checked yet. That is a statement about the records searched.",
            kind="clinical", label="Clinical history")
    else:
        frame = pd.DataFrame(trials)
        n_amr = int(frame["amr_related"].sum())
        ui.metric_grid([
            ("Registered studies", f"{len(frame):,}", "human trials on record",
             "clipboard", "clinical"),
            ("Infection-related", f"{n_amr:,}", "studied in an infection setting",
             "check", "clinical"),
            ("Other conditions", f"{len(frame) - n_amr:,}", "unrelated to infection",
             "alert", "limitation"),
        ], columns=3)

    uses = data.documented_uses(molecule_id, limit=6)
    if not uses.empty:
        ui.spacer(".6rem")
        st.markdown(ui.evidence_badge("clinical", "Documented repurposing evidence"),
                    unsafe_allow_html=True)
        ui.spacer(".35rem")
        ui.data_table(
            uses.rename(columns={"condition": "Also studied for",
                                 "studies": "Registered studies",
                                 "earliest_phase": "Phase", "statuses": "Status"}),
            dash_columns=["Phase", "Status"],
            caption="Documented history from trial records — a study count, not a predicted "
                    "percentage. This system does not estimate a probability for these "
                    "conditions.",
        )

    # --------------------------------------------------------- conclusion --
    ui.section("What this walkthrough shows")
    ui.callout(
        f"<strong>{ui.esc(name)}</strong> was found in the approved-drug library, converted "
        f"into a comparable structural form, scored by the model against "
        f"<strong>{ui.esc(profile['short'])}</strong>, checked for a physical fit against a "
        f"target protein, and cross-referenced with registered human studies. "
        f"<br><br>That makes it a <strong>{ui.CANDIDATE_LABEL.lower()}</strong> — a medicine "
        f"worth investigating experimentally. {ui.esc(content.WHAT_IS_A_RESULT)}",
        kind="limitation", label="Conclusion",
    )

    if st.button("Open the full drug details", key="case_open"):
        st.session_state["selected_molecule"] = molecule_id
        st.switch_page(st.session_state["_pages"]["drug_details"])
