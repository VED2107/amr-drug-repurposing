"""The rule that decides whether an approved medicine is already an antibacterial.

The repurposing view removes existing antibacterials, so a wrong answer here
either hides a legitimate candidate or lists an antibiotic as "repurposing".
Every case below uses real WHO ATC codes and FDA class names.
"""

from __future__ import annotations

import pytest

from src.ingestion.classification import (
    ANTIBACTERIAL,
    NOT_ANTI_INFECTIVE,
    OTHER_ANTI_INFECTIVE,
    RULE_TEXT,
    UNCLASSIFIED,
    classify,
    strip_epc_suffix,
)


@pytest.mark.parametrize(
    "atc, epc, expected",
    [
        # Systemic antibacterials and antimycobacterials.
        (["J01MA02"], [], ANTIBACTERIAL),                       # ciprofloxacin
        (["J04AC01"], [], ANTIBACTERIAL),                       # isoniazid
        (["J04BA02", "D10AX05"], [], ANTIBACTERIAL),            # dapsone
        # Topical / ophthalmic antibacterial groups.
        (["D06AX09"], [], ANTIBACTERIAL),                       # mupirocin
        (["S01AE08"], [], ANTIBACTERIAL),                       # besifloxacin
        (["S01AB04"], [], ANTIBACTERIAL),                       # sulfacetamide
        (["A07AA06"], [], ANTIBACTERIAL),                       # paromomycin
        # FDA class alone.
        ([], ["Fluoroquinolone Antibacterial"], ANTIBACTERIAL),
        ([], ["Tetracycline-class Drug"], ANTIBACTERIAL),
        ([], ["Rifamycin Antimycobacterial"], ANTIBACTERIAL),
        # Polyene antifungals the WHO files under "antibiotics".
        (["A07AA07", "G01AA03", "J02AA01"], [], OTHER_ANTI_INFECTIVE),  # amphotericin B
        (["A07AA03", "D01AA02", "S01AA10"], ["Polyene Antimicrobial"], OTHER_ANTI_INFECTIVE),  # natamycin
        # Other anti-infectives are not antibacterials.
        (["J02AC01"], ["Azole Antifungal"], OTHER_ANTI_INFECTIVE),  # fluconazole
        (["J05AB01"], [], OTHER_ANTI_INFECTIVE),                    # acyclovir
        (["P01BA02"], [], OTHER_ANTI_INFECTIVE),                    # hydroxychloroquine
        (["P02DA01"], [], OTHER_ANTI_INFECTIVE),                    # niclosamide
        # Not anti-infectives.
        (["C07AB02"], ["beta-Adrenergic Blocker"], NOT_ANTI_INFECTIVE),  # metoprolol
        (["A07EA06", "R03BA02"], ["Corticosteroid"], NOT_ANTI_INFECTIVE),  # budesonide
        (["A07EC01"], [], NOT_ANTI_INFECTIVE),                    # sulfasalazine: a sulfonamide, not an antibacterial
        # Nothing known.
        ([], [], UNCLASSIFIED),
    ],
)
def test_classify(atc, epc, expected):
    assert classify(atc, epc).status == expected


def test_status_never_comes_from_the_name():
    # The rule takes codes and classes only; a medicine whose name sounds like
    # an antibiotic but whose codes say otherwise is classified by its codes.
    assert classify(["N06AB03"], ["Selective Serotonin Reuptake Inhibitor"]).status == NOT_ANTI_INFECTIVE
    import inspect

    assert list(inspect.signature(classify).parameters) == ["atc_codes", "fda_classes"]


def test_basis_names_every_deciding_code():
    result = classify(["J01MA02", "S01AE03"], ["Fluoroquinolone Antibacterial"])
    assert result.basis == [
        "WHO ATC J01MA02",
        "WHO ATC S01AE03",
        "FDA class Fluoroquinolone Antibacterial",
    ]


def test_unclassified_is_kept_not_removed():
    assert "never removed" in RULE_TEXT
    assert classify([], []).basis == []


def test_codes_are_normalised():
    assert classify([" j01ma02 "], []).status == ANTIBACTERIAL
    assert strip_epc_suffix("Corticosteroid [EPC]") == "Corticosteroid"
