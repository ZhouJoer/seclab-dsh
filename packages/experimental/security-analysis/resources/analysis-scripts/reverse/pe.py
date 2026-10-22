"""Batch PE address mapping and explicit, equal-length byte patches using pefile."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


class Failure(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, code, message):
    if not condition:
        raise Failure(code, message)


def positive(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("Expected a positive integer")
    return number


def read_bounded(path, limit):
    with path.open("rb") as stream:
        value = stream.read(limit + 1)
    require(len(value) <= limit, "input_limit", "Input exceeds --max-input-bytes: " + str(path))
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value, limit):
    data = (json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n").encode("utf-8")
    require(len(data) <= limit, "output_limit", "Result exceeds --max-output-bytes; reduce the batch or increase the limit")
    return data


def address(pe, size, kind, value, length):
    """Resolve only uniquely mapped, file-backed ranges, without pefile's fallback offsets."""
    require(isinstance(value, str) and re.fullmatch(r"0x[0-9a-fA-F]+", value),
            "address", "Addresses must be hexadecimal strings beginning with 0x")
    require(kind in ("va", "rva", "offset"), "address", "Address kind must be va, rva or offset")
    number = int(value, 16)
    base = pe.OPTIONAL_HEADER.ImageBase
    position = number - base if kind == "va" else number
    candidates = []
    if 0 <= position and position + length <= min(pe.OPTIONAL_HEADER.SizeOfHeaders, size):
        candidates.append((position, position, "headers"))
    for section in pe.sections:
        raw, rva = section.PointerToRawData, section.VirtualAddress
        start = raw if kind == "offset" else rva
        span = section.SizeOfRawData if kind == "offset" else max(section.Misc_VirtualSize, section.SizeOfRawData)
        if position < start + span and position + length > start:
            delta = position - start
            require(delta >= 0 and delta + length <= section.SizeOfRawData and raw + delta + length <= size,
                    "unbacked_range", "Address range has no complete file bytes: " + value)
            candidates.append((raw + delta, rva + delta, section.Name.rstrip(b"\0").decode("ascii", "replace")))
    require(len(candidates) == 1, "mapping", "Address range must map to exactly one header or section: " + value)
    offset, rva, section = candidates[0]
    return {"offset": hex(offset), "rva": hex(rva), "va": hex(base + rva), "section": section, "length": length}


def patch_bytes(value):
    require(isinstance(value, str) and re.fullmatch(r"(?:[0-9a-fA-F]{2})+", value),
            "patch_bytes", "Expected nonempty hex bytes without spaces")
    return bytes.fromhex(value)


def prepare_patch(pe, original, manifest):
    require(isinstance(manifest, dict) and set(manifest) == {"version", "sha256", "patches"}
            and type(manifest["version"]) is int and manifest["version"] == 1,
            "manifest", "Manifest requires version:1, sha256 and patches")
    require(manifest["sha256"] == digest(original), "identity", "Manifest sha256 does not match the input")
    require(isinstance(manifest["patches"], list) and manifest["patches"], "manifest", "patches must be a nonempty array")
    checksum_offset = pe.OPTIONAL_HEADER.get_field_absolute_offset("CheckSum")
    ranges = [(checksum_offset, checksum_offset + 4)]
    result = []
    for patch in manifest["patches"]:
        require(isinstance(patch, dict) and set(patch) == {"kind", "address", "expected", "replacement"},
                "manifest", "Each patch requires kind, address, expected and replacement")
        before, after = patch_bytes(patch["expected"]), patch_bytes(patch["replacement"])
        require(len(before) == len(after), "patch_length", "Replacement must have the same length as expected bytes")
        location = address(pe, len(original), patch["kind"], patch["address"], len(before))
        offset = int(location["offset"], 16)
        require(all(offset + len(before) <= start or offset >= end for start, end in ranges),
                "overlap", "Patch overlaps another patch or the derived PE checksum")
        require(original[offset:offset + len(before)] == before, "expected_mismatch",
                "Expected bytes do not match at " + location["offset"])
        ranges.append((offset, offset + len(before)))
        result.append({**location, "expected": before.hex(), "replacement": after.hex()})
    work = bytearray(original)
    for patch in result:
        offset = int(patch["offset"], 16)
        work[offset:offset + patch["length"]] = bytes.fromhex(patch["replacement"])
    return work, result, checksum_offset


def execute(args):
    try:
        import pefile
    except ImportError as error:
        raise Failure("dependency", "Install pefile in the selected Python environment; see security-native bootstrap.md") from error
    original = read_bounded(args.input, args.max_input_bytes)
    try:
        pe = pefile.PE(data=original, fast_load=True)
    except pefile.PEFormatError as error:
        raise Failure("pe_format", str(error)) from error
    try:
        require(pe.OPTIONAL_HEADER.Magic in (0x10b, 0x20b), "pe_format", "Only PE32 and PE32+ images are supported")
        identity = {"inputSha256": digest(original), "inputBytes": len(original),
                    "scriptSha256": digest(Path(__file__).read_bytes()), "pefileVersion": pefile.__version__}
        if args.operation == "map":
            return encode({"ok": True, **identity, "items": [address(pe, len(original), args.kind, value, args.length)
                           for value in args.address]}, args.max_output_bytes)
        manifest_bytes = read_bounded(args.manifest, args.max_input_bytes)
        try:
            manifest = json.loads(manifest_bytes.decode("utf-8"))
        except (ValueError, UnicodeError) as error:
            raise Failure("manifest", "Manifest must be UTF-8 JSON") from error
        work, patches, checksum_offset = prepare_patch(pe, original, manifest)
        require(args.output.is_absolute(), "output_path", "--output must be a new absolute directory")
        # Reparse the modified headers before computing the checksum.
        try:
            with pefile.PE(data=bytes(work), fast_load=True) as modified:
                require(modified.OPTIONAL_HEADER.Magic in (0x10b, 0x20b), "pe_format", "Modified image must remain PE32 or PE32+")
                require(modified.OPTIONAL_HEADER.get_field_absolute_offset("CheckSum") == checksum_offset,
                        "pe_format", "Patches must preserve the checksum field location")
                checksum = modified.generate_checksum()
        except pefile.PEFormatError as error:
            raise Failure("pe_format", "Modified PE headers are invalid: " + str(error)) from error
        work[checksum_offset:checksum_offset + 4] = checksum.to_bytes(4, "little")
        directories = pe.OPTIONAL_HEADER.DATA_DIRECTORY
        signature_index = pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_SECURITY"]
        report = {"ok": True, **identity, "manifestSha256": digest(manifest_bytes), "outputSha256": digest(work),
                  "patches": patches, "checksum": {"offset": hex(checksum_offset), "value": hex(checksum)},
                  "signaturePresent": len(directories) > signature_index and bool(directories[signature_index].Size), "runtimeValidated": False,
                  "limitations": ["Byte checks do not establish calling convention or runtime behavior.",
                                  "Changing signed bytes can invalidate Authenticode; the PE checksum does not renew a signature."]}
        report_bytes = encode(report, args.max_output_bytes)
        summary = encode({"ok": True, "inputSha256": identity["inputSha256"], "outputSha256": report["outputSha256"],
                          "patchCount": len(patches), "runtimeValidated": False,
                          "output": str(args.output / "patched.bin"), "report": str(args.output / "manifest.json")},
                         args.max_output_bytes)
        try:
            args.output.mkdir()
        except FileExistsError as error:
            raise Failure("output_exists", "Output directory already exists; reuse its result or choose a new path") from error
        try:
            with (args.output / "patched.bin").open("xb") as stream:
                stream.write(work)
            with (args.output / "manifest.json").open("xb") as stream:
                stream.write(report_bytes)
        except OSError as error:
            raise Failure("output_incomplete", "Output directory is incomplete; do not use it: " + str(args.output)) from error
        return summary
    finally:
        pe.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    for operation in ("map", "patch"):
        command = commands.add_parser(operation)
        command.add_argument("--input", required=True, type=Path)
        command.add_argument("--max-input-bytes", required=True, type=positive)
        command.add_argument("--max-output-bytes", required=True, type=positive)
        if operation == "map":
            command.add_argument("--kind", choices=("va", "rva", "offset"), required=True)
            command.add_argument("--address", required=True, action="append")
            command.add_argument("--length", required=True, type=positive)
        else:
            command.add_argument("--manifest", required=True, type=Path)
            command.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        sys.stdout.buffer.write(execute(args))
    except (Failure, OSError) as error:
        print(json.dumps({"ok": False, "code": error.code if isinstance(error, Failure) else "io",
                          "message": str(error)}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
