"""Fail when tracked text files contain personal paths or e-mail addresses.

Usage: python tools/check_private_paths.py
The repository and site are public (AGENTS.md: no user-folder, save, Downloads or Temp paths,
credentials or account identifiers). Placeholders such as %USERPROFILE%, <user> or PATH_TO_GAME
are fine. CI runs this beside the link check.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip())
SEP = r'[\\/]+'
PATTERNS = [
    # Placeholders and well-known non-personal accounts (Windows Sandbox, CI runners, test fixtures) are fine.
    ('user folder', re.compile(r'[A-Za-z]:' + SEP + r'Users' + SEP + r'(?![<%{$]|(?:Public|Default|name|user|USERNAME|someone|example|WDAGUtilityAccount|runneradmin)\b)[^\\/\s"\'`<>]+', re.I)),
    ('personal media folder', re.compile(r'Media' + SEP + r'Other' + SEP, re.I)),
    # A real address: letter-led domain with an alphabetic TLD not followed by a call or index, so `pkg@1.2.3`,
    # `A@b.x`, Python's matrix `@` (`a@np.eye(4)`) and ArchiveXL references (`ash_brown@long.mi`) don't match.
    ('e-mail address', re.compile(r'\b[A-Za-z][\w.+-]*@(?!example\.(?:com|org|net)\b|users\.noreply\.github\.com\b|anthropic\.com\b)[A-Za-z][\w-]*(?:\.[\w-]+)*\.(?!(?:mi|mt|mesh|app|ent|xbm|morphtarget|anims|inkcc)\b)[A-Za-z]{2,24}\b(?![(\[.])')),
]
# Third-party licence texts and lockfiles carry maintainers' addresses by design.
EXEMPT = re.compile(r'(^|/)(LICENSE[^/]*|THIRD_PARTY_NOTICES[^/]*|NOTICE[^/]*|[^/]*\.lock|bun\.lockb?|package-lock\.json|package-content-scan\.test\.ts|knowledge\.test\.ts|privacy\.ts|check_private_paths\.py)$', re.I)
TEXT = re.compile(r'\.(md|json|ts|js|mjs|py|ps1|txt|html|css|yml|yaml|toml|ini|xl|lua|reds|cpp|hpp|h|cmake|svg)$|(^|/)CMakeLists\.txt$', re.I)


def main():
    files = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split('\0')
    findings = []
    for rel in files:
        if not rel or not TEXT.search(rel) or EXEMPT.search(rel):
            continue
        try:
            text = (ROOT / rel).read_text(encoding='utf-8')
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        for number, line in enumerate(text.splitlines(), 1):
            for kind, pattern in PATTERNS:
                if pattern.search(line):
                    findings.append(f'{rel}:{number}: {kind}')
    for finding in findings:
        print(finding)
    print(f'{len(findings)} private-path finding(s) in tracked text files.')
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main())
