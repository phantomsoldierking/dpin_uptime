FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN go build -o /bin/validator ./cmd/validator

FROM alpine:3.20
RUN adduser -D -g '' appuser
USER appuser
COPY --from=builder /bin/validator /validator
ENTRYPOINT ["/validator"]
