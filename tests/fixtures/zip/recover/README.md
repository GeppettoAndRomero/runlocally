# Recovery ZIP fixtures

These archives were copied byte for byte from the old recover-zip tool at revision `502c74a`.
The SHA-256 values below are grouped in 16-character blocks; remove the colons to obtain the conventional form.

| File | SHA-256 | State and expected test result |
| --- | --- | --- |
| `good.zip` | `64e10455cc355092:cd30c111b60b3c26:e316258798bca097:61148cace74501a4` | Readable central directory; all three files recover intact through the central path. |
| `bad-central.zip` | `8a6ebdde14d35cb1:0085e8b37fddbe5a:67c26b626e480945:31797f854f3bcd43` | Unreadable central directory; local-header scanning finds entries, including readable `hello.txt`. |
| `crc-broken.zip` | `9270e94d0f441c48:214bdc53a90a1148:b954a8b7c26d6925:2cc7ef91bc02e7bd` | Readable central directory with a damaged `broken.txt`; its bytes are retained as broken while the other two files recover intact. |

The recovery tests assert these results. No archive reconstruction is expected.
