# ZIP rewrite fixtures

- `remove-sample.zip` comes from the old remove-from-zip tool at `f263393`. It was generated in that repository with zip.js and Unicode filenames. It contains `a.txt` (`alpha`), `b.txt` (`bravo`), `docs/`, `docs/guide.txt`, and `写真/メモ.txt`. The destination name distinguishes it from the shared ZIP fixture.
- `mojibake.zip` comes from the old zip-filename-fix tool at `9143956`. It was handcrafted there with one CP932/Shift_JIS filename, no UTF-8 flag, and the text `これは日本語のメモです。`. Its destination name is unchanged.

Both files were copied byte for byte for the rewrite regression tests. They contain no third-party content.
