output "gateway_url" {
  value       = "https://${google_api_gateway_gateway.canvas.default_hostname}"
  description = "Public URL of the API Gateway, the only public entry point."
}

output "hello_function_url" {
  value       = google_cloudfunctions2_function.hello.service_config[0].uri
  description = "Direct URL of the hello function. Must answer 403 when called without the gateway."
}

output "hello_service_account" {
  value       = google_service_account.hello.email
  description = "Runtime identity of the hello function."
}

output "gateway_service_account" {
  value       = google_service_account.gateway.email
  description = "Identity API Gateway uses to invoke the functions."
}

# Public configuration of the web app, to build the frontend (VITE_FIREBASE_*). A Firebase web API
# key identifies the project; it grants nothing by itself (the rules and the gateway do).
output "frontend_build_env" {
  value = {
    VITE_API_GATEWAY_URL              = "https://${google_api_gateway_gateway.canvas.default_hostname}"
    VITE_FIREBASE_PROJECT_ID          = var.project_id
    VITE_FIREBASE_API_KEY             = data.google_firebase_web_app_config.canvas.api_key
    VITE_FIREBASE_AUTH_DOMAIN         = data.google_firebase_web_app_config.canvas.auth_domain
    VITE_FIREBASE_APP_ID              = google_firebase_web_app.canvas.app_id
    VITE_FIREBASE_MESSAGING_SENDER_ID = data.google_firebase_web_app_config.canvas.messaging_sender_id
    VITE_DISCORD_CLIENT_ID            = var.discord_client_id
  }
  description = "Build-time configuration of app/frontend, used by the frontend deployment (#168)."
}

output "frontend_origin" {
  value       = local.frontend_origin
  description = "Origin allowed by CORS and registered as the Discord OAuth2 redirect URI."
}

output "demo_api_key" {
  value       = google_apikeys_key.demo.key_string
  description = "API key for the demo calls through the gateway."
  sensitive   = true
}
