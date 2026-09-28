# ZIP test fixtures

- `sample.zip`: from the old unzip tool at revision `393caa5`, generated with Python `zipfile`. It contains `readme.txt`, `docs/notes.txt`, `docs/sub/deep.txt`, `メモ.txt` (UTF-8 filename), and the explicit `images/` directory entry. Five entries total: four files and one directory.
- `viewer-sample.zip`: from the old zip-viewer tool at revision `e169bd8`, generated with zip.js. It contains a plain entry and a Japanese-named entry in a folder. Renamed to keep the two distinct source archives.

Both archives contain only test-generated content and were copied byte for byte.
