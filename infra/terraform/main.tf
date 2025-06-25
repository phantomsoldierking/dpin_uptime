terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "eks" {
  source               = "./modules/eks"
  cluster_name         = var.cluster_name
  kubernetes_version   = var.kubernetes_version
  subnet_ids           = var.private_subnet_ids
  node_instance_types  = var.eks_node_instance_types
  desired_nodes        = var.eks_desired_nodes
  min_nodes            = var.eks_min_nodes
  max_nodes            = var.eks_max_nodes
}

module "rds" {
  source              = "./modules/rds"
  identifier          = var.rds_identifier
  db_name             = var.rds_db_name
  username            = var.rds_username
  password            = var.rds_password
  subnet_ids          = var.private_subnet_ids
  vpc_security_groups = var.rds_security_group_ids
}

module "elasticache" {
  source              = "./modules/elasticache"
  replication_group_id = var.redis_replication_group_id
  subnet_ids          = var.private_subnet_ids
  security_group_ids  = var.redis_security_group_ids
}

module "cloudwatch" {
  source                    = "./modules/cloudwatch"
  alarm_topic_name          = var.alarm_topic_name
  high_latency_threshold_ms = var.high_latency_threshold_ms
}

module "route53" {
  source              = "./modules/route53"
  health_check_domain = var.health_check_domain
  health_check_path   = var.health_check_path
}
