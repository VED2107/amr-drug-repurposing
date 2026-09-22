"""AMR Intelligence - visual system.

A light, precise, information-dense interface for a computational research tool.
The colour system is semantic before it is decorative: each hue names a *kind of
evidence*, so the interface can never let a model prediction look like clinical
proof.

    indigo   AI prediction        (model output)
    teal     molecular evidence   (chemistry, descriptors, structure)
    violet   docking evidence     (structural / binding calculations)
    emerald  clinical context     (human study records)
    amber    limitation           (missing, weak or caveated evidence)
    rose     failure              (errors, rejected runs)

Nothing here sets a font on Streamlit's own icon spans: those render glyphs from
a ligature font, and overriding it makes the literal ligature name appear
on screen. The typeface is set once on the app root and inherits.
"""

from __future__ import annotations

import plotly.graph_objects as go
import plotly.io as pio
import streamlit as st

# ----------------------------------------------------------------- surfaces --
CANVAS = "#F7F8FA"          # page ground
SURFACE = "#FFFFFF"         # card
SURFACE_SUNKEN = "#F2F4F7"  # wells, table headers
SURFACE_TINT = "#FBFCFD"

HAIRLINE = "#E7E9EF"
HAIRLINE_STRONG = "#D3D7E0"

INK = "#0E1524"             # primary text
INK_MUTED = "#5B6577"
INK_FAINT = "#8E97A8"

# ---------------------------------------------------------------- semantics --
PREDICTION = "#4F46E5"      # indigo  - AI model output
PREDICTION_SOFT = "#EEF0FE"
MOLECULAR = "#0D9488"       # teal    - chemistry
MOLECULAR_SOFT = "#E6F5F3"
DOCKING = "#7C3AED"         # violet  - structural
DOCKING_SOFT = "#F2ECFE"
CLINICAL = "#059669"        # emerald - human evidence
CLINICAL_SOFT = "#E6F5EF"
LIMIT = "#B45309"           # amber   - limitation
LIMIT_SOFT = "#FDF3E3"
FAILURE = "#DC2626"         # rose    - error
FAILURE_SOFT = "#FDECEC"
NEUTRAL = "#64748B"
NEUTRAL_SOFT = "#EEF1F5"

#: Evidence kind -> (accent, soft background, label). The single source of truth
#: for how each class of evidence is presented anywhere in the app.
EVIDENCE = {
    "prediction": (PREDICTION, PREDICTION_SOFT, "AI prediction"),
    "molecular": (MOLECULAR, MOLECULAR_SOFT, "Molecular evidence"),
    "docking": (DOCKING, DOCKING_SOFT, "Docking evidence"),
    "clinical": (CLINICAL, CLINICAL_SOFT, "Clinical context"),
    "limitation": (LIMIT, LIMIT_SOFT, "Limitation"),
    "failure": (FAILURE, FAILURE_SOFT, "Failure"),
    "neutral": (NEUTRAL, NEUTRAL_SOFT, ""),
}

PATHOGEN_COLORS = {
    "mrsa": PREDICTION,
    "ecoli": MOLECULAR,
    "kpneumoniae": DOCKING,
    "mtb": "#C2410C",
}

CATEGORICAL = [PREDICTION, MOLECULAR, DOCKING, "#C2410C", CLINICAL, FAILURE, NEUTRAL]

FONT = "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"


def plotly_template() -> go.layout.Template:
    """Charts inherit the interface, not Plotly's defaults."""
    return go.layout.Template(
        layout=go.Layout(
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            font=dict(family=FONT, size=12, color=INK_MUTED),
            colorway=CATEGORICAL,
            margin=dict(l=8, r=12, t=34, b=8),
            title=dict(font=dict(size=13, color=INK), x=0, xanchor="left"),
            xaxis=dict(
                gridcolor=HAIRLINE, zerolinecolor=HAIRLINE_STRONG, linecolor=HAIRLINE,
                tickfont=dict(family=MONO, size=11, color=INK_FAINT),
                title_font=dict(size=11, color=INK_MUTED),
            ),
            yaxis=dict(
                gridcolor=HAIRLINE, zerolinecolor=HAIRLINE_STRONG, linecolor=HAIRLINE,
                tickfont=dict(family=MONO, size=11, color=INK_FAINT),
                title_font=dict(size=11, color=INK_MUTED),
            ),
            legend=dict(bgcolor="rgba(0,0,0,0)", font=dict(size=11), borderwidth=0),
            hoverlabel=dict(
                bgcolor=SURFACE, bordercolor=HAIRLINE_STRONG,
                font=dict(family=MONO, size=11, color=INK),
            ),
        )
    )


CSS = f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;450;500;600;650&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

:root {{
  --canvas: {CANVAS};
  --surface: {SURFACE};
  --sunken: {SURFACE_SUNKEN};
  --tint: {SURFACE_TINT};
  --hairline: {HAIRLINE};
  --hairline-strong: {HAIRLINE_STRONG};
  --ink: {INK};
  --ink-muted: {INK_MUTED};
  --ink-faint: {INK_FAINT};
  --prediction: {PREDICTION};
  --molecular: {MOLECULAR};
  --docking: {DOCKING};
  --clinical: {CLINICAL};
  --limit: {LIMIT};
  --failure: {FAILURE};
  --neutral: {NEUTRAL};

  --s1: .25rem;  --s2: .5rem;   --s3: .75rem;  --s4: 1rem;
  --s5: 1.5rem;  --s6: 2rem;    --s7: 3rem;
  --r-sm: 6px;   --r-md: 10px;  --r-lg: 14px;
  --shadow: 0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06);
  --shadow-lift: 0 4px 12px rgba(16,24,40,.07), 0 1px 3px rgba(16,24,40,.05);
}}

/* Typeface is set once on the root and inherits. Streamlit's icon spans set
   their own font-family, so inheritance leaves their glyphs intact. */
html, body, .stApp {{ font-family: {FONT}; color: var(--ink); background: var(--canvas); }}
.stApp {{ background: var(--canvas); }}

.block-container {{ padding-top: 2rem; padding-bottom: 5rem; max-width: 1560px; }}

h1, h2, h3, h4 {{ color: var(--ink); letter-spacing: -.02em; }}
h1 {{ font-size: 2rem; font-weight: 650; line-height: 1.15; margin: 0 0 .25rem; }}
h2 {{ font-size: 1.3rem; font-weight: 600; margin: 0 0 .4rem; }}
h3 {{ font-size: 1rem; font-weight: 600; margin: 0 0 .3rem; }}
p, li {{ color: var(--ink-muted); font-size: .9rem; line-height: 1.6; }}
code {{ font-family: {MONO}; font-size: .82rem; background: var(--sunken);
        padding: .1rem .35rem; border-radius: 4px; color: var(--ink); }}

/* ------------------------------------------------------------- page header */
.page-head {{ margin-bottom: var(--s5); }}
.eyebrow {{
  font-family: {MONO}; font-size: .68rem; font-weight: 500; letter-spacing: .16em;
  text-transform: uppercase; color: var(--prediction); margin-bottom: .45rem;
}}
.page-sub {{ font-size: .95rem; color: var(--ink-muted); max-width: 70ch; line-height: 1.55; }}
.head-meta {{ display: flex; flex-wrap: wrap; gap: var(--s4); align-items: center;
              margin-top: var(--s3); }}
.head-meta .item {{ display: flex; flex-direction: column; gap: .1rem; }}
.head-meta .k {{ font-family: {MONO}; font-size: .62rem; letter-spacing: .12em;
                 text-transform: uppercase; color: var(--ink-faint); }}
.head-meta .v {{ font-family: {MONO}; font-size: .82rem; color: var(--ink); font-weight: 500; }}

/* ----------------------------------------------------------- section label */
.section {{ display: flex; align-items: baseline; gap: var(--s3);
            margin: var(--s6) 0 var(--s4); }}
.section .title {{ font-size: 1.02rem; font-weight: 600; color: var(--ink);
                   letter-spacing: -.01em; white-space: nowrap; }}
.section .note {{ font-size: .8rem; color: var(--ink-faint); }}
.section .rule {{ flex: 1; height: 1px; background: var(--hairline); }}

/* ------------------------------------------------------------ metric cards */
.grid {{ display: grid; gap: var(--s3); }}
.metric {{
  background: var(--surface); border: 1px solid var(--hairline);
  border-radius: var(--r-md); padding: var(--s4) var(--s4) calc(var(--s4) - 2px);
  box-shadow: var(--shadow); min-width: 0;
  transition: box-shadow 160ms ease-out, border-color 160ms ease-out;
}}
.metric:hover {{ box-shadow: var(--shadow-lift); border-color: var(--hairline-strong); }}
.metric .top {{ display: flex; align-items: flex-start; gap: .45rem; margin-bottom: .55rem; }}
.metric .ico {{ width: 26px; height: 26px; border-radius: var(--r-sm); flex: 0 0 auto;
                display: grid; place-items: center; }}
.metric .ico svg {{ width: 15px; height: 15px; }}
.metric .label {{ font-size: .74rem; font-weight: 500; color: var(--ink-muted);
                  letter-spacing: .01em; line-height: 1.3; min-height: 1.9em;
                  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                  overflow: hidden; }}
.metric .value {{ font-family: {MONO}; font-size: 1.55rem; font-weight: 600;
                  color: var(--ink); line-height: 1.1; font-variant-numeric: tabular-nums;
                  letter-spacing: -.02em; }}
.metric .value.sm {{ font-size: 1.05rem; }}
.metric .sub {{ font-size: .74rem; color: var(--ink-faint); margin-top: .3rem; line-height: 1.4; }}

/* ------------------------------------------------------------------ badges */
.badge {{
  display: inline-flex; align-items: center; gap: .3rem; font-family: {MONO};
  font-size: .68rem; font-weight: 500; letter-spacing: .04em; padding: .18rem .45rem;
  border-radius: 5px; line-height: 1.45; white-space: nowrap;
}}
.badge .dot {{ width: 5px; height: 5px; border-radius: 50%; background: currentColor; }}
.ev-tag {{
  display: inline-block; font-family: {MONO}; font-size: .6rem; font-weight: 600;
  letter-spacing: .13em; text-transform: uppercase; padding: .16rem .4rem;
  border-radius: 4px; line-height: 1.5;
}}

/* ------------------------------------------------------------------- cards */
.card {{
  background: var(--surface); border: 1px solid var(--hairline);
  border-radius: var(--r-md); padding: var(--s4); box-shadow: var(--shadow);
  height: 100%; min-width: 0;
}}
.card.pad-lg {{ padding: var(--s5); }}
.card-head {{ display: flex; align-items: center; justify-content: space-between;
              gap: var(--s3); margin-bottom: var(--s3); }}
.card-title {{ font-size: .95rem; font-weight: 600; color: var(--ink);
               display: flex; align-items: center; gap: .45rem; }}

/* --------------------------------------------------------- pathogen cards */
.pcard {{
  background: var(--surface); border: 1px solid var(--hairline);
  border-radius: var(--r-md); overflow: hidden; box-shadow: var(--shadow); height: 100%;
  transition: box-shadow 160ms ease-out, transform 160ms ease-out;
}}
.pcard:hover {{ box-shadow: var(--shadow-lift); transform: translateY(-1px); }}
.pcard .strip {{ height: 3px; }}
.pcard .body {{ padding: var(--s4); }}
.pcard .name {{ font-size: 1rem; font-weight: 650; color: var(--ink); letter-spacing: -.01em; }}
.pcard .latin {{ font-size: .76rem; color: var(--ink-faint); font-style: italic; margin-top: .05rem; }}
.pcard .rows {{ display: grid; grid-template-columns: 1fr 1fr; gap: .55rem var(--s3);
                margin-top: var(--s3); }}
.pcard .k {{ font-family: {MONO}; font-size: .62rem; letter-spacing: .09em;
             text-transform: uppercase; color: var(--ink-faint); }}
.pcard .v {{ font-family: {MONO}; font-size: .92rem; color: var(--ink); font-weight: 500;
             font-variant-numeric: tabular-nums; }}
.pcard .foot {{ margin-top: var(--s3); padding-top: var(--s3); border-top: 1px solid var(--hairline); }}

/* ------------------------------------------------------------- evidence bar */
.ebar {{ background: var(--sunken); height: 6px; border-radius: 3px; overflow: hidden; }}
/* The fill is a full-width block scaled on the X axis: animating transform
   stays on the compositor, while animating width forces layout every frame. */
.ebar > span {{ display: block; height: 100%; width: 100%; border-radius: 3px;
                transform-origin: left center;
                transition: transform 320ms cubic-bezier(.22,1,.36,1); }}

/* --------------------------------------------------------------- callouts */
.callout {{
  border: 1px solid var(--hairline); border-radius: var(--r-md);
  padding: var(--s3) var(--s4); font-size: .85rem; line-height: 1.6;
  color: var(--ink-muted); background: var(--surface);
}}
/* Semantic tint rather than a coloured slab down one edge. */
.callout[data-kind] {{ border-color: color-mix(in srgb, var(--kind) 22%, var(--hairline)); }}
.callout .tag {{ margin-bottom: .35rem; }}
.callout strong {{ color: var(--ink); font-weight: 600; }}

/* ------------------------------------------------------------ empty states */
.empty {{
  border: 1px dashed var(--hairline-strong); border-radius: var(--r-md);
  padding: var(--s6) var(--s5); text-align: center; background: var(--tint);
}}
.empty .t {{ font-size: .95rem; font-weight: 600; color: var(--ink); margin-bottom: .3rem; }}
.empty .d {{ font-size: .85rem; color: var(--ink-muted); max-width: 52ch;
             margin: 0 auto; line-height: 1.6; }}

/* -------------------------------------------------------- pipeline stages */
.flow {{ display: grid; gap: var(--s2); }}
.stage {{
  background: var(--surface); border: 1px solid var(--hairline);
  border-radius: var(--r-md); padding: var(--s3) var(--s4); position: relative;
  box-shadow: var(--shadow); min-width: 0;
}}
.stage .idx {{ font-family: {MONO}; font-size: .6rem; color: var(--ink-faint);
               letter-spacing: .12em; }}
.stage .nm {{ font-size: .86rem; font-weight: 600; color: var(--ink); margin-top: .15rem; }}
.stage .mt {{ font-family: {MONO}; font-size: .7rem; color: var(--ink-muted); margin-top: .3rem; }}
.stage .bar {{ position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
               border-radius: var(--r-md) 0 0 var(--r-md); }}

/* ------------------------------------------------------- definition lists */
.kv {{ display: grid; grid-template-columns: minmax(96px, 168px) 1fr;
       gap: .4rem var(--s3); font-size: .85rem; }}
/* In a narrow column a two-column definition list wraps one character per
   line, so it stacks instead. */
@container (max-width: 380px) {{ .kv {{ grid-template-columns: 1fr; gap: .1rem; }} }}
.kv .k {{ font-family: {MONO}; font-size: .68rem; letter-spacing: .08em;
          text-transform: uppercase; color: var(--ink-faint); padding-top: .18rem; }}
.kv .v {{ font-family: {MONO}; font-size: .82rem; color: var(--ink); word-break: break-word; }}

/* ------------------------------------------------------------- structures */
.struct {{ background: var(--tint); border: 1px solid var(--hairline);
           border-radius: var(--r-md); padding: var(--s3); display: flex;
           justify-content: center; align-items: center; }}
.struct svg {{ max-width: 100%; height: auto; }}

/* ------------------------------------------------------- Streamlit chrome */
section[data-testid="stSidebar"] {{
  background: var(--surface); border-right: 1px solid var(--hairline);
}}
section[data-testid="stSidebar"] .block-container {{ padding-top: 1.25rem; }}
section[data-testid="stSidebar"] [data-testid="stSidebarNav"] {{ padding-top: .25rem; }}

/* Navigation links: quiet by default, unmistakable when active. */
section[data-testid="stSidebar"] a[data-testid="stSidebarNavLink"] {{
  border-radius: var(--r-sm); margin: 1px 0; padding: .36rem .55rem;
  transition: background 140ms ease-out, color 140ms ease-out;
}}
section[data-testid="stSidebar"] a[data-testid="stSidebarNavLink"] span {{
  font-size: .86rem; color: var(--ink-muted);
}}
section[data-testid="stSidebar"] a[data-testid="stSidebarNavLink"]:hover {{
  background: var(--sunken);
}}
section[data-testid="stSidebar"] a[data-testid="stSidebarNavLink"][aria-current="page"] {{
  background: {PREDICTION_SOFT};
}}
section[data-testid="stSidebar"] a[data-testid="stSidebarNavLink"][aria-current="page"] span {{
  color: var(--prediction); font-weight: 600;
}}

div[data-testid="stDataFrame"] {{ border: 1px solid var(--hairline);
                                  border-radius: var(--r-md); overflow: hidden; }}
div[data-testid="stDataFrame"] * {{ font-family: {MONO} !important; font-size: .78rem !important; }}

.stTabs [data-baseweb="tab-list"] {{ gap: 1.3rem; border-bottom: 1px solid var(--hairline); }}
.stTabs [data-baseweb="tab"] {{ padding: .4rem 0; font-size: .85rem; color: var(--ink-faint);
                                background: transparent; }}
.stTabs [aria-selected="true"] {{ color: var(--prediction); }}
.stTabs [data-baseweb="tab-highlight"] {{ background: var(--prediction); }}

.stButton > button {{
  background: var(--surface); border: 1px solid var(--hairline-strong); color: var(--ink);
  font-size: .82rem; font-weight: 500; border-radius: var(--r-sm); padding: .34rem .9rem;
  transition: border-color 140ms ease-out, color 140ms ease-out, background 140ms ease-out;
}}
.stButton > button:hover {{ border-color: var(--prediction); color: var(--prediction);
                            background: {PREDICTION_SOFT}; }}
.stButton > button:active {{ transform: scale(.985); }}
.stButton > button:focus-visible {{ outline: 2px solid var(--prediction); outline-offset: 2px; }}

div[data-testid="stExpander"] {{ border: 1px solid var(--hairline);
                                 border-radius: var(--r-md); background: var(--surface); }}

hr {{ border-color: var(--hairline); }}
a {{ color: var(--prediction); text-decoration: none; }}
a:hover {{ text-decoration: underline; }}

/* --------------------------------------------------------------- footer */
.foot {{ margin-top: var(--s7); padding-top: var(--s4); border-top: 1px solid var(--hairline);
         display: flex; justify-content: space-between; gap: var(--s4); flex-wrap: wrap;
         font-size: .75rem; color: var(--ink-faint); }}

/* ----------------------------------------------------------- responsive */
/* Column counts arrive as --cols so these queries can still reflow the grid;
   an inline grid-template-columns would outrank them. */
.grid {{ grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr)); }}
.flow {{ grid-template-columns: repeat(var(--cols, 7), minmax(0, 1fr)); }}

@media (max-width: 1280px) {{
  .grid {{ grid-template-columns: repeat(min(var(--cols, 4), 3), minmax(0, 1fr)); }}
  .flow {{ grid-template-columns: repeat(4, minmax(0, 1fr)); }}
}}
@media (max-width: 1024px) {{
  .grid {{ grid-template-columns: repeat(min(var(--cols, 4), 2), minmax(0, 1fr)); }}
  .flow {{ grid-template-columns: repeat(3, minmax(0, 1fr)); }}
  .block-container {{ padding-left: 1.25rem; padding-right: 1.25rem; }}
}}
@media (max-width: 760px) {{
  h1 {{ font-size: 1.5rem; }}
  .grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
  .flow {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
  .kv {{ grid-template-columns: 1fr; gap: .15rem; }}
  .kv .v {{ margin-bottom: .45rem; }}
  .metric .value {{ font-size: 1.3rem; }}
  .head-meta {{ gap: var(--s3); }}
  .block-container {{ padding-left: 1rem; padding-right: 1rem; padding-top: 1.25rem; }}
}}
@media (max-width: 460px) {{
  .grid, .flow {{ grid-template-columns: 1fr; }}
  .pcard .rows {{ grid-template-columns: 1fr 1fr; }}
}}

@media (prefers-reduced-motion: reduce) {{
  * {{ animation-duration: .01ms !important; transition-duration: .01ms !important; }}
}}
</style>
"""


def apply_theme() -> None:
    """Install fonts, CSS and the Plotly template. Called once per rerun."""
    st.markdown(CSS, unsafe_allow_html=True)
    pio.templates["amr"] = plotly_template()
    pio.templates.default = "amr"
