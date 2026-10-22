# syntax=docker/dockerfile:1

# Log shipper (ADR 9 addendum): reads the app container's stdout through the Docker socket and
# sends it to VictoriaLogs. See docs/deploy.md ("Logs").
# Reproducible build: the base is pinned by digest (the tag stays for readers; Docker resolves the
# digest), and Dependabot opens PRs for it (docs/deploy.md, "Pinned images").
FROM timberio/vector:0.60.0-alpine@sha256:1c6a6c4c5c9de08df357fa8adbe72e5a7abcea458b0bd82de0b14ac9b79d5b31
COPY vector.yaml /etc/vector/vector.yaml
CMD ["--config", "/etc/vector/vector.yaml"]
