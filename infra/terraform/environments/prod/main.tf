module "stack" {
  source = "../.."

  aws_region                = var.aws_region
  cluster_name              = "dpin-uptime-prod"
  private_subnet_ids        = var.private_subnet_ids
  rds_username              = var.rds_username
  rds_password              = var.rds_password
  rds_security_group_ids    = var.rds_security_group_ids
  redis_security_group_ids  = var.redis_security_group_ids
  health_check_domain       = var.health_check_domain
  health_check_path         = "/health"
  alarm_topic_name          = "dpin-alerts-prod"
  high_latency_threshold_ms = 1000
  eks_desired_nodes         = 4
  eks_min_nodes             = 3
  eks_max_nodes             = 12
}

variable "aws_region" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "rds_username" { type = string }
variable "rds_password" { type = string }
variable "rds_security_group_ids" { type = list(string) }
variable "redis_security_group_ids" { type = list(string) }
variable "health_check_domain" { type = string }
