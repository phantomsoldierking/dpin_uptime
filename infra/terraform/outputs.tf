output "eks_cluster_name" {
  value = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  value = module.rds.endpoint
}

output "redis_primary_endpoint" {
  value = module.elasticache.primary_endpoint
}

output "alarm_topic_arn" {
  value = module.cloudwatch.topic_arn
}

output "route53_health_check_id" {
  value = module.route53.health_check_id
}
