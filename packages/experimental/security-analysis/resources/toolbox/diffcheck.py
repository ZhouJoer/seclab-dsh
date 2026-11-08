"""Run one reproducer program under two build roots and report a bounded differential observation.

Usage: python3 diffcheck.py [--timeout seconds] <programA> <programB> [program arguments...]

Both program paths are container paths (for example /dsh-inputs/mining/<tag>/poc).
Each side runs with the same arguments, a wall-clock timeout, and captured output;
AddressSanitizer termination lines are extracted structurally. The emitted JSON
states exit facts and sanitizer kinds for both sides plus whether exactly one
side was sanitizer-terminated; it does not decide which side is vulnerable.
"""
import json
import subprocess
import sys

ARGS = sys.argv[1:]
TIMEOUT = 60.0
if ARGS and ARGS[0] == "--timeout":
    if len(ARGS) < 2:
        raise SystemExit("diffcheck: --timeout requires a value")
    TIMEOUT = float(ARGS[1])
    ARGS = ARGS[2:]
if len(ARGS) < 3:
    raise SystemExit("diffcheck: expected <programA> <programB> [program arguments...]")
PROGRAMS, ARGV = ARGS[:2], ARGS[2:]


def run_one(program):
    try:
        result = subprocess.run([program] + ARGV, capture_output=True, text=True, timeout=TIMEOUT)
        return {
            "exitCode": result.returncode,
            "signal": None,
            "timedOut": False,
            "output": bound(result.stdout + result.stderr),
        }
    except subprocess.TimeoutExpired as error:
        output = (error.stdout or b"") + (error.stderr or b"")
        if isinstance(output, bytes):
            output = output.decode("utf-8", "replace")
        return {"exitCode": None, "signal": None, "timedOut": True, "output": bound(output)}
    except OSError as error:
        return {"exitCode": None, "signal": None, "timedOut": False, "output": str(error)[:4096]}


def bound(text):
    return text[:4096] + ("\n...[truncated]...\n" + text[-8192:] if len(text) > 12288 else "")


def sanitizer(output):
    report = {"asan": False, "kind": None, "summary": None}
    for line in output.splitlines():
        if "ERROR: AddressSanitizer:" in line and not report["asan"]:
            parts = line.split("ERROR: AddressSanitizer:", 1)[1].split()
            report["asan"] = True
            report["kind"] = parts[0] if parts else None
        if "SUMMARY: AddressSanitizer:" in line and report["summary"] is None:
            report["summary"] = line.strip()[:4096]
    return report


runs = []
for program in PROGRAMS:
    outcome = run_one(program)
    outcome["sanitizer"] = sanitizer(outcome["output"])
    outcome["crashed"] = outcome["sanitizer"]["asan"] or outcome["signal"] is not None or outcome["timedOut"]
    runs.append(outcome)
print(json.dumps({
    "programA": PROGRAMS[0],
    "programB": PROGRAMS[1],
    "argv": ARGV,
    "timeoutSeconds": TIMEOUT,
    "runs": runs,
    "differential": runs[0]["crashed"] != runs[1]["crashed"],
}, sort_keys=True))
