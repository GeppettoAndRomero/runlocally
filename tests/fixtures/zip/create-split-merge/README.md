# Split archive fixture

`sample.zip` is copied unchanged from 旧 split-zip ツール at revision `e79b659`.
It has six STORED entries of seeded pseudo-random content (~110 KB each), including
`data/日本語.bin`. The generator reproduces entry content, but ZIP metadata dates are
not fixed, so regenerating does not guarantee byte-identical ZIP output.

Run `node tests/fixtures/zip/create-split-merge/build-fixture.mjs` to regenerate.
