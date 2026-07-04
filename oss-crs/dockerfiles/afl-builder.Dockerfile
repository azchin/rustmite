# afl build: cargo fuzz build linked against the OSS-Fuzz AFL engine driver
# (FUZZING_ENGINE=afl). Script is named rustmite_afl_build (NOT compile_afl) so it does not
# overwrite OSS-Fuzz's /usr/local/bin/compile_afl, which `compile` sources.
ARG target_base_image
FROM $target_base_image

COPY --from=libcrs . /libCRS
RUN /libCRS/install.sh

COPY builder/rustmite_afl_build /usr/local/bin/rustmite_afl_build

CMD ["rustmite_afl_build"]
