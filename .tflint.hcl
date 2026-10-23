# Rules of tflint, run on every stack by the pipeline (ADR-0002). Only the bundled Terraform
# ruleset is enabled, so no plugin has to be downloaded.
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
