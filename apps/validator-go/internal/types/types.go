package types

type JobPayload struct {
	JobID           string   `json:"jobId"`
	WebsiteID       string   `json:"websiteId"`
	URL             string   `json:"url"`
	Region          string   `json:"region"`
	CheckType       string   `json:"checkType"`
	ExpectedStatus  int      `json:"expectedStatus"`
	TimeoutSeconds  int      `json:"timeoutSeconds"`
	ExpectedBody    *string  `json:"expectedBody"`
	AssignedNodeIDs []string `json:"assignedNodeIds"`
}

type PollResponse struct {
	Job *JobPayload `json:"job"`
}

type ResultPayload struct {
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
	Signature      string  `json:"signature"`
}

func IntPtr(v int) *int {
	return &v
}

func StringPtr(v string) *string {
	return &v
}
