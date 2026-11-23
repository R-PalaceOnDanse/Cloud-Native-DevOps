# Runner autoscaling demonstration

How to show that the runner node pool grows when jobs arrive and shrinks back to zero when they are
done (subject §2.1 and §4, issue #75), how to record the evidence, and how to replay it at the
defense. Read by whoever runs the demonstration. The limits it shows are described in the *Cost
safeguards* section of [infra.md](infra.md).

## What it shows

- A burst of jobs makes the runner node count go from 0 up to its ceiling (`runner_node_max_count`,
  2), because each runner pod requests 500m CPU and one `e2-medium` node holds only one runner.
- The ceiling holds: with more jobs than `runner_max_count`, the extra jobs wait in GitHub and no
  third node is added.
- When the jobs are done, the runner pods are deleted (`minRunners = 0`) and the cluster autoscaler
  removes the empty nodes, back to 0.

## The pieces

| Piece | Role |
|---|---|
| `.github/workflows/runner-load-test.yml` | Started by hand. Runs `jobs` jobs at once on the runner scale set; each one only sleeps for `minutes` minutes, so the load is the number of runners, not CPU work. Each job stops after 20 minutes at most |
| `scripts/watch-runner-scaling.sh` | Prints and saves, every 15 seconds, the number of runner nodes (ready or not) and of runner pods (running, pending), as CSV. Ctrl-C prints the peak node count |
| Cluster dashboard (section 6) | Shows the node count over time. Until it exists, use Metrics Explorer (see [Evidence](#evidence)) |

## Scenario

Prerequisites: the `foundation` stack is applied in the environment, the runner scale set is
registered on the repository (*Settings > Actions > Runners* lists `arc-runner-set`), and the tools
of [development.md](development.md) are installed. The example uses dev; for prd replace `dev` with
`prd` everywhere.

**1. Get kubectl credentials for the cluster.** This writes the cluster address and a token into
`~/.kube/config`, so the next commands talk to this cluster.

```bash
gcloud container clusters get-credentials teampasx-dev-vpc-gke \
  --zone europe-west1-b --project teampasx-cloudnative-dev
```

**2. Check the starting point: no runner node.** The label `role=runner` is set by the runner pool
in `gke.tf`. Expected answer: `No resources found`. If a runner node exists, wait for it to be
removed, otherwise the demonstration does not start from zero.

```bash
kubectl get nodes -L role,cloud.google.com/gke-nodepool
kubectl get nodes -l role=runner
```

**3. Start the recorder in a first terminal.** It keeps running and writes
`runner-scaling-<date>.csv` in the current folder.

```bash
scripts/watch-runner-scaling.sh 15
```

**4. Optionally, follow the nodes live in a second terminal.** `-w` prints a line each time a
node appears or changes status (not when it is deleted); it is the most readable view to show on
screen.

```bash
kubectl get nodes -l role=runner -w
```

**5. Start the burst.** Three jobs of three minutes: two runners start, the third job waits for a
free runner, which shows the ceiling.

```bash
gh workflow run runner-load-test.yml --ref main -f jobs=3 -f minutes=3
```

Or from the *Actions* tab, workflow `runner-load-test`, *Run workflow*.

**6. Watch it happen.** Expected sequence:

1. Two runner pods appear `Pending` (`runner_pods_pending = 2`): no node can hold them yet.
2. The cluster autoscaler adds two nodes (`runner_nodes` goes 0 → 2), then the pods run.
3. After the first two jobs end, the third job takes one of the runners; the other node becomes
   empty and is removed (2 → 1).
4. When the last job ends, the last node is removed (1 → 0).

`runner_nodes` must never go above 2.

**7. Stop the recorder** with Ctrl-C once `runner_nodes` is back to 0. It prints the peak.

## Evidence

Keep, for each recorded run, in the pull request or the defense material:

- the CSV written by the recorder, and the peak it printed;
- a capture of the `kubectl get nodes -l role=runner -w` terminal;
- the link to the `runner-load-test` run on GitHub (it shows when each job started and ended);
- a capture of the node count over the run window, on the cluster dashboard once it exists. Until
  then, in Cloud Monitoring *Metrics Explorer*, the metric `kubernetes.io/node/cpu/allocatable_cores`
  on the `k8s_node` resource, filtered on the cluster name and aggregated with *count*, gives one
  time series per node: the line goes from 1 (the system node) to 3 and back to 1. Cloud Monitoring
  shows it with a delay of a few minutes.

## Recorded run

| | |
|---|---|
| Date | 2026-11-19 |
| Environment / runner set | dev / `arc-dev` |
| Inputs | `jobs = 3`, `minutes = 3` |
| Workflow run | [runner-load-test #1](https://github.com/R-PalaceOnDanse/Cloud-Native-DevOps/actions/runs/44508208356), success, 8 min 14 s |
| CSV | [`docs/evidence/runner-scaling-dev.csv`](evidence/runner-scaling-dev.csv), one sample every 15 s |
| Peak runner nodes | 2 (ceiling reached) |
| Peak runner pods | 2 (`maxRunners`); the third job waited in the GitHub queue |
| Runner pods Pending → nodes Ready | under 1 minute (10:43:14 → 10:44:01) |
| Last job done → 0 nodes | <from the last scaleDown in the autoscaler log> |

Timeline (UTC, ±15 s from the sampling interval):

| Time | Event |
|---|---|
| 10:43:14 | 2 runner pods `Pending`, 0 runner node: the autoscaler must add nodes |
| <hh:mm:ss> | `scaleUp` decision in the cluster autoscaler log |
| 10:44:01 | 2 runner nodes `Ready` |
| 10:44:47 | 2 runner pods `Running` (image pulled); job 3 queued on GitHub |
| 10:48:11 | jobs 1 and 2 done; job 3 takes a runner at once: 1 pod `Running` |
| 10:49:14 | the idle node goes `NotReady`: it is being removed |
| 10:50:01 | 1 runner node left, job 3 still running on it |
| 10:51:18 | job 3 done, 0 runner pod |
| <hh:mm:ss> | `scaleDown` of the last node: 0 runner node |

What it shows: the pool grows from 0 to its ceiling of 2 nodes when jobs wait, extra jobs queue
instead of adding nodes beyond the cap, and nodes are removed one by one as the load drops, back to
zero once no job runs.

## At the defense

A full run takes about 10 to 20 minutes, including the scale-down. Start it at the beginning of the
slot (steps 1 to 5), go on with the presentation, and come back to the recorder and the dashboard
when the scaling part comes. Keep the captures of a recorded run ready in case the live run is
slow, for example if Spot capacity is short.

## When it does not behave

- **Jobs stay *Queued* and no pod appears**: the scale set is not registered or the label is wrong.
  Check *Settings > Actions > Runners* and the `runner` input (the Helm release name).
- **The listener in `arc-systems` restarts every few seconds**: read its logs while it runs with
  `until kubectl logs -n arc-systems <listener-pod> -f 2>/dev/null; do sleep 1; done`. A `409`
  `RunnerScaleSetSessionConflictException` ("already has an active session") means another listener
  holds the session of a scale set with the same name, typically the other environment's cluster
  registered on the same repository. GitHub accepts one listener per scale set: give each
  environment its own scale set name, or run the demonstration where the listener is connected.
- **Pods stay `Pending` and no node is added**: look at the autoscaler's reason with
  `kubectl describe pod -n arc-runners <pod>` (the *Events* section names it, for example a quota
  or Spot capacity problem).
- **A runner node is not removed**: list what still runs on it with
  `kubectl get pods -A --field-selector spec.nodeName=<node>`. A pod that is not managed by a
  controller blocks the scale-down.