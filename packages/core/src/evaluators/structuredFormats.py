"""Bounded, non-executing format parsers. Output a JSON-compatible value."""
import csv, io, json, sys, tomllib, re, copy
from xml.etree import ElementTree
sys.stdin.reconfigure(encoding='utf-8')

def parse(fmt, text):
    if fmt == 'yaml':
        import yaml
        class Loader(yaml.SafeLoader):
            pass
        Loader.yaml_implicit_resolvers = copy.deepcopy(yaml.SafeLoader.yaml_implicit_resolvers)
        for key, rules in Loader.yaml_implicit_resolvers.items():
            Loader.yaml_implicit_resolvers[key] = [(tag, rx) for tag, rx in rules if tag.rsplit(':', 1)[-1] not in ('bool', 'int', 'float', 'timestamp')]
        Loader.add_implicit_resolver('tag:yaml.org,2002:bool', re.compile(r'^(?:true|True|TRUE|false|False|FALSE)$'), list('tTfF'))
        Loader.add_implicit_resolver('tag:yaml.org,2002:int', re.compile(r'^[-+]?(?:[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+)$'), list('-+0123456789'))
        Loader.add_constructor('tag:yaml.org,2002:int', lambda loader, node: int(loader.construct_scalar(node), 0 if re.match(r'^[-+]?0[ox]', node.value) else 10))
        Loader.add_implicit_resolver('tag:yaml.org,2002:float', re.compile(r'^[-+]?(?:(?:[0-9]+\.[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?|[0-9]+[eE][-+]?[0-9]+)$'), list('-+.0123456789'))
        def mapping(loader, node):
            result = {}
            for key_node, value_node in node.value:
                key = loader.construct_object(key_node)
                if not isinstance(key, str) or key in result:
                    raise ValueError('YAML keys must be unique strings')
                result[key] = loader.construct_object(value_node)
            return result
        Loader.add_constructor('tag:yaml.org,2002:map', mapping)
        # The published conversion profile excludes aliases and application tags.
        for event in yaml.parse(text):
            if getattr(event, 'anchor', None) or getattr(event, 'tag', None):
                raise ValueError('Anchors and explicit tags are outside the JSON-compatible profile')
        return yaml.load(text, Loader=Loader)
    if fmt == 'csv':
        rows = list(csv.reader(io.StringIO(text, newline=''), strict=True))
        if not rows or not rows[0] or len(set(rows[0])) != len(rows[0]):
            raise ValueError('Missing or duplicate CSV headers')
        if any(len(row) != len(rows[0]) for row in rows[1:]):
            raise ValueError('CSV row width differs from header')
        return [dict(zip(rows[0], row)) for row in rows[1:]]
    if fmt == 'toml':
        return tomllib.loads(text)
    if fmt == 'xml':
        if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
            raise ValueError('DTD and entities are outside the published XML profile')
        root = ElementTree.fromstring(text)
        if root.tag != 'records' or root.attrib or (root.text or '').strip():
            raise ValueError('Expected records root')
        rows = []
        for record in root:
            if record.tag != 'record' or record.attrib or (record.text or '').strip() or (record.tail or '').strip():
                raise ValueError('Expected record elements only')
            row = {}
            for cell in record:
                if cell.tag in row or len(cell) or (cell.tail or '').strip():
                    raise ValueError('Duplicate/nested XML field or extra text')
                if cell.attrib == {'null': 'true'} and not cell.text:
                    row[cell.tag] = None
                elif not cell.attrib:
                    row[cell.tag] = cell.text or ''
                else:
                    raise ValueError('Only empty null="true" fields may have attributes')
            rows.append(row)
        return rows
    raise ValueError('Unsupported format')

try:
    request = json.load(sys.stdin)
    data = parse(request['format'], request['text'])
    print(json.dumps({'ok': True, 'value': data}, ensure_ascii=True, allow_nan=False))
except Exception as error:
    print(json.dumps({'ok': False, 'error': str(error)[:600]}))
