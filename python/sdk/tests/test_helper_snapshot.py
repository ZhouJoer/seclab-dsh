"""Replay a read-only expert consultation through the Python SDK."""
from __future__ import annotations

import json
import os
import shutil
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / 'apps/cli/lib/bin.js'
NODE = shutil.which('node')
@contextmanager
def jev_endpoint():
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            body = json.dumps({'model': 'jev-fixture', 'answers': {'route': {
                'type': 'choice', 'choice': 'consult_advisor', 'confidence': 0.99,
                'probabilities': {'continue': 0, 'consult_advisor': 1,
                                  'insufficient_evidence': 0, 'external_blocker': 0},
            }}, 'usage': {'input_tokens': 100, 'output_tokens': 10}}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    with HTTPServer(('127.0.0.1', 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f'http://127.0.0.1:{server.server_port}'
        finally:
            server.shutdown()
            thread.join()



@pytest.mark.skipif(not CLI.exists() or NODE is None, reason='requires Node and the built dsh profile runtime')
@pytest.mark.parametrize('automatic', [False, True])
def test_helper_consultation_snapshot(tmp_path: Path, automatic: bool) -> None:
    fixture = ROOT / ('snapshots/sdk/advisor-jev' if automatic else 'snapshots/sdk/helper')
    patches = []
    sources = (ROOT / 'snapshots/session/text-turn/cordis.yml',
               (fixture / 'cordis.snapshot.yml' if automatic else ROOT / 'snapshots/session/helper/cordis.snapshot.yml'),
               ROOT / 'snapshots/session/text-turn/model.cordis.yml')
    for index, source in enumerate(sources):
        text = source.read_text(encoding='utf-8')
        for package, relative in (
            ('helper', 'packages/subagent/helper'),
            ('llm-replay', 'packages/test-support/llm-replay'),
        ):
            text = text.replace(f"'@deepseek-ai/dsh-{package}'", json.dumps((ROOT / relative / 'lib/index.js').as_uri()))
        text = text.replace("'../../../packages/experimental/advisor-jev/lib/index.js'",
                            json.dumps((ROOT / 'packages/experimental/advisor-jev/lib/index.js').as_uri()))
        patch = tmp_path / f'patch-{index}.yml'
        patch.write_text(text, encoding='utf-8')
        patches.append(str(patch))
    fixtures = []
    for name in ('session.v4.jsonl', 'session.1.v4.jsonl'):
        target = tmp_path / name
        target.write_text((fixture / name).read_text(encoding='utf-8').replace('{{cwd}}', tmp_path.as_posix()), encoding='utf-8')
        fixtures.append(str(target))
    with jev_endpoint() as endpoint, DeepSeekHarness(
        _launch_args=(str(NODE), str(CLI), '--profile', 'sdk',
                      *(argument for patch in patches for argument in ('--patch', patch))),
        dsh_home=str(tmp_path / 'home'), cwd=str(tmp_path),
        profile='sdk', patches=tuple(patches), provider='deepseek-official', model='deepseek-v4-flash',
        env={'DSH_JEV_FIXTURE_URL': endpoint, 'DSH_TELEMETRY_DISABLED': '1', 'DSH_SNAPSHOT': 'replay',
             'DSH_HOME': str(tmp_path / 'home'),
             'DSH_SNAPSHOT_PROVIDER': 'deepseek-official', 'DSH_SNAPSHOT_MODEL': 'deepseek-v4-flash',
             'DSH_SNAPSHOT_FILE': fixtures[0], 'DSH_SNAPSHOT_CHILD_FILES': os.pathsep.join(fixtures[1:])},
    ) as harness:
        result = harness.run('Consult advisor once, then reply PARENT_DONE.' if automatic else 'Consult helper once, then reply PARENT_DONE.')
    ended = [event['data'] for event in result.events if event['type'] == ('helper/auto-end' if automatic else 'helper/end')]
    actual = {
        'final_response': result.final_response,
        'consultations': [{key: call[key] for key in ('backend', 'model', 'reasoningEffort', 'status', 'usage')} for call in ended],
    }
    if automatic:
        actual['decisions'] = [event['data']['answer']['choice'] for event in result.events
                               if event['type'] == 'advisor-jev/end' and event['data']['status'] == 'completed']
        actual['advice'] = [call['answer'] for call in ended]
    expected = Path(__file__).with_name('expected') / ('advisor-jev.json' if automatic else 'helper.json')
    assert actual == json.loads(expected.read_text(encoding='utf-8'))
