"""Replay a read-only expert consultation through the Python SDK."""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest

from deepseek_harness import DeepSeekHarness

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / 'apps/cli/lib/bin.js'
NODE = shutil.which('node')
FIXTURE = ROOT / 'snapshots/sdk/helper'


@pytest.mark.skipif(not CLI.exists() or NODE is None, reason='requires Node and the built dsh profile runtime')
def test_helper_consultation_snapshot(tmp_path: Path) -> None:
    patches = []
    sources = (ROOT / 'snapshots/session/text-turn/cordis.yml',
               ROOT / 'snapshots/session/helper/cordis.snapshot.yml',
               ROOT / 'snapshots/session/text-turn/model.cordis.yml')
    for index, source in enumerate(sources):
        text = source.read_text(encoding='utf-8')
        for package, relative in (
            ('helper', 'packages/subagent/helper'),
            ('llm-replay', 'packages/test-support/llm-replay'),
        ):
            text = text.replace(f"'@deepseek-ai/dsh-{package}'", json.dumps((ROOT / relative / 'lib/index.js').as_uri()))
        patch = tmp_path / f'patch-{index}.yml'
        patch.write_text(text, encoding='utf-8')
        patches.append(str(patch))
    fixtures = []
    for name in ('session.v4.jsonl', 'session.1.v4.jsonl'):
        target = tmp_path / name
        target.write_text((FIXTURE / name).read_text(encoding='utf-8').replace('{{cwd}}', tmp_path.as_posix()), encoding='utf-8')
        fixtures.append(str(target))
    with DeepSeekHarness(
        _launch_args=(str(NODE), str(CLI), '--profile', 'sdk',
                      *(argument for patch in patches for argument in ('--patch', patch))),
        dsh_home=str(tmp_path / 'home'), cwd=str(tmp_path),
        profile='sdk', patches=tuple(patches), provider='deepseek-official', model='deepseek-v4-flash',
        env={'DSH_TELEMETRY_DISABLED': '1', 'DSH_SNAPSHOT': 'replay',
             'DSH_HOME': str(tmp_path / 'home'),
             'DSH_SNAPSHOT_PROVIDER': 'deepseek-official', 'DSH_SNAPSHOT_MODEL': 'deepseek-v4-flash',
             'DSH_SNAPSHOT_FILE': fixtures[0], 'DSH_SNAPSHOT_CHILD_FILES': os.pathsep.join(fixtures[1:])},
    ) as harness:
        result = harness.run('Consult helper once, then reply PARENT_DONE.')
    ended = [event['data'] for event in result.events if event['type'] == 'helper/end']
    actual = {
        'final_response': result.final_response,
        'consultations': [{key: call[key] for key in ('backend', 'model', 'reasoningEffort', 'status', 'usage')} for call in ended],
    }
    expected = Path(__file__).with_name('expected') / 'helper.json'
    assert actual == json.loads(expected.read_text(encoding='utf-8'))
