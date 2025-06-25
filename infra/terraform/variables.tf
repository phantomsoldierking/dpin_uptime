variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "cluster_name" {
  type    = string
  default = "dpin-uptime"
}

variable "kubernetes_version" {
  type    = string
  default = "1.31"
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "eks_node_instance_types" {
  type    = list(string)
  default = ["t3.large"]
}

variable "eks_desired_nodes" {
  type    = number
  default = 3
}

variable "eks_min_nodes" {
  type    = number
  default = 2
}

variable "eks_max_nodes" {
  type    = number
  default = 6
}

variable "rds_identifier" {
  type    = string
  default = "dpin-postgres"
}

variable "rds_db_name" {
  type    = string
  default = "dpin"
}

variable "rds_username" {
  type = string
}

variable "rds_password" {
  type      = string
  sensitive = true
}

variable "rds_security_group_ids" {
  type = list(string)
}

variable "redis_replication_group_id" {
  type    = string
  default = "dpin-redis"
}

variable "redis_security_group_ids" {
  type = list(string)
}

variable "alarm_topic_name" {
  type    = string
  default = "dpin-alerts"
}

variable "high_latency_threshold_ms" {
  type    = number
  default = 2000
}

variable "health_check_domain" {
  type = string
}

variable "health_check_path" {
  type    = string
  default = "/health"
}
