#!/usr/bin/env python3
"""Install a verified local Staging ZIP at the existing unpacked Chrome path."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import time
from zipfile import ZipFile

TARGET = Path('/Users/xuyaoyang/x posst/apps/reply-copilot/dist/staging')
EXTENSION_ID = 'kaaehkpihjenlhjjfjcopkjhegmfmchk'
API = 'https://api-staging.x-reply-helper.top'
SITE = 'https://staging.x-reply-helper.top'


def digest(path):
    hashed = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            hashed.update(chunk)
    return hashed.hexdigest()


def identity(path):
    return ''.join(chr(97 + int(char, 16)) for char in hashlib.sha256(os.fsencode(path)).hexdigest()[:32])


def verify_manifest(directory, *, momentum=False):
    manifest = json.loads((directory / 'manifest.json').read_text())
    runtime = (directory / 'config/runtime.js').read_text()
    if manifest.get('key') or manifest.get('host_permissions') != [API + '/*']:
        raise ValueError('Staging manifest identity or host differs')
    if manifest.get('manifest_version') != 3 or 'debugger' in manifest.get('permissions', []):
        raise ValueError('Unexpected manifest or permissions')
    if f'websiteUrl: "{SITE}"' not in runtime or 'channel: "staging"' not in runtime:
        raise ValueError('Staging runtime configuration differs')
    if momentum and not (directory / 'content/momentum.css').is_file():
        raise ValueError('Missing Momentum UI')
    return manifest


def install(archive, expected):
    if not re.fullmatch('[a-f0-9]{64}', expected) or digest(archive) != expected:
        raise ValueError('ZIP SHA-256 differs')
    if not TARGET.is_dir() or TARGET.resolve(strict=True) != TARGET or identity(TARGET) != EXTENSION_ID:
        raise ValueError('Original Staging directory or extension identity differs')
    original = verify_manifest(TARGET)
    if any(path.is_symlink() for path in TARGET.rglob('*')):
        raise ValueError('Unexpected symlink in the existing extension')
    backup = TARGET.with_name(f'.staging-momentum-backup-{time.time_ns()}')
    with tempfile.TemporaryDirectory(prefix='.momentum-staging-', dir=TARGET.parent) as temp:
        extracted = Path(temp) / 'candidate'
        extracted.mkdir()
        with ZipFile(archive) as package:
            entries = package.infolist()
            if len(entries) > 500 or sum(item.file_size for item in entries) > 20_000_000:
                raise ValueError('Unexpected ZIP size')
            seen = set()
            for item in entries:
                path = PurePosixPath(item.filename)
                kind = stat.S_IFMT(item.external_attr >> 16)
                if (not path.parts or path.is_absolute() or '..' in path.parts or '\\' in item.filename
                        or path in seen or kind not in (0, stat.S_IFREG, stat.S_IFDIR)):
                    raise ValueError('Unsafe ZIP entry')
                seen.add(path)
            package.extractall(extracted)
        candidate = verify_manifest(extracted, momentum=True)
        for key in ('permissions', 'optional_permissions', 'optional_host_permissions'):
            if set(candidate.get(key, [])) - set(original.get(key, [])):
                raise ValueError(f'Unexpected permission expansion: {key}')
        TARGET.rename(backup)
        try:
            extracted.rename(TARGET)
        except BaseException:
            backup.rename(TARGET)
            raise
    print(f'Extension ID: {EXTENSION_ID}\nBackup: {backup}')
    print('Reload the existing extension in chrome://extensions, then refresh X.')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('Usage: python3 install-momentum-staging.py ZIP SHA256')
    try:
        install(Path(sys.argv[1]), sys.argv[2])
    except (OSError, ValueError) as error:
        sys.exit(f'Staging install stopped: {error}')
