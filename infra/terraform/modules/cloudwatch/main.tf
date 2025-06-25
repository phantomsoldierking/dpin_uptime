variable "alarm_topic_name" { type = string }
variable "high_latency_threshold_ms" { type = number }

resource "aws_sns_topic" "alerts" {
  name = var.alarm_topic_name
}

resource "aws_cloudwatch_metric_alarm" "high_latency" {
  alarm_name          = "dpin-high-latency"
  namespace           = "DPIN/Checks"
  metric_name         = "ResponseTimeMs"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  threshold           = var.high_latency_threshold_ms
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions = {
    Region = "us-east-1"
  }
}

output "topic_arn" {
  value = aws_sns_topic.alerts.arn
}
