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
    "firestore.googleapis.com",         # Firestore NoSQL database
    "firebaserules.googleapis.com",     # Firestore security rules
    "pubsub.googleapis.com",            # Pub/Sub message broker
    "monitoring.googleapis.com",        # Cloud Monitoring
    "logging.googleapis.com",           # Cloud Logging
    "cloudtrace.googleapis.com",        # Cloud Trace (Issue #88)
    "firebase.googleapis.com",          # Firebase project (Auth, Hosting)
    "firebasehosting.googleapis.com",   # Firebase Hosting: the frontend's site and its releases (#168)
    "identitytoolkit.googleapis.com",   # Firebase Authentication: custom tokens (ADR-0009)
    "iamcredentials.googleapis.com",    # signBlob: custom tokens and snapshot signed URLs, no key file
  ]
}

resource "google_project_service" "serverless" {
  for_each = toset(local.serverless_apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
