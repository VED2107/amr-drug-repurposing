"""Train/validation/test splitting.

Random splitting of molecular data leaks: close analogues of a test compound
sit in the training set, and the reported score measures memorisation rather
than generalisation to new chemistry. The default here is a scaffold split,
which keeps every molecule sharing a Bemis-Murcko scaffold on the same side of
the split.
"""

from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass
class SplitResult:
    """Index arrays for the three partitions, plus an audit trail."""

    train_idx: np.ndarray
    val_idx: np.ndarray
    test_idx: np.ndarray
    method: str
    seed: int
    n_scaffolds: int | None = None
    notes: str = ""

    def sizes(self) -> dict[str, int]:
        return {
            "train": int(self.train_idx.size),
            "validation": int(self.val_idx.size),
            "test": int(self.test_idx.size),
        }


def random_split(
    n: int, *, test_fraction: float, validation_fraction: float, seed: int
) -> SplitResult:
    """Shuffle-and-cut split. Use only when scaffolds are unavailable."""
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    n_test = int(round(n * test_fraction))
    n_val = int(round(n * validation_fraction))
    test = idx[:n_test]
    val = idx[n_test:n_test + n_val]
    train = idx[n_test + n_val:]
    return SplitResult(train, val, test, "random", seed,
                       notes="random split: optimistic for molecular generalisation")


def scaffold_split(
    scaffolds: Sequence[str],
    *,
    test_fraction: float,
    validation_fraction: float,
    seed: int,
    labels: Sequence[int] | None = None,
) -> SplitResult:
    """Group molecules by scaffold, then assign whole groups to partitions.

    Groups are ordered largest-first (the standard deterministic scaffold
    split) and filled into test, then validation, then train. When ``labels``
    are supplied the assignment also tries to keep at least one minority-class
    example in each partition, because an all-negative test set makes every
    ranking metric undefined.
    """
    n = len(scaffolds)
    if n == 0:
        empty = np.array([], dtype=int)
        return SplitResult(empty, empty, empty, "scaffold", seed, 0, "empty dataset")

    groups: dict[str, list[int]] = defaultdict(list)
    for i, scaffold in enumerate(scaffolds):
        groups[scaffold or "__acyclic__"].append(i)

    # Largest groups first; ties broken deterministically by scaffold string so
    # the split is reproducible from the seed alone.
    ordered = sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))

    # Singleton scaffolds get shuffled so repeated runs with different seeds
    # explore different partitions while staying reproducible per seed.
    rng = random.Random(seed)
    singles = [g for g in ordered if len(g[1]) == 1]
    multis = [g for g in ordered if len(g[1]) > 1]
    rng.shuffle(singles)
    ordered = multis + singles

    n_test_target = int(round(n * test_fraction))
    n_val_target = int(round(n * validation_fraction))

    test: list[int] = []
    val: list[int] = []
    train: list[int] = []

    for _, members in ordered:
        if len(test) < n_test_target:
            test.extend(members)
        elif len(val) < n_val_target:
            val.extend(members)
        else:
            train.extend(members)

    notes = "scaffold split (Bemis-Murcko), whole scaffolds kept intact"

    if labels is not None:
        labels_arr = np.asarray(labels)
        train, val, test, rebalance_note = _ensure_minority_present(
            train, val, test, labels_arr, groups
        )
        if rebalance_note:
            notes = f"{notes}; {rebalance_note}"

    return SplitResult(
        np.array(sorted(train), dtype=int),
        np.array(sorted(val), dtype=int),
        np.array(sorted(test), dtype=int),
        "scaffold",
        seed,
        n_scaffolds=len(groups),
        notes=notes,
    )


def _ensure_minority_present(
    train: list[int],
    val: list[int],
    test: list[int],
    labels: np.ndarray,
    groups: dict[str, list[int]],
) -> tuple[list[int], list[int], list[int], str]:
    """Move whole scaffold groups until every partition holds both classes.

    Scaffold integrity is preserved: entire groups move, never single
    molecules, so no analogue leaks across the boundary.
    """
    notes: list[str] = []
    index_to_group = {i: name for name, members in groups.items() for i in members}
    partitions = {"train": train, "validation": val, "test": test}

    def count_class(name: str, cls: int) -> int:
        return sum(1 for i in partitions[name] if labels[i] == cls)

    for minority_class in (1, 0):
        for target_name in ("test", "validation", "train"):
            if not partitions[target_name]:
                continue
            if count_class(target_name, minority_class) > 0:
                continue

            # Take from whichever partition can best afford it, and only a whole
            # scaffold group, so no analogue is split across the boundary.
            candidates = sorted(
                (n for n in partitions if n != target_name),
                key=lambda n: count_class(n, minority_class),
                reverse=True,
            )

            moved = False
            for donor_name in candidates:
                donor = partitions[donor_name]
                available = [i for i in donor if labels[i] == minority_class]
                if not available:
                    continue

                # Try each candidate group, smallest minority-cost first, and
                # refuse any move that would leave the donor with no example of
                # this class or with no rows at all.
                group_names = []
                for i in available:
                    name = index_to_group[i]
                    if name not in group_names:
                        group_names.append(name)

                for group_name in group_names:
                    moving = [i for i in donor if index_to_group[i] == group_name]
                    moving_minority = sum(1 for i in moving if labels[i] == minority_class)
                    if len(available) - moving_minority < 1:
                        continue
                    if len(moving) >= len(donor):
                        continue

                    moving_set = set(moving)
                    partitions[donor_name] = [i for i in donor if i not in moving_set]
                    partitions[target_name] = partitions[target_name] + moving
                    notes.append(
                        f"moved scaffold {group_name} from {donor_name} to {target_name} "
                        f"so class {minority_class} is represented there"
                    )
                    moved = True
                    break
                if moved:
                    break

            if not moved:
                notes.append(
                    f"{target_name} has no class-{minority_class} example: too few scaffolds "
                    "carry that class to cover every partition"
                )

    return (
        partitions["train"],
        partitions["validation"],
        partitions["test"],
        "; ".join(notes),
    )


def make_split(
    *,
    method: str,
    scaffolds: Sequence[str],
    labels: Sequence[int],
    test_fraction: float,
    validation_fraction: float,
    seed: int,
) -> SplitResult:
    """Dispatch to the configured split method."""
    if method == "scaffold":
        return scaffold_split(
            scaffolds,
            test_fraction=test_fraction,
            validation_fraction=validation_fraction,
            seed=seed,
            labels=labels,
        )
    if method == "random":
        return random_split(
            len(scaffolds),
            test_fraction=test_fraction,
            validation_fraction=validation_fraction,
            seed=seed,
        )
    raise ValueError(f"unknown split method: {method}")


def check_leakage(
    train_keys: Sequence[str], test_keys: Sequence[str]
) -> dict[str, object]:
    """Report identical structures appearing on both sides of a split."""
    train_set = set(train_keys)
    overlap = sorted(train_set.intersection(test_keys))
    return {
        "n_overlap": len(overlap),
        "overlap_examples": overlap[:10],
        "clean": len(overlap) == 0,
    }
