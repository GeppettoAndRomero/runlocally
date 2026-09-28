# syntax=docker/dockerfile-upstream:master-labs
# Lean libarchive.js build; JavaScript glue and WASM must be built together.
FROM emscripten/emsdk:3.1.52 AS builder

WORKDIR /opt

ENV LIBARCHIVE_VERSION=3.7.2
ENV ZLIB_VERSION=1.3
ENV XZ_VERSION=5.2.11
ENV BZIP2_VERSION=1.0.8
ENV LIBARCHIVEJS_REF=v2.0.2

ADD https://github.com/libarchive/libarchive/releases/download/v${LIBARCHIVE_VERSION}/libarchive-${LIBARCHIVE_VERSION}.zip /opt
ADD https://github.com/madler/zlib/releases/download/v${ZLIB_VERSION}/zlib13.zip /opt
ADD https://github.com/tukaani-project/xz/releases/download/v${XZ_VERSION}/xz-${XZ_VERSION}.tar.gz /opt
ADD https://sourceware.org/pub/bzip2/bzip2-${BZIP2_VERSION}.tar.gz /opt

RUN unzip /opt/libarchive-${LIBARCHIVE_VERSION}.zip && rm /opt/libarchive-${LIBARCHIVE_VERSION}.zip && \
    unzip /opt/zlib13.zip && rm /opt/zlib13.zip && \
    tar xf /opt/xz-${XZ_VERSION}.tar.gz && rm /opt/xz-${XZ_VERSION}.tar.gz && \
    tar xf /opt/bzip2-${BZIP2_VERSION}.tar.gz && rm /opt/bzip2-${BZIP2_VERSION}.tar.gz

RUN apt-get update && apt-get install -y locate vim file git

# libarchive.js's own repo (unmodified TS/JS source + wrapper glue) — pinned to the
# exact tag this application depends on. Used for: lib/wrapper/main.c + lib/tools/lib.exports
# (the emcc invocation inputs) AND, later, its own `npm run build` (rollup) to produce
# a JS bundle matched to our rebuilt .wasm (see COMPATIBILITY NOTE above).
RUN git clone --depth=1 --branch ${LIBARCHIVEJS_REF} https://github.com/nika-begiashvili/libarchivejs.git /opt/libarchivejs

# NOTE: deliberately no OpenSSL ADD/RUN block here (the entire point of this rebuild).
ENV CPPFLAGS="-I/usr/local/include/ -I/opt/zlib-1.3 -I/opt/bzip2-1.0.8"
ENV LDLIBS="-lz -lbz2"
ENV LDFLAGS="-L/usr/local/lib"

# Compile zlib to LLVM
WORKDIR /opt/zlib-1.3
RUN emconfigure ./configure --static && emmake make && emmake make install

# Compile bzip2 to LLVM (kept — see header comment)
WORKDIR /opt/bzip2-1.0.8
RUN emmake make && emmake make install

# Compile LZMA to LLVM
WORKDIR /opt/xz-${XZ_VERSION}
RUN emconfigure ./configure --disable-assembler --enable-threads=no --enable-static=yes 2>&1 | tee conf.out && \
    emmake make 2>&1 | tee make.out && emmake make install

# Compile libarchive to LLVM — --without-openssl is the fix for the lean build.
ENV EMCC_CFLAGS="-s USE_BZIP2=1"
WORKDIR /opt/libarchive-${LIBARCHIVE_VERSION}
RUN emconfigure ./configure --enable-static --disable-shared --enable-bsdtar=static --enable-bsdcat=static \
    --enable-bsdcpio=static --enable-posix-regex-lib=libc \
    --disable-xattr --disable-acl --without-nettle --without-lzo2 \
    --without-cng --without-lz4 \
    --without-xml2 --without-expat \
    --without-openssl 2>&1 | tee conf.out && \
    emmake make 2>&1 | tee make.out && emmake make install
ENV EMCC_CFLAGS=""

# Build-time assert: OpenSSL must NOT be detected in libarchive's generated config.h.
# (The real, binary-level verification happens afterward via `strings` on the linked
# .wasm — this just fails the Docker build early/loudly if configure disagrees.)
# grep exits 0 on a match, 1 on no match and >1 on a read error; only 1 may pass.
RUN status=0; \
    grep -E "^#define HAVE_LIBCRYPTO 1|^#define HAVE_OPENSSL_EVP_H 1" \
      /opt/libarchive-${LIBARCHIVE_VERSION}/config.h || status=$?; \
    if [ "$status" -eq 0 ]; then echo "ERROR: OpenSSL detected in libarchive config.h"; exit 1; fi; \
    if [ "$status" -ne 1 ]; then echo "ERROR: could not read libarchive config.h"; exit 1; fi; \
    echo "OK: OpenSSL not detected in libarchive config.h"

# Link the new .wasm — identical emcc invocation to libarchive.js's own
# lib/tools/build.sh, minus libssl.a/libcrypto.a (never built, so never linked).
WORKDIR /opt/libarchivejs/lib/build
RUN emcc /opt/libarchivejs/lib/wrapper/main.c -c -I /usr/local/include/ -o main.o && \
    emcc main.o /usr/local/lib/libarchive.a /usr/local/lib/liblzma.a \
      -o libarchive.js \
      -s USE_ZLIB=1 -s USE_BZIP2=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=libarchive -s WASM=1 -O3 -s ALLOW_MEMORY_GROWTH=1 \
      -s EXPORTED_RUNTIME_METHODS='["cwrap","allocate"]' \
      -s EXPORTED_FUNCTIONS=@/opt/libarchivejs/lib/tools/lib.exports -s ERROR_ON_UNDEFINED_SYMBOLS=0 && \
    ls -la /opt/libarchivejs/lib/build

# Drop the new .wasm/.js into libarchive.js's own source tree (overwriting the ones
# the upstream project includes) and run ITS OWN unmodified `npm run build` (rollup) so the
# resulting dist/ bundle is internally consistent with the new .wasm — see the
# COMPATIBILITY NOTE at the top of this file for why this step is necessary.
RUN cp /opt/libarchivejs/lib/build/libarchive.js /opt/libarchivejs/src/webworker/wasm-gen/libarchive.js && \
    cp /opt/libarchivejs/lib/build/libarchive.wasm /opt/libarchivejs/src/webworker/wasm-gen/libarchive.wasm
WORKDIR /opt/libarchivejs
# libarchive.js's devDependencies include `puppeteer` (used only for ITS OWN browser
# test suite, which we never run) — puppeteer's postinstall step downloads a full
# Chromium build, which hung indefinitely in this container (no reachable network
# path to the download CDN from inside this build), stalling `npm install` for hours
# with no error/timeout of its own. We only need `rollup` (+ its plugins) to run
# `npm run build`, so skip that download entirely.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm install --no-audit --no-fund && npm run build && ls -la dist

FROM scratch AS export
COPY --from=builder /opt/libarchivejs/dist/libarchive.wasm /libarchive.wasm
COPY --from=builder /opt/libarchivejs/dist/worker-bundle.js /worker-bundle.js
COPY --from=builder /opt/libarchivejs/dist/worker-bundle-node.mjs /worker-bundle-node.mjs
COPY --from=builder /opt/libarchivejs/dist/libarchive.js /libarchive.js
COPY --from=builder /opt/libarchivejs/dist/libarchive-node.mjs /libarchive-node.mjs
COPY --from=builder /opt/libarchive-3.7.2/conf.out /libarchive-configure.log
