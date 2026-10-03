#!/usr/bin/env bash
# Start or stop extra docking workers on Google Compute Engine.
#
# Each VM builds the same worker image (Dockerfile.docking) from the public
# repository and consumes the same Supabase queue as every other worker. Workers
# share nothing but the database and the storage bucket, so VMs can be added or
# removed at any time; a VM that is deleted mid-job loses nothing (its leases
# expire and the jobs return to the queue).
#
# Usage (after `gcloud auth login` and `gcloud config set project <id>`):
#   scripts/cloud/gcp_docking_workers.sh up   [N_VMS] [MACHINE_TYPE] [ZONE]
#   scripts/cloud/gcp_docking_workers.sh down [N_VMS] [ZONE]
#
# Defaults: 2 x c2d-highcpu-56 (112 vCPU) as Spot VMs in australia-southeast1-b,
# the Supabase region, so the database is close. Reads credentials from
# docking.env in the repository root and passes them as instance metadata,
# which is visible to anyone with access to the project. Delete the VMs
# afterwards (`down`): they bill per second while running.
set -euo pipefail

ACTION=${1:-}
N=${2:-2}
TYPE=${3:-c2d-highcpu-56}
ZONE=${4:-australia-southeast1-b}
REPO=${DOCKING_REPO:-https://github.com/VED2107/amr-drug-repurposing.git}
ENV_FILE=${DOCKING_ENV_FILE:-docking.env}

case "$ACTION" in
  up)
    [ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
    STARTUP=$(mktemp)
    cat > "$STARTUP" <<'EOS'
#!/bin/bash
set -e
apt-get update && apt-get install -y docker.io git
curl -s -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/attributes/docking-env' > /root/docking.env
REPO=$(curl -s -H 'Metadata-Flavor: Google' 'http://metadata.google.internal/computeMetadata/v1/instance/attributes/docking-repo')
rm -rf /opt/amr && git clone --depth 1 "$REPO" /opt/amr
cd /opt/amr && docker build -f Dockerfile.docking -t amr-docking:latest .
mkdir -p /data/docking && chown 10001:10001 /data/docking
docker rm -f docking-worker 2>/dev/null || true
docker run -d --name docking-worker --restart unless-stopped --env-file /root/docking.env \
  -e DOCKING_CONCURRENCY=$(( $(nproc) - 1 )) -v /data/docking:/data/docking \
  --stop-timeout 40 amr-docking:latest worker
EOS
    for i in $(seq 1 "$N"); do
      gcloud compute instances create "amr-docking-$i" --zone "$ZONE" --machine-type "$TYPE" \
        --provisioning-model SPOT --instance-termination-action DELETE \
        --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB \
        --metadata-from-file "startup-script=$STARTUP,docking-env=$ENV_FILE" \
        --metadata "docking-repo=$REPO" &
    done
    wait
    rm -f "$STARTUP"
    echo "started $N x $TYPE; watch progress with: npm run docking:status"
    ;;
  down)
    ZONE=${3:-australia-southeast1-b}
    names=$(seq -f "amr-docking-%g" 1 "$N" | tr '\n' ' ')
    gcloud compute instances delete $names --zone "$ZONE" --quiet
    ;;
  *)
    sed -n '2,20p' "$0"; exit 2 ;;
esac
