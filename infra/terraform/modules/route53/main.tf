variable "health_check_domain" { type = string }
variable "health_check_path" { type = string }

resource "aws_route53_health_check" "api" {
  fqdn              = var.health_check_domain
  port              = 443
  type              = "HTTPS"
  resource_path     = var.health_check_path
  failure_threshold = 3
  request_interval  = 30
}

output "health_check_id" {
  value = aws_route53_health_check.api.id
}
