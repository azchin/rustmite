# Coverage build: llvm-cov-instrumented harnesses. Selected via the coverage-build phase.
ARG target_base_image
FROM $target_base_image

COPY --from=libcrs . /libCRS
RUN /libCRS/install.sh

COPY builder/compile_coverage /usr/local/bin/compile_coverage

CMD ["compile_coverage"]
