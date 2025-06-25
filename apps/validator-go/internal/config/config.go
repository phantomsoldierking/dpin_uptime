package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	HubAPIURL         string
	NodeID            string
	NodeRegion        string
	NodeAPIKey        string
	NodeHMACSecret    string
	PollInterval      time.Duration
	HeartbeatInterval time.Duration
	CheckTimeout      time.Duration
}

func getEnv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func getEnvInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func Load() Config {
	pollSeconds := getEnvInt("POLL_INTERVAL_SECONDS", 5)
	heartbeatSeconds := getEnvInt("HEARTBEAT_INTERVAL_SECONDS", 30)
	checkTimeout := getEnvInt("CHECK_TIMEOUT_SECONDS", 10)

	return Config{
		HubAPIURL:         getEnv("HUB_API_URL", "http://localhost:3001/v1"),
		NodeID:            getEnv("NODE_ID", "validator-us-east-dev"),
		NodeRegion:        getEnv("NODE_REGION", "us-east-1"),
		NodeAPIKey:        os.Getenv("NODE_API_KEY"),
		NodeHMACSecret:    os.Getenv("NODE_HMAC_SECRET"),
		PollInterval:      time.Duration(pollSeconds) * time.Second,
		HeartbeatInterval: time.Duration(heartbeatSeconds) * time.Second,
		CheckTimeout:      time.Duration(checkTimeout) * time.Second,
	}
}
