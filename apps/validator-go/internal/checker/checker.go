package checker

import (
	"context"
	"net"
	"net/http"
	"time"
)

type CheckResult struct {
	Status         string
	StatusCode     *int
	ResponseTimeMs *int
	DNSTimeMs      *int
	TCPTimeMs      *int
	TLSTimeMs      *int
	TTFBMs         *int
	ErrorMessage   *string
}

func ptr(v int) *int {
	return &v
}

func strPtr(v string) *string {
	return &v
}

func HTTP(ctx context.Context, target string, timeout time.Duration) CheckResult {
	client := &http.Client{Timeout: timeout}
	start := time.Now()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return CheckResult{Status: "DOWN", ErrorMessage: strPtr(err.Error())}
	}

	resp, err := client.Do(req)
	elapsed := int(time.Since(start).Milliseconds())
	if err != nil {
		return CheckResult{Status: "DOWN", ResponseTimeMs: ptr(elapsed), ErrorMessage: strPtr(err.Error())}
	}
	defer resp.Body.Close()

	statusCode := resp.StatusCode
	status := "UP"
	if statusCode >= 500 {
		status = "DOWN"
	}

	return CheckResult{
		Status:         status,
		StatusCode:     &statusCode,
		ResponseTimeMs: ptr(elapsed),
		DNSTimeMs:      ptr(0),
		TCPTimeMs:      ptr(0),
		TLSTimeMs:      ptr(0),
		TTFBMs:         ptr(elapsed),
	}
}

func TCP(target string, timeout time.Duration) CheckResult {
	start := time.Now()

	host, port, err := net.SplitHostPort(target)
	if err != nil {
		return CheckResult{Status: "DOWN", ErrorMessage: strPtr(err.Error())}
	}

	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), timeout)
	elapsed := int(time.Since(start).Milliseconds())
	if err != nil {
		return CheckResult{Status: "DOWN", ResponseTimeMs: ptr(elapsed), TCPTimeMs: ptr(elapsed), ErrorMessage: strPtr(err.Error())}
	}
	conn.Close()

	statusCode := 0
	return CheckResult{Status: "UP", StatusCode: &statusCode, ResponseTimeMs: ptr(elapsed), TCPTimeMs: ptr(elapsed)}
}

func ICMPPlaceholder() CheckResult {
	message := "ICMP checks are unavailable in unprivileged runtime"
	return CheckResult{Status: "UNKNOWN", ErrorMessage: &message}
}
