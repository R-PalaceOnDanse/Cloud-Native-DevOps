#!/usr/bin/env bash
# Records how many runner nodes and runner pods exist, every INTERVAL seconds, as CSV on the
# terminal and in a file. It is the command-line evidence of the runner autoscaling demonstration
# (docs/runner-autoscaling-demo.md). Stop it with Ctrl-C: it then prints the peak node count.
#
# Usage: scripts/watch-runner-scaling.sh [interval-seconds] [output-file]
# Needs kubectl credentials for the cluster (gcloud container clusters get-credentials ...).
set -euo pipefail

interval="${1:-15}"
out="${2:-runner-scaling-$(date -u +%Y%m%dT%H%M%SZ).csv}"
peak=0

summary() {
  echo
  echo "peak runner nodes: ${peak}"
  echo "recorded in: ${out}"
  exit 0
}
trap summary INT TERM

kubectl get nodes >/dev/null # fails here, before the loop, if the credentials are missing

echo "time_utc,runner_nodes,runner_nodes_ready,runner_pods_running,runner_pods_pending" | tee "$out"
while true; do
  # Runner nodes carry the label role=runner (gke.tf); runner pods live in the arc-runners namespace.
  nodes="$(kubectl get nodes -l role=runner --no-headers 2>/dev/null || true)"
  pods="$(kubectl get pods -n arc-runners --no-headers 2>/dev/null || true)"

  total="$(awk 'NF { n++ } END { print n + 0 }' <<<"$nodes")"
  ready="$(awk '$2 == "Ready" { n++ } END { print n + 0 }' <<<"$nodes")"
  running="$(awk '$3 == "Running" { n++ } END { print n + 0 }' <<<"$pods")"
  pending="$(awk '$3 == "Pending" { n++ } END { print n + 0 }' <<<"$pods")"

  if ((total > peak)); then peak="$total"; fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ),${total},${ready},${running},${pending}" | tee -a "$out"
  sleep "$interval"
done