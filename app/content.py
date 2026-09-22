"""Plain-language content, sourced from AMR_Drug_Repurposing.pptx.

Everything a non-specialist needs to read this dashboard lives here: what the
product is, what each pathogen is, what each technical term means in ordinary
words, and what a result does and does not establish.

Nothing in this module is a measurement. Numbers always come from the database;
this file only supplies the words wrapped around them. The one exception is the
set of historical repurposing examples on the concept card, which are the
illustrative examples from the presentation and are labelled as such - they are
not outputs of this system.
"""

from __future__ import annotations

# --------------------------------------------------------------- identity --
# Slide 1 of the deck.
PRODUCT_NAME = "Smart Screening"
PRODUCT_TAGLINE = "An AI Framework for Automated Drug Repurposing Against AMR Threats"
PRODUCT_SHORT = "AI-assisted drug repurposing for antimicrobial resistance"

WHAT_IS_THIS = (
    "An AI-assisted system for identifying existing, already-approved medicines that may "
    "have antibacterial activity against drug-resistant bacteria."
)

WHAT_IT_DOES = [
    ("Finds approved medicines",
     "Pulls the list of medicines regulators have already approved for human use."),
    ("Analyses their molecular structure",
     "Converts each medicine's chemical structure into a form the computer can compare."),
    ("Predicts antibacterial activity",
     "A trained model estimates how likely the medicine is to act against each bacterium."),
    ("Checks the 3D fit",
     "Simulates whether the molecule physically fits into a target protein in the bacterium."),
    ("Looks for clinical history",
     "Searches public trial records for what the medicine has already been studied for."),
]

WHAT_IS_A_RESULT = (
    "A candidate is a computationally prioritised medicine for further investigation — "
    "not a confirmed treatment."
)

# --------------------------------------------------------------- concept ---
# Slide 2. These are the deck's illustrative examples of the *concept* of
# repurposing. They are history, not predictions from this system, and the UI
# labels them that way wherever they appear.
REPURPOSING_DEFINITION = (
    "Drug repurposing means finding new medical uses for existing, already-approved "
    "medications — outside their original scope."
)

REPURPOSING_EXAMPLES = [
    ("Thalidomide", "Morning sickness (1950s)", "Leprosy complications & multiple myeloma"),
    ("Aspirin", "Pain & fever relief", "Preventing heart attacks & strokes"),
    ("Sildenafil", "Chest pain (angina)", "Erectile dysfunction"),
]

WHY_REPURPOSING_WORKS = [
    ("Saves time and money", "Cuts timelines from 10+ years to 3–5 years."),
    ("Lower safety risk", "Human toxicity is already characterised, so early-trial "
                          "failures are less likely."),
    ("Faster crisis response", "Existing manufacturing and supply chains can be reused."),
    ("Revives shelved molecules", "Gives failed or restricted drugs a second use."),
    ("Helps neglected diseases", "Makes rare-disease research financially viable."),
]

# ---------------------------------------------------------------- problem --
# Slide 3. Figures quoted from the deck, attributed as such in the UI.
CRISIS_FACTS = [
    ("1.27M", "Deaths a year", "Deaths globally every year from multi-drug resistant bacteria"),
    ("0", "New antibiotic classes", "New antibiotic classes approved in the last three decades"),
    ("10–15", "Years", "Years to bring one new antibiotic to market from scratch"),
    ("$1B+", "Investment", "Investment required for a single new antibiotic"),
]
CRISIS_SUMMARY = (
    "Traditional laboratory screening cannot keep pace with mutating bacteria. Repurposing "
    "medicines already proven safe in humans is a faster, lower-cost alternative."
)

# -------------------------------------------------------------- pathogens --
# Slide 5: why these four, and what makes each one hard to treat.
PATHOGENS = {
    "mrsa": {
        "short": "MRSA",
        "full": "Methicillin-resistant Staphylococcus aureus",
        "plain": "A drug-resistant bacterium commonly associated with skin, wound and "
                 "bloodstream infections.",
        "armour": "Gram-positive blueprint",
        "mechanism": "A single thick, heavily cross-linked cell wall. It makes a mutated "
                     "PBP2a protein that penicillin-class antibiotics can no longer lock onto.",
    },
    "ecoli": {
        "short": "E. coli",
        "full": "Escherichia coli",
        "plain": "A bacterium that can cause urinary tract, bloodstream and other infections.",
        "armour": "Gram-negative barrier",
        "mechanism": "A double membrane with an outer fatty layer. It over-expresses efflux "
                     "pumps that actively vacuum drugs back out of the cell.",
    },
    "kpneumoniae": {
        "short": "K. pneumoniae",
        "full": "Klebsiella pneumoniae",
        "plain": "A bacterium associated with respiratory, urinary and bloodstream infections, "
                 "and an important drug-resistance concern.",
        "armour": "Gram-negative barrier",
        "mechanism": "A double membrane, plus carbapenemase enzymes that chop up last-resort "
                     "antibiotics before they can work.",
    },
    "mtb": {
        "short": "M. tuberculosis",
        "full": "Mycobacterium tuberculosis",
        "plain": "The bacterium responsible for tuberculosis.",
        "armour": "Acid-fast bacillus",
        "mechanism": "An unusually tough, waxy outer shell built from mycolic acids. It alters "
                     "its InhA pathway to shield that membrane from standard drugs.",
    },
}

WHY_THESE_FOUR = (
    "Together these four cover the full range of bacterial defences — thick single wall, "
    "double membrane, and waxy shell. A method that works across all three generalises "
    "broadly. All four also sit at the top tier of the WHO priority pathogen list."
)

# ------------------------------------------------------------- vocabulary --
# Plain label first, technical term kept and explained. Used for tooltips and
# for the Advanced technical details sections.
GLOSSARY = {
    "fingerprint": (
        "Molecular fingerprint",
        "1024-bit Morgan fingerprint",
        "A numerical summary of a molecule's structure that the AI model can compare.",
    ),
    "roc_auc": (
        "Model discrimination",
        "ROC-AUC",
        "How well the model separates active from inactive compounds. 1.0 is perfect, "
        "0.5 is no better than guessing.",
    ),
    "pr_auc": (
        "Precision-recall score",
        "PR-AUC",
        "How well the model ranks genuinely active compounds near the top of the list.",
    ),
    "pr_auc_adj": (
        "Adjusted precision-recall score",
        "Prevalence-adjusted PR-AUC",
        "The precision-recall score corrected for how common active compounds are in the "
        "test data, so scores from different datasets can be compared fairly.",
    ),
    "pactivity": (
        "Measured biological activity",
        "pActivity",
        "The strength of a compound's measured effect in published laboratory experiments. "
        "Higher means more potent.",
    ),
    "docking": (
        "Predicted binding strength",
        "AutoDock Vina score (kcal/mol)",
        "How well the molecule is calculated to fit into a target protein. More negative "
        "means a tighter predicted fit.",
    ),
    "model_version": (
        "AI model used",
        "Model version",
        "The exact trained model that produced this prediction, kept so any result can be "
        "traced back.",
    ),
    "dataset_version": (
        "Training data used",
        "Dataset version",
        "The exact snapshot of experimental data the model learned from.",
    ),
    "scaffold_split": (
        "Fair testing method",
        "Scaffold-aware split",
        "The model is tested on chemical structures it has never seen, so its score reflects "
        "genuine generalisation rather than memorisation.",
    ),
    "lipinski": (
        "Drug-likeness",
        "Lipinski rule-of-five violations",
        "A rough guide to whether a molecule has properties typical of an oral medicine. "
        "It is not a safety assessment.",
    ),
    "smiles": (
        "Chemical structure code",
        "SMILES",
        "A text format that describes a molecule's structure.",
    ),
    "exhaustiveness": (
        "Search effort",
        "Docking exhaustiveness",
        "How hard the docking simulation searched for the best fit.",
    ),
}

# --------------------------------------------------- how to read a result --
HOW_TO_READ = [
    ("prediction", "High AI score",
     "The model predicts stronger antibacterial activity against that bacterium."),
    ("docking", "Docking result",
     "The molecule showed a favourable computational fit with the selected target protein."),
    ("clinical", "Clinical history",
     "The medicine already appears in registered human trial records for some condition."),
    ("molecular", "Measured activity",
     "Laboratory experiments in the published literature measured a real effect."),
    ("limitation", "Important",
     "None of these alone proves the medicine will treat a resistant infection in patients."),
]

# ------------------------------------------------------ the five stages ----
# Slide 6. Plain description first, technical detail second.
PIPELINE_STAGES = [
    ("01", "Collect", "ingest",
     "Gather every medicine regulators have already approved, plus published laboratory "
     "measurements of what those chemicals do to bacteria.",
     "openFDA Orange Book and ChEMBL via live APIs.", "molecular"),
    ("02", "Decode", "process",
     "Translate each medicine's chemical structure into a numerical form the computer can "
     "compare across thousands of molecules.",
     "RDKit converts SMILES into 1024-bit Morgan fingerprints.", "molecular"),
    ("03", "Predict", "train",
     "A trained model estimates how likely each medicine is to act against each of the four "
     "bacteria.",
     "Random Forest baseline; hundreds of decision trees vote on each fingerprint.",
     "prediction"),
    ("04", "Validate", "dock",
     "Simulate whether the most promising molecules physically fit into a key protein inside "
     "the bacterium.",
     "AutoDock Vina 3D docking against one validated target per pathogen.", "docking"),
    ("05", "Deliver", "clinical",
     "Cross-check what is already known about each candidate from registered human studies, "
     "and present everything together.",
     "ClinicalTrials.gov history, surfaced in this Streamlit dashboard.", "clinical"),
]

# ---------------------------------------------------------------- future ---
# Slide 8. Explicitly future capability - never presented as available today.
FUTURE_ASPECTS = [
    ("Deep learning upgrade",
     "Move from the current model to Graph Neural Networks that read 3D atomic shapes "
     "directly rather than a flat structural summary."),
    ("Combination therapies",
     "Train the system to find non-antibiotic helper compounds that weaken bacterial "
     "defences and revive older antibiotics."),
    ("Multi-disease expansion",
     "Retrain the same framework on non-bacterial datasets to look for hidden uses in "
     "areas such as cancer, Alzheimer's and rare diseases."),
    ("Method-of-use patents",
     "File method-of-use filings for discovered indications via the FDA 505(b)(2) pathway."),
]

#: What each pipeline stage does *not* establish. The case study shows one of
#: these under every stage, because a walkthrough that only says what happened
#: reads as a chain of proof.
STAGE_LIMITS = {
    "ingest": "A medicine being approved says nothing about the condition being explored. "
              "Approval is for its existing use, not for this one.",
    "process": "A fingerprint is a description of a structure. Two molecules looking alike "
               "does not make them act alike.",
    "train": "A probability is the model's estimate of antibacterial activity against the "
             "species. It is not effectiveness, and not a clinical outcome.",
    "dock": "A docking score is a simulated fit to one rigid protein. It does not show that "
            "the medicine binds inside a living cell, or that it kills the bacterium.",
    "clinical": "A registered study means the medicine has been studied for something. It "
                "is not proof that the study succeeded, and unrelated trials are not AMR "
                "evidence.",
}

FUTURE_DISEASE_NOTICE = (
    "This system predicts antibacterial activity against the four bacteria above, and "
    "nothing else. It does not estimate a probability for cancer, Alzheimer's, diabetes or "
    "any other condition. Extending the framework to a new disease would require training "
    "it on a dataset for that disease."
)


#: Approval status and indication are different facts, and conflating them is the
#: easiest way for this interface to mislead. Every medicine here is approved for
#: *something*; none of that says anything about the condition being explored.
APPROVAL_VS_INDICATION = (
    "Every medicine in this library is <strong>already approved for some use</strong>. "
    "That is what makes repurposing possible - the safety work exists. It is "
    "<strong>not</strong> approval for the condition you are looking at, and it does not "
    "establish that the medicine is safe or effective for that condition."
)

#: Shown wherever a trial record is presented, so a reader does not read the
#: existence of a study as a positive result.
STUDY_EXISTS_NOTICE = (
    "A registered study means this medicine has been <strong>studied</strong> for this "
    "condition. It does not say the study succeeded, and it is not an approval."
)

#: The evidence ladder, strongest first. Each entry is
#: (key, label, evidence kind, what it means, what it does not mean).
EVIDENCE_LEVELS = (
    ("clinical", "Clinical", "clinical",
     "This medicine has been studied in registered human trials for this condition.",
     "It does not mean the trials succeeded or that the medicine is approved for it."),
    ("experimental", "Experimental", "molecular",
     "Laboratory experiments measured this medicine's effect on this organism.",
     "A measurement in a dish is not a result in a patient."),
    ("computational", "Computational", "prediction",
     "A model prediction or a docking simulation supports this pairing.",
     "Computation suggests where to look; it establishes nothing on its own."),
    ("none", "No evidence found", "limitation",
     "The sources that were searched returned nothing for this pairing.",
     "This is not evidence that the medicine has no effect."),
    ("unchecked", "Not yet checked", "limitation",
     "This medicine has not been queried against the trial registry yet.",
     "Nothing at all can be concluded either way."),
)


def pathogen(key: str) -> dict[str, str]:
    """Plain-language profile for a pathogen key, with safe fallbacks."""
    return PATHOGENS.get(key, {
        "short": key, "full": key, "plain": "", "armour": "", "mechanism": "",
    })


def term(key: str) -> tuple[str, str, str]:
    """(plain label, technical term, explanation) for a glossary key."""
    return GLOSSARY.get(key, (key, key, ""))


def plain_label(key: str) -> str:
    return term(key)[0]


def tooltip(key: str) -> str:
    """Tooltip text that names the technical term and explains it plainly."""
    plain, technical, explanation = term(key)
    if technical and technical != plain:
        return f"{explanation} (Technical term: {technical}.)"
    return explanation
