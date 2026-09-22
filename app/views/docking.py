"""Docking and 3D: targets, poses, parameters and the limits of the calculation."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st
import streamlit.components.v1 as components

from .. import components as ui
from .. import data, theme

VIEWER_HEIGHT = 440


def _pose_viewer(receptor_pdb: str | None, ligand_pdbqt: str | None) -> None:
    """Receptor and docked pose, rendered with 3Dmol.js."""
    if not ligand_pdbqt:
        ui.empty_state("No stored pose", "The pose file for this result is not on disk.")
        return

    receptor_js = ""
    if receptor_pdb:
        # Three representations at once: a faint cartoon for the fold, a
        # translucent surface so the pocket reads as a cavity, and thin sticks
        # on the residues lining the site. Without the lining residues the pose
        # floats in empty space and shows nothing useful.
        receptor_js = f"""
          viewer.addModel({receptor_pdb!r}, "pdb");
          receptorModel = viewer.getModel();
          viewer.setStyle({{model: receptorModel}},
                          {{cartoon: {{color: "#C7CCD8", opacity: 0.65}}}});
        """

    html = f"""
    <div id="viewer" style="width:100%;height:{VIEWER_HEIGHT}px;position:relative;
         background:{theme.SURFACE_SUNKEN};border:1px solid {theme.HAIRLINE};
         border-radius:10px;"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.0.4/3Dmol-min.js"></script>
    <script>
      (function () {{
        var viewer = $3Dmol.createViewer(document.getElementById("viewer"),
                                         {{backgroundColor: "{theme.SURFACE_SUNKEN}"}});
        var receptorModel = null;
        {receptor_js}
        viewer.addModel({ligand_pdbqt!r}, "pdbqt");
        var ligandModel = viewer.getModel();
        viewer.setStyle({{model: ligandModel}},
                        {{stick: {{radius: 0.2, colorscheme: "purpleCarbon"}}}});
        if (receptorModel !== null) {{
          var pocket = {{model: receptorModel, within:
                         {{distance: 5.0, sel: {{model: ligandModel}}}}}};
          viewer.addStyle(pocket, {{stick: {{radius: 0.09, colorscheme: "grayCarbon"}}}});
          viewer.addSurface($3Dmol.SurfaceType.VDW,
                            {{opacity: 0.45, color: "#AEB6C6"}}, pocket);
        }}
        viewer.zoomTo({{model: ligandModel}});
        viewer.zoom(0.32);
        viewer.render();
      }})();
    </script>
    """
    components.html(html, height=VIEWER_HEIGHT + 10)


def render() -> None:
    cfg = data.get_config()
    labels = {p.key: p.label for p in cfg.pathogens}

    ui.page_header(
        "Docking & 3D",
        "AutoDock Vina results against one validated protein target per pathogen, with the "
        "full parameter set behind every score.",
        meta=data.header_meta(),
    )
    ui.callout(ui.DISCLAIMER_DOCKING, kind="docking", label="Docking evidence")

    targets = data.docking_targets()
    if targets.empty:
        ui.empty_state(
            "No targets registered",
            "Docking targets are declared in configs/targets.yaml and registered when the "
            "docking stage runs.",
            "python -m src.pipeline.dock",
        )
        return

    # -------------------------------------------------------------- targets --
    ui.section("Targets", "binding sites derived from the structure, never hard-coded")
    view = targets.copy()
    view["pathogen"] = view["pathogen_key"].map(lambda k: labels.get(k, k))
    view["box"] = view.apply(
        lambda r: (f"{r['box_center_x']:.1f}, {r['box_center_y']:.1f}, {r['box_center_z']:.1f}"
                   if pd.notna(r["box_center_x"]) else "not prepared"), axis=1)
    ui.data_table(
        view[["target_key", "name", "gene", "pathogen", "pdb_id", "chain",
              "site_mode", "site_reference", "box", "status"]].rename(columns={
            "target_key": "Key", "name": "Protein", "gene": "Gene", "pathogen": "Pathogen",
            "pdb_id": "PDB", "chain": "Chain", "site_mode": "Site definition",
            "site_reference": "Site reference", "box": "Box centre (x, y, z)",
            "status": "Status"}),
        dash_columns=["Gene", "Site reference", "Box centre (x, y, z)"],
    )

    failed = view[view["status"].isin(["failed", "unavailable"])]
    for _, row in failed.iterrows():
        ui.error_state(f"Target unavailable: {row['target_key']}", str(row["error"]))

    with st.expander("Target selection rationale"):
        for _, row in targets.iterrows():
            st.markdown(f"**{row['name']}** · {row['target_key']} · PDB {row['pdb_id']}")
            st.caption(row["selection_notes"] or "No rationale recorded.")

    # ------------------------------------------------------------- coverage --
    # The denominator matters more than the numerator here. Docking is run over a
    # shortlist, so a reader who sees only "N ligands docked" can reasonably
    # assume the library was screened structurally. It was not.
    cover = data.docking_coverage()
    if cover["medicines_docked"]:
        share = cover["medicines_docked"] / max(cover["medicines_scored"], 1)
        ui.callout(
            f"<strong>Docking has been run on {cover['medicines_docked']:,} of the "
            f"{cover['medicines_scored']:,} scored medicines</strong> "
            f"({ui.format_probability(share, 1)} of the scored library), producing "
            f"{cover['poses']:,} stored poses across {cover['targets']} target "
            f"{'protein' if cover['targets'] == 1 else 'proteins'}. "
            "Every other medicine has <em>not yet been docked</em> - which is not the same "
            "as having been docked and found unpromising.",
            kind="limitation", label="Docking coverage")
        ui.spacer(".5rem")

    # ----------------------------------------------------------------- runs --
    runs = data.docking_runs()
    ui.section("Docking runs")
    if runs.empty:
        ui.empty_state("No docking run recorded",
                       "Docking runs over the top-ranked candidates for each target.",
                       "python -m src.pipeline.dock")
        return

    latest = runs.iloc[0]
    ui.metric_grid([
        ("Engine", latest["engine_version"] or latest["engine"], "as executed", "cube", "docking"),
        ("Exhaustiveness", str(int(latest["exhaustiveness"])), "search effort", "target", "docking"),
        ("Modes / ligand", str(int(latest["num_modes"])), "poses retained", "layers", "docking"),
        ("Random seed", str(int(latest["random_seed"])), "reproducible", "refresh", "docking"),
        ("Runs", f"{len(runs):,}", f"{int(runs['n_succeeded'].sum()):,} ligands docked",
         "flow", "docking"),
    ], columns=5)
    ui.spacer(".75rem")

    runs_table = runs[["run_id", "target_key", "engine_version", "n_ligands", "n_succeeded",
                       "n_failed", "started_at", "finished_at", "status"]].rename(columns={
        "run_id": "Run", "target_key": "Target", "engine_version": "Engine",
        "n_ligands": "Ligands", "n_succeeded": "Docked", "n_failed": "Failed",
        "started_at": "Started", "finished_at": "Finished", "status": "Status"})
    ui.data_table(runs_table,
                  dash_columns=["Engine", "Finished", "Ligands", "Docked", "Failed"], height=200)
    if (runs["status"] == "INTERRUPTED").any():
        st.caption("Runs marked INTERRUPTED were still in progress when their process ended. "
                   "Poses they had already scored are stored and remain valid.")

    # -------------------------------------------------------------- results --
    ui.section("Scores")
    target_keys = targets["target_key"].tolist()
    chosen = st.selectbox(
        "Target", target_keys, key="dock_target",
        format_func=lambda k: f"{k} — {targets.loc[targets.target_key == k, 'name'].iloc[0]}")
    results = data.docking_results(chosen)

    if results.empty:
        ui.empty_state(
            f"No successful docking results for {chosen}",
            "Either the target has not been docked yet, or every ligand failed preparation.",
            f"python -m src.pipeline.dock --target {chosen}",
        )
    else:
        interest = float(cfg.get("docking", "interest_threshold_kcal_mol", default=-7.0))
        below = int((results["score_kcal_mol"] <= interest).sum())
        ui.metric_grid([
            ("Ligands docked", f"{len(results):,}", "best pose per ligand", "cube", "docking"),
            ("Best score", f"{results['score_kcal_mol'].min():.2f}", "kcal/mol", "target", "docking"),
            ("Median score", f"{results['score_kcal_mol'].median():.2f}", "kcal/mol",
             "scale", "docking"),
            (f"At or below {interest} kcal/mol", f"{below:,}",
             "project screening target, not a universal cutoff", "target", "limitation"),
        ], columns=4)
        ui.spacer(".5rem")
        ui.callout(
            f"<strong>{interest} kcal/mol is this project's screening target</strong>, taken "
            f"from the presentation - not a scientific threshold at which binding becomes "
            f"real. A score below it means the simulation produced a favourable fit "
            f"<em>relative to the project's own criterion</em>, and marks the compound for "
            f"further investigation. It does not show that the medicine binds in a cell or "
            f"acts against the bacterium.",
            kind="limitation", label="Project docking target")
        ui.spacer(".5rem")

        left, right = st.columns([1, 1.25], gap="medium")
        with left:
            fig = px.histogram(results, x="score_kcal_mol", nbins=26,
                               labels={"score_kcal_mol": "Best docking score (kcal/mol)"})
            fig.update_traces(marker_color=theme.DOCKING)
            fig.add_vline(x=interest, line_dash="dot", line_color=theme.LIMIT,
                          annotation_text=f"{interest}", annotation_font_color=theme.LIMIT,
                          annotation_font_size=10)
            fig.update_layout(height=300, bargap=.05, yaxis_title="Ligands",
                              title="Score distribution")
            st.plotly_chart(fig, use_container_width=True)
        with right:
            ui.data_table(
                results[["drug", "score_kcal_mol", "ml_probability"]].rename(columns={
                    "drug": "Compound", "score_kcal_mol": "Score (kcal/mol)",
                    "ml_probability": "AI probability"}),
                height=300,
                column_config={
                    "Score (kcal/mol)": st.column_config.NumberColumn(format="%.2f"),
                    "AI probability": ui.probability_column(),
                },
            )

        # ------------------------------------------------------------- pose --
        ui.section("Pose")
        pick = st.selectbox(
            "Docked compound", results["molecule_id"].tolist(), key="dock_pose_pick",
            format_func=lambda mid: str(results.loc[results.molecule_id == mid, "drug"].iloc[0]))
        row = results[results.molecule_id == pick].iloc[0]
        target_row = targets[targets.target_key == chosen].iloc[0]

        receptor_pdb = None
        if target_row["receptor_path"]:
            chain_pdb = Path(str(target_row["receptor_path"])).with_name(f"{chosen}_chain.pdb")
            if chain_pdb.exists():
                receptor_pdb = chain_pdb.read_text(encoding="utf-8", errors="replace")

        # Two columns, not three: a definition list squeezed into a third of the
        # width wraps one character per line and becomes unreadable.
        viewer_col, detail_col = st.columns([1.75, 1], gap="medium")
        with viewer_col:
            _pose_viewer(receptor_pdb, data.read_pose(row["pose_path"]))
            st.caption(
                f"Computational docking result: {row['drug']} in {target_row['name']} "
                f"(PDB {target_row['pdb_id']}, chain {target_row['chain']}). "
                "Requires experimental validation."
            )
        with detail_col:
            st.markdown(ui.evidence_badge("docking", "Target"), unsafe_allow_html=True)
            ui.spacer(".35rem")
            ui.kv_block([
                ("Pathogen", labels.get(target_row["pathogen_key"], target_row["pathogen_key"])),
                ("Protein", target_row["name"]),
                ("Gene", target_row["gene"]),
                ("PDB", f"{target_row['pdb_id']} chain {target_row['chain']}"),
                ("Site", f"{target_row['site_mode']}: {target_row['site_reference']}"),
            ])
            ui.spacer(".9rem")
            st.markdown(ui.evidence_badge("docking", "Result provenance"), unsafe_allow_html=True)
            ui.spacer(".35rem")
            ui.kv_block([
                ("Compound", row["drug"]),
                ("Score", f"{row['score_kcal_mol']:.2f} kcal/mol"),
                ("Pose rank", "1 of retained modes"),
                ("Engine", latest["engine_version"]),
                ("Exhaustiveness", int(latest["exhaustiveness"])),
                ("Seed", int(latest["random_seed"])),
                ("Box size", f"{latest['box_size_x']:.0f} × {latest['box_size_y']:.0f} × "
                             f"{latest['box_size_z']:.0f} Å"),
            ])

    # --------------------------------------------------------- interpretation --
    ui.section("Docking interpretation")
    ui.callout(
        "Docking is <strong>computational evidence and does not establish biological "
        "efficacy</strong>. Receptors are rigid single chains with waters, buffer molecules "
        "and cofactors excluded, so scores describe an apo pocket. One target per pathogen "
        "means a compound active through another mechanism will score poorly here: "
        "<strong>a weak score is not evidence of inactivity</strong>.",
        kind="limitation", label="Limitation",
    )

    failures = data.docking_failures()
    if not failures.empty:
        ui.section("Failed dockings", "recorded, not dropped")
        ui.data_table(
            failures.rename(columns={"molecule_id": "Molecule", "target_key": "Target",
                                     "error": "Reason", "created_at": "When"}),
            dash_columns=["Reason"], height=min(340, 46 + 35 * len(failures)),
            caption="A ligand that cannot be embedded or docked is a known gap in coverage, "
                    "not a silent absence.",
        )
