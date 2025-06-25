package main

import (
	"context"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/phantomsoldierking/dpin_uptime/apps/validator-go/internal/checker"
	"github.com/phantomsoldierking/dpin_uptime/apps/validator-go/internal/client"
	"github.com/phantomsoldierking/dpin_uptime/apps/validator-go/internal/config"
	"github.com/phantomsoldierking/dpin_uptime/apps/validator-go/internal/signer"
	"github.com/phantomsoldierking/dpin_uptime/apps/validator-go/internal/types"
)

func runCheck(ctx context.Context, checkType string, target string, timeout time.Duration) checker.CheckResult {
	switch strings.ToUpper(checkType) {
	case "TCP":
		parsed, err := url.Parse(target)
		if err != nil {
			message := err.Error()
			return checker.CheckResult{Status: "DOWN", ErrorMessage: &message}
		}
		address := parsed.Host
		if !strings.Contains(address, ":") {
			if parsed.Scheme == "https" {
				address = address + ":443"
			} else {
				address = address + ":80"
			}
		}
		return checker.TCP(address, timeout)
	case "ICMP":
		return checker.ICMPPlaceholder()
	default:
		return checker.HTTP(ctx, target, timeout)
	}
}

func main() {
	cfg := config.Load()
	if cfg.NodeAPIKey == "" || cfg.NodeHMACSecret == "" {
		log.Fatal("NODE_API_KEY and NODE_HMAC_SECRET must be set")
	}

	apiClient := client.New(cfg.HubAPIURL, cfg.NodeID, cfg.NodeAPIKey)
	ctx := context.Background()

	log.Printf("validator-go starting node=%s region=%s hub=%s", cfg.NodeID, cfg.NodeRegion, cfg.HubAPIURL)

	heartbeatTicker := time.NewTicker(cfg.HeartbeatInterval)
	pollTicker := time.NewTicker(cfg.PollInterval)
	defer heartbeatTicker.Stop()
	defer pollTicker.Stop()

	if err := apiClient.Heartbeat(ctx, map[string]any{"runtime": "go", "version": "1.0.0"}); err != nil {
		log.Printf("initial heartbeat failed: %v", err)
	}

	for {
		select {
		case <-heartbeatTicker.C:
			if err := apiClient.Heartbeat(ctx, map[string]any{"runtime": "go", "version": "1.0.0"}); err != nil {
				log.Printf("heartbeat failed: %v", err)
			}
		case <-pollTicker.C:
			job, err := apiClient.Poll(ctx)
			if err != nil {
				log.Printf("poll failed: %v", err)
				continue
			}
			if job == nil {
				continue
			}

			checkCtx, cancel := context.WithTimeout(ctx, cfg.CheckTimeout)
			result := runCheck(checkCtx, job.CheckType, job.URL, cfg.CheckTimeout)
			cancel()

			timestamp := time.Now().UnixMilli()
			sig, err := signer.Sign(
				cfg.NodeHMACSecret,
				job.JobID,
				cfg.NodeID,
				job.WebsiteID,
				job.Region,
				result.Status,
				result.StatusCode,
				result.ResponseTimeMs,
				result.DNSTimeMs,
				result.TCPTimeMs,
				result.TLSTimeMs,
				result.TTFBMs,
				result.ErrorMessage,
				timestamp,
			)
			if err != nil {
				log.Printf("sign failed job=%s: %v", job.JobID, err)
				continue
			}

			payload := types.ResultPayload{
				JobID:          job.JobID,
				NodeID:         cfg.NodeID,
				WebsiteID:      job.WebsiteID,
				Region:         job.Region,
				Status:         result.Status,
				StatusCode:     result.StatusCode,
				ResponseTimeMs: result.ResponseTimeMs,
				DNSTimeMs:      result.DNSTimeMs,
				TCPTimeMs:      result.TCPTimeMs,
				TLSTimeMs:      result.TLSTimeMs,
				TTFBMs:         result.TTFBMs,
				ErrorMessage:   result.ErrorMessage,
				Timestamp:      timestamp,
				Signature:      sig,
			}

			if err := apiClient.SubmitResult(ctx, payload); err != nil {
				log.Printf("submit failed job=%s: %v", job.JobID, err)
				continue
			}

			log.Printf("submitted job=%s status=%s", job.JobID, result.Status)
		}
	}
}
