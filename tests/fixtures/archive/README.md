# Archive fixtures

Seven fixtures were copied unchanged from the prior archive test suite. `sample.tar`, `sample.tar.gz`, and `sample.7z` contain `readme.txt` (26 bytes, `hello from extract-rar-7z\n`) and `docs/notes.txt` (14 bytes, `a nested note\n`). They were generated with `tar` and `bsdtar`. `empty.tar` is an empty tar used to check the no-files result.

The three RAR fixtures originate from the [libarchive test suite at v3.7.2](https://github.com/libarchive/libarchive/tree/v3.7.2/libarchive/test), under BSD-3-Clause. They were decoded from the upstream `.uu` files:

- `rar4-sample.rar`: `test_read_format_rar.rar.uu`; root and nested files, a symlink, and an empty directory.
- `rar5-helloworld.rar`: `test_read_format_rar5_stored.rar.uu`; one 29-byte file.
- `rar-encrypted.rar`: `test_read_format_rar_encryption_data.rar.uu`; encrypted data with readable names.

The original RAR fixtures are used to test reading only. No password is stored here.
