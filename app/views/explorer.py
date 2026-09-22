"""Medicine x Disease explorer.

Answers one plain question: *could this medicine be relevant to this condition?*

The answer is assembled from evidence this database actually holds, and graded so
a reader can see how strong it is. A probability appears only where a trained,
validated model exists - which, in this system, means the four bacteria and
nothing else. For every other condition the page shows the documented evidence
and says why there is no number, rather than inventing one.

Two distinctions are load-bearing here and are never collapsed: absence of
evidence is not evidence of absence, and a study existing is not a study
succeeding.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
import streamlit as st

from .. import components as ui
from .. import content, data, theme

#: grade -> (label, evidence kind, what it means, what it does not mean)
GRADES = {
    key: (label, kind, meaning, caveat)
    for key, label, kind, meaning, caveat in content.EVIDENCE_LEVELS
}

#: Strongest first. The order is this page's whole argument, so it lives in one place.
GRADE_ORDER = ("clinical", "experimental", "computational", "none", "unchecked")


def grade_evidence(evidence: dict[str, Any]) -> str:
    """Highest grade of evidence available, strongest first.

    Clinical outranks experimental, which outranks computational. "Not checked"
    is deliberately distinct from "nothing found": one is an absence of evidence,
    the other is an absence of looking.
    """
    if evidence["trials"]:
        return "clinical"
    if evidence["measured"]:
        return "experimental"
    if evidence["prediction"] or evidence.get("docking"):
        return "computational"
    if not evidence["was_checked"]:
        return "unchecked"
    return "none"


def _grade_banner(grade: str, medicine: str, disease: str) -> None:
    label, kind, meaning, caveat = GRADES[grade]
    accent, soft, _ = theme.EVIDENCE[kind]
    st.markdown(
        f'<div class="callout" data-kind="{kind}" style="--kind:{accent};background:{soft};">'
        f'<span class="ev-tag" style="background:{theme.SURFACE};color:{accent};">'
        f'Evidence level · {ui.esc(label)}</span>'
        f'<div style="margin-top:.45rem;font-size:1rem;color:var(--ink);font-weight:600;">'
        f'{ui.esc(medicine)} &times; {ui.esc(disease)}</div>'
        f'<div style="margin-top:.3rem;">{ui.esc(meaning)}</div>'
        f'<div style="margin-top:.2rem;color:var(--ink-faint);font-size:.82rem;">'
        f'{ui.esc(caveat)}</div></div>',
        unsafe_allow_html=True,
    )


def evidence_ladder() -> None:
    """The five levels, strongest at the top, as a ladder rather than a scoreboard.

    Rendered vertically with arrows because the levels are ordered; a row of equal
    cards reads as a menu of equivalent options, which is the wrong idea.
    """
    rows = []
    for index, key in enumerate(GRADE_ORDER):
        label, kind, meaning, caveat = GRADES[key]
        accent, soft, _ = theme.EVIDENCE[kind]
        arrow = (
            '<div style="font-family:ui-monospace,monospace;color:var(--ink-faint);'
            'font-size:.72rem;line-height:1;margin:.05rem 0 .05rem .6rem;">&darr;</div>'
            if index else ""
        )
        rows.append(
            f'{arrow}<div style="display:flex;gap:.7rem;align-items:baseline;'
            f'padding:.3rem 0;flex-wrap:wrap;">'
            f'<span class="ev-tag" style="background:{soft};color:{accent};flex:0 0 auto;'
            f'min-width:9.5rem;">{ui.esc(label)}</span>'
            f'<span style="font-size:.82rem;color:var(--ink-muted);flex:1 1 18rem;'
            f'min-width:0;">{ui.esc(meaning)} '
            f'<span style="color:var(--ink-faint);">{ui.esc(caveat)}</span></span></div>'
        )
    st.markdown(f'<div class="card">{"".join(rows)}</div>', unsafe_allow_html=True)
    st.caption(
        "These describe **what kind of supporting information exists today** - not how "
        "well a medicine works. A higher level is a stronger kind of evidence, never a "
        "statement of effectiveness."
    )


def _probability_column() -> Any:
    """AI-predicted activity as a labelled percentage bar.

    The label travels with the number: a bare bar beside a medicine name reads as
    a measure of how well the medicine works, to anyone who has not read the rest
    of the page.
    """
    return st.column_config.ProgressColumn(
        "AI-predicted activity", min_value=0.0, max_value=100.0, format="%.0f%%",
        help="Model-predicted probability of antibacterial activity against this "
             "species. Not effectiveness, not a cure probability, not a clinical outcome.",
    )


# ------------------------------------------------------------ evidence panes --
def _trials_pane(evidence: dict[str, Any]) -> None:
    st.markdown("**Known use - registered clinical studies**")
    if evidence["trials"]:
        frame = pd.DataFrame(evidence["trials"])
        st.caption(
            f"**{len(frame):,} registered study record(s)** in this database name this "
            f"condition for this medicine."
        )
        ui.callout(content.STUDY_EXISTS_NOTICE, kind="clinical",
                   label="What a study record means")
        ui.spacer(".4rem")
        columns = {
            "nct_id": "Trial ID", "brief_title": "Study title", "conditions": "Condition",
            "interventions": "Intervention", "phase": "Phase", "overall_status": "Status",
            "study_type": "Study type", "url": "Record",
        }
        ui.data_table(
            frame[list(columns)].rename(columns=columns),
            dash_columns=["Study title", "Condition", "Intervention", "Phase", "Status",
                          "Study type"],
            height=260,
            column_config={"Record": st.column_config.LinkColumn("Record",
                                                                 display_text="open")},
        )
    elif not evidence["was_checked"]:
        ui.empty_state(
            "Not yet checked",
            "We have not queried this medicine against the trial registry yet. That is "
            "different from there being no studies.",
            "python -m src.pipeline.clinical",
        )
    else:
        ui.empty_state(
            "No evidence found in the sources checked",
            f"This medicine was searched on {evidence['checked_at']}, and no retrieved "
            f"study record names this condition. That is not evidence that the medicine "
            f"has no effect on it.",
        )


def _measured_pane(evidence: dict[str, Any]) -> None:
    st.markdown("**Research evidence - laboratory measurements**")
    if evidence["measured"]:
        frame = pd.DataFrame(evidence["measured"])
        frame["Result"] = frame["label"].map({1: "Active", 0: "Not active"})
        st.caption("Measured in published laboratory experiments - real data, not model output.")
        ui.data_table(
            frame[["Result", "activity_type", "activity_relation", "activity_value",
                   "activity_units", "pactivity"]].rename(columns={
                "activity_type": "Measurement", "activity_relation": "Rel",
                "activity_value": "Value", "activity_units": "Units",
                "pactivity": content.plain_label("pactivity")}),
            dash_columns=["Measurement", "Rel", "Value", "Units",
                          content.plain_label("pactivity")],
            height=200,
        )
    elif evidence["modelled_pathogen"]:
        ui.empty_state(
            "No laboratory measurement on record",
            "No published experiment in the ingested data measured this medicine against "
            "this organism.",
        )
    else:
        ui.empty_state(
            "Not applicable to this condition",
            "This system holds laboratory measurements only for the four bacteria it "
            "models.",
        )


def _computational_pane(evidence: dict[str, Any]) -> None:
    st.markdown("**AI prediction and molecular docking**")
    pathogen = evidence["modelled_pathogen"]

    if not pathogen:
        ui.callout(
            "<strong>No percentage is shown for this condition.</strong> The current AI "
            "models cover four bacterial pathogens only - MRSA, E. coli, K. pneumoniae "
            "and M. tuberculosis. Extending them to another condition would mean training "
            "and validating a model on a dataset for that condition, which has not been "
            "done. Until then this page reports the documented evidence above instead of "
            "inventing a probability.",
            kind="limitation", label="Model unavailable - future model expansion",
        )
        return

    profile = content.pathogen(pathogen)
    prediction, docking = evidence["prediction"], evidence.get("docking")

    if prediction:
        st.markdown(
            f'<div class="card">{ui.prediction_row(pathogen, prediction["probability"])}</div>',
            unsafe_allow_html=True)
        st.caption(
            f"A validated model exists for {profile['short']}, so a probability can be "
            f"shown. It estimates **antibacterial activity against the species** - it is "
            f"not a success rate, and it does not establish that the medicine treats an "
            f"infection in a patient."
        )
    else:
        ui.empty_state(
            "No stored prediction for this medicine",
            f"A validated model exists for {profile['short']}, but this medicine has not "
            f"been scored by it yet.",
        )

    ui.spacer(".4rem")
    if docking:
        ui.kv_block([
            ("Docking score", f"{docking['score_kcal_mol']:.2f} kcal/mol"),
            ("Target protein", docking.get("target_name") or docking.get("target_key")),
            ("Pose", f"rank {docking['pose_rank']}"),
        ])
        st.caption(
            "A docking score is a simulated fit between the molecule and one protein. It "
            "is computational evidence worth following up, not a demonstration that the "
            "medicine binds or acts in a living organism."
        )
    else:
        ui.empty_state(
            "No docking result for this pairing",
            "This medicine has not been docked against this organism's target protein.",
        )

    if prediction:
        with ui.advanced_details("Model provenance"):
            ui.kv_block([
                (content.plain_label("model_version"), prediction["model_version"]),
                ("Algorithm", prediction["model_type"]),
                (content.plain_label("dataset_version"), prediction["dataset_version"]),
                ("Scored on", prediction["predicted_at"]),
            ])


def _render_evidence(evidence: dict[str, Any], medicine: str, disease: str) -> str:
    """Render every evidence stream for one pairing. Returns the grade."""
    grade = grade_evidence(evidence)
    _grade_banner(grade, medicine, disease)
    ui.spacer(".5rem")
    _trials_pane(evidence)
    ui.spacer(".5rem")
    _measured_pane(evidence)
    ui.spacer(".5rem")
    _computational_pane(evidence)
    return grade


# ------------------------------------------------------------------ pickers --
def _medicine_picker(key: str, label: str = "Medicine") -> tuple[str, str] | None:
    term = st.text_input(label, key=f"{key}_term",
                         placeholder="Type a medicine name, e.g. aspirin")
    if not term.strip():
        return None
    matches = data.search_molecules(term, limit=40)
    if matches.empty:
        st.caption("No medicine in the library matches that name.")
        return None
    options = matches["molecule_id"].tolist()
    names = dict(zip(matches["molecule_id"], matches["drug"]))
    chosen = st.selectbox("Select", options, key=f"{key}_pick",
                          format_func=lambda mid: names.get(mid, mid))
    return chosen, names.get(chosen, chosen)


def _disease_picker(key: str, label: str = "Condition") -> str | None:
    term = st.text_input(label, key=f"{key}_dterm",
                         placeholder="Type a condition, e.g. migraine, pneumonia, MRSA")
    if not term.strip():
        return None
    options = data.disease_options(term, limit=120)
    if options.empty:
        st.caption("No condition in the retrieved trial records matches that text.")
        return None
    labels = {
        row["disease"]: f"{row['disease']}  ({int(row['medicines'])} medicines, "
                        f"{int(row['studies'])} studies)"
        for _, row in options.iterrows()
    }
    return st.selectbox("Select", list(labels), key=f"{key}_dpick",
                        format_func=lambda d: labels.get(d, d))


# -------------------------------------------------------------------- modes --
def _mode_medicine_to_condition(coverage: dict[str, int]) -> None:
    ui.section("Pick a medicine, then a condition")
    left, right = st.columns(2, gap="medium")
    with left:
        picked = _medicine_picker("md")
    with right:
        disease = _disease_picker("md")

    if picked and disease:
        molecule_id, medicine = picked
        ui.section("Could this medicine be relevant to this condition?")
        evidence = data.medicine_disease_evidence(molecule_id, disease)
        _render_evidence(evidence, medicine, disease)
        ui.spacer(".5rem")
        if st.button("Open full drug details", key="explore_open"):
            st.session_state["selected_molecule"] = molecule_id
            st.switch_page(st.session_state["_pages"]["drug_details"])
        return

    if picked:
        molecule_id, medicine = picked
        uses = data.documented_uses(molecule_id, limit=25)
        ui.section(f"What {medicine} has been studied for")
        if uses.empty:
            ui.empty_state(
                "No conditions on record",
                "Either this medicine has not been queried against the trial registry, or "
                "the retrieved records name no condition outside the AMR context.")
        else:
            st.caption("Documented conditions from registered studies. Pick one above to "
                       "see the full evidence for that pairing.")
            ui.data_table(
                uses.rename(columns={"condition": "Condition studied",
                                     "studies": "Registered studies",
                                     "earliest_phase": "Phase", "statuses": "Status"}),
                dash_columns=["Phase", "Status"], height=320)
        return

    ui.empty_state(
        "Nothing selected yet",
        "Type a medicine name on the left to begin. Add a condition on the right to see "
        "the evidence for that specific pairing.")


def _mode_condition_to_medicines(coverage: dict[str, int]) -> None:
    ui.section("Pick a condition")
    disease = _disease_picker("dm", label="Condition")
    if not disease:
        ui.empty_state(
            "No condition selected",
            "Type a condition - or a pathogen shorthand such as MRSA or TB - to see which "
            "medicines in this database have registered studies naming it.")
        return

    pathogen = data.match_modelled_pathogen(disease)
    medicines = data.medicines_for_disease(disease)

    if pathogen:
        profile = content.pathogen(pathogen)
        ui.callout(
            f"This condition maps onto <strong>{ui.esc(profile['short'])}</strong>, one of "
            f"the four bacteria this system models. AI-predicted activity and docking "
            f"results are therefore available for the medicines below.",
            kind="prediction", label="Validated AMR model available")
    else:
        ui.callout(
            "The current AI models do not cover this condition, so the table below shows "
            "<strong>documented study history only</strong> - no predicted percentages.",
            kind="limitation", label="Model unavailable for this condition")

    ui.section(f"Medicines studied for {disease}")
    if medicines.empty:
        ui.empty_state(
            "No evidence found in the sources checked",
            f"No retrieved study record names this condition. Only "
            f"{coverage['medicines_checked']:,} of {coverage['medicines_total']:,} "
            f"medicines have been queried so far, so this is a limit of the data, not a "
            f"finding about the condition.")
        return

    st.caption(
        f"**{len(medicines):,} medicine(s)** in this database have registered studies "
        f"naming this condition. Study counts are documented history, not predictions.")

    # Column order is reading priority, not the evidence ladder. On a phone the
    # table scrolls sideways and only the first two columns are visible, so the
    # figure this mode promises - predicted activity - sits next to the name.
    # The counts follow, and the two least useful columns go last.
    frame = medicines.copy()
    columns = {"medicine": "Medicine"}
    config: dict[str, Any] = {}
    if pathogen:
        # Cast to a nullable float so a missing score renders as an empty cell.
        # Left as Python None in an object column, Streamlit prints the literal
        # text "None", which reads like a measured result of nothing.
        frame["probability_pct"] = (
            pd.to_numeric(frame["probability"], errors="coerce").astype("Float64") * 100)
        # Rendered as text, because Streamlit's NumberColumn prints a missing
        # value as the literal word "None", which reads like a measured result.
        docking = pd.to_numeric(frame["docking_score"], errors="coerce")
        frame["docking_score"] = docking.map(
            lambda value: "—" if pd.isna(value) else f"{value:.2f}")
        frame["measurements"] = pd.to_numeric(
            frame["measurements"], errors="coerce").astype("Int64")
        columns["probability_pct"] = "AI-predicted activity"
        columns["studies"] = "Clinical studies found"
        columns["measurements"] = "Lab measurements"
        columns["docking_score"] = "Docking (kcal/mol)"
        config = {
            # Narrow the counting columns so the predicted-activity bar is
            # reachable on a phone without scrolling the table twice.
            "Clinical studies found": st.column_config.NumberColumn(width="small"),
            "Lab measurements": st.column_config.NumberColumn(width="small"),
            "AI-predicted activity": _probability_column(),
            "Docking (kcal/mol)": st.column_config.TextColumn(
                width="small", help="Best docking score on record, in kcal/mol. More "
                                    "negative is a tighter simulated fit."),
        }

    columns.setdefault("studies", "Clinical studies found")
    columns["infection_studies"] = "Infection-related"
    columns["earliest_phase"] = "Phase"

    ui.data_table(frame[list(columns)].rename(columns=columns),
                  dash_columns=["Phase"], height=380, column_config=config)

    if pathogen:
        st.caption(
            "Every percentage in this table is **AI-predicted activity against the "
            "bacterium**. It is not effectiveness, not a cure probability and not a "
            "clinical outcome. An empty cell means no stored result, not a negative one.")
        ui.spacer(".4rem")
        ui.callout(ui.DISCLAIMER_RESISTANCE, kind="limitation", label="Important limitation")


def _mode_compare() -> None:
    ui.section("Compare two medicines for the same condition")
    cols = st.columns(3, gap="medium")
    with cols[0]:
        first = _medicine_picker("cmp_a", "Medicine A")
    with cols[1]:
        second = _medicine_picker("cmp_b", "Medicine B")
    with cols[2]:
        disease = _disease_picker("cmp")

    if not (first and second and disease):
        ui.empty_state(
            "Pick two medicines and a condition",
            "The comparison puts the evidence each medicine has for the same condition "
            "side by side. It does not pick a better medicine.")
        return

    ui.section(f"Evidence available for {disease}")
    left, right = st.columns(2, gap="medium")
    for column, (molecule_id, name) in zip((left, right), (first, second)):
        with column:
            evidence = data.medicine_disease_evidence(molecule_id, disease)
            grade = grade_evidence(evidence)
            _grade_banner(grade, name, disease)
            ui.spacer(".4rem")
            prediction, docking = evidence["prediction"], evidence.get("docking")
            ui.kv_block([
                ("Evidence level", GRADES[grade][0]),
                ("Clinical studies found", len(evidence["trials"]) or "—"),
                ("Lab measurements", len(evidence["measured"]) or "—"),
                ("AI-predicted activity",
                 ui.format_probability(prediction["probability"]) if prediction
                 else "not available for this condition"),
                ("Docking result",
                 f"{docking['score_kcal_mol']:.2f} kcal/mol" if docking
                 else "none on record"),
            ])

    ui.spacer(".6rem")
    ui.callout(
        "This comparison is based on <strong>the evidence currently available in this "
        "system</strong>, and nothing more. More studies means a medicine has been "
        "<em>studied and recorded</em> more for this condition - not that it works "
        "better, and not that it is preferable. No ranking, score or recommendation is "
        "produced here.",
        kind="limitation", label="How to read this comparison")


# --------------------------------------------------------------------- page --
def render() -> None:
    ui.page_header(
        "Medicine × Disease",
        "Could this medicine be relevant to this condition? See exactly what evidence "
        "sits behind the answer.",
        meta=data.header_meta(),
    )

    coverage = data.clinical_coverage()
    ui.callout(
        "This page reports <strong>only what is in this database</strong>. Trial records "
        f"have been retrieved for <strong>{coverage['medicines_checked']:,}</strong> of "
        f"{coverage['medicines_total']:,} approved medicines, covering "
        f"{coverage['studies']:,} studies across {coverage['conditions']:,} conditions. "
        "A medicine that has not been checked shows <em>Not yet checked</em> - which is "
        "not the same as no evidence existing, and neither one means the medicine has no "
        "effect.",
        kind="limitation", label="What this page can and cannot tell you",
    )

    ui.spacer(".5rem")
    ui.callout(content.APPROVAL_VS_INDICATION, kind="clinical",
               label="Approved medicine is not approval for this condition")

    ui.spacer(".6rem")
    ui.section("Evidence levels", "strongest first")
    evidence_ladder()

    ui.spacer(".4rem")
    tabs = st.tabs(["Medicine → condition", "Condition → medicines",
                    "Compare two medicines"])
    with tabs[0]:
        _mode_medicine_to_condition(coverage)
    with tabs[1]:
        _mode_condition_to_medicines(coverage)
    with tabs[2]:
        _mode_compare()
