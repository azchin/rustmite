# honggfuzz build: cargo fuzz build linked against the OSS-Fuzz honggfuzz engine driver
# (FUZZING_ENGINE=honggfuzz). The base image already ships the honggfuzz driver + runner.
ARG target_base_image
FROM $target_base_image

COPY --from=libcrs . /libCRS
RUN /libCRS/install.sh

COPY builder/compile_honggfuzz /usr/local/bin/compile_honggfuzz

CMD ["compile_honggfuzz"]
