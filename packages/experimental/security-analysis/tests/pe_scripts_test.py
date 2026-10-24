"""PE helpers against synthetic PE32/PE32+ files; no sample code is executed."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "resources/analysis-scripts/reverse/pe.py"


def fixture(bits=32):
    data = bytearray(0x620)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 0x3c, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    optional_size = 0xe0 if bits == 32 else 0xf0
    struct.pack_into("<HHIIIHH", data, 0x84, 0x14c if bits == 32 else 0x8664, 1, 0, 0, 0, optional_size, 2)
    opt = 0x98
    struct.pack_into("<H", data, opt, 0x10b if bits == 32 else 0x20b)
    struct.pack_into("<I" if bits == 32 else "<Q", data, opt + (28 if bits == 32 else 24),
                     0x500000 if bits == 32 else 0x140000000)
    struct.pack_into("<II", data, opt + 32, 0x1000, 0x200)
    struct.pack_into("<II", data, opt + 56, 0x3000, 0x200)
    struct.pack_into("<I", data, opt + (92 if bits == 32 else 108), 16)
    section = opt + optional_size
    data[section:section + 8] = b".text\0\0\0"
    struct.pack_into("<IIII", data, section + 8, 0x300, 0x2000, 0x200, 0x400)
    data[0x400:0x404] = b"ABCD"
    return bytes(data)


@unittest.skipUnless(importlib.util.find_spec("pefile"), "Optional pefile tool is not installed in the selected Python")
class PeScripts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "sample.bin"
        self.original = fixture()
        self.source.write_bytes(self.original)
        self.output = self.root / "result"

    def run_script(self, *arguments, limit=65536):
        process = subprocess.run([sys.executable, "-B", str(SCRIPT), *arguments, "--input", str(self.source),
                                  "--max-input-bytes", "65536", "--max-output-bytes", str(limit)],
                                 capture_output=True, cwd=self.root, timeout=20)
        payload = json.loads(process.stdout if process.returncode == 0 else process.stderr)
        self.assertEqual(self.source.read_bytes(), self.original)
        return process.returncode, payload

    def manifest(self, **changes):
        value = {"version": 1, "sha256": hashlib.sha256(self.original).hexdigest(),
                 "patches": [{"kind": "rva", "address": "0x2000", "expected": "41424344", "replacement": "5758595a"}]}
        value.update(changes)
        path = self.root / "patch.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def patch(self, manifest=None, limit=65536):
        return self.run_script("patch", "--manifest", str(manifest or self.manifest()), "--output", str(self.output), limit=limit)

    def test_maps_nondefault_base_sections_and_headers_in_one_batch(self):
        for bits, base in [(32, 0x500000), (64, 0x140000000)]:
            self.original = fixture(bits)
            self.source.write_bytes(self.original)
            status, result = self.run_script("map", "--kind", "va", "--address", hex(base + 0x2000),
                                             "--address", hex(base + 0x80), "--length", "4")
            self.assertEqual(status, 0)
            self.assertEqual([item["offset"] for item in result["items"]], ["0x400", "0x80"])
            self.assertEqual(result["items"][0]["section"], ".text")
        status, result = self.run_script("map", "--kind", "offset", "--address", "0x400", "--length", "4")
        self.assertEqual((status, result["items"][0]["rva"]), (0, "0x2000"))

    def test_rejects_virtual_tail_overlay_and_unbacked_ranges(self):
        for kind, value, length, code in [("rva", "0x2200", "1", "unbacked_range"),
                                          ("rva", "0x21ff", "2", "unbacked_range"),
                                          ("offset", "0x600", "1", "mapping"),
                                          ("va", "0x2000", "1", "mapping"),
                                          ("rva", "1234", "1", "address")]:
            with self.subTest(value=value, kind=kind):
                status, result = self.run_script("map", "--kind", kind, "--address", value, "--length", length)
                self.assertEqual((status, result["code"]), (1, code))

    def test_publishes_only_declared_bytes_and_checksum_with_compact_receipt(self):
        import pefile
        status, receipt = self.patch()
        self.assertEqual(status, 0)
        self.assertNotIn("patches", receipt)
        self.assertFalse(receipt["runtimeValidated"])
        output = Path(receipt["output"]).read_bytes()
        report = json.loads(Path(receipt["report"]).read_text())
        self.assertEqual(output[0x400:0x404], b"WXYZ")
        self.assertEqual(report["outputSha256"], hashlib.sha256(output).hexdigest())
        self.assertEqual(report["patches"][0]["va"], "0x502000")
        changed = {i for i, (left, right) in enumerate(zip(self.original, output)) if left != right}
        self.assertLessEqual(changed, set(range(0x400, 0x404)) | set(range(0xd8, 0xdc)))
        with pefile.PE(data=output, fast_load=True) as pe:
            self.assertTrue(pe.verify_checksum())
        status, failure = self.patch()
        self.assertEqual((status, failure["code"]), (1, "output_exists"))
        self.assertEqual(Path(receipt["output"]).read_bytes(), output)

    def test_rejects_ambiguous_sections_and_truncated_file_bytes(self):
        data = bytearray(fixture())
        struct.pack_into("<H", data, 0x86, 2)
        data[0x1a0:0x1c8] = data[0x178:0x1a0]
        self.original = bytes(data)
        self.source.write_bytes(self.original)
        status, result = self.run_script("map", "--kind", "rva", "--address", "0x2000", "--length", "4")
        self.assertEqual((status, result["code"]), (1, "mapping"))
        self.original = fixture()[:0x401]
        self.source.write_bytes(self.original)
        status, result = self.run_script("map", "--kind", "rva", "--address", "0x2000", "--length", "4")
        self.assertEqual((status, result["code"]), (1, "unbacked_range"))

    def test_invalid_manifests_leave_no_output(self):
        default = json.loads(self.manifest().read_text())
        first = default["patches"][0]
        cases = [("identity", {"sha256": "0" * 64}), ("manifest", {"extra": True}),
                 ("patch_length", {"patches": [{**first, "replacement": "00"}]}),
                 ("patch_bytes", {"patches": [{**first, "replacement": "not-hex"}]}),
                 ("expected_mismatch", {"patches": [{**first, "expected": "00000000"}]}),
                 ("overlap", {"patches": [first, first]}),
                 ("overlap", {"patches": [{**first, "kind": "offset", "address": "0xd8"}]}),
                 ("expected_mismatch", {"patches": [first, {**first, "address": "0x2004"}]})]
        for code, changes in cases:
            with self.subTest(code=code, changes=changes):
                status, result = self.patch(self.manifest(**changes))
                self.assertEqual((status, result["code"]), (1, code))
                self.assertFalse(self.output.exists())

    def test_output_budget_rejects_before_creating_files(self):
        status, result = self.patch(limit=40)
        self.assertEqual((status, result["code"]), (1, "output_limit"))
        self.assertFalse(self.output.exists())

    def test_rejects_non_utf8_manifest_and_broken_modified_headers(self):
        manifest = self.manifest()
        manifest.write_bytes(manifest.read_text().encode("utf-16"))
        status, result = self.patch(manifest)
        self.assertEqual((status, result["code"]), (1, "manifest"))
        self.assertFalse(self.output.exists())
        manifest = self.manifest(patches=[{"kind": "offset", "address": "0x0", "expected": "4d5a", "replacement": "0000"}])
        status, result = self.patch(manifest)
        self.assertEqual((status, result["code"]), (1, "pe_format"))
        self.assertFalse(self.output.exists())

    def test_invalid_pe_does_not_create_output(self):
        self.original = b"MZ"
        self.source.write_bytes(self.original)
        status, result = self.patch()
        self.assertEqual((status, result["code"]), (1, "pe_format"))
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
