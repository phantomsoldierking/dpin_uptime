package signer

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

type signablePayload struct {
	JobID          string  `json:"jobId"`
	NodeID         string  `json:"nodeId"`
	WebsiteID      string  `json:"websiteId"`
	Region         string  `json:"region"`
	Status         string  `json:"status"`
	StatusCode     *int    `json:"statusCode"`
	ResponseTimeMs *int    `json:"responseTimeMs"`
	DNSTimeMs      *int    `json:"dnsTimeMs"`
	TCPTimeMs      *int    `json:"tcpTimeMs"`
	TLSTimeMs      *int    `json:"tlsTimeMs"`
	TTFBMs         *int    `json:"ttfbMs"`
	ErrorMessage   *string `json:"errorMessage"`
	Timestamp      int64   `json:"timestamp"`
}

func Sign(
	secret string,
	jobID string,
	nodeID string,
	websiteID string,
	region string,
	status string,
	statusCode *int,
	responseTimeMs *int,
	dnsTimeMs *int,
	tcpTimeMs *int,
	tlsTimeMs *int,
	ttfbMs *int,
	errorMessage *string,
	timestamp int64,
) (string, error) {
	payload := signablePayload{
		JobID:          jobID,
		NodeID:         nodeID,
		WebsiteID:      websiteID,
		Region:         region,
		Status:         status,
		StatusCode:     statusCode,
		ResponseTimeMs: responseTimeMs,
		DNSTimeMs:      dnsTimeMs,
		TCPTimeMs:      tcpTimeMs,
		TLSTimeMs:      tlsTimeMs,
		TTFBMs:         ttfbMs,
		ErrorMessage:   errorMessage,
		Timestamp:      timestamp,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	h := hmac.New(sha256.New, []byte(secret))
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil)), nil
}
