"""Dashboard contracts.

These tests exercise the presentation layer without a browser: component output,
the page registry, the evidence-colour system and the rules that keep a model
prediction from being presented as clinical proof.
"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd
import pytest

from app import theme
from app.components import badges, cards, icons, primitives

PROJECT_ROOT = Path(__file__).resolve().parents[1]

#: Words that turn a forbidden phrase into an honest disclaimer. "It is not a
#: success rate" must pass; "success rate: 91%" must not. The check looks at the
#: 90 characters before each hit, which is long enough to catch a negation that
#: wrapped onto the previous source line.
_NEGATIONS = ("not ", "never ", "n't ", "no ", "nor ", "neither ", "without ")


def flat(text: str) -> str:
    """Source with its line wrapping removed, so a phrase can be matched whole."""
    return " ".join(text.split())


def unnegated_hits(text: str, phrase: str) -> list[str]:
    """Occurrences of `phrase` that are not inside a negating clause."""
    lowered = text.lower()
    hits, start = [], 0
    while (index := lowered.find(phrase, start)) != -1:
        window = lowered[max(0, index - 90):index]
        if not any(negation in window for negation in _NEGATIONS):
            hits.append(text[max(0, index - 60):index + len(phrase) + 20])
        start = index + len(phrase)
    return hits


class TestVisualSystem:
    def test_every_evidence_kind_has_an_accent_and_a_soft_background(self):
        for kind, (accent, soft, _label) in theme.EVIDENCE.items():
            assert re.fullmatch(r"#[0-9A-Fa-f]{6}", accent), kind
            assert re.fullmatch(r"#[0-9A-Fa-f]{6}", soft), kind

    def test_the_four_pathogens_have_distinct_colours(self, cfg):
        colours = [theme.PATHOGEN_COLORS[p.key] for p in cfg.pathogens]
        assert len(set(colours)) == len(colours)

    def test_stylesheet_never_overrides_the_icon_font(self):
        """Overriding Streamlit's icon font makes ligature names appear on screen.

        The previous implementation used a blanket [class*="st-"] selector, which
        matched Streamlit's icon spans and rendered the literal text
        "keyboard_double_arrow_left" instead of a glyph.
        """
        css = theme.CSS
        assert '[class*="st-"]' not in css, "blanket selector matches Streamlit icon spans"
        assert "font-family" in css
        # The typeface is applied on the app root so it inherits, leaving
        # elements that set their own font-family (icons) untouched.
        assert "html, body, .stApp {" in css

    def test_grid_column_count_travels_as_a_custom_property(self):
        """Inline grid-template-columns would outrank the responsive queries."""
        assert "--cols" in theme.CSS
        assert "repeat(var(--cols" in theme.CSS

    def test_responsive_breakpoints_exist(self):
        for width in ("1280px", "1024px", "760px", "460px"):
            assert f"max-width: {width}" in theme.CSS, width

    def test_reduced_motion_is_respected(self):
        assert "prefers-reduced-motion" in theme.CSS


class TestIcons:
    def test_icons_render_inline_svg_not_emoji(self):
        svg = icons.icon("molecule", "#123456")
        assert svg.startswith("<svg")
        assert "#123456" in svg
        # No emoji anywhere in the icon set.
        for name in icons.available():
            assert all(ord(ch) < 0x2190 for ch in icons.icon(name)), name

    def test_unknown_icon_falls_back_without_raising(self):
        assert icons.icon("does-not-exist").startswith("<svg")

    def test_every_card_icon_name_exists(self):
        """A typo in an icon name would silently render a blank dot."""
        used = {"database", "pill", "molecule", "flask", "brain", "chart", "target",
                "cube", "clipboard", "check", "alert", "cross", "clock", "flow",
                "refresh", "search", "layers", "scale"}
        assert used <= set(icons.available())


class TestBadges:
    def test_status_badge_carries_text_not_only_colour(self):
        html = badges.status_badge("SUCCESS")
        assert "SUCCESS" in html, "colour must never be the only signal"

    @pytest.mark.parametrize("status", ["SUCCESS", "PARTIAL", "FAILED", "ACTIVE",
                                        "CANDIDATE", "ARCHIVED", "REJECTED", None])
    def test_status_badge_handles_every_state(self, status):
        assert badges.status_badge(status).startswith("<span")

    def test_evidence_badge_names_the_kind_of_evidence(self):
        assert "AI prediction" in badges.evidence_badge("prediction")
        assert "Docking evidence" in badges.evidence_badge("docking")
        assert "Clinical context" in badges.evidence_badge("clinical")

    def test_prediction_and_clinical_are_visually_distinct(self):
        """The interface must not let model output look like human evidence."""
        assert theme.EVIDENCE["prediction"][0] != theme.EVIDENCE["clinical"][0]


class TestPrimitives:
    def test_missing_values_render_as_a_dash_never_zero(self):
        assert primitives.fmt(None) == "—"
        assert primitives.fmt(float("nan")) == "—"
        assert primitives.fmt(0) == "0", "a real zero must survive"

    def test_escaping_prevents_markup_injection(self):
        assert "<script>" not in primitives.esc("<script>alert(1)</script>")

    def test_evidence_bar_shows_a_dash_when_absent(self):
        assert "—" in primitives.evidence_bar(None)

    def test_evidence_bar_clamps_out_of_range_values(self):
        # The fill is a full-width block scaled on X, so animating it stays on
        # the compositor instead of forcing layout on every frame.
        assert "scaleX(1.0000)" in primitives.evidence_bar(1.7)
        assert "scaleX(0.0000)" in primitives.evidence_bar(-2.0)
        assert "scaleX(0.5000)" in primitives.evidence_bar(0.5)

    def test_evidence_bar_animates_transform_not_width(self):
        """Animating width thrashes layout; transform does not."""
        assert "transform:scaleX" in primitives.evidence_bar(0.4)
        assert "width:" not in primitives.evidence_bar(0.4)

    def test_disclaimers_never_use_forbidden_language(self):
        text = " ".join([
            primitives.DISCLAIMER_GLOBAL, primitives.DISCLAIMER_DOCKING,
            primitives.DISCLAIMER_CLINICAL, primitives.DISCLAIMER_ADMET,
            primitives.DISCLAIMER_RESISTANCE, primitives.CANDIDATE_LABEL,
        ]).lower()
        for banned in ("cure", "best drug", "winner", "confirmed treatment",
                       "clinically proven", "guaranteed"):
            assert banned not in text, banned

    def test_candidate_label_is_the_approved_vocabulary(self):
        assert primitives.CANDIDATE_LABEL == "Prioritised candidate"


class TestCards:
    def test_pipeline_stages_cover_the_whole_pipeline(self):
        stages = {key for _, _, key, _ in cards.PIPELINE_STAGES}
        assert stages == {"ingest", "process", "train", "predict", "dock", "clinical"}

    def test_pipeline_stage_kinds_are_known_evidence_kinds(self):
        for _, _, _, kind in cards.PIPELINE_STAGES:
            assert kind in theme.EVIDENCE


class TestPageRegistry:
    """The ten pages the brief requires, in four levels of the architecture."""

    EXPECTED = {
        "overview": "", "screening": "screening", "candidates": "candidates",
        "drug_details": "drug", "molecular": "molecular", "docking": "docking",
        "clinical": "clinical", "model": "model", "pipeline": "pipeline",
        "retraining": "retraining", "run_history": "runs",
    }

    def test_every_view_module_exists_and_exposes_render(self):
        import importlib

        for key in self.EXPECTED:
            module = importlib.import_module(f"app.views.{key}")
            assert callable(getattr(module, "render", None)), key

    def test_app_registers_each_page_with_its_url(self):
        source = (PROJECT_ROOT / "app" / "streamlit_app.py").read_text(encoding="utf-8")
        for key, url in self.EXPECTED.items():
            assert f'"{key}": st.Page' in source, key
            if url:
                assert f'url_path="{url}"' in source, url

    def test_the_default_page_declares_no_url_path(self):
        """A url_path on the default page makes that path 404."""
        source = (PROJECT_ROOT / "app" / "streamlit_app.py").read_text(encoding="utf-8")
        default_line = next(line for line in source.splitlines() if "default=True" in line)
        assert "url_path" not in default_line

    def test_navigation_uses_streamlit_material_icons(self):
        """Streamlit's own icon font is used, and never overridden by our CSS."""
        source = (PROJECT_ROOT / "app" / "streamlit_app.py").read_text(encoding="utf-8")
        assert source.count(":material/") >= len(self.EXPECTED) - 1

    def test_no_emoji_is_used_as_a_ui_icon(self):
        for path in (PROJECT_ROOT / "app").rglob("*.py"):
            if "__pycache__" in str(path):
                continue
            text = path.read_text(encoding="utf-8")
            # Emoji live well above the arrows block; typographic dashes and
            # arrows used in copy are fine.
            offenders = [ch for ch in text if ord(ch) >= 0x1F300]
            assert not offenders, f"{path.name} uses emoji as UI: {offenders[:3]}"


class TestDataLayerContract:
    """The redesign must keep using the existing data access layer."""

    def test_dashboard_never_trains_docks_or_ingests(self):
        forbidden = re.compile(
            r"\b(train_pathogen|dock_ligand|prepare_receptor|iter_activities|"
            r"fetch_products|create_dataset_version)\b")
        for path in (PROJECT_ROOT / "app").rglob("*.py"):
            if "__pycache__" in str(path):
                continue
            assert not forbidden.search(path.read_text(encoding="utf-8")), path.name

    def test_no_hard_coded_headline_metrics(self):
        """Every number on screen must come from the database."""
        literals = ["47,804", "28,440", "26,694", "20,258", "2,721", "35,232"]
        for path in (PROJECT_ROOT / "app").rglob("*.py"):
            if "__pycache__" in str(path):
                continue
            text = path.read_text(encoding="utf-8")
            for literal in literals:
                assert literal not in text, f"{path.name} hard-codes {literal}"

    def test_data_module_exposes_what_the_views_need(self):
        from app import data

        for name in ("overview_counts", "pathogen_summaries", "screening_table",
                     "candidates", "molecule_detail", "model_versions",
                     "benchmark_table", "docking_results", "clinical_table",
                     "pipeline_runs", "retraining_status", "strain_evidence",
                     "system_status", "header_meta"):
            assert callable(getattr(data, name, None)), name


class TestSystemStatusDerivation:
    """Status indicators must reflect real state, never a hard-coded 'healthy'."""

    def test_status_reports_missing_models_and_empty_data(self, db, cfg, monkeypatch):
        from app import data as data_module

        monkeypatch.setattr(data_module, "open_conn", lambda: db)
        monkeypatch.setattr(data_module, "get_config", lambda: cfg)

        status = data_module.system_status.__wrapped__()

        labels = [label for label, _ in status["indicators"]]
        kinds = [kind for _, kind in status["indicators"]]
        assert "No structures ingested" in labels
        assert "No active model" in labels
        # An empty database must not be described as healthy.
        assert "clinical" not in kinds[:2]

    def test_header_meta_returns_three_live_values(self, db, cfg, monkeypatch):
        from app import data as data_module

        monkeypatch.setattr(data_module, "open_conn", lambda: db)
        monkeypatch.setattr(data_module, "get_config", lambda: cfg)
        # Capture the uncached function before replacing the name, or the
        # replacement would recurse into itself.
        uncached_status = data_module.system_status.__wrapped__
        monkeypatch.setattr(data_module, "system_status", uncached_status)

        meta = data_module.header_meta.__wrapped__()
        assert len(meta) == 3
        assert all(isinstance(k, str) and isinstance(v, str) for k, v in meta)


class TestPercentageSemantics:
    """A percentage next to a medicine reads as an effectiveness claim.

    The rule is enforced structurally: percent() takes the meaning as a required
    argument, so a bare number followed by a percent sign cannot be rendered.
    """

    def test_percent_requires_a_label(self):
        from app.components import explain

        with pytest.raises(TypeError):
            explain.percent(0.91)  # type: ignore[call-arg]

    def test_percent_includes_its_meaning(self):
        from app.components import explain

        html = explain.percent(0.91, "AI-predicted activity against MRSA")
        assert "91%" in html
        assert "AI-predicted activity against MRSA" in html

    @pytest.mark.parametrize("label", [
        "effectiveness", "91% effectiveness", "clinical success", "chance of curing MRSA",
        "treatment efficacy", "guaranteed response", "will treat MRSA",
    ])
    def test_labels_implying_clinical_benefit_are_refused(self, label):
        from app.components import explain

        with pytest.raises(explain.MisleadingLabelError):
            explain.percent(0.91, label)

    def test_missing_value_renders_a_dash_with_its_label(self):
        from app.components import explain

        html = explain.percent(None, "AI-predicted activity")
        assert "\u2014" in html
        assert "AI-predicted activity" in html
        assert "%" not in html, "a missing value must not render a percent sign"

    def test_percent_clamps_out_of_range(self):
        from app.components import explain

        # Clamped, and expressed without implying certainty.
        assert ">99%" in explain.percent(1.4, "AI-predicted activity")
        assert "100%" not in explain.percent(1.4, "AI-predicted activity")
        assert "0%" in explain.percent(-0.2, "AI-predicted activity")

    def test_activity_bands_describe_the_prediction_not_an_outcome(self):
        from app.components import explain

        for value in (0.95, 0.6, 0.1, None):
            wording = explain.activity_band(value)[0].lower()
            for banned in ("effective", "success", "cure", "works", "treats"):
                assert banned not in wording, wording
            assert "predicted" in wording or "no prediction" in wording

    def test_prediction_rows_always_name_what_the_number_is(self):
        from app.components import explain

        html = explain.prediction_row("mrsa", 0.91)
        assert "AI-predicted activity" in html
        assert "91%" in html


class TestNoFabricatedDiseaseScores:
    """The system models four bacteria. It must not imply a score for anything else."""

    OUT_OF_SCOPE = ["cancer", "alzheimer", "diabetes", "parkinson", "hiv", "covid"]

    def test_no_out_of_scope_disease_is_given_a_percentage(self):
        """No view may pair an out-of-scope disease with a percentage figure."""
        for path in (PROJECT_ROOT / "app").rglob("*.py"):
            if "__pycache__" in str(path):
                continue
            text = path.read_text(encoding="utf-8").lower()
            for disease in self.OUT_OF_SCOPE:
                for match in re.finditer(disease, text):
                    window = text[max(0, match.start() - 160):match.end() + 160]
                    # A percent sign near an out-of-scope disease is only allowed
                    # where the text explicitly says no such estimate is produced.
                    if "%" in window:
                        assert any(
                            phrase in window for phrase in
                            ("does not estimate", "not available", "would require",
                             "retrain", "future")
                        ), f"{path.name}: {disease!r} appears near a percentage"

    def test_scope_notice_names_the_limitation_explicitly(self):
        from app import content

        notice = content.FUTURE_DISEASE_NOTICE.lower()
        assert "does not estimate a probability" in notice
        assert "cancer" in notice and "alzheimer" in notice

    def test_future_work_is_labelled_as_future(self):
        from app import content

        assert len(content.FUTURE_ASPECTS) >= 3
        expansion = " ".join(b for _t, b in content.FUTURE_ASPECTS).lower()
        assert "retrain" in expansion, "multi-disease expansion must be framed as retraining"

    def test_historical_examples_carry_no_predicted_percentage(self):
        """Thalidomide, aspirin and sildenafil are documented history, not predictions."""
        from app import content

        for name, was, now in content.REPURPOSING_EXAMPLES:
            assert "%" not in was and "%" not in now, name


class TestPlainLanguageLayer:
    def test_every_pathogen_has_a_plain_explanation(self, cfg):
        from app import content

        for p in cfg.pathogens:
            profile = content.pathogen(p.key)
            assert profile["plain"], p.key
            assert profile["full"], p.key
            # The plain sentence must avoid jargon a lay reader would not know.
            assert "peptidoglycan" not in profile["plain"].lower()

    def test_glossary_gives_a_plain_label_for_each_technical_term(self):
        from app import content

        for key, (plain, technical, explanation) in content.GLOSSARY.items():
            assert plain and technical and explanation, key
            assert plain != technical, f"{key} has no plain alternative"

    def test_jargon_is_replaced_in_user_facing_tables(self):
        """Column headers a lay reader meets first should not be raw jargon."""
        for name in ("screening.py", "candidates.py"):
            text = (PROJECT_ROOT / "app" / "views" / name).read_text(encoding="utf-8")
            assert "Lipinski viol." not in text, name
            assert "Docking (kcal/mol)" not in text, name

    def test_how_to_read_covers_every_evidence_kind(self):
        from app import content

        kinds = {kind for kind, _t, _b in content.HOW_TO_READ}
        assert {"prediction", "docking", "clinical", "molecular", "limitation"} <= kinds


class TestPresentationAlignment:
    """The dashboard must match AMR_Drug_Repurposing.pptx."""

    def test_product_identity_matches_the_deck(self):
        from app import content

        assert content.PRODUCT_NAME == "Smart Screening"
        assert "Drug Repurposing" in content.PRODUCT_TAGLINE
        assert "AMR" in content.PRODUCT_TAGLINE

    def test_the_five_stages_match_the_methodology_slide(self):
        from app import content

        names = [name.lower() for _i, name, _k, _p, _t, _kind in content.PIPELINE_STAGES]
        assert names == ["collect", "decode", "predict", "validate", "deliver"]

    def test_methodology_names_the_deck_technologies(self):
        from app import content

        technical = " ".join(stage[4] for stage in content.PIPELINE_STAGES)
        for expected in ("Orange Book", "ChEMBL", "RDKit", "Morgan", "Random Forest",
                         "AutoDock Vina", "ClinicalTrials.gov"):
            assert expected in technical, expected

    def test_all_four_pathogens_from_the_deck_are_described(self):
        from app import content

        assert set(content.PATHOGENS) == {"mrsa", "ecoli", "kpneumoniae", "mtb"}
        # The deck's structural-diversity slide: each has a distinct defence.
        armours = {p["armour"] for p in content.PATHOGENS.values()}
        assert len(armours) >= 3

    def test_resistance_mechanisms_from_the_deck_are_present(self):
        from app import content

        assert "PBP2a" in content.PATHOGENS["mrsa"]["mechanism"]
        assert "efflux" in content.PATHOGENS["ecoli"]["mechanism"].lower()
        assert "carbapenemase" in content.PATHOGENS["kpneumoniae"]["mechanism"].lower()
        assert "InhA" in content.PATHOGENS["mtb"]["mechanism"]

    def test_the_case_study_page_from_slide_seven_exists(self):
        import importlib

        module = importlib.import_module("app.views.case_study")
        assert callable(module.render)
        source = (PROJECT_ROOT / "app" / "streamlit_app.py").read_text(encoding="utf-8")
        assert "case_study" in source
        assert "case-study" in source

    def test_repurposing_concept_and_examples_are_present(self):
        from app import content

        assert "new medical uses" in content.REPURPOSING_DEFINITION.lower()
        names = {n for n, _w, _t in content.REPURPOSING_EXAMPLES}
        assert {"Thalidomide", "Aspirin", "Sildenafil"} <= names


class TestProbabilityNeverImpliesCertainty:
    """A Random Forest returns 1.0 when its trees agree unanimously.

    That is agreement among trees, not certainty about the world. Printing
    "100%" beside a medicine would tell a non-specialist something the model
    cannot support.
    """

    def test_saturated_probability_reads_as_greater_than_99(self):
        from app.components import explain

        assert explain.format_probability(1.0) == ">99%"
        assert explain.format_probability(0.999) == ">99%"
        assert "100%" not in explain.format_probability(1.0)

    def test_near_zero_reads_as_less_than_1(self):
        from app.components import explain

        assert explain.format_probability(0.002) == "<1%"

    def test_ordinary_values_are_shown_plainly(self):
        from app.components import explain

        assert explain.format_probability(0.91) == "91%"
        assert explain.format_probability(0.5) == "50%"
        assert explain.format_probability(0.0) == "0%"

    def test_missing_probability_is_a_dash(self):
        from app.components import explain

        assert explain.format_probability(None) == "—"

    def test_prediction_rows_never_print_100_percent(self):
        from app.components import explain

        assert "100%" not in explain.prediction_row("mrsa", 1.0)
        assert ">99%" in explain.prediction_row("mrsa", 1.0)


class TestMedicineDiseaseExplorer:
    """The explorer answers "medicine x condition" from stored evidence only.

    Its central rule: a percentage appears only where a trained, validated model
    stands behind it. Every other condition gets the documented evidence and an
    explicit statement that no probability is available.
    """

    def test_the_page_is_registered_in_navigation(self):
        source = (PROJECT_ROOT / "app" / "streamlit_app.py").read_text(encoding="utf-8")
        assert "explorer.render" in source
        assert 'url_path="explorer"' in source

    def test_modelled_conditions_map_onto_a_pathogen(self):
        from app import data

        assert data.match_modelled_pathogen("Methicillin Resistant Staphylococcus Aureus") == "mrsa"
        assert data.match_modelled_pathogen("Klebsiella pneumoniae bacteraemia") == "kpneumoniae"
        assert data.match_modelled_pathogen("Latent TB Infection") == "mtb"
        assert data.match_modelled_pathogen("Escherichia coli urinary infection") == "ecoli"

    def test_conditions_outside_the_models_have_no_pathogen(self):
        from app import data

        for disease in ("Migraine", "Glaucoma", "Type 2 Diabetes", "Breast Cancer",
                        "Helicobacter Pylori Infection", ""):
            assert data.match_modelled_pathogen(disease) is None, disease

    def test_evidence_for_an_unmodelled_condition_carries_no_probability(self):
        """The rule the user set: no invented percentages outside the models."""
        from app import data

        evidence = data.medicine_disease_evidence("ANY-MOLECULE", "Migraine")
        assert evidence["prediction"] is None
        assert evidence["measured"] == []
        assert evidence["modelled_pathogen"] is None

    def test_grading_prefers_clinical_then_experimental_then_computational(self):
        from app.views import explorer

        base = {"trials": [], "measured": [], "prediction": None, "was_checked": True}
        assert explorer.grade_evidence({**base, "trials": [{"nct_id": "NCT1"}]}) == "clinical"
        assert explorer.grade_evidence({**base, "measured": [{"label": 1}]}) == "experimental"
        assert explorer.grade_evidence({**base, "prediction": {"probability": 0.9}}) == "computational"

    def test_never_checked_is_distinct_from_nothing_found(self):
        """"No evidence" and "never looked" are different claims.

        Only 100 of the approved medicines have been queried against the trial
        registry, so collapsing the two would turn a gap in the data into a
        finding about the medicine.
        """
        from app.views import explorer

        base = {"trials": [], "measured": [], "prediction": None}
        assert explorer.grade_evidence({**base, "was_checked": False}) == "unchecked"
        assert explorer.grade_evidence({**base, "was_checked": True}) == "none"
        assert explorer.GRADES["unchecked"][0] == "Not yet checked"
        assert explorer.GRADES["none"][0] == "No evidence found"

    def test_every_grade_has_a_plain_meaning_and_a_known_evidence_kind(self):
        from app.views import explorer

        for grade, (label, kind, meaning, caveat) in explorer.GRADES.items():
            assert label and meaning.endswith("."), grade
            assert caveat.endswith("."), grade
            assert kind in theme.EVIDENCE, grade

    def test_the_page_states_why_there_is_no_percentage(self):
        source = (PROJECT_ROOT / "app" / "views" / "explorer.py").read_text(encoding="utf-8")
        assert "No percentage is shown for this condition" in flat(source)

    def test_the_page_never_labels_a_probability_as_effectiveness(self):
        from app.components import explain

        source = (PROJECT_ROOT / "app" / "views" / "explorer.py").read_text(encoding="utf-8")
        # The page is allowed - required, in fact - to say "it is not a success
        # rate". What it may never do is use one of these as a label.
        for banned in ("success rate", "effectiveness", "cure probability", "efficacy"):
            assert not unnegated_hits(source, banned), (banned, unnegated_hits(source, banned))

    def test_comparison_does_not_present_more_evidence_as_better_treatment(self):
        source = (PROJECT_ROOT / "app" / "views" / "explorer.py").read_text(encoding="utf-8")
        assert "not that it works" in flat(source)
        assert "No ranking, score or recommendation" in flat(source)

    def test_condition_list_splits_multi_condition_trial_records(self):
        """One trial record can name fifty conditions in a single string.

        Offering that string whole would be unreadable, and any list containing
        an AMR organism among the fifty would wrongly trip the model gate.
        """
        from app import data

        options = data.disease_options("migraine", limit=20)
        assert not options.empty
        assert all(";" not in d for d in options["disease"]), \
            "condition options must be individual conditions, not joined lists"

    def test_medicine_counts_agree_with_the_condition_list(self):
        """The chooser and the table must not disagree about the same condition.

        They did: counting studies after the LEFT JOIN onto `drugs` multiplied
        every study by that medicine's number of brand rows, reporting 26
        studies where the database holds one.
        """
        from app import data

        disease = "Methicillin Resistant Staphylococcus Aureus"
        options = data.disease_options("methicillin", limit=40)
        row = options[options["disease"].str.lower() == disease.lower()]
        assert not row.empty, "the condition must appear in its own option list"

        medicines = data.medicines_for_disease(disease)
        assert len(medicines) == int(row.iloc[0]["medicines"])
        assert int(medicines["studies"].sum()) == int(row.iloc[0]["studies"])

    def test_a_condition_matches_as_a_whole_entry_not_a_substring(self):
        """"Migraine" must not silently absorb "Migraine Disorders".

        Substring matching would inflate every count and let the reader's chosen
        condition stand in for a different one they did not pick.
        """
        from app import data

        topiramate = "KJADKKWYZYXHBB-XBWDGYHZSA-N"
        evidence = data.medicine_disease_evidence(topiramate, "Migraine")
        assert evidence["trials"], "expected real migraine trials for topiramate"

        for trial in evidence["trials"]:
            entries = {c.strip().lower() for c in trial["conditions"].split(";")}
            assert "migraine" in entries, trial["conditions"]


class TestProductLanguageAlignment:
    """The claims this interface is allowed to make, asserted on the source.

    These are the project's guardrails: a percentage always says what it measures,
    a study is not an outcome, an approval is not an indication, and a missing
    result is never a negative finding.
    """

    VIEWS = sorted((PROJECT_ROOT / "app" / "views").glob("*.py"))

    def _sources(self):
        return {path.name: path.read_text(encoding="utf-8") for path in self.VIEWS}

    def test_the_four_modelled_pathogens_can_carry_a_percentage(self, cfg):
        from app import data

        for pathogen in cfg.pathogens:
            assert pathogen.key in data.AMR_DISEASE_PATTERNS, pathogen.key

    def test_percentages_outside_the_models_are_impossible_to_produce(self):
        """The gate sits in the data layer, so no view can bypass it."""
        from app import data

        for disease in ("Cancer", "Alzheimer Disease", "Migraine", "Rare Disease",
                        "Type 2 Diabetes"):
            evidence = data.medicine_disease_evidence("KJADKKWYZYXHBB-XBWDGYHZSA-N", disease)
            assert evidence["modelled_pathogen"] is None, disease
            assert evidence["prediction"] is None, disease
            assert evidence["docking"] is None, disease
            assert evidence["measured"] == [], disease

    def test_future_diseases_are_presented_as_future_work(self):
        from app import content

        notice = content.FUTURE_DISEASE_NOTICE.lower()
        assert "cancer" in notice and "alzheimer" in notice
        assert "would require training" in notice
        assert content.FUTURE_ASPECTS, "the roadmap must be stated somewhere"

    def test_every_rendered_probability_carries_its_meaning(self):
        from app.components import explain

        assert "AI-predicted activity" in explain.prediction_row("mrsa", 0.9)
        for label in ("effectiveness", "chance of curing the infection", "clinical success"):
            with pytest.raises(explain.MisleadingLabelError):
                explain.percent(0.9, label)

    def test_no_view_labels_a_number_as_effectiveness_or_a_cure(self):
        banned = ("% effective", "% effectiveness", "cure probability",
                  "probability of cure", "success rate", "will cure", "will treat")
        for name, source in self._sources().items():
            for phrase in banned:
                hits = unnegated_hits(source, phrase)
                assert not hits, f"{name}: {phrase} -> {hits}"

    def test_the_explorer_never_declares_a_winner(self):
        source = (PROJECT_ROOT / "app" / "views" / "explorer.py").read_text(encoding="utf-8")
        lowered = source.lower()
        for phrase in ("winner", "better choice", "recommended medicine", "best medicine"):
            assert phrase not in lowered, phrase
        assert "No ranking, score or recommendation" in flat(source)

    def test_a_trial_record_is_never_presented_as_efficacy(self):
        from app import content

        assert "does not say the study succeeded" in content.STUDY_EXISTS_NOTICE
        explorer = (PROJECT_ROOT / "app" / "views" / "explorer.py").read_text(encoding="utf-8")
        assert "content.STUDY_EXISTS_NOTICE" in explorer

    def test_approval_is_never_presented_as_approval_for_this_condition(self):
        from app import content

        assert "not</strong> approval for the condition" in content.APPROVAL_VS_INDICATION
        for page in ("explorer.py", "drug_details.py"):
            source = (PROJECT_ROOT / "app" / "views" / page).read_text(encoding="utf-8")
            assert "APPROVAL_VS_INDICATION" in source, page

    def test_missing_evidence_is_never_written_as_no_effect(self):
        for name, source in self._sources().items():
            lowered = source.lower()
            for phrase in ("does not work for", "has no effect on this",
                           "proven ineffective", "shown to be ineffective"):
                assert phrase not in lowered, f"{name}: {phrase}"
        explorer = (PROJECT_ROOT / "app" / "views" / "explorer.py").read_text(encoding="utf-8")
        assert "not evidence that the medicine" in flat(explorer)

    def test_the_docking_threshold_is_labelled_as_a_project_criterion(self):
        source = (PROJECT_ROOT / "app" / "views" / "docking.py").read_text(encoding="utf-8")
        assert "Project docking target" in source
        assert "not a universal cutoff" in source
        assert "screening target" in source

    def test_each_pipeline_stage_states_what_it_does_not_prove(self):
        from app import content

        keys = {key for _idx, _name, key, _plain, _tech, _kind in content.PIPELINE_STAGES}
        assert keys == set(content.STAGE_LIMITS)
        for key, limit in content.STAGE_LIMITS.items():
            assert limit.endswith("."), key
        case_study = (PROJECT_ROOT / "app" / "views" / "case_study.py").read_text(encoding="utf-8")
        assert "What this step does not prove" in flat(case_study)

    def test_candidates_are_called_prioritised_not_cures(self):
        from app.components import primitives

        assert "prioritised candidates" in primitives.DISCLAIMER_GLOBAL.lower()
        for name, source in self._sources().items():
            lowered = source.lower()
            for phrase in ("the best drug", "guaranteed treatment", "proven cure"):
                assert phrase not in lowered, f"{name}: {phrase}"


class TestExplorerEvidenceContract:
    def test_the_ladder_has_five_ordered_levels(self):
        from app.views import explorer

        assert explorer.GRADE_ORDER == ("clinical", "experimental", "computational",
                                        "none", "unchecked")
        assert set(explorer.GRADE_ORDER) == set(explorer.GRADES)

    def test_every_level_states_what_it_does_not_mean(self):
        from app.views import explorer

        for key, (label, kind, meaning, caveat) in explorer.GRADES.items():
            assert label and meaning.endswith(".") and caveat.endswith("."), key
            assert kind in theme.EVIDENCE, key

    def test_docking_alone_counts_as_computational_evidence(self):
        from app.views import explorer

        base = {"trials": [], "measured": [], "prediction": None, "was_checked": True}
        graded = explorer.grade_evidence({**base, "docking": {"score_kcal_mol": -9.0}})
        assert graded == "computational"

    def test_condition_view_shows_predictions_only_for_modelled_pathogens(self):
        """The percentage column is filled by the database, not by the view."""
        from app import data

        modelled = data.medicines_for_disease("Methicillin Resistant Staphylococcus Aureus")
        assert not modelled.empty
        assert modelled["probability"].notna().any(), "expected stored MRSA predictions"

        other = data.medicines_for_disease("Migraine")
        assert not other.empty
        assert other["probability"].isna().all()
        assert other["docking_score"].isna().all()
        assert int(other["measurements"].fillna(0).sum()) == 0

    def test_pathogen_shorthand_finds_the_registry_spelling(self):
        """A reader types MRSA; the registry writes it out in full."""
        from app import data

        options = data.disease_options("MRSA", limit=60)
        assert not options.empty
        joined = " ".join(options["disease"]).lower()
        assert "staphylococcus aureus" in joined

    def test_counts_shown_to_the_reader_come_from_the_database(self):
        """No figure on this page may be a literal in the source."""
        from app import data

        coverage = data.clinical_coverage()
        # Coverage may reach the whole library once the clinical sweep has run,
        # so this asserts the relationship rather than an incomplete state.
        assert 0 < coverage["medicines_checked"] <= coverage["medicines_total"]
        assert coverage["medicines_with_records"] <= coverage["medicines_checked"]
        assert coverage["studies"] > 0 and coverage["conditions"] > 0

        source = (PROJECT_ROOT / "app" / "views" / "explorer.py").read_text(encoding="utf-8")
        for value in (coverage["studies"], coverage["conditions"],
                      coverage["medicines_total"]):
            assert f"{value:,}" not in source, f"hard-coded count {value}"


class TestDockingCoverageIsStated:
    """Docking runs over a shortlist, and the interface has to say so."""

    def test_coverage_reports_a_denominator(self):
        from app import data

        cover = data.docking_coverage()
        assert cover["medicines_scored"] > 0
        assert 0 <= cover["medicines_docked"] <= cover["medicines_scored"]
        assert cover["poses"] >= cover["ligand_target_pairs"] >= cover["medicines_docked"]

    def test_the_docking_page_states_the_denominator(self):
        source = (PROJECT_ROOT / "app" / "views" / "docking.py").read_text(encoding="utf-8")
        assert "docking_coverage" in source
        assert "not yet been docked" in source

    def test_no_docking_count_is_hard_coded_in_the_view(self):
        from app import data

        import re

        cover = data.docking_coverage()
        source = (PROJECT_ROOT / "app" / "views" / "docking.py").read_text(encoding="utf-8")
        # A whole-number match, so that a layout constant like height=300 does not
        # read as the count 30.
        for value in (cover["medicines_docked"], cover["poses"], cover["medicines_scored"]):
            pattern = rf"(?<![\d,]){value:,}(?![\d,])"
            assert not re.search(pattern, source), f"hard-coded docking count {value}"


class TestOnlyTheActiveModelIsShown:
    """A retrain leaves the previous generation's predictions in the table.

    They are kept for provenance. They must never reach a reader, or one medicine
    would carry two different probabilities for the same bacterium.
    """

    def test_screening_shows_one_row_per_medicine(self):
        from app import data

        table = data.screening_table(pathogen="mrsa", limit=5000)
        assert not table.empty
        assert table["molecule_id"].duplicated().sum() == 0
        assert table["model_version"].nunique() == 1

    def test_screening_uses_the_active_model_version(self):
        from app import data

        table = data.screening_table(pathogen="mrsa", limit=50)
        conn = data.open_conn()
        try:
            active = conn.execute(
                "SELECT model_version FROM model_versions "
                "WHERE pathogen_key = 'mrsa' AND status = 'ACTIVE'"
            ).fetchone()
        finally:
            conn.close()
        assert active is not None
        assert set(table["model_version"]) == {active["model_version"]}

    def test_counts_exclude_superseded_predictions(self):
        from app import data

        counts = data.overview_counts()
        conn = data.open_conn()
        try:
            all_rows = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
            n_pathogens = conn.execute(
                "SELECT COUNT(*) FROM model_versions WHERE status = 'ACTIVE'"
            ).fetchone()[0]
        finally:
            conn.close()
        assert counts["predictions_total"] <= all_rows
        assert counts["predictions_total"] == counts["screened_molecules"] * n_pathogens

    def test_drug_details_shows_one_prediction_per_pathogen(self):
        from app import data

        conn = data.open_conn()
        try:
            row = conn.execute(
                "SELECT molecule_id FROM predictions GROUP BY molecule_id LIMIT 1"
            ).fetchone()
            n_active = conn.execute(
                "SELECT COUNT(*) FROM model_versions WHERE status = 'ACTIVE'"
            ).fetchone()[0]
        finally:
            conn.close()
        assert row is not None
        detail = data.molecule_detail(row["molecule_id"])
        pathogens = [p["pathogen_key"] for p in detail["predictions"]]
        assert len(pathogens) == len(set(pathogens)), "one row per pathogen"
        assert len(pathogens) <= n_active
        assert all(p["model_status"] == "ACTIVE" for p in detail["predictions"])

    def test_the_header_count_matches_what_is_shown(self):
        from app import data

        status = data.system_status()
        counts = data.overview_counts()
        assert status["predictions"] == counts["predictions_total"]

    def test_docking_table_carries_one_probability_per_pose(self):
        from app import data

        results = data.docking_results(limit=500)
        if results.empty:
            return
        assert results.duplicated(["molecule_id", "target_key"]).sum() == 0


class TestTrainingMembershipIsDisclosed:
    """A probability for a molecule the model trained on is recall, not a prediction."""

    def test_membership_reports_the_split_for_a_training_molecule(self):
        from app import data

        conn = data.open_conn()
        try:
            row = conn.execute(
                """SELECT dm.molecule_id FROM dataset_members dm
                   JOIN model_versions mv ON mv.dataset_version = dm.dataset_version
                                         AND mv.pathogen_key = dm.pathogen_key
                                         AND mv.status = 'ACTIVE'
                   LIMIT 1"""
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return
        membership = data.training_membership(row["molecule_id"])
        assert membership
        entry = next(iter(membership.values()))
        assert entry["split"] in {"train", "validation", "test", None}
        assert entry["label"] in (0, 1)

    def test_a_molecule_the_model_never_saw_returns_nothing(self):
        from app import data

        assert data.training_membership("NOT-A-REAL-MOLECULE-ID") == {}

    def test_drug_details_states_where_the_medicine_sits(self):
        source = (PROJECT_ROOT / "app" / "views" / "drug_details.py").read_text(encoding="utf-8")
        assert "training_membership" in source
        assert "not an independent prediction" in source
