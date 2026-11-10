# API Gateway: api -> config (the OpenAPI spec, immutable) -> gateway (the public URL).

locals {
  openapi_spec = templatefile("${path.module}/openapi.yaml.tftpl", {
    hello_url = google_cloudfunctions2_function.hello.service_config[0].uri
  })
}

resource "google_api_gateway_api" "canvas" {
  provider = google-beta

  api_id       = "canvas-api"
  display_name = "Pixel canvas API"

  depends_on = [google_project_service.serverless]
}

resource "google_api_gateway_api_config" "canvas" {
  provider = google-beta

  api                  = google_api_gateway_api.canvas.api_id
  api_config_id_prefix = "canvas-"
  display_name         = "Pixel canvas API config"

  openapi_documents {
    document {
      path     = "openapi.yaml"
      contents = base64encode(local.openapi_spec)
    }
  }

  gateway_config {
    backend_config {
      google_service_account = google_service_account.gateway.email
    }
  }

  # A config cannot be changed in place: the new one is created, the gateway switches to it, then
  # the old one is deleted.
  lifecycle {
    create_before_destroy = true
  }
}

resource "google_api_gateway_gateway" "canvas" {
  provider = google-beta

  gateway_id   = "canvas-gw"
  region       = var.region
  api_config   = google_api_gateway_api_config.canvas.id
  display_name = "Pixel canvas gateway"
}

# Each API gets its own managed service, which must be enabled for API keys to work with it.
resource "google_project_service" "canvas_api" {
  project            = var.project_id
  service            = google_api_gateway_api.canvas.managed_service
  disable_on_destroy = false
}

# Key used for the C05 demo. It only works on this API. Its value is in the state (private bucket)
# and is read with `terraform output -raw demo_api_key`.
resource "google_apikeys_key" "demo" {
  name         = "canvas-demo"
  display_name = "Pixel canvas API: demo key"

  restrictions {
    api_targets {
      service = google_api_gateway_api.canvas.managed_service
    }
  }

  depends_on = [google_project_service.canvas_api]
}
