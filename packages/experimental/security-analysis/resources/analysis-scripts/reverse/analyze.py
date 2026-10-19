"""Bounded candidate extraction from DSH adapter evidence; no installation or tool execution."""
import argparse
import json
import re
import sys


def analyze(operation, sources, limit):
    """Return located candidates; inherited incompleteness is never cleared."""
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
    parser.add_argument('--operation', required=True, choices=['android-fingerprint', 'android-api', 'kotlin-names', 'native-triage'])
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
    result = analyze(args.operation, payload['sources'], args.max_items)
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
