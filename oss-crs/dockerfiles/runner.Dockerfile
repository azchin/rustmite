# =============================================================================
# rustmite runner (run phase)
# =============================================================================
# FROM the framework-provided base_runner_image (matched to the target's base OS) so the
# harness binaries load under a matching glibc/ABI. Installs the full Rust analysis
# toolchain (fuzzing + bolero + Kani/CBMC + Miri + rust-gdb), Node + the Claude Agent SDK,
# libCRS, and the rustmite TypeScript app. Heavy; all engine toolchains are best-effort so
# a transient failure degrades (the crs-* tools/skills detect absence) rather than breaking
# the image.
# =============================================================================
ARG base_runner_image=gcr.io/oss-fuzz-base/base-runner:latest
FROM ${base_runner_image}
ARG crs_version

ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_BREAK_SYSTEM_PACKAGES=1

# System + build deps (cc/linker, openssl, cmake for Kani/CBMC + proc-macro builds).
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg git rsync unzip \
        build-essential pkg-config libssl-dev cmake \
        python3 python3-pip python3-venv \
        gdb \
    && { apt-get install -y --no-install-recommends llvm-18 \
         || echo "WARN: llvm-18 unavailable on this base OS (coverage may degrade)"; } \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 + (belt-and-suspenders) the Claude Code CLI, in case the Agent SDK execs it.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
ARG CLAUDE_CODE_CLI_VERSION=2.1.165
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_CLI_VERSION} || \
    echo "WARN: claude-code CLI global install failed (SDK may still work standalone)"

# CodeQL bundle (rust extractor) for the crs-codeql query tool at run time.
ARG CODEQL_BUNDLE_VERSION=v2.25.6
RUN curl -fsSL \
      "https://github.com/github/codeql-action/releases/download/codeql-bundle-${CODEQL_BUNDLE_VERSION}/codeql-bundle-linux64.tar.gz" \
      | tar -xz -C /opt \
    && /opt/codeql/codeql --version
ENV PATH="/opt/codeql:${PATH}"

# -----------------------------------------------------------------------------
# Rust analysis toolchain. rustup (nightly default, +stable) with the `miri` + `rust-src`
# components -> crs-miri + rust-gdb; `cargo install` cargo-fuzz / cargo-bolero (harness
# build + fuzz/kani engines) and kani-verifier; `cargo kani setup` pulls the CBMC backend.
# Best-effort/guarded; the crs-* tools gate on tool presence.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/opt/codeql:${PATH}
ARG RUST_NIGHTLY=nightly
RUN set -e; \
    ( curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o /tmp/rustup-init.sh \
      && sh /tmp/rustup-init.sh -y --no-modify-path \
            --default-toolchain "${RUST_NIGHTLY}" --profile minimal \
      && rustup toolchain install stable --profile minimal \
      && rustup component add miri rust-src --toolchain "${RUST_NIGHTLY}" \
      && cargo +"${RUST_NIGHTLY}" miri --version \
      && command -v rust-gdb \
      && echo "rustup + miri + rust-gdb OK" ) \
    || echo "WARN: rustup/miri install failed; crs-miri and rust-gdb will be unavailable"; \
    rm -f /tmp/rustup-init.sh; \
    chmod -R a+rwX "$CARGO_HOME" "$RUSTUP_HOME" 2>/dev/null || true

# cargo-fuzz + cargo-bolero (harness build + fuzz/kani drivers). Best-effort.
RUN ( cargo +"${RUST_NIGHTLY}" install cargo-fuzz cargo-bolero \
      && command -v cargo-bolero && echo "cargo-fuzz + cargo-bolero OK" ) \
    || echo "WARN: cargo-fuzz/cargo-bolero install failed"; \
    chmod -R a+rwX "$CARGO_HOME" 2>/dev/null || true

# Kani (model checker) + CBMC backend. Kani ships PREBUILT binaries that are glibc-version
# sensitive, and base_runner_image tracks the target's base OS: ubuntu-20.04 (glibc 2.31) or
# ubuntu-24.04 (glibc 2.39). Modern kani needs glibc>=2.34; kani 0.55.0 is the last release
# whose bundle runs on glibc 2.31. Detect glibc and pick the version accordingly, then VERIFY
# `cargo kani --version` actually RUNS (not just exists) — otherwise crs-kani is unavailable
# (the crs-kani skill gates on tool presence). Best-effort: never fail the image.
ARG KANI_VERSION_MODERN=0.67.0
ARG KANI_VERSION_LEGACY=0.55.0
RUN set -e; \
    minor=$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1 | cut -d. -f2); \
    if [ "${minor:-0}" -ge 34 ]; then KV="${KANI_VERSION_MODERN}"; else KV="${KANI_VERSION_LEGACY}"; fi; \
    echo "detected glibc 2.${minor:-?}; installing kani-verifier ${KV}"; \
    ( cargo install --locked "kani-verifier@${KV}" \
      && cargo kani setup \
      && cargo kani --version \
      && echo "kani ${KV} + CBMC OK (runs on glibc 2.${minor})" ) \
    || echo "WARN: kani ${KV} install/run failed on this glibc; crs-kani will be unavailable"; \
    chmod -R a+rwX "$CARGO_HOME" "$RUSTUP_HOME" 2>/dev/null || true

# Identity for any git operations the agents perform.
RUN git config --global user.email "crs@rustmite.dev" \
    && git config --global user.name "rustmite" \
    && git config --global --add safe.directory '*'

# libCRS (CLI + importable package; we use the CLI from TypeScript).
COPY --from=libcrs . /libCRS
RUN /libCRS/install.sh

# -----------------------------------------------------------------------------
# rustmite TypeScript app: install deps, build to dist/, put the crs-* tool CLIs on PATH.
# Prompt assets (crs/agents, crs/roles, crs/skills, crs/CLAUDE.md*) ship via `COPY crs/`.
WORKDIR /opt/rustmite
ENV RUSTMITE_ROOT=/opt/rustmite
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY crs/ ./crs/
RUN npm run build \
    && npm install -g . \
    && echo "rustmite built; tools: $(ls dist/tools 2>/dev/null | tr '\n' ' ')"

# main.js dispatches on $CRS_ENTRYPOINT (run | run_fuzz_only | idle); the harness name
# arrives as argv[1] or $OSS_CRS_TARGET_HARNESS.
ENTRYPOINT ["node", "/opt/rustmite/dist/main.js"]
