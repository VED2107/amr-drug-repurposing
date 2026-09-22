"""The update worker: new medicines, existing models.

This package is the containerised half of the system. It watches the same
public sources the pipeline already uses, finds approved medicines that the
published database does not have yet, runs them through the models that are
already ACTIVE, and writes the results to Supabase.

What it deliberately is not
---------------------------
It does not train. It does not create a model version, promote one, touch a
dataset, or write a bioactivity label. A medicine appearing in a source is new
*data to score*, never new *data to learn from* — those are different events,
and conflating them is how a screening system quietly turns into a system that
marks its own homework.

Everything scientific is imported from the existing engine rather than
reimplemented here: standardisation, the Morgan fingerprint, the descriptors
and the model call are the same functions the pipeline runs locally. Only the
persistence layer is new, because the pipeline writes SQLite and this writes
Postgres.
"""

from .config import UpdaterConfig, load_updater_config

__all__ = ["UpdaterConfig", "load_updater_config"]
