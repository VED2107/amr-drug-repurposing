"""Inline SVG icons.

One coherent 16x16 stroked set, drawn inline so nothing depends on an icon font
or an emoji. Streamlit's own Material icons are used for navigation and are left
strictly alone.
"""

from __future__ import annotations

_WRAP = (
    '<svg viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="1.9" '
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{body}</svg>'
)

_PATHS = {
    # data and library
    "database": '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    "pill": '<path d="M10.5 20.5a6 6 0 0 1-8.5-8.5l9.5-9.5a6 6 0 0 1 8.5 8.5z"/><path d="M8.5 8.5l7 7"/>',
    "molecule": '<circle cx="5" cy="18" r="2.4"/><circle cx="19" cy="18" r="2.4"/><circle cx="12" cy="5" r="2.4"/><path d="M7 16.5 10.5 7M13.5 7 17 16.5M7.4 18h9.2"/>',
    "flask": '<path d="M9 3h6M10 3v6.2L4.8 18A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-3L14 9.2V3"/><path d="M7.5 15h9"/>',
    # model and analysis
    "brain": '<path d="M12 5a3 3 0 0 0-5.9-.7A2.8 2.8 0 0 0 4 9.4a3 3 0 0 0 .6 4.4A2.8 2.8 0 0 0 7 19a3 3 0 0 0 5 1.4z"/><path d="M12 5a3 3 0 0 1 5.9-.7A2.8 2.8 0 0 1 20 9.4a3 3 0 0 1-.6 4.4A2.8 2.8 0 0 1 17 19a3 3 0 0 1-5 1.4z"/><path d="M12 5v15.4"/>',
    "chart": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    "target": '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    "cube": '<path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z"/><path d="m3.5 7 8.5 4.6L20.5 7M12 21.5v-9.9"/>',
    # evidence and status
    "clipboard": '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9.5 4V2.8h5V4"/><path d="M9.5 10h5M9.5 14h5M9.5 18h3"/>',
    "check": '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
    "alert": '<path d="M12 3.8 21 19.5H3z"/><path d="M12 10v4M12 17.2v.1"/>',
    "cross": '<circle cx="12" cy="12" r="8.5"/><path d="m9.5 9.5 5 5M14.5 9.5l-5 5"/>',
    "clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/>',
    # system
    "flow": '<rect x="3" y="4" width="6" height="5" rx="1.4"/><rect x="15" y="4" width="6" height="5" rx="1.4"/><rect x="9" y="15" width="6" height="5" rx="1.4"/><path d="M6 9v3.5h12V9M12 12.5V15"/>',
    "refresh": '<path d="M20 11a8 8 0 0 0-13.7-5.2L3 9"/><path d="M4 13a8 8 0 0 0 13.7 5.2L21 15"/><path d="M3 4.5V9h4.5M21 19.5V15h-4.5"/>',
    "search": '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m20 20-4.4-4.4"/>',
    "layers": '<path d="m12 3 8.5 4.5L12 12 3.5 7.5z"/><path d="m3.5 12.2 8.5 4.5 8.5-4.5"/>',
    "scale": '<path d="M12 4v16M7 8h10"/><path d="m4.5 15 2.5-7 2.5 7a3 3 0 0 1-5 0Z"/><path d="m14.5 15 2.5-7 2.5 7a3 3 0 0 1-5 0Z"/>',
}


def icon(name: str, color: str = "currentColor") -> str:
    """Return one inline SVG. Unknown names fall back to a neutral dot."""
    body = _PATHS.get(name)
    if body is None:
        body = '<circle cx="12" cy="12" r="4"/>'
    return _WRAP.format(color=color, body=body)


def available() -> list[str]:
    return sorted(_PATHS)
