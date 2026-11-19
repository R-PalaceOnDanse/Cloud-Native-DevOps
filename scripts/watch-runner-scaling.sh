#!/usr/bin/env bash
# Records how many runner nodes and runner pods exist, every INTERVAL seconds, as CSV on the
# terminal and in a file. It is the command-line evidence of the runner autoscaling demonstration
# (docs/runner-autoscaling-demo.md). Stop it with Ctrl-C: it then prints the peaks.
#
# Usage: scripts/watch-runner-scaling.sh [interval-seconds] [output-file]
# Needs kubectl credentials for the cluster (gcloud container clusters get-credentials ...).
set -euo pipefail

interval="${1:-15}"
out="${2:-runner-scaling-$(date -u +%Y%m%dT%H%M%SZ).csv}"
peak_nodes=0
peak_pods=0

summary() {
  echo
  echo "peak runner nodes: ${peak_nodes}"
  echo "peak running runner pods: ${peak_pods}"
  echo "recorded in: ${out}"
  exit 0
}
trap summary INT TERM

kubectl get nodes >/dev/null # fails here, before the loop, if the credentials are missing

echo "time_utc,runner_nodes,runner_nodes_ready,runner_pods_running,runner_pods_pending" | tee "$out"
while true; do
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Runner nodes carry the label role=runner (gke.tf); runner pods live in the arc-runners namespace.
  # An empty list is not an error ("No resources found", exit 0). A failed call is: the sample is
  # skipped, so a network hiccup is not recorded as the pool falling to zero.
  if ! nodes="$(kubectl get nodes -l role=runner --no-headers 2>/dev/null)" ||
    ! pods="$(kubectl get pods -n arc-runners --no-headers 2>/dev/null)"; then
    echo "${now} kubectl failed, sample skipped" >&2
    sleep "$interval"
    continue
  fi

  total="$(awk 'NF { n++ } END { print n + 0 }' <<<"$nodes")"
  ready="$(awk '$2 == "Ready" { n++ } END { print n + 0 }' <<<"$nodes")"
  running="$(awk '$3 == "Running" { n++ } END { print n + 0 }' <<<"$pods")"
  pending="$(awk '$3 == "Pending" { n++ } END { print n + 0 }' <<<"$pods")"

  if ((total > peak_nodes)); then peak_nodes="$total"; fi
  if ((running > peak_pods)); then peak_pods="$running"; fi
  echo "${now},${total},${ready},${running},${pending}" | tee -a "$out"
  sleep "$interval"
done