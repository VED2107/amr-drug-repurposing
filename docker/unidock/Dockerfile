# Benchmark-only image: Uni-Dock (GPU, Vina scoring function) from conda-forge.
FROM mambaorg/micromamba:1.5.10-jammy-cuda-12.4.1
RUN micromamba install -y -n base -c conda-forge unidock && micromamba clean -a -y
ENV PATH=/opt/conda/bin:$PATH
ENTRYPOINT ["/usr/local/bin/_entrypoint.sh"]
