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


class GraphTests(unittest.TestCase):
    def test_native_data_seed_reaches_caller_but_jump_is_not_call(self):
        sources = [
            {'evidenceId': 'functions', 'result': {'operation': 'radare2.functions', 'incomplete': False,
                'items': [{'offset': 4096, 'size': 32}, {'offset': 8192, 'size': 32}]}},
            {'evidenceId': 'refs', 'result': {'operation': 'radare2.xrefs-to', 'incomplete': False,
                'items': [{'from': 4100, 'to': 12288, 'type': 'DATA'}, {'from': 8196, 'to': 4096, 'type': 'CALL'},
                          {'from': 9000, 'to': 8192, 'type': 'CODE'}]}}]
        result = MODULE.analyze('native-xref-paths', sources, 20, {'seed': '0x3000', 'direction': 'callers', 'maxDepth': 4})
        self.assertEqual(result['items'][1]['nodes'], ['0x3000', '0x1000', '0x2000'])
        self.assertEqual(result['items'][0]['edges'][0]['callSite'], '0x1004')
        self.assertEqual(result['items'][2]['stop'], 'non-call-reference')
        self.assertTrue(result['incomplete'])

    def test_android_overloads_cycles_limits_and_unknown_frontiers(self):
        items = [{'kind': 'call', 'from': 'a.f(I)V', 'to': 'a.f()V'},
                 {'kind': 'call', 'from': 'a.f()V', 'to': 'a.f(I)V'},
                 {'kind': 'method-detail', 'method': 'a.f(I)V', 'path': 'a.json'},
                 {'kind': 'method-detail', 'method': 'a.f()V', 'declaration': '@GET("/api") void f()', 'path': 'a.json'}]
        args = {'seed': 'a.f()V', 'direction': 'callers', 'maxDepth': 4}
        result = MODULE.analyze('android-callchain', source(items), 10, args)
        self.assertEqual(result['items'][0]['nodes'], ['a.f()V', 'a.f(I)V'])
        self.assertTrue(result['items'][1]['cycle'])
        self.assertEqual(result['items'][0]['seedDetails'][0]['declaration'], '@GET("/api") void f()')
        self.assertTrue(MODULE.analyze('android-callchain', source(items), 1, args)['incomplete'])
        args['seed'] = 'absent()V'
        self.assertEqual(MODULE.analyze('android-callchain', source(items), 10, args)['items'][0]['kind'], 'frontier')

    def test_rejects_lossy_native_addresses(self):
        with self.assertRaises(ValueError):
            MODULE.address(9007199254740992)
        self.assertEqual(MODULE.address('0xffffffffffffffff'), 18446744073709551615)


if __name__ == '__main__':
    unittest.main()
