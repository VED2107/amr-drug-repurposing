"""Reusable dashboard components.

Grouped by purpose: primitives (text, callouts, empty and error states), badges
(status and evidence tags), cards (metrics, pathogens, candidates, pipeline
stages) and layout (page header, sidebar, tables).
"""

from .badges import dot_status, evidence_badge, status_badge
from .cards import (
    PIPELINE_STAGES,
    candidate_card,
    metric_grid,
    pathogen_card,
    pipeline_flow,
)
from .explain import (
    FORBIDDEN_PERCENT_LABELS,
    MisleadingLabelError,
    activity_band,
    advanced_details,
    disease_scope_notice,
    evidence_checklist,
    format_probability,
    glossary_note,
    how_to_read,
    percent,
    prediction_row,
    why_am_i_seeing_this,
    why_flagged,
)
from .icons import icon
from .layout import (
    data_table,
    page_header,
    probability_column,
    sidebar_identity,
    sidebar_status,
)
from .primitives import (
    CANDIDATE_LABEL,
    DISCLAIMER_ADMET,
    DISCLAIMER_CLINICAL,
    DISCLAIMER_DOCKING,
    DISCLAIMER_GLOBAL,
    DISCLAIMER_RESISTANCE,
    callout,
    dash_na,
    empty_state,
    error_state,
    esc,
    evidence_bar,
    fmt,
    footer,
    kv_block,
    section,
    spacer,
    structure_svg,
)

__all__ = [
    "FORBIDDEN_PERCENT_LABELS", "MisleadingLabelError", "activity_band",
    "advanced_details", "disease_scope_notice", "evidence_checklist", "format_probability", "glossary_note",
    "how_to_read", "percent", "prediction_row", "why_am_i_seeing_this", "why_flagged",
    "CANDIDATE_LABEL", "DISCLAIMER_ADMET", "DISCLAIMER_CLINICAL", "DISCLAIMER_DOCKING",
    "DISCLAIMER_GLOBAL", "DISCLAIMER_RESISTANCE", "PIPELINE_STAGES",
    "callout", "candidate_card", "dash_na", "data_table", "dot_status", "empty_state",
    "error_state", "esc", "evidence_badge", "evidence_bar", "fmt", "footer", "icon",
    "kv_block", "metric_grid", "page_header", "pathogen_card", "pipeline_flow",
    "probability_column", "section", "sidebar_identity", "sidebar_status", "spacer",
    "status_badge", "structure_svg",
]
