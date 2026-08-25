# Single image that runs identically on a clinic PC and on a cloud container
# host. Relocating to cloud is then only a change of window.XRAY_AI_API_URL in
# index.html - no application code differs between the two deployments.
#
# Build:
#   docker build -t cs-xray-ai .
#
# Run locally (models cached on the host so rebuilds stay fast):
#   docker run --rm -p 8765:8765 -v cs-xray-models:/app/model_cache cs-xray-ai
#
# Run in cloud (bind all interfaces, restrict origins):
#   docker run -p 8765:8765 -e HOST=0.0.0.0 -e ALLOW_ANY_ORIGIN=false \
#     -e ALLOWED_ORIGINS=https://your-user.github.io cs-xray-ai

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HOST=0.0.0.0 \
    PORT=8765 \
    MODEL_CACHE_DIR=/app/model_cache

WORKDIR /app

# libgl/libglib are required by opencv even in the headless build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# CPU-only torch keeps the image far smaller than the default CUDA wheels.
# Drop the --index-url line if deploying to a GPU host.
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

COPY . .

RUN mkdir -p "$MODEL_CACHE_DIR"

# Weights are NOT baked into the image: they are large, and some repos may be
# gated. Mount MODEL_CACHE_DIR as a volume and run download_models.py once, or
# uncomment below to bake them in for an immutable deployment.
# RUN python download_models.py

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["sh", "-c", "python -m uvicorn main:app --host \"$HOST\" --port \"$PORT\""]
