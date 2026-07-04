# honggfuzz build: cargo fuzz build linked against the OSS-Fuzz honggfuzz engine driver.
# Script named rustmite_hf_build (NOT compile_honggfuzz) to avoid overwriting OSS-Fuzz's
# /usr/local/bin/compile_honggfuzz, which `compile` sources.
ARG target_base_image
FROM $target_base_image

COPY --from=libcrs . /libCRS
RUN /libCRS/install.sh

COPY builder/rustmite_hf_build /usr/local/bin/rustmite_hf_build

CMD ["rustmite_hf_build"]
