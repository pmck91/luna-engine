#!/usr/bin/env python3
"""Record native dependencies and enforce the release's runtime assumptions."""
import json
import os
from pathlib import Path
import platform
import re
import struct
import subprocess

from release_common import ROOT, binary_directory, native_target


def windows_imports(path):
    """Read PE32+ import names without requiring Visual Studio command setup."""
    data = path.read_bytes()
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("Expected a Windows PE executable")
    sections, optional_size = struct.unpack_from("<H12xH", data, pe + 6)
    optional = pe + 24
    if struct.unpack_from("<H", data, optional)[0] != 0x20B:
        raise ValueError("Expected a 64-bit Windows executable")
    table = optional + optional_size

    def offset(rva):
        for index in range(sections):
            entry = table + index * 40
            virtual_size, address, raw_size, raw_offset = struct.unpack_from("<IIII", data, entry + 8)
            if address <= rva < address + max(virtual_size, raw_size):
                return raw_offset + rva - address
        raise ValueError(f"Unmapped PE address {rva}")

    import_rva = struct.unpack_from("<I", data, optional + 112 + 8)[0]
    cursor = offset(import_rva)
    names = []
    while any(data[cursor:cursor + 20]):
        name = offset(struct.unpack_from("<I", data, cursor + 12)[0])
        names.append(data[name:data.index(b"\0", name)].decode("ascii"))
        cursor += 20
    return sorted(names)


def inspect_native_dependencies():
    report = {"target": native_target()["target"], "binaries": {}}
    for name in ("luna", "luna-editor"):
        path = binary_directory(native_target()) / (name + (".exe" if os.name == "nt" else ""))
        if os.name == "nt":
            imports = windows_imports(path)
            if any(dll.lower().startswith(("vcruntime", "msvcp", "api-ms-win-crt")) for dll in imports):
                raise ValueError("Windows download unexpectedly depends on the dynamic Visual C++ runtime")
            report["binaries"][name] = imports
        elif platform.system() == "Darwin":
            dependencies = subprocess.check_output(["otool", "-L", str(path)], text=True)
            if any(line.startswith(("\t/opt/", "\t/usr/local/", "\t@rpath/")) for line in dependencies.splitlines()):
                raise ValueError("macOS binary depends on non-system libraries")
            report["binaries"][name] = dependencies
        else:
            dependencies = subprocess.check_output(["ldd", str(path)], text=True)
            symbols = subprocess.check_output(["readelf", "--version-info", str(path)], text=True)
            glibc = sorted({tuple(map(int, item.split('.'))) for item in re.findall(r"GLIBC_(\d+\.\d+)", symbols)})
            if os.environ.get("LUNA_ENFORCE_LINUX_BASELINE") == "1" and glibc[-1] > (2, 35):
                raise ValueError(f"Linux binary requires glibc {glibc[-1]}, newer than the 2.35 baseline")
            report["binaries"][name] = {"libraries": dependencies, "maximum_glibc_symbol": glibc[-1]}
    return report


def main():
    report = inspect_native_dependencies()
    destination = ROOT / "dist/native-dependencies.json"
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(destination.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
