/**
 * Editorial copy that is not data.
 *
 * Everything here is a description of what the system does and does not
 * establish. Deliberately, nothing here is a count: counts come from the
 * database at render time, so that running a pipeline stage changes the page
 * rather than leaving a stale constant behind.
 *
 * Wording is carried over from the research prototype and the design project
 * so that the two surfaces make the same claims in the same words.
 */

export interface Stage {
  n: string;
  name: string;
  what: string;
  proves: string;
  denies: string;
  color: string;
}

export const STAGES: readonly Stage[] = [
  {
    n: "01",
    name: "COLLECT",
    what: "Bioactivity, approved products and registered studies pulled from open scientific sources.",
    proves: "That a record exists, and where it came from.",
    denies: "Nothing about activity. A record is provenance, not a result.",
    color: "var(--color-experimental)",
  },
  {
    n: "02",
    name: "DECODE",
    what: "Structures standardised, salts stripped, identity fixed on InChIKey, molecules turned into features.",
    proves: "That two records describe the same molecule.",
    denies: "Nothing about behaviour in an organism.",
    color: "var(--color-experimental)",
  },
  {
    n: "03",
    name: "PREDICT",
    what: "One random-forest model per pathogen, selected on prevalence-adjusted PR-AUC on the validation split.",
    proves: "That the chemistry resembles what the training data labelled active.",
    denies:
      "Not effectiveness, not activity against the resistant phenotype, not a treatment claim.",
    color: "var(--color-computational)",
  },
  {
    n: "04",
    name: "VALIDATE",
    what: "Docking against one target per pathogen, plus a registry sweep for human studies.",
    proves: "That a pose is geometrically plausible, and that studies were or were not found.",
    denies:
      "A docking score is not proof of binding. A registered trial is not a successful trial.",
    color: "var(--color-violet)",
  },
  {
    n: "05",
    name: "DELIVER",
    what: "Every figure rendered with its label, its provenance and its limitation attached.",
    proves: "That the reader can see which kind of evidence they are looking at.",
    denies: "Nothing is asserted beyond the rung the evidence sits on.",
    color: "var(--color-ink)",
  },
] as const;

/** Plain-language descriptions of the four modelled bacteria. */
export const PATHOGEN_PLAIN: Record<string, { plain: string; mechanism: string }> = {
  mrsa: {
    plain:
      "A skin and bloodstream pathogen that no longer responds to methicillin-class antibiotics.",
    mechanism: "Altered penicillin-binding protein PBP2a; beta-lactams lose affinity.",
  },
  ecoli: {
    plain:
      "A gut bacterium behind urinary and bloodstream infections; resistant strains are widespread.",
    mechanism: "Extended-spectrum beta-lactamases and efflux-mediated multidrug resistance.",
  },
  kpneumoniae: {
    plain: "A hospital pathogen with strains resistant to nearly every available antibiotic.",
    mechanism: "KPC-family carbapenemases hydrolyse carbapenems, the drugs of last resort.",
  },
  mtb: {
    plain:
      "The cause of tuberculosis; multidrug-resistant strains require years of treatment.",
    mechanism: "Chromosomal mutations plus a waxy cell wall that limits drug entry.",
  },
};

/**
 * How each docked receptor relates to the resistance the pathogen is known for.
 *
 * This exists because the two are easy to conflate, and conflating them would
 * overstate what a docking score means. The research framework describes MRSA
 * by PBP2a and E. coli by efflux and beta-lactamases; the receptors actually
 * prepared and docked are, for those two, dihydrofolate reductase — a
 * clinically validated antibacterial target, but not the protein that makes the
 * organism resistant. For K. pneumoniae the two coincide, and for
 * M. tuberculosis the receptor is the front-line drug's target rather than a
 * resistance determinant.
 *
 * Keyed by `targets.target_key`. The wording is deliberately flat: it states
 * the relationship and stops, because anything more would be a claim about
 * whether docking against this receptor could overcome resistance, which
 * nothing in this system establishes.
 */
export const TARGET_RESISTANCE_RELATION: Record<
  string,
  { isResistanceMechanism: boolean; note: string }
> = {
  sa_dhfr: {
    isResistanceMechanism: false,
    note:
      "Methicillin resistance in MRSA comes from PBP2a, a different protein. This receptor is dihydrofolate reductase, the target of trimethoprim — chosen because it is clinically validated and its bound inhibitor defines the site unambiguously. A score here says nothing about PBP2a.",
  },
  ec_dhfr: {
    isResistanceMechanism: false,
    note:
      "Multidrug resistance in E. coli is attributed to beta-lactamases and efflux pumps. This receptor is dihydrofolate reductase, which is neither. A score here describes fit to a folate-pathway enzyme, not an effect on a resistance mechanism.",
  },
  kp_kpc2: {
    isResistanceMechanism: true,
    note:
      "KPC-2 is itself the carbapenemase responsible for carbapenem resistance in K. pneumoniae, so here the docked receptor and the resistance mechanism are the same protein. That still makes a score computational evidence of fit, not of inhibition.",
  },
  mtb_inha: {
    isResistanceMechanism: false,
    note:
      "InhA is the target of isoniazid, a front-line tuberculosis drug, rather than a resistance determinant in its own right. Resistance commonly arises through katG and inhA-promoter mutations, which this docking does not model.",
  },
};

/**
 * The framing the project presentation gives this work.
 *
 * These figures are not produced by this system, and nothing downstream is
 * derived from them. They are carried here because a reader who does not know
 * why anyone would screen approved medicines against four bacteria cannot judge
 * what the rest of the site shows — and because leaving the motivation out
 * would misrepresent the research as a chemistry exercise.
 *
 * Every entry is attributed on the page as published context rather than as a
 * result. The one thing this system measures about them is nothing at all.
 */
export const CRISIS_CONTEXT: readonly {
  figure: string;
  meaning: string;
}[] = [
  { figure: "1.27M", meaning: "Deaths a year attributed to drug-resistant bacterial infections." },
  { figure: "0", meaning: "New antibiotic classes discovered and approved in roughly three decades." },
  { figure: "10–15", meaning: "Years to bring one new antibiotic to market from scratch." },
  { figure: "$1B+", meaning: "Typical investment behind a single new antibiotic." },
] as const;

/**
 * Why these four organisms and no others.
 *
 * Two reasons, both from the research design: between them they span the three
 * structural classes of bacterial envelope, and all four sit high on published
 * priority lists. Neither reason is a claim about any medicine.
 */
export const WHY_THESE_FOUR: readonly {
  group: string;
  organisms: string;
  envelope: string;
}[] = [
  {
    group: "Gram-positive",
    organisms: "MRSA",
    envelope:
      "A single thick, cross-linked peptidoglycan wall. Methicillin resistance comes from the altered penicillin-binding protein PBP2a.",
  },
  {
    group: "Gram-negative",
    organisms: "E. coli · K. pneumoniae",
    envelope:
      "A double membrane with an outer lipopolysaccharide layer. Resistance is attributed to efflux pumps and to beta-lactamases, including the KPC carbapenemases.",
  },
  {
    group: "Acid-fast",
    organisms: "M. tuberculosis",
    envelope:
      "A waxy mycolic-acid envelope that limits drug entry, with resistance arising chromosomally.",
  },
] as const;

/**
 * Repurposing that already happened, from the presentation's own examples.
 *
 * Included as precedent for the idea, not as an analogy to anything this system
 * found. None of these came from a computational screen.
 */
export const REPURPOSING_PRECEDENT: readonly {
  medicine: string;
  from: string;
  to: string;
}[] = [
  { medicine: "Thalidomide", from: "Morning sickness", to: "Leprosy complications and multiple myeloma" },
  { medicine: "Aspirin", from: "Pain and fever relief", to: "Prevention of heart attack and stroke" },
  { medicine: "Sildenafil", from: "Angina", to: "Erectile dysfunction" },
] as const;

/**
 * Plain-language glosses for the exact identifiers stored in the database.
 *
 * Keyed by the literal value of `model_versions.model_type` and
 * `molecules.feature_version`. A lookup miss renders nothing rather than a
 * guess: an unfamiliar identifier means a model or featurisation this copy was
 * not written for, and describing it anyway would be inventing a method.
 *
 * These describe what the named algorithm is. They make no claim about how well
 * it performs — the metrics on the page do that, from the database.
 */
export const MODEL_TYPE_GLOSS: Record<string, string> = {
  random_forest:
    "An ensemble of decision trees. Each tree votes on a molecule's fingerprint and the probability is the proportion that voted active — which is why a value of 1.0 means the trees were unanimous, not that the outcome is certain.",
  extra_trees:
    "An ensemble like a random forest, but with split points chosen at random rather than optimised, which trades a little fit for less variance.",
  hist_gradient_boosting:
    "Trees trained in sequence, each correcting the errors of the ones before it, on binned feature values.",
  logistic_regression:
    "A linear model over the fingerprint bits, giving each bit a weight for or against activity.",
  linear_svm:
    "A linear separator fitted to maximise the margin between the labelled active and inactive molecules.",
};

export const FEATURE_VERSION_GLOSS: Record<string, string> = {
  "morgan-r2-1024-v1":
    "A 1024-bit Morgan fingerprint at radius 2: each bit records whether a particular circular substructure, up to two bonds across, is present. The model never sees the molecule — only these bits.",
};
