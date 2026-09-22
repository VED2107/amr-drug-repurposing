# AMR Drug Repurposing - reproducible runtime image.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    AMR_VINA_BIN=/opt/vina/vina

# RDKit and Meeko need a few shared libraries; curl fetches the Vina binary.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates libxrender1 libxext6 libsm6 \
    && rm -rf /var/lib/apt/lists/*

# AutoDock Vina. Docking is optional: if this layer is removed the pipeline
# records the limitation and every other stage still runs.
RUN mkdir -p /opt/vina \
    && curl -fsSL -o /opt/vina/vina \
       https://github.com/ccsb-scripps/AutoDock-Vina/releases/download/v1.2.5/vina_1.2.5_linux_x86_64 \
    && chmod +x /opt/vina/vina

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --upgrade pip && pip install -e . && pip install gemmi

COPY configs ./configs
COPY app ./app
COPY scripts ./scripts
COPY docs ./docs
COPY tests ./tests

RUN mkdir -p data/raw data/processed data/external data/demo models logs

EXPOSE 8501

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8501/_stcore/health || exit 1

# The dashboard only reads stored results. Populate the database first, e.g.
#   docker run --rm -v "$PWD/data:/app/data" amr python -m src.pipeline.run
CMD ["streamlit", "run", "app/streamlit_app.py", \
     "--server.address=0.0.0.0", "--server.port=8501", "--server.headless=true"]
