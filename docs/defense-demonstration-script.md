# Defense demonstration script (Issue #92)

The live part of the defense, in the order of subject §5.3: IDE to production, runners, the app,
scaling, security, then observability. Each step gives the exact click or command and what to point
at. **prd is the reference**. dev is only the fallback. Commands are for bash (Git Bash or WSL on
Windows).

The reference is `main` plus three pull requests:

- #176: discord-proxy defers and publishes, plus Cloud Trace spans;
- #177: Firebase Hosting;
- #178: snapshot-notifier.

Rehearse on a release that contains all three.

## T-30 min: preparation

Each presenter checks this on their own machine (§5.1: microphone, screen sharing).

```bash
gcloud auth login && gcloud config set project teampasx-cloudnative-prd
gcloud container clusters get-credentials teampasx-prd-vpc-gke --zone europe-west1-b --project teampasx-cloudnative-prd
terraform -chdir=infra/serverless init -reconfigure -backend-config=backends/prd.hcl
GW=$(terraform -chdir=infra/serverless output -raw gateway_url)
WEB=$(terraform -chdir=infra/serverless output -raw frontend_origin)   # https://teampasx-cloudnative-prd.web.app
fn_url() { gcloud functions describe "$1" --region europe-west1 --format='value(serviceConfig.uri)'; }
```

Open these tabs:

1. **GitHub**: *Pull requests*, *Actions*, *Settings > Environments*.
2. **Web app** `$WEB` in two windows side by side (two Discord accounts if possible), DevTools open on
   *Network*.
3. **Discord** test server with the bot.
4. **Cloud Console (prd)**:
   - *Monitoring > Dashboards*: `Canvas Serverless Application Dashboard (teampasx-cloudnative-prd)`
     and `teampasx-prd-vpc-gke-overview`;
   - *Monitoring > Alerting*;
   - *Logging > Logs Explorer*;
   - *Trace > Trace explorer*;
   - *Cloud Run* (instances of `draw-worker`);
   - *Cloud Storage* bucket `teampasx-cloudnative-prd-canvas-snapshots`.
5. **Grafana** (cluster dashboard). Start the port-forward, log in as `admin`, and open
   `http://localhost:3000`:

   ```bash
   gcloud secrets versions access latest --secret=grafana-admin-password --project=teampasx-cloudnative-prd
   kubectl port-forward --namespace monitoring service/grafana 3000:80
   ```

6. **Terminal 2**: `scripts/watch-runner-scaling.sh 15` (runner nodes and pods, as CSV).

Before you start, check that the last `terraform-deploy` run is green and that the web app loads.
Also check that `gh variable get RUNNER_LABEL` prints `arc-prd` (or `arc-dev`), so the PR checks
run on the self-hosted runners.

## 0:00 to 4:00 - From the IDE to a pull request

1. In the IDE, make a small visible change, for example a text in `app/frontend/src/main.ts`.
2. Commit it signed on a feature branch and open the pull request:

   ```bash
   git switch -c feat/demo-defense
   git commit -S -am "feat(frontend): demo change for the defense"
   git log --show-signature -1
   git push -u origin feat/demo-defense
   gh pr create --fill --base main
   ```

3. Show the checks starting on the pull request:
   - `frontend-ci` (test and build), `secret-scan` (gitleaks on the whole history);
   - `terraform-ci` and `functions-ci` only if the change touches their paths.

   Open a job and show *Runner name*: `arc-prd-...`, a pod of the cluster, not GitHub's runner.
4. On an infra pull request (an earlier one if this change has none), open `terraform-ci` >
   *Summary* to show the plan of each stack in dev and prd. It was made with the read-only
   `github-plan` account, through Workload Identity Federation.
5. A teammate reviews and approves (*Files changed > Review changes > Approve*), then merges. Show
   *Settings > Rules > Rulesets > protect-main*. It requires:
   - a pull request with 1 approving review;
   - signed commits;
   - the gitleaks check.

   It also blocks force pushes and deletion of `main`. Merge stays greyed out until all of these
   pass.

Say: GitFlow (feature branch, PR, review, merge to `main`), signed commits enforced on `main`, no
deploy from a branch.

## 4:00 to 8:00 - Release and deploy

1. Tag `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag -s vX.Y.Z -m "vX.Y.Z"    # next version after the last tag: git tag --sort=-v:refname | head -1
   git push origin vX.Y.Z
   ```

2. *Actions > terraform-deploy*: show the chain `check-tag` -> `foundation-dev` -> `serverless-dev`
   -> `frontend-dev` -> `foundation-prd` -> `serverless-prd` -> `frontend-prd`.
3. The prd jobs wait on *Review deployments*: the `prd` environment requires a reviewer (one of the
   three members). A teammate approves it live.
4. Open a `serverless-prd` job:
   - the job runs in the **environment `prd`**, which is the only way to impersonate
     `github-apply` (ADR-0011);
   - the step `google-github-actions/auth` uses no key;
   - the plan in the summary, then `terraform apply` of that saved plan.
5. Open `frontend-prd` (job *deploy frontend to prd*). It:
   - reads `terraform output frontend_build_env`;
   - runs `npm ci` and `npm run build`;
   - runs `firebase-tools@15.36.0 deploy --only hosting` with the same keyless credentials.

   The job summary prints the site URL.
6. A full release takes long. Let it run and come back to it at the end, or show the last green run.

## 8:00 to 11:00 - Runners scale with the node pool

1. Terminal: `kubectl get nodes -L role,cloud.google.com/gke-nodepool`. At rest there is 1
   `system-pool` node and 0 `runner-pool` nodes.
2. Start a burst:

   ```bash
   gh workflow run runner-load-test.yml --ref main -f jobs=3 -f minutes=3 -f runner=arc-prd
   ```

3. Show:
   - `watch-runner-scaling.sh`: runner pods go Pending, the Spot nodes appear (0 -> 2), the third
     job waits because `maxRunners` is 2;
   - Grafana *Cluster and runners*: *Nodes by pool*, *Runner jobs*, *Runners*;
   - *Actions*: the jobs run on `arc-prd-...`.
4. About 10 minutes after the jobs end, the runner nodes are removed. Show it at the end, or show
   [runner-auto-scaling-demo.md](runner-auto-scaling-demo.md) and `docs/evidence/runner-scaling-dev.csv`.

Say: the taint `runner=true:NoSchedule` keeps runners on the Spot pool; `minRunners 0` and
`total_min_node_count 0` mean nothing is billed when idle.

## 11:00 to 17:00 - The app: web, Discord, real time, large grid

1. **Sign in**: window A, *Connexion Discord* -> Discord consent -> back on `$WEB`, signed in. Do the
   same in window B with another account.
2. **Draw**: click a pixel in window A. In DevTools, show `POST $GW/draw` -> **202**, with an
   `Authorization: Bearer` header and the `correlationId` in the response. The pixel appears in
   window B with no reload.
3. **No polling**: in DevTools, filter `firestore.googleapis.com`. Show the long-lived `Listen`
   channel and that no request repeats on a timer.
4. **Large grid**: zoom out to the whole 10 000 x 10 000 grid, use the minimap to jump, zoom in on
   another area. Only the visible chunks get a listener.
5. **Brush**: draw a stroke larger than the remaining quota (20 pixels per minute). It is refused
   whole, never truncated, and the message says why.
6. **Discord**:
   - `/draw x:5000 y:5000 color:#ff0000`: the bot shows "thinking" at once (deferred response,
     type 5, after `discord-proxy` has published to `pixel-draw-events`). The worker then edits it,
     and the pixel appears in both browser windows;
   - `/draw x:20000 y:0 color:red`: an ephemeral error from the proxy, nothing is published;
   - `/get`: the current canvas as a PNG;
   - `/admin pause` with an admin account: a draw from the web or Discord is now refused. Try
     `/admin pause` with a non-admin: refused. Then `/admin resume`;
   - `/admin ratelimit user:@someone limit:5`;
   - `/snapshot` (admin): the answer first says the snapshot is being prepared (edited by
     `draw-worker`), then the same message gets the link. The link comes from `snapshot-notifier`:
     - the worker uploads `snapshots/<timestamp>.png` with the interaction in its custom metadata;
     - the bucket fires the `OBJECT_FINALIZE` notification to `snapshot-ready`;
     - the notifier receives it by push, then signs the URL.

     Open the link: a `storage.googleapis.com` URL with `X-Goog-Signature` and
     `X-Goog-Expires=3600`. In the console, open the object in the bucket: its custom metadata holds
     `applicationId`, `correlationId`, `traceparent`. Logs Explorer
     `resource.labels.service_name="snapshot-notifier"` shows *Signed snapshot link sent to Discord*.
7. `/admin clear` last, if you clear at all. The canvas empties in every window at once, because
   the epoch in `config/system` changed.

## 17:00 to 20:00 - Serverless scaling under load

1. Copy the ID token from a `/draw` request in DevTools (*Request Headers > authorization*, without
   `Bearer `).
2. Run the load test against the gateway:

   ```bash
   node tests/load/burst-load.mjs --url "$GW/draw" --token "<ID token>" -c 20 -n 600 -b 9
   ```

   Every request is accepted by the proxy (202) and goes through Pub/Sub. The worker rejects most of
   them for the rate limit (one user), but it still processes each message, which is what scales.
3. Show:
   - *Canvas Serverless Application Dashboard*: *Cloud Functions Invocations*, *Pub/Sub Queue
     Depth*, *Oldest Unacked Message Age*, *p95 latency*;
   - *Cloud Run > draw-worker > Metrics*: instance count going up (max 10), then back to 0;
   - the tool's summary: throughput, p50, p95, p99, errors.

## 20:00 to 24:00 - Security

Detail and proofs are in [security-walkthrough.md](security-walkthrough.md). Live:

```bash
curl -i "$(fn_url web-draw-proxy)"                    # 403: not public, only SA api-gateway may invoke
curl -i -X POST "$(fn_url draw-worker)"               # refused: ingress internal only
curl -i -X POST "$GW/draw" -d '{}'                    # 401 from the gateway: no Firebase ID token
curl -i -X POST "$GW/discord/interactions" -H 'Content-Type: application/json' -d '{"type":1}'   # 401: no Ed25519 signature
curl -i "https://storage.googleapis.com/teampasx-cloudnative-prd-canvas-snapshots/snapshots/<name>.png"  # 403 without the signature
gcloud iam service-accounts keys list --iam-account=github-apply@teampasx-cloudnative-prd.iam.gserviceaccount.com --managed-by=user   # empty
gcloud secrets get-iam-policy discord-client-secret   # only fn-auth-callback
```

Then show, in the console:

- *IAM > Service accounts*: one per function;
- *Security > Workload Identity Federation*: pool `github`, condition on the repository;
- *Settings > Environments* on GitHub.

## 24:00 to 28:00 - Logs, traces, alert

1. **Logs**: Logs Explorer, query with the `correlationId` of step 11:00-2:

   ```text
   resource.type="cloud_run_revision"
   jsonPayload.correlationId="<correlationId>"
   ```

   You get one line from `web-draw-proxy` (*Received draw request*) and one from `draw-worker`
   (*pixel.processed*), with the same `trace_id`.
2. **Trace**: in *Trace explorer*, open the trace with that `trace_id` (or click the trace link of
   a log line). Each function exports its own span with the Cloud Trace API v2 (`src/trace.ts`):
   `web-draw-proxy /draw` (or `discord-proxy /draw`), then `draw-worker pixel.draw` as its child, with
   `correlationId` and outcome as attributes, and the log lines alongside.

   For `/snapshot` the same trace continues: `discord-proxy /snapshot` -> `draw-worker
   discord.command` -> `snapshot-notifier OBJECT_FINALIZE`. The traceparent rides in the object
   metadata.
3. **Alert**: *Monitoring > Alerting* lists the policies:
   - *Cloud Functions High Error Rate (>5% 5xx)*;
   - *Pub/Sub Dead-Letter Queue Active Messages*;
   - *Pub/Sub Draw Queue Backlog (Age > 60s)*;
   - the cluster alerts.

   To fire one live, publish a message the worker cannot parse:

   ```bash
   gcloud pubsub topics publish pixel-draw-events --message='not json'
   ```

   `draw-worker` answers 400. Pub/Sub push retries any non-2xx answer, so it retries the message
   (backoff from 10 s up to 600 s). After 5 attempts it moves the message to
   `pixel-draw-events-dlq`, and the DLQ alert e-mails the team. Do it at the start
   of this section: the retries take a few minutes. Read the message back with
   `gcloud pubsub subscriptions pull pixel-draw-events-dlq-inspection --auto-ack`.
4. Back to *Actions*: the release started at 4:00 is green, and the change is live on `$WEB`.

## Fallbacks

| Step | Problem | Fallback |
|---|---|---|
| PR checks | `arc-prd` runners missing | `gh variable delete RUNNER_LABEL` and re-run: the checks use `ubuntu-latest`. Show the runner evidence in [runner-auto-scaling-demo.md](runner-auto-scaling-demo.md) |
| Release | slow or failing apply | Show the last green `terraform-deploy` run and its plan summaries |
| Runners | Spot capacity unavailable | `docs/evidence/runner-scaling-dev.csv` and the Grafana history |
| Web app | prd down | The same app on dev (`https://teampasx-cloudnative-dev.web.app`) |
| Discord | reply not arriving | Logs Explorer `resource.labels.service_name="discord-proxy"`, then `"draw-worker"`, then `"snapshot-notifier"`, to show where it stopped |
| Snapshot link | interaction token expired (15 min) or notifier failing | Messages in `snapshot-ready-dlq-inspection`; the object is still in the bucket |
| Alert | e-mail delayed | Show the incident in *Monitoring > Alerting* and the messages in `pixel-draw-events-dlq-inspection` |
