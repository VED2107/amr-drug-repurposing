"""1024-bit Morgan fingerprints - the molecular representation fixed by the
project presentation.

The bit vector is stored in SQLite as a packed bytes blob (128 bytes per
molecule) so that screening a large library does not require recomputing
fingerprints.
"""

from __future__ import annotations

import numpy as np
from rdkit import Chem
from rdkit.Chem import rdFingerprintGenerator

FEATURE_DIM = 1024

# Generators are stateless and moderately expensive to construct; cache by the
# parameters that define them.
_GENERATORS: dict[tuple[int, int, bool], object] = {}


def _generator(radius: int, n_bits: int, use_chirality: bool):
    key = (radius, n_bits, use_chirality)
    gen = _GENERATORS.get(key)
    if gen is None:
        gen = rdFingerprintGenerator.GetMorganGenerator(
            radius=radius, fpSize=n_bits, includeChirality=use_chirality
        )
        _GENERATORS[key] = gen
    return gen


def morgan_fingerprint(
    mol: Chem.Mol,
    *,
    radius: int = 2,
    n_bits: int = FEATURE_DIM,
    use_chirality: bool = False,
) -> np.ndarray:
    """Return the fingerprint as a uint8 array of 0/1 values.

    Raises ValueError on a None molecule: callers should have validated the
    structure with :func:`~src.chemistry.standardize.standardize_smiles` first.
    """
    if mol is None:
        raise ValueError("cannot fingerprint a None molecule")
    gen = _generator(radius, n_bits, use_chirality)
    fp = gen.GetFingerprintAsNumPy(mol)
    return np.asarray(fp, dtype=np.uint8)


def fingerprint_to_blob(fp: np.ndarray) -> bytes:
    """Pack a 0/1 array into bits for compact storage."""
    arr = np.asarray(fp, dtype=np.uint8)
    if arr.ndim != 1:
        raise ValueError(f"expected a 1-D fingerprint, got shape {arr.shape}")
    return np.packbits(arr).tobytes()


def fingerprint_from_blob(blob: bytes, n_bits: int = FEATURE_DIM) -> np.ndarray:
    """Unpack a stored blob back into a 0/1 array of length ``n_bits``."""
    if blob is None:
        raise ValueError("cannot unpack a None fingerprint blob")
    arr = np.unpackbits(np.frombuffer(blob, dtype=np.uint8))
    if arr.size < n_bits:
        raise ValueError(f"fingerprint blob holds {arr.size} bits, expected at least {n_bits}")
    return arr[:n_bits].astype(np.uint8)


def fingerprint_array(blobs: list[bytes], n_bits: int = FEATURE_DIM) -> np.ndarray:
    """Stack stored fingerprint blobs into an (n_samples, n_bits) matrix."""
    if not blobs:
        return np.zeros((0, n_bits), dtype=np.uint8)
    out = np.zeros((len(blobs), n_bits), dtype=np.uint8)
    for i, blob in enumerate(blobs):
        out[i] = fingerprint_from_blob(blob, n_bits)
    return out
