# Split archive fixture

`sample.zip` is an unchanged copy of the split archive fixture at revision `e79b659`.
It contains six STORED entries of seeded pseudo-random content (about 110 KB each),
including `data/日本語.bin`.

Regenerate with `node tests/fixtures/zip/create-split-merge/build-fixture.mjs`.
The fixed seed reproduces entry contents. ZIP metadata dates are not fixed, so a
regenerated archive is not guaranteed to be byte-identical to this copy.
