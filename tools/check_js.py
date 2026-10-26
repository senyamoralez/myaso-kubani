#!/usr/bin/env python3
"""Проверяет синтаксис всех встроенных скриптов site/index.html (нужен Node.js). Падает, если скрипт сломан."""
import os, re, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(ROOT, 'site', 'index.html'), encoding='utf-8').read()
bad = 0
for i, m in enumerate(re.finditer(r'<script([^>]*)>([\s\S]*?)</script>', s)):
    if 'src=' in m.group(1) or not m.group(2).strip():
        continue
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(m.group(2))
    r = subprocess.run(['node', '--check', f.name], capture_output=True, text=True)
    os.unlink(f.name)
    if r.returncode:
        bad += 1
        print('Ошибка в скрипте №', i + 1, '\n', r.stderr[:800])
print('Скрипты страницы: ' + ('ОШИБКИ' if bad else 'ok'))
sys.exit(1 if bad else 0)
