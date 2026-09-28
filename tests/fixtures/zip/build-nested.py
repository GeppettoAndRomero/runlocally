from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED

folder = Path(__file__).parent
inner = BytesIO()
with ZipFile(inner, 'w', compression=ZIP_STORED) as archive:
    archive.writestr('inside.txt', 'nested content\n')
with ZipFile(folder / 'nested.zip', 'w', compression=ZIP_STORED) as archive:
    archive.writestr('inner.zip', inner.getvalue())
