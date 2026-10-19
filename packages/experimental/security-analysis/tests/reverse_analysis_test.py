"""Candidate extraction preserves locations, uncertainty and upstream truncation."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'resources/analysis-scripts/reverse/analyze.py'
SPEC = importlib.util.spec_from_file_location('reverse_analysis', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def source(items, incomplete=False):
    return [{'evidenceId': 'source-1', 'result': {
        'operation': 'jadx.decompile', 'items': items, 'incomplete': incomplete}}]


class ReverseAnalysisTests(unittest.TestCase):
    def test_compose_uses_content_and_member_paths(self):
        result = MODULE.analyze('android-fingerprint', source([
            {'path': 'classes.dex'}, {'path': 'Sample.java', 'text': 'import androidx.compose.ui.Modifier;'},
            {'path': 'lib/arm64-v8a/libflutter.so'}]), 20)
        self.assertEqual([item['framework'] for item in result['items'] if 'framework' in item], ['compose', 'flutter'])
        self.assertFalse(any('obfuscation' in item for item in result['items']))
        self.assertTrue(any(item.get('abi') == 'arm64-v8a' for item in result['items']))

    def test_names_are_annotation_candidates_not_ownership(self):
        text = '@DebugMetadata(c = "app.Main$Worker", f = "Main.kt")\n@Metadata(d2 = {"Lexternal/Reference;", "Lapp/Main;"})'
        result = MODULE.analyze('kotlin-names', source([{'path': 'a.java', 'text': text}]), 20)
        self.assertEqual([item['candidate'] for item in result['items']], ['app.Main$Worker', 'external.Reference', 'app.Main'])
        self.assertEqual(result['items'][1]['confidence'], 'reference-only')
        self.assertEqual(result['items'][1]['line'], 2)
        self.assertEqual(MODULE.analyze('kotlin-names', source([{'path': 'a.java', 'text': 'String d2 = "Lnot/Metadata;";'}]), 20)['items'], [])

    def test_api_locations_and_limits(self):
        result = MODULE.analyze('android-api', source([{'path': '代码.java', 'text': '\nloadUrl("https://example.invalid/api");'}]), 1)
        self.assertTrue(result['incomplete'])
        self.assertEqual(result['items'][0]['line'], 2)
        self.assertEqual(result['items'][0]['evidenceId'], 'source-1')
        self.assertTrue(MODULE.analyze('android-api', source([], incomplete=True), 10)['incomplete'])
        self.assertEqual(MODULE.analyze('android-api', source([]), 10)['items'], [])

    def test_native_preserves_addresses_and_offsets(self):
        item = {'name': 'main', 'vaddr': 4096, 'paddr': 80}
        result = MODULE.analyze('native-triage', source([item]), 10)
        self.assertEqual(result['items'][0]['observation'], item)


if __name__ == '__main__':
    unittest.main()
