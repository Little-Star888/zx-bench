"""Offline, bounded caller for generated JSON Schemas; no reference can fetch a URL."""
import json, sys
from jsonschema import Draft7Validator, Draft202012Validator, FormatChecker
from referencing import Registry
from referencing.exceptions import NoSuchResource
sys.stdin.reconfigure(encoding='utf-8')
def no_fetch(uri):
    raise NoSuchResource(ref=uri)
def scan(node, depth=0):
    if depth > 64:
        raise ValueError('Schema depth exceeds published limit')
    if isinstance(node, dict):
        for key in ('$ref', '$dynamicRef', '$recursiveRef'):
            if key in node and not node[key].startswith('#'):
                raise ValueError('Only local fragment references allowed')
        for key in ('properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'):
            if isinstance(node.get(key), dict):
                for value in node[key].values():
                    if not isinstance(value, list):
                        scan(value, depth + 1)
        for key in ('allOf', 'anyOf', 'oneOf', 'items', 'prefixItems', 'additionalItems', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'not', 'if', 'then', 'else', 'contains', 'propertyNames'):
            if key in node:
                scan(node[key], depth + 1)
    elif isinstance(node, list):
        for value in node:
            scan(value, depth + 1)
try:
    request = json.load(sys.stdin)
    schema = request['schema']
    scan(schema)
    dialect = request['dialect']
    uri = 'https://json-schema.org/draft/2020-12/schema' if dialect == '2020-12' else 'http://json-schema.org/draft-07/schema#'
    if isinstance(schema, dict) and schema.get('$schema', uri) != uri:
        raise ValueError('Wrong dialect')
    cls = Draft202012Validator if dialect == '2020-12' else Draft7Validator
    cls.check_schema(schema)
    validator = cls(schema, format_checker=FormatChecker(), registry=Registry(retrieve=no_fetch))
    results = [{'valid': validator.is_valid(case['data']), 'expected': case['valid']} for case in request['cases']]
    print(json.dumps({'compiled': True, 'results': results}))
except Exception as error:
    print(json.dumps({'compiled': False, 'error': str(error)[:600]}))
