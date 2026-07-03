# Debug build: -O0 + full debuginfo (Rust) for clean rust-gdb stacks. Selected via the
# debug-build phase.
ARG target_base_image
FROM $target_base_image

COPY --from=libcrs . /libCRS
RUN /libCRS/install.sh

COPY builder/compile_debug /usr/local/bin/compile_debug

CMD ["compile_debug"]
