"""ClinicalTrials.gov evidence retrieval.

Everything in this package answers one question: *does this drug have a human
clinical record?* It never answers *does this drug work against a resistant
pathogen?* - the two are kept separate throughout.
"""

from .evidence import ClinicalTrialsClient, TrialRecord, classify_amr_relevance

__all__ = ["ClinicalTrialsClient", "TrialRecord", "classify_amr_relevance"]
