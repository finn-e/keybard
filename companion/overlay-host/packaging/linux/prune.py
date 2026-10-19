"""Drop the parts of PySide6 that Keybard Overlay never loads, to shrink the package.

Keeps the Python modules the overlay imports, the Qt plugins a desktop session uses,
and every Qt library those link against (followed with ldd), and removes the rest:
Qt Designer and the other tools, QML files, 3D, multimedia, charts and so on.

    python3 prune.py <site-packages>/PySide6
"""
from pathlib import Path
import re
import shutil
import subprocess
import sys

MODULES = ('QtCore', 'QtGui', 'QtWidgets', 'QtNetwork', 'QtWebEngineCore', 'QtWebEngineWidgets',
           'QtWebChannel', 'QtPrintSupport', 'QtDBus', 'QtOpenGL', 'QtPositioning', 'QtQuick',
           'QtQml', 'QtQuickWidgets')
PLUGINS = ('platforms', 'platformthemes', 'platforminputcontexts', 'imageformats', 'iconengines',
           'xcbglintegrations', 'egldeviceintegrations', 'generic', 'tls', 'networkinformation',
           'wayland-decoration-client', 'wayland-graphics-integration-client', 'wayland-shell-integration')


def qt_deps(path, lib):
    out = subprocess.run(['ldd', str(path)], capture_output=True, text=True,
                         env={'LD_LIBRARY_PATH': str(lib)}).stdout
    lib = lib.resolve()
    return {m.group(1) for m in re.finditer(r'^\s*(\S+) => (\S+)', out, re.M) if Path(m.group(2)).resolve().parent == lib}


def prune(pyside):
    qt = pyside / 'Qt'
    lib = qt / 'lib'
    keep_modules = {p for p in pyside.glob('*.abi3.so') if p.name.split('.')[0] in MODULES}
    for p in pyside.glob('*.abi3.so'):
        if p not in keep_modules: p.unlink()
    for p in pyside.glob('*.pyi'):
        if p.name.split('.')[0] not in MODULES: p.unlink()
    for d in (qt / 'plugins').iterdir():
        if d.name not in PLUGINS: shutil.rmtree(d)
    roots = list(keep_modules) + list((qt / 'plugins').rglob('*.so')) + [qt / 'libexec' / 'QtWebEngineProcess']
    needed, todo = set(), list(roots)
    while todo:
        for name in qt_deps(todo.pop(), lib) - needed:
            needed.add(name)
            todo.append(lib / name)
    for p in lib.iterdir():
        if p.is_file() and p.name not in needed and '.so' in p.name: p.unlink()
    for name in ('qml', 'metatypes', 'modules', 'typesystems', 'include', 'scripts', 'doc'):
        shutil.rmtree(qt / name, ignore_errors=True)
        shutil.rmtree(pyside / name, ignore_errors=True)
    translations = qt / 'translations'
    for p in translations.iterdir():
        if p.name != 'qtwebengine_locales':
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    # Designer, Linguist, Assistant and friends (executables at the package root and in libexec).
    for p in list(pyside.iterdir()) + list((qt / 'libexec').iterdir()):
        if p.is_file() and p.suffix == '' and p.name not in ('QtWebEngineProcess', 'qt.conf'): p.unlink()
    return sorted(needed)


if __name__ == '__main__':
    print('\n'.join(prune(Path(sys.argv[1]))))
