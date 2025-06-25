variable "replication_group_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.replication_group_id}-subnets"
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = var.replication_group_id
  description                = "Redis for DPIN uptime"
  node_type                  = "cache.t3.micro"
  engine                     = "redis"
  engine_version             = "7.1"
  parameter_group_name       = "default.redis7"
  port                       = 6379
  automatic_failover_enabled = true
  num_cache_clusters         = 2
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = var.security_group_ids
}

output "primary_endpoint" {
  value = aws_elasticache_replication_group.this.primary_endpoint_address
}
