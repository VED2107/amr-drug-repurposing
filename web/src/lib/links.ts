/**
 * Where a piece of evidence can be checked at its source. Every link opens the
 * public record the figure on this site was read from.
 */

const CHEMBL = "https://www.ebi.ac.uk/chembl/explore";

export const chemblCompound = (id: string) => `${CHEMBL}/compound/${encodeURIComponent(id)}`;
export const chemblAssay = (id: string) => `${CHEMBL}/assay/${encodeURIComponent(id)}`;
export const chemblDocument = (id: string) => `${CHEMBL}/document/${encodeURIComponent(id)}`;
export const pdbStructure = (id: string) => `https://www.rcsb.org/structure/${encodeURIComponent(id)}`;
export const trialRecord = (nctId: string) =>
  `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`;
