"""Fail when tracked text files contain personal paths or e-mail addresses.

Usage: python tools/check_private_paths.py [--self-test]
The repository and site are public (AGENTS.md: no user-folder, save, Downloads or Temp paths,
credentials or account identifiers). Placeholders such as %USERPROFILE%, <user> or PATH_TO_GAME
are fine. The patterns and test vectors live in tools/private-data.json, shared with the site's
privacy check and the packaged-app content scan. Every tracked file that reads as UTF-8 text is
scanned, whatever its extension. CI runs this and its self-test beside the link check.
Findings name the file, line and kind only, never the matched text: CI logs are public.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

DATA = json.loads((Path(__file__).resolve().parent / 'private-data.json').read_text(encoding='utf-8'))


def _compile(spec):
    return re.compile(spec['source'], re.I if 'i' in spec['flags'] else 0)


USER_PATHS = [_compile(spec) for spec in DATA['userPaths']]
PLACEHOLDER_USER = _compile(DATA['placeholderUser'])
EMAIL = _compile(DATA['email'])
ROLE_LOCAL = _compile(DATA['emailExemptions']['local'])
NOT_ADDRESS_DOMAINS = [_compile(spec) for spec in DATA['emailExemptions']['domains']]

USER_FOLDER, MEDIA_FOLDER, EMAIL_ADDRESS = 'user folder', 'personal media folder', 'e-mail address'
KINDS = frozenset({USER_FOLDER, MEDIA_FOLDER, EMAIL_ADDRESS})
# A repository-only rule: the reference collection's private media folder.
MEDIA = re.compile(r'Media[\\/]+Other[\\/]', re.I)

# Specific repository paths exempt from specific kinds only. The shared vectors and the tests that
# plant personal data on purpose carry it by design; nothing else is exempt.
EXEMPT = [
    ('tools/private-data.json', {USER_FOLDER, EMAIL_ADDRESS}),
    ('projects/xf-studio/authoring/desktop/tests/package-content-scan.test.ts', {USER_FOLDER, EMAIL_ADDRESS}),
    ('projects/xf-studio/site/tests/knowledge.test.ts', {USER_FOLDER, EMAIL_ADDRESS}),
    ('tools/check_private_paths.py', {MEDIA_FOLDER}),  # its self-test case
]
# Binary formats are never read; everything else that decodes as UTF-8 without NUL bytes is text.
BINARY = re.compile(r'\.(png|jpe?g|gif|webp|avif|ico|bmp|tga|dds|glb|gltf|bin|blend|zip|7z|gz|zst|tar|exe|dll|pdb|'
                    r'so|dylib|woff2?|ttf|otf|pdf|wasm|archive|sqlite|db|lockb)$', re.I)


def personal_data(line):
    """The kinds of personal data in one line of text, as (kind, start, end), overlaps dropped."""
    found = []

    def add(kind, start, end):
        if not any(start < e and s < end for _, s, e in found):
            found.append((kind, start, end))

    for pattern in USER_PATHS:
        for match in pattern.finditer(line):
            if not PLACEHOLDER_USER.search(match.group(1)):
                add(USER_FOLDER, match.start(), match.end())
    for match in MEDIA.finditer(line):
        add(MEDIA_FOLDER, match.start(), match.end())
    for match in EMAIL.finditer(line):
        local, domain = match.group(1), match.group(2)
        if ROLE_LOCAL.search(local) or any(rule.search(domain) for rule in NOT_ADDRESS_DOMAINS):
            continue
        add(EMAIL_ADDRESS, match.start(), match.end())
    return found


def exempt_kinds(rel):
    """The kinds a repository path is exempt from (none for almost every file)."""
    kinds = set()
    for path, exempt in EXEMPT:
        if rel == path:
            kinds |= exempt
    return kinds


def is_scanned(rel):
    return not BINARY.search(rel)


def scan_text(rel, text):
    exempt = exempt_kinds(rel)
    findings = []
    for number, line in enumerate(text.splitlines(), 1):
        for kind in sorted({kind for kind, _, _ in personal_data(line)} - exempt):
            findings.append(f'{rel}:{number}: {kind}')
    return findings


def main():
    root = Path(subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip())
    files = subprocess.run(['git', 'ls-files', '-z'], cwd=root, capture_output=True, text=True, check=True).stdout.split('\0')
    findings = []
    for rel in files:
        if not rel or not is_scanned(rel):
            continue
        try:
            raw = (root / rel).read_bytes()
        except (FileNotFoundError, IsADirectoryError):
            continue
        if b'\0' in raw:
            continue
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            continue
        findings += scan_text(rel, text)
    for finding in findings:
        print(finding)
    print(f'{len(findings)} private-path finding(s) in tracked text files.')
    return 1 if findings else 0


def self_test():
    """The shared vectors plus this checker's own path rules. Prints failures without the vectors' text."""
    failures = []

    def expect(condition, label):
        if not condition:
            failures.append(label)

    vectors = DATA['vectors']
    for index, text in enumerate(vectors['userPath']):
        expect([kind for kind, _, _ in personal_data(text)] == [USER_FOLDER], f'vectors.userPath[{index}] not flagged once as a user folder')
    for index, text in enumerate(vectors['email']):
        expect([kind for kind, _, _ in personal_data(text)] == [EMAIL_ADDRESS], f'vectors.email[{index}] not flagged once as an address')
    for index, text in enumerate(vectors['clean']):
        expect(personal_data(text) == [], f'vectors.clean[{index}] flagged')
    # Repository-only rule.
    expect([kind for kind, _, _ in personal_data('see Media/Other/clip.mp4')] == [MEDIA_FOLDER], 'media folder not flagged')
    # Exemptions are exact paths and exact kinds: the same file name elsewhere is scanned.
    planted = vectors['userPath'][0] + '\n' + vectors['email'][0]
    expect(scan_text('tools/private-data.json', planted) == [], 'shared vectors file not exempt')
    expect(len(scan_text('docs/private-data.json', planted)) == 2, 'exemption matched by file name elsewhere')
    expect(len(scan_text('projects/other/tests/knowledge.test.ts', planted)) == 2, 'test exemption matched by file name elsewhere')
    expect(len(scan_text('LICENSE', planted)) == 2, 'a licence file is exempt')
    # File selection: anything but binary formats.
    for rel in ['a/Program.cs', 'a/Bridge.csproj', 'a/version.rc', '.gitignore', 'LICENSE', 'a/b.ts', 'a/c.md', 'bun.lock', 'x/Makefile']:
        expect(is_scanned(rel), f'{rel} not scanned')
    for rel in ['a/icon.png', 'a/app.exe', 'a/head.glb', 'a/font.woff2']:
        expect(not is_scanned(rel), f'{rel} scanned')
    for failure in failures:
        print(f'FAIL {failure}')
    total = len(vectors['userPath']) + len(vectors['email']) + len(vectors['clean'])
    print(f'self-test: {len(failures)} failure(s); {total} shared vectors.')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(self_test() if '--self-test' in sys.argv[1:] else main())
