"""Pipeline stages.

Each stage is runnable on its own (``python -m src.pipeline.<stage>``) and
records a row in ``pipeline_runs`` with its counts, duration and errors, so the
dashboard's automation page reflects what actually happened rather than what
was supposed to happen.
"""

from .runlog import PipelineRun, stage_run

__all__ = ["PipelineRun", "stage_run"]
