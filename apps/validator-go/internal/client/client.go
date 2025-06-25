package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/phantomsoldierking/dpin_uptime/apps/validator-go/internal/types"
)

type Client struct {
	baseURL    string
	nodeID     string
	nodeAPIKey string
	http       *http.Client
}

func New(baseURL, nodeID, nodeAPIKey string) *Client {
	return &Client{
		baseURL:    baseURL,
		nodeID:     nodeID,
		nodeAPIKey: nodeAPIKey,
		http:       &http.Client{Timeout: 20 * time.Second},
	}
}

func (c *Client) addAuthHeaders(req *http.Request) {
	req.Header.Set("x-node-id", c.nodeID)
	req.Header.Set("x-node-api-key", c.nodeAPIKey)
	req.Header.Set("Content-Type", "application/json")
}

func (c *Client) Heartbeat(ctx context.Context, metadata map[string]any) error {
	payload := map[string]any{
		"nodeId":   c.nodeID,
		"metadata": metadata,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/nodes/heartbeat", bytes.NewReader(body))
	if err != nil {
		return err
	}
	c.addAuthHeaders(req)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("heartbeat failed: status=%d", resp.StatusCode)
	}

	return nil
}

func (c *Client) Poll(ctx context.Context) (*types.JobPayload, error) {
	endpoint := fmt.Sprintf("%s/jobs/poll?nodeId=%s", c.baseURL, url.QueryEscape(c.nodeID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	c.addAuthHeaders(req)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("poll failed: status=%d", resp.StatusCode)
	}

	var out types.PollResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}

	return out.Job, nil
}

func (c *Client) SubmitResult(ctx context.Context, payload types.ResultPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/results", bytes.NewReader(body))
	if err != nil {
		return err
	}
	c.addAuthHeaders(req)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("submit failed: status=%d", resp.StatusCode)
	}

	return nil
}
