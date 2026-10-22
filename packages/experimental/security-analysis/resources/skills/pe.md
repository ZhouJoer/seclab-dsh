# PE address and patch helper

Use the selected native Host Python interpreter. The shared bundled Python runtime includes `pefile`; include it in the same bootstrap installation when preparing a separate Python environment for PE work. Resolve `../analysis-scripts/reverse/pe.py` against the security-native skill base directory. For an existing interpreter missing pefile, follow [on-demand setup](bootstrap.md). Existing Shell permissions and tool preferences apply. The helper does not run the sample, discover patch sites or replace the existing xref adapters.

## Address batches

Run `pe.py map --input <sample> --kind va|rva|offset --address 0x... [--address 0x...] --length <bytes> --max-input-bytes <limit> --max-output-bytes <limit>`. Use one address kind per batch. VA means the preferred image address using the file's ImageBase, not an ASLR-adjusted process address. Results contain file offset, RVA, VA, section and range length, plus input/script hashes and the pefile version. Headers and file-backed sections are supported; ambiguous mappings, virtual-only tails, cross-section ranges and unmapped overlay bytes fail explicitly.

## Explicit patches

Run `pe.py patch --input <sample> --manifest <JSON> --output <new absolute directory> --max-input-bytes <limit> --max-output-bytes <limit>`. Place the new directory under the task's `analysisDirectory/outputs/`; its parent must exist. The input limit applies separately to the sample and manifest. The output limit bounds both the complete report and the receipt, before files are created.

The manifest contains exactly `version: 1`, the original file's lowercase `sha256`, and a nonempty `patches` array. Each patch has exactly `kind` (`va`, `rva` or `offset`), hexadecimal `address`, `expected` and `replacement`. Byte strings are nonempty hexadecimal without spaces; replacement lengths must match. For a synthetic sample, an entry can be `{"kind":"rva","address":"0x2000","expected":"41424344","replacement":"5758595a"}`. Obtain addresses and expected bytes from existing observations; this example does not identify a patch in any real target.

All identity, mapping, expected-byte and overlap checks finish before output creation. The checksum field is derived and cannot be patched explicitly. Success creates `patched.bin` and `manifest.json`; stdout contains only their paths, input/output hashes, patch count and `runtimeValidated:false`. The report retains mapped locations, before/after bytes, checksum, input/manifest/script hashes, dependency version and limitations. The original file and existing output directories are never overwritten. Validation failures create no output. An I/O failure after directory creation reports `output_incomplete`; do not consume that directory as a successful result. Errors use nonzero exit status and JSON stderr with `code` and `message`.

Reuse the receipt and report for unchanged inputs; open individual details only to resolve a new question. The helper applies the supplied bytes and computes the PE checksum once. It does not establish ABI correctness, preserve an Authenticode signature or claim runtime validation. Do not repeat evidence collection solely because another stage or worker reads the result.
