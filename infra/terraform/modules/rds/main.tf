variable "identifier" { type = string }
variable "db_name" { type = string }
variable "username" { type = string }
variable "password" { type = string }
variable "subnet_ids" { type = list(string) }
variable "vpc_security_groups" { type = list(string) }

resource "aws_db_subnet_group" "this" {
  name       = "${var.identifier}-subnets"
  subnet_ids = var.subnet_ids
}

resource "aws_db_instance" "this" {
  identifier             = var.identifier
  engine                 = "postgres"
  engine_version         = "16.4"
  instance_class         = "db.t3.medium"
  allocated_storage      = 100
  storage_type           = "gp3"
  db_name                = var.db_name
  username               = var.username
  password               = var.password
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = var.vpc_security_groups
  skip_final_snapshot    = false
  deletion_protection    = true
  publicly_accessible    = false
  multi_az               = true
}

output "endpoint" {
  value = aws_db_instance.this.address
}
