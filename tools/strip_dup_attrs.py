"""Strip <attr> declarations from the decoded app res that the real
dependencies already declare, using a real XML parser (nesting-safe)."""
import os, re, glob, zipfile
from lxml import etree

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
PROJ = os.path.join(ROOT, 'analysis/SGP_Tactical_AndroidStudio')
CACHE = os.path.expanduser('~/.gradle/caches/modules-2/files-2.1')

deps = [l.strip() for l in open('/tmp/deps.txt') if l.strip().count(':') == 2]
dep_attrs = set()
for coord in deps:
    g, a, v = coord.split(':')
    for f in glob.glob(os.path.join(CACHE, g, a, v, '*', '*.aar')):
        with zipfile.ZipFile(f) as z:
            for n in z.namelist():
                if n.startswith('res/values') and n.endswith('.xml'):
                    for m in re.finditer(r'<attr\b[^>]*?\bname="([^"]+)"',
                                         z.read(n).decode('utf-8', 'ignore')):
                        dep_attrs.add(m.group(1))

for p in glob.glob(os.path.join(PROJ, 'capacitor-android/src/main/res/values*/*.xml')):
    for m in re.finditer(r'<attr\b[^>]*?\bname="([^"]+)"', open(p, encoding='utf-8').read()):
        dep_attrs.add(m.group(1))

print('dependency attrs:', len(dep_attrs))

parser = etree.XMLParser(remove_blank_text=False, huge_tree=True)
removed_total = 0
for p in glob.glob(os.path.join(PROJ, 'app/src/main/res/values*/*.xml')):
    try:
        tree = etree.parse(p, parser)
    except etree.XMLSyntaxError as e:
        print('SKIP (parse error)', os.path.basename(p), e)
        continue
    changed = 0
    doomed = []
    for el in tree.iter():
        if not isinstance(el.tag, str) or etree.QName(el).localname != 'attr':
            continue
        if el.get('name') in dep_attrs:
            doomed.append(el)
    for el in doomed:
        parent = el.getparent()
        if parent is not None:
            parent.remove(el)
            changed += 1
    if changed:
        tree.write(p, encoding='utf-8', xml_declaration=True)
        removed_total += changed

print('attr declarations removed:', removed_total)
