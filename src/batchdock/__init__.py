"""Batch molecular docking: every library medicine against every selected AMR target.

A Postgres-backed job queue (schema `docking`), long-lived AutoDock Vina workers
that can run on any number of machines, and progress computed from the database.
See docs/BATCH_DOCKING.md.
"""
