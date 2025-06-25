export const config = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  jwtSecret:
    process.env.JWT_SECRET ??
    "local-dev-jwt-secret-minimum-64-chars-padpadpadpadpadpadpadpadpad",
  jwtExpiry: process.env.JWT_EXPIRY ?? "15m",
  refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY ?? "7d",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  nodeHeartbeatGraceSeconds: Number(process.env.NODE_HEARTBEAT_GRACE_SECONDS ?? 120),
};
