# Firebase in the GCP project (ADR-0009): Authentication for the web users, and the web app whose
# public configuration the frontend is built with, and the Hosting site that serves it (#168).
#
# Sign-in flow: Discord OAuth2 -> auth-callback mints a custom token for discord:<id> -> the browser
# signs in with it -> its Firebase ID token is read by the Firestore rules and verified by API Gateway.
# Firebase Auth has no sign-in provider enabled here: only auth-callback can create a session.

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.serverless]
}

# Initialises Firebase Authentication (Identity Platform) so that custom tokens can be exchanged.
# Cannot be deleted by the API: a destroy only forgets it, and it costs nothing without users.
resource "google_identity_platform_config" "this" {
  project = var.project_id

  authorized_domains = distinct([
    "localhost",
    "${var.project_id}.firebaseapp.com",
    "${var.project_id}.web.app",
    trimprefix(local.frontend_origin, "https://"),
  ])

  depends_on = [google_firebase_project.this]
}

resource "google_firebase_web_app" "canvas" {
  provider        = google-beta
  project         = var.project_id
  display_name    = "Pixel canvas"
  deletion_policy = "DELETE"

  depends_on = [google_firebase_project.this]
}

data "google_firebase_web_app_config" "canvas" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.canvas.app_id
}

# The project's default Hosting site (<project_id>.web.app), the origin in local.frontend_origin.
# Firebase creates it with Hosting, so the provider adopts it when it already exists instead of
# failing, and a destroy only forgets it (a default site cannot be deleted). Terraform owns the
# site; the content is released by .github/workflows/frontend-deploy.yml after each apply.
resource "google_firebase_hosting_site" "default" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.project_id
  # Links the site to the web app, so the console shows which configuration the build uses.
  app_id = google_firebase_web_app.canvas.app_id

  depends_on = [google_firebase_project.this]
}
