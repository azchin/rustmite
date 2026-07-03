# afl build: cargo fuzz build linked against the OSS-Fuzz afl engine driver
# (FUZZING_ENGINE=afl). The base image already ships the afl driver + runner.
ARG target_base_image
FROM $target_base_image

COPY --from=libcrs . /libCRS
RUN /libCRS/install.sh

COPY builder/compile_afl /usr/local/bin/compile_afl

CMD ["compile_afl"]
