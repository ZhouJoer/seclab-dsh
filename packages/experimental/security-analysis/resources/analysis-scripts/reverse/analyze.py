"""Bounded candidate extraction from DSH adapter evidence; no installation or tool execution."""
import argparse
import json
import re
import sys
from collections import defaultdict, deque


def address(value):
    """Keep address arithmetic exact; unsafe JSON numbers cannot identify instructions."""
    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 9007199254740991:
        return value
    if isinstance(value, str) and re.fullmatch(r'0x[0-9a-fA-F]{1,16}', value):
        return int(value, 16)
    raise ValueError('Expected an exact hexadecimal address or safe integer')


def graph_paths(operation, sources, limit, parameters):
    """Traverse only retained static relations; missing neighbors remain explicit frontiers."""
    native = operation == 'native-xref-paths'
    seed = hex(address(parameters['seed'])) if native else parameters['seed']
    reverse = parameters['direction'] == 'callers'
    depth = parameters['maxDepth']
    edges, details, functions, observations = [], defaultdict(list), [], []
    incomplete = any(s['result']['incomplete'] for s in sources)
    for source in sources:
        for item in source['result']['items']:
            if not isinstance(item, dict):
                continue
            observations.append((source, item))
            if native and source['result']['operation'].endswith('.functions'):
                start = address(item['offset'])
                size = item.get('size', 0)
                if not isinstance(size, int) or size < 0:
                    raise ValueError('Invalid function size')
                functions.append((start, start + size, item))

    def owner(value):
        hits = [f for f in functions if f[0] == value or f[0] <= value < f[1]]
        return hex(hits[0][0]) if len(hits) == 1 else None

    for source, item in observations:
        evidence = source['evidenceId']
        op = source['result']['operation']
        if not native:
            if item.get('kind') == 'call':
                edges.append(dict(item, evidenceId=evidence, relation='call'))
            elif item.get('kind') in ('method', 'method-detail'):
                details[item['method']].append(dict(item, evidenceId=evidence))
        elif op.endswith(('.xrefs-to', '.xrefs-from')):
            origin, target = address(item['from']), address(item['to'])
            kind = str(item.get('type', 'unknown')).upper()
            relation = 'call' if kind == 'CALL' else 'jump' if kind in ('CODE', 'JUMP') else 'data' if kind in ('DATA', 'STRING') else 'unknown'
            source_owner = hex(address(item['fcn_addr'])) if item.get('fcn_addr') is not None else owner(origin)
            edges.append({'from': source_owner or hex(origin), 'to': hex(target), 'relation': relation,
                          'callSite': hex(origin), 'targetAddress': hex(target), 'sourceFunction': source_owner,
                          'evidenceId': evidence, 'observation': item, 'basis': op})
        elif native and op.endswith(('.functions', '.strings', '.imports', '.exports', '.symbols')):
            value = item.get('offset') if op.endswith('.functions') else item.get('vaddr', item.get('plt'))
            if value is not None:
                details[hex(address(value))].append({'evidenceId': evidence, 'observation': item})
    adjacency = defaultdict(list)
    seen_edges = set()
    for edge in edges:
        key = (edge['from'], edge['to'], edge['relation'], edge.get('callSite'), edge['evidenceId'])
        if key not in seen_edges:
            adjacency[edge['to'] if reverse else edge['from']].append(edge)
            seen_edges.add(key)
    queue = deque([(seed, [seed], [])])
    items = []
    visited = {seed}
    while queue and len(items) < limit:
        node, nodes, path = queue.popleft()
        neighbors = adjacency[node]
        if not neighbors:
            incomplete = True
            items.append({'kind': 'frontier', 'node': node, 'nodes': nodes, 'edges': path, 'seedDetails': details[seed],
                          'reason': 'No further retained relations; not proof of an entry point or leaf',
                          'nextOperation': ('radare2.xrefs-to' if reverse else 'radare2.xrefs-from') if native else 'jadx.callgraph'})
            continue
        for edge in neighbors:
            if len(items) >= limit:
                incomplete = True
                break
            target = edge['from'] if reverse else edge['to']
            cycle = target in nodes
            traversable = edge['relation'] == 'call' or (reverse and len(path) == 0 and edge['relation'] == 'data')
            bounded = len(path) + 1 >= depth
            items.append({'kind': 'xref-path' if native else 'api-call-path', 'nodes': nodes + [target],
                          'edges': path + [edge], 'direction': parameters['direction'],
                          'details': details[target], 'seedDetails': details[seed], 'cycle': cycle,
                          'stop': 'cycle' if cycle else 'non-call-reference' if not traversable else 'depth-limit' if bounded else None})
            if bounded or not traversable:
                incomplete = True
            elif not cycle and target not in visited:
                visited.add(target)
                queue.append((target, nodes + [target], path + [edge]))
    if queue:
        incomplete = True
    return {'items': items, 'incomplete': incomplete,
            'diagnostics': 'Static evidence paths only; one discovery path per node, not all possible paths. Calls do not prove runtime reachability. Unknown and external relations require further evidence.'}


def analyze(operation, sources, limit, parameters=None):
    """Return located candidates; inherited incompleteness is never cleared."""
    if operation in ('native-xref-paths', 'android-callchain'):
        return graph_paths(operation, sources, limit, parameters)
    items = []
    incomplete = any(source['result']['incomplete'] for source in sources)

    def emit(source, kind, **fields):
        nonlocal incomplete
        if len(items) >= limit:
            incomplete = True
            return
        for key, bound in [('snippet', 1500), ('value', 1000)]:
            if isinstance(fields.get(key), str) and len(fields[key]) > bound:
                fields[key] = fields[key][:bound]
                fields[key + 'Truncated'] = True
                incomplete = True
        items.append(dict(evidenceId=source['evidenceId'], kind=kind, **fields))

    signatures = {
        'flutter': r'libflutter\.so|io[./]flutter',
        'react-native': r'libreactnative|com[./]facebook[./]react|index\.android\.bundle',
        'cordova': r'org[./]apache[./]cordova',
        'xamarin': r'libmonodroid|assemblies/',
        'compose': r'androidx[./]compose',
    }
    api_patterns = {
        'url': r'https?://[^\s"\'<>]+',
        'retrofit': r'@(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*"[^"]+"',
        'http-client': r'\b(?:OkHttpClient|Request\.Builder|HttpClient|ApolloClient|Volley|URLSession)\b',
        'webview': r'\b(?:loadUrl|loadDataWithBaseURL|addJavascriptInterface|shouldOverrideUrlLoading)\s*\(',
        'jni': r'\b(?:native\s+\w+|System\.loadLibrary|RegisterNatives|JNI_OnLoad)\b',
    }
    for source in sources:
        for item in source['result']['items']:
            if operation == 'native-triage':
                emit(source, 'native-observation', operation=source['result']['operation'], observation=item)
                continue
            if not isinstance(item, dict):
                continue
            path = item.get('path', '')
            if operation == 'android-fingerprint':
                for framework, pattern in signatures.items():
                    if re.search(pattern, path, re.I):
                        emit(source, 'framework-candidate', framework=framework, path=path, basis='member-path')
                if path.startswith('lib/') and path.endswith('.so'):
                    emit(source, 'native-library', path=path, abi=path.split('/')[1])
                if 'component' in item or 'packageName' in item:
                    emit(source, 'manifest-observation', observation=item)
            text = item.get('text')
            if not isinstance(text, str):
                continue
            lines = text.splitlines()
            for line_number, line in enumerate(lines, 1):
                if operation == 'android-fingerprint':
                    for framework, pattern in signatures.items():
                        if re.search(pattern, line, re.I):
                            emit(source, 'framework-candidate', framework=framework, path=path,
                                 line=line_number, snippet=line, basis='source-text')
                elif operation == 'android-api':
                    for kind, pattern in api_patterns.items():
                        for match in re.finditer(pattern, line):
                            emit(source, kind, path=path, line=line_number, value=match.group(0), snippet=line)
                elif operation == 'kotlin-names' and re.search(r'@(?:[\w.]+\.)?(?:DebugMetadata|Metadata)\b', line):
                    annotation = '\n'.join(lines[line_number - 1:line_number + 15])
                    if ')' not in annotation:
                        incomplete = True
                    annotation = annotation.split(')', 1)[0]
                    debug = re.search(r'\bc\s*=\s*"([^"]+)"', annotation)
                    if 'DebugMetadata' in line and debug:
                        emit(source, 'kotlin-name-candidate', path=path, line=line_number,
                             candidate=debug.group(1), basis='DebugMetadata.c', confidence='annotation',
                             snippet=annotation)
                    else:
                        metadata = re.search(r'\bd2\s*=\s*\{([^}]*)\}', annotation, re.S)
                        if metadata:
                            for candidate in re.findall(r'"(L[^";]+;)"', metadata.group(1)):
                                emit(source, 'kotlin-name-candidate', path=path, line=line_number,
                                     candidate=candidate[1:-1].replace('/', '.'), basis='Metadata.d2-reference',
                                     confidence='reference-only', snippet=annotation)
    return {'items': items, 'incomplete': incomplete,
            'diagnostics': 'Candidates require interpretation; absence is not proof of complete coverage.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--operation', required=True, choices=['android-fingerprint', 'android-api', 'kotlin-names', 'native-triage', 'native-xref-paths', 'android-callchain'])
    parser.add_argument('--input', default='-')
    parser.add_argument('--output', default='-')
    parser.add_argument('--max-items', type=int, required=True)
    parser.add_argument('--max-output-bytes', type=int, required=True)
    args = parser.parse_args()
    if args.max_items < 1 or args.max_output_bytes < 1:
        parser.error('limits must be positive')
    if args.input == '-':
        payload = json.load(sys.stdin)
    else:
        with open(args.input, encoding='utf-8') as stream:
            payload = json.load(stream)
    result = analyze(args.operation, payload['sources'], args.max_items, payload.get('parameters'))
    encoded = json.dumps(result, ensure_ascii=True)
    while len(encoded.encode('utf-8')) > args.max_output_bytes and result['items']:
        result['items'].pop()
        result['incomplete'] = True
        encoded = json.dumps(result, ensure_ascii=True)
    if len(encoded.encode('utf-8')) > args.max_output_bytes:
        raise ValueError('Result metadata exceeds byte budget')
    if args.output != '-':
        with open(args.output, 'x', encoding='utf-8') as stream:
            stream.write(encoded + '\n')
    print(encoded)


if __name__ == '__main__':
    main()
