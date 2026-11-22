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

output "demo_api_key" {
  value       = google_apikeys_key.demo.key_string
  description = "API key for the demo calls through the gateway."
  sensitive   = true
}

output "firestore_database" {
  value       = google_firestore_database.canvas.name
  description = "Firestore database used for the pixel grid and rate-limit counters."
}
