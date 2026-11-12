locals {
  serverless_apis = [
    "cloudfunctions.googleapis.com",    # Cloud Run functions
    "run.googleapis.com",               # the Cloud Run service behind each function
    "cloudbuild.googleapis.com",        # builds the function source
    "artifactregistry.googleapis.com",  # stores the built images
    "storage.googleapis.com",           # source bucket
    "secretmanager.googleapis.com",     # runtime secrets
    "apigateway.googleapis.com",        # the public entry point
    "servicemanagement.googleapis.com", # required by API Gateway
    "servicecontrol.googleapis.com",    # required by API Gateway
    "apikeys.googleapis.com",           # API key checked by the gateway
  ]
}

resource "google_project_service" "serverless" {
  for_each = toset(local.serverless_apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
