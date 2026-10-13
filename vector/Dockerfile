# syntax=docker/dockerfile:1

# Log shipper (ADR 9 addendum): reads the app container's stdout through the Docker socket and
# sends it to VictoriaLogs. See docs/deploy.md ("Logs").
# Reproducible build: the base is pinned by digest (the tag stays for readers; Docker resolves the
# digest), and Dependabot opens PRs for it (docs/deploy.md, "Pinned images").
FROM timberio/vector:0.59.0-alpine@sha256:0e36bc2a290039e9b6a5e92f04bd2f133223506f72d09682c1df16c015172b7a
COPY vector.yaml /etc/vector/vector.yaml
CMD ["--config", "/etc/vector/vector.yaml"]
