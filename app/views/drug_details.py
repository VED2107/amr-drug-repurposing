"""Drug details, written for someone who is not a chemist.

The page answers one question in order: what should I know about this medicine?
Plain language leads; every technical figure stays available underneath an
Advanced section rather than being deleted.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from src.chemistry.depict import mol_to_svg
from src.chemistry.descriptors import DESCRIPTOR_LABELS

from .. import components as ui
from .. import content, data, theme


def _select_molecule() -> str | None:
    ui.section("Find a medicine")
    cols = st.columns([2.4, 1.4])
    term = cols[0].text_input(
        "Search", key="detail_search", label_visibility="collapsed",
        placeholder="Type a medicine name, e.g. ciprofloxacin",
    )

    options: list[str] = []
    labels: dict[str, str] = {}
    if term:
        matches = data.search_molecules(term)
        if matches.empty:
            st.caption("No medicine matches that search.")
        else:
            options = matches["molecule_id"].tolist()
            labels = dict(zip(matches["molecule_id"], matches["drug"]))

    current = st.session_state.get("selected_molecule")
    if current and current not in options:
        options = [current] + options
        labels.setdefault(current, current)

    if not options:
        return None

    selected = cols[1].selectbox("Medicine", options, key="detail_pick",
                                 format_func=lambda mid: labels.get(mid, mid),
                                 label_visibility="collapsed")
    st.session_state["selected_molecule"] = selected
    return selected


def _latest_predictions(detail: dict, cfg) -> list[dict]:
    latest: dict[str, dict] = {}
    for record in detail["predictions"]:
        key = record["pathogen_key"]
        if key not in latest or (record["predicted_at"] or "") > (latest[key]["predicted_at"] or ""):
            latest[key] = record
    return [latest[p.key] for p in cfg.pathogens if p.key in latest]


def _training_membership_note(molecule_id: str) -> None:
    """State whether the active models were trained on this molecule.

    A high probability for a compound whose label the model already learned is
    recall, not a prediction. Saying so is the difference between a hypothesis
    and an overstated result, and it is not visible from the number alone.
    """
    membership = data.training_membership(molecule_id)
    if not membership:
        st.caption(
            "None of the active models carried a measured label for this medicine, so every "
            "figure above is a prediction about chemistry the model had not seen labelled."
        )
        return

    labels = {"train": "trained on", "validation": "used to tune", "test": "held out from"}
    lines = []
    for key, row in sorted(membership.items()):
        name = content.pathogen(key)["short"]
        verb = labels.get(str(row.get("split") or ""), "included in the dataset for")
        outcome = "active" if row.get("label") == 1 else "inactive"
        n = row.get("n_measurements") or 0
        lines.append(
            f"<li><strong>{ui.esc(name)}</strong>: the model was {verb} this medicine, "
            f"labelled <strong>{outcome}</strong> from {n:,} measurement"
            f"{'' if n == 1 else 's'}.</li>"
        )

    ui.callout(
        "This medicine appears in the data behind the active models:"
        f"<ul style=\"margin:.4rem 0 0 1rem;padding:0;\">{''.join(lines)}</ul>"
        "A probability for a medicine the model was trained on reflects chemistry it has "
        "already been shown, not an independent prediction. A medicine held out from "
        "training is the stronger test.",
        kind="limitation", label="Where this medicine sits in the training data",
    )


def render() -> None:
    cfg = data.get_config()

    ui.page_header(
        "Drug Details",
        "Everything the system knows about one medicine: what it is, why it was "
        "flagged, and how strong the evidence behind that is.",
        meta=data.header_meta(),
    )

    molecule_id = _select_molecule()
    if not molecule_id:
        ui.empty_state(
            "No medicine selected",
            "Search above, or open a medicine from the screening table or candidate explorer.",
        )
        return

    detail = data.molecule_detail(molecule_id)
    if not detail:
        ui.error_state("Medicine not found",
                       f"No record with id {molecule_id} exists in the database.")
        return

    mol = detail["molecule"]
    drugs = detail["drugs"]
    display_name = (drugs[0]["generic_name"] if drugs else None) or mol.get("pref_name") or molecule_id
    predictions = _latest_predictions(detail, cfg)
    measured = data.measured_activity_pathogens(molecule_id)

    # ============================================================ 1. MEDICINE
    st.markdown(
        f'<div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;'
        f'margin:.25rem 0 .35rem;">'
        f'<span style="font-size:1.6rem;font-weight:650;letter-spacing:-.02em;">'
        f'{ui.esc(display_name)}</span>'
        f'{ui.status_badge("Approved medicine" if drugs else "Not matched to an approved product")}'
        f'</div>',
        unsafe_allow_html=True,
    )

    brands = sorted({d["brand_name"] for d in drugs if d.get("brand_name")})
    if brands:
        st.markdown(
            f'<div style="font-size:.86rem;color:var(--ink-muted);margin-bottom:.5rem;">'
            f'Also sold as {ui.esc(", ".join(brands[:6]))}'
            f'{" and others" if len(brands) > 6 else ""}.</div>',
            unsafe_allow_html=True,
        )

    # The badge above says "Approved medicine". On a page that then shows
    # antibacterial predictions, that adjacency is exactly where a reader can
    # conclude the medicine is approved for treating these bacteria.
    approvals = sorted({d["approval_status"] for d in drugs if d.get("approval_status")})
    routes = sorted({d["route"] for d in drugs if d.get("route")})
    if drugs:
        ui.kv_block([
            ("Approved for", "an existing, unrelated indication"),
            ("Marketing status", ", ".join(approvals) if approvals else "—"),
            ("Route", ", ".join(routes[:4]) if routes else "—"),
            ("Source", drugs[0].get("approval_source") or "—"),
        ])
    ui.callout(content.APPROVAL_VS_INDICATION, kind="clinical",
               label="Approved medicine is not approval for these bacteria")

    # ------------------------------------------------- 2. WHY WAS IT FLAGGED
    ui.section("Why did the system flag this medicine?")
    best = max(predictions, key=lambda r: r["probability"], default=None)
    if best is None:
        ui.empty_state(
            "Prediction unavailable",
            "This medicine has a valid structure but has not been scored yet.",
            "python -m src.pipeline.predict --all",
        )
    else:
        best_profile = content.pathogen(best["pathogen_key"])
        ui.callout(
            ui.why_flagged(best_profile["short"], best["probability"],
                           best["pathogen_key"] in measured),
            kind="prediction", label="Why this medicine appears here",
        )
        ui.why_am_i_seeing_this(
            "This ranking comes from a machine-learning model trained on published "
            "laboratory measurements of how chemicals affect bacteria. The model compares "
            "the structure of this medicine with structures that were measured as active. "
            "<strong>It is a computational prediction, not proof that the medicine will "
            "work in patients.</strong>"
        )

    # ------------------------------------------------------ 3. AMR PREDICTION
    if predictions:
        ui.section("Predicted antibacterial activity",
                   "against the four bacteria this system covers")
        st.markdown(ui.evidence_badge("prediction"), unsafe_allow_html=True)
        ui.spacer(".4rem")

        left, right = st.columns([1.5, 1], gap="medium")
        with left:
            rows = "".join(
                ui.prediction_row(r["pathogen_key"], r["probability"]) for r in predictions
            )
            st.markdown(f'<div class="card">{rows}</div>', unsafe_allow_html=True)
            st.caption(
                "Each figure is the model's estimated probability of antibacterial activity "
                "against that bacterium. It is not a success rate and not an effectiveness "
                "figure."
            )
        with right:
            ui.structure_svg(mol_to_svg(mol.get("canonical_smiles"), width=380, height=260),
                             caption="Chemical structure, drawn with RDKit")

        _training_membership_note(molecule_id)
        ui.callout(ui.DISCLAIMER_RESISTANCE, kind="limitation", label="Important limitation")

    # ------------------------------------------- 4. WHAT ELSE IS IT USED FOR
    ui.section("Other documented uses", "what this medicine has already been studied for")
    uses = data.documented_uses(molecule_id)
    query = detail["clinical_query"]

    if query is None:
        ui.empty_state(
            "Not yet checked",
            "Registered trial records have not been searched for this medicine, which is "
            "different from there being none.",
            "python -m src.pipeline.clinical",
        )
    elif uses.empty:
        ui.callout(
            "No non-infection conditions were found in registered trial records for this "
            "medicine. That is a statement about the records searched, not about the "
            "medicine itself.",
            kind="clinical", label="Documented repurposing evidence",
        )
    else:
        st.markdown(ui.evidence_badge("clinical", "Documented repurposing evidence"),
                    unsafe_allow_html=True)
        ui.spacer(".4rem")
        ui.callout(
            "These are conditions this medicine has <strong>actually been studied for</strong> "
            "in registered human trials. They are documented history, so they carry a study "
            "count rather than a percentage — this system does not predict a probability for "
            "any disease other than the four bacteria above.",
            kind="clinical", label="What this list is",
        )
        ui.spacer(".5rem")
        table = uses.rename(columns={
            "condition": "Condition studied", "studies": "Registered studies",
            "earliest_phase": "Phase", "statuses": "Trial status"})
        ui.data_table(table, dash_columns=["Phase", "Trial status"], height=280)

    ui.disease_scope_notice()

    # ------------------------------------------------------ 5. THE EVIDENCE
    ui.section("The evidence behind this")
    ui.how_to_read()
    ui.spacer(".6rem")

    tabs = st.tabs(["Measured activity", "3D fit (docking)", "Clinical history",
                    "Molecular properties"])

    # -- measured -----------------------------------------------------------
    with tabs[0]:
        st.markdown(ui.evidence_badge("molecular", "Measured in the laboratory"),
                    unsafe_allow_html=True)
        ui.spacer(".4rem")
        if not detail["bioactivity"]:
            ui.empty_state(
                "No laboratory measurement on record",
                "No published experiment in the ingested data measured this medicine "
                "against these bacteria. The prediction above rests on structure alone.",
            )
        else:
            st.caption(
                "Real experimental results from published studies — this is measured data, "
                "not model output."
            )
            activity = pd.DataFrame(detail["bioactivity"])
            activity["Bacterium"] = activity["pathogen_key"].map(
                lambda k: content.pathogen(k)["short"])
            activity["Result"] = activity["label"].map(
                {1: "Active", 0: "Not active"}).fillna("Inconclusive")
            ui.data_table(
                activity[["Bacterium", "Result", "activity_type", "activity_value",
                          "activity_units", "pactivity", "label_reason"]].rename(columns={
                    "activity_type": "Measurement", "activity_value": "Value",
                    "activity_units": "Units", "pactivity": content.plain_label("pactivity"),
                    "label_reason": "How it was classified"}),
                dash_columns=["Measurement", "Value", "Units",
                              content.plain_label("pactivity"), "How it was classified"],
                height=250,
            )

    # -- docking ------------------------------------------------------------
    with tabs[1]:
        st.markdown(ui.evidence_badge("docking"), unsafe_allow_html=True)
        ui.spacer(".4rem")
        if not detail["docking"]:
            ui.empty_state(
                "No docking result available",
                "This candidate has not been docked against the configured target protein.",
                "python -m src.pipeline.dock",
            )
        else:
            st.caption(
                "A simulation of whether the molecule physically fits into a key protein "
                "inside the bacterium. A more negative number means a tighter predicted fit."
            )
            docking = pd.DataFrame(detail["docking"])
            docking["Bacterium"] = docking["pathogen_key"].map(
                lambda k: content.pathogen(k)["short"])
            ui.data_table(
                docking[["Bacterium", "target_name", "pdb_id", "score_kcal_mol"]].rename(
                    columns={"target_name": "Target protein", "pdb_id": "Structure",
                             "score_kcal_mol": content.plain_label("docking")}),
                dash_columns=["Target protein", "Structure"],
            )
            ui.callout(ui.DISCLAIMER_DOCKING, kind="limitation", label="Important limitation")

    # -- clinical -----------------------------------------------------------
    with tabs[2]:
        st.markdown(ui.evidence_badge("clinical"), unsafe_allow_html=True)
        ui.spacer(".4rem")
        if query is None:
            ui.empty_state("Not yet checked",
                           "Trial records have not been searched for this medicine.",
                           "python -m src.pipeline.clinical")
        elif not detail["trials"]:
            ui.callout(
                f"Searched on {ui.esc(query['retrieved_at'])}: no registered studies found.",
                kind="clinical", label="Clinical history")
        else:
            trials = pd.DataFrame(detail["trials"])
            n_amr = int(trials["amr_related"].sum())
            ui.metric_grid([
                ("Registered studies", f"{len(trials):,}", "human trials on record",
                 "clipboard", "clinical"),
                ("Infection-related", f"{n_amr:,}", "studied in an infection setting",
                 "check", "clinical"),
                ("Other conditions", f"{len(trials) - n_amr:,}", "unrelated to infection",
                 "alert", "limitation"),
            ], columns=3)
            ui.spacer(".6rem")
            trials["Evidence type"] = trials["amr_related"].map(
                {1: "Infection-related study", 0: "Unrelated condition"})
            ui.data_table(
                trials[["nct_id", "brief_title", "conditions", "phase", "overall_status",
                        "Evidence type", "url"]].rename(columns={
                    "nct_id": "Trial ID", "brief_title": "Study title",
                    "conditions": "Condition", "phase": "Phase",
                    "overall_status": "Status", "url": "Record"}),
                dash_columns=["Study title", "Condition", "Phase", "Status"], height=300,
                column_config={"Record": st.column_config.LinkColumn("Record",
                                                                    display_text="open")},
            )
            ui.callout(ui.DISCLAIMER_CLINICAL, kind="limitation", label="Important limitation")

    # -- properties ---------------------------------------------------------
    with tabs[3]:
        st.markdown(ui.evidence_badge("molecular"), unsafe_allow_html=True)
        ui.spacer(".4rem")
        st.caption(
            "Calculated physical properties of the molecule. These describe the chemistry; "
            "they are not a safety assessment."
        )
        keys = ["mw", "logp", "tpsa", "hbd", "hba", "rotatable_bonds",
                "lipinski_violations", "qed"]
        spec = {"mw": ".1f", "logp": ".2f", "tpsa": ".1f", "qed": ".3f"}
        ui.metric_grid([
            (DESCRIPTOR_LABELS[k][0], ui.fmt(mol.get(k), spec.get(k, "")),
             DESCRIPTOR_LABELS[k][1] or None, "scale", "molecular")
            for k in keys
        ], columns=8)
        ui.spacer(".6rem")
        violations = mol.get("lipinski_violations")
        if violations is not None:
            verdict = ("has the properties typical of an oral medicine"
                       if violations == 0 else
                       f"breaks {violations} of the five drug-likeness guidelines")
            st.caption(f"This molecule {verdict}. "
                       f"{content.tooltip('lipinski')}")
        ui.callout(ui.DISCLAIMER_ADMET, kind="limitation", label="Important limitation")

    # ------------------------------------------------- 6. ADVANCED DETAILS
    # --------------------------------------------- what this does not prove --
    ui.section("What this does not prove", "read before drawing any conclusion")
    st.markdown(
        '<div class="callout" data-kind="limitation" style="--kind:%s;background:%s;">'
        '<span class="ev-tag" style="background:%s;color:%s;">Limits of this page</span>'
        '<div style="margin-top:.4rem;">%s</div></div>' % (
            theme.LIMIT, theme.LIMIT_SOFT, theme.SURFACE, theme.LIMIT,
            "".join(
                f'<div style="padding:.25rem 0;font-size:.86rem;color:var(--ink-muted);">'
                f'&mdash; {line}</div>'
                for line in (
                    "A model probability is predicted antibacterial activity against a "
                    "species. It is not effectiveness, a cure probability or a clinical "
                    "outcome.",
                    "A docking score is a simulation against one rigid protein, not "
                    "demonstrated binding in a living cell.",
                    "A registered trial shows existing human study history for some "
                    "indication, not antimicrobial efficacy.",
                    "Approval by a regulator covers this medicine's existing use only.",
                    "Where a kind of evidence is missing, that is an absence of evidence "
                    "&mdash; never evidence of no effect.",
                )
            ),
        ),
        unsafe_allow_html=True,
    )

    ui.section("For specialists")
    with ui.advanced_details():
        st.markdown("**Identity and provenance**")
        ui.kv_block([
            ("Generic name", display_name),
            ("Approval source", ", ".join(sorted({d["approval_source"] for d in drugs
                                                  if d.get("approval_source")})) or None),
            ("ChEMBL ID", mol.get("chembl_id")),
            ("InChIKey", mol.get("inchikey")),
            ("Molecule ID", mol.get("molecule_id")),
            (content.term("smiles")[1], mol.get("canonical_smiles")),
            ("Murcko scaffold", mol.get("murcko_scaffold")),
        ])

        if predictions:
            st.markdown("**Prediction provenance**")
            provenance = pd.DataFrame(predictions)[
                ["pathogen_key", "probability", "model_version", "model_type",
                 "dataset_version", "feature_version", "predicted_at"]
            ].rename(columns={
                "pathogen_key": "Bacterium", "probability": "Probability",
                "model_version": content.term("model_version")[1],
                "model_type": "Algorithm",
                "dataset_version": content.term("dataset_version")[1],
                "feature_version": "Feature version", "predicted_at": "Predicted at"})
            provenance["Bacterium"] = provenance["Bacterium"].map(
                lambda k: content.pathogen(k)["short"])
            ui.data_table(provenance, dash_columns=list(provenance.columns))

        if drugs:
            st.markdown(f"**Approved products ({len(drugs)})**")
            products = pd.DataFrame(drugs)[
                ["generic_name", "brand_name", "application_no", "marketing_status",
                 "dosage_form", "approval_source", "match_method"]
            ].rename(columns={
                "generic_name": "Ingredient", "brand_name": "Brand",
                "application_no": "Application", "marketing_status": "Status",
                "dosage_form": "Form / route", "approval_source": "Source",
                "match_method": "Structure match"})
            ui.data_table(products, dash_columns=list(products.columns), height=240)

        st.markdown("**Terms used on this page**")
        ui.glossary_note(["fingerprint", "pactivity", "docking", "lipinski",
                          "model_version", "dataset_version"])
