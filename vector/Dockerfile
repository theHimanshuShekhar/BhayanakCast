# syntax=docker/dockerfile:1

# Log shipper (ADR 9 addendum): reads the app container's stdout through the Docker socket and
# sends it to VictoriaLogs. See docs/deploy.md ("Logs").
# Reproducible build: the base is pinned by digest (the tag stays for readers; Docker resolves the
# digest), and Dependabot opens PRs for it (docs/deploy.md, "Pinned images").
FROM timberio/vector:0.62.0-alpine@sha256:149c77c09aabf16a3aa543abf9cea2e2152c1d9a7d4a45669fe7ad05f4ed8b27
COPY vector.yaml /etc/vector/vector.yaml
CMD ["--config", "/etc/vector/vector.yaml"]
