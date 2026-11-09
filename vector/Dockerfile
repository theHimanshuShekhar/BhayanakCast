# syntax=docker/dockerfile:1

# Log shipper (ADR 9 addendum): reads the app container's stdout through the Docker socket and
# sends it to VictoriaLogs. See docs/deploy.md ("Logs").
# Reproducible build: the base is pinned by digest (the tag stays for readers; Docker resolves the
# digest), and Dependabot opens PRs for it (docs/deploy.md, "Pinned images").
FROM timberio/vector:0.61.0-alpine@sha256:3bb7ed5152910ed51729e256937b1d8a4bf67ff624e9d565e8e5877bffd015c7
COPY vector.yaml /etc/vector/vector.yaml
CMD ["--config", "/etc/vector/vector.yaml"]
