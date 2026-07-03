# CodeQL build: create a CodeQL database (rust extractor) for semantic queries. Selected
# via the codeql-build phase.
ARG target_base_image
FROM $target_base_image

# curl + ca-certificates for fetching the CodeQL bundle (installed defensively).
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# CodeQL CLI bundle (CLI + language extractors incl. `rust` + precompiled query packs).
# Pinned; unpacks to /opt/codeql/.
ARG CODEQL_BUNDLE_VERSION=v2.25.6
RUN curl -fsSL \
      "https://github.com/github/codeql-action/releases/download/codeql-bundle-${CODEQL_BUNDLE_VERSION}/codeql-bundle-linux64.tar.gz" \
      | tar -xz -C /opt \
    && /opt/codeql/codeql --version
ENV PATH="/opt/codeql:${PATH}"

COPY --from=libcrs . /libCRS
RUN /libCRS/install.sh

COPY builder/compile_codeql /usr/local/bin/compile_codeql

CMD ["compile_codeql"]
