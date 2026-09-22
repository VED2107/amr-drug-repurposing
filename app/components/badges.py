"""Status and evidence badges.

Colour reinforces meaning here, it is never the only signal: every badge also
carries its own text, so the interface stays readable without colour vision.
"""

from __future__ import annotations

from .. import theme
from .primitives import esc

#: Pipeline / model / target states mapped to an evidence kind.
_STATUS_KIND = {
    "SUCCESS": "clinical", "ok": "clinical", "ready": "clinical",
    "ACTIVE": "clinical", "predicted": "clinical", "clear": "clinical",
    "PARTIAL": "limitation", "pending": "limitation", "CANDIDATE": "limitation",
    "SKIPPED": "limitation", "RUNNING": "prediction", "INTERRUPTED": "limitation",
    "warning": "limitation",
    "FAILED": "failure", "failed": "failure", "REJECTED": "failure",
    "unavailable": "failure", "critical": "failure",
    "ARCHIVED": "neutral", "unmatched": "neutral", "info": "neutral",
}


def status_badge(status: str | None, *, dot: bool = True) -> str:
    """Inline badge for a run, model or target state."""
    label = str(status) if status else "unknown"
    accent, soft, _ = theme.EVIDENCE.get(_STATUS_KIND.get(label, "neutral"),
                                         theme.EVIDENCE["neutral"])
    dot_html = '<span class="dot"></span>' if dot else ""
    return (
        f'<span class="badge" style="background:{soft};color:{accent};">'
        f'{dot_html}{esc(label)}</span>'
    )


def evidence_badge(kind: str, label: str | None = None) -> str:
    """Name the class of evidence a value belongs to.

    This is the mechanism that keeps a model prediction from looking like
    clinical proof: every number is tagged with where it came from.
    """
    accent, soft, default = theme.EVIDENCE.get(kind, theme.EVIDENCE["neutral"])
    text = label or default or kind
    return f'<span class="ev-tag" style="background:{soft};color:{accent};">{esc(text)}</span>'


def dot_status(label: str, kind: str) -> str:
    """A small labelled dot, used for system status in the sidebar."""
    accent = theme.EVIDENCE.get(kind, theme.EVIDENCE["neutral"])[0]
    return (
        f'<div style="display:flex;align-items:center;gap:.45rem;font-size:.76rem;'
        f'color:var(--ink-muted);line-height:1.9;">'
        f'<span style="width:6px;height:6px;border-radius:50%;background:{accent};'
        f'flex:0 0 auto;"></span>{esc(label)}</div>'
    )
