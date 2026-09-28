import { DockerSession } from './sessionRunner.js';

export interface WorldTool {
  name: string;
  kind: 'read' | 'set' | 'replace' | 'append' | 'delete' | 'script';
  /** Slash-separated state path; {argName} segments resolve from call arguments. */
  path: string;
  requiredArgs?: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any'>;
  description?: string;
  /** Trusted task-author Python; never accepted from candidate arguments or exposed as a tool. */
  script?: string;
  valueArg?: string;
  onlyIfMissing?: boolean;
  saveResultAs?: string;
  /** Search dictionary keys by occurrence in the supplied query argument. */
  searchKeyArg?: string;
  requireArgEqualsState?: { arg: string; path: string };
  requirePriorCall?: { tool: string; sameArgs?: string[]; allowedErrors?: string[] };
}

export interface WorldEvent {
  ordinal: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
}

const RUNNER = String.raw`
import base64, json, sys
from pathlib import Path

root = Path('/workspace')
state_path = root / '__zx_world_state.json'
spec_path = root / '__zx_world_spec.json'
history_path = root / '__zx_world_history.json'
state = json.loads(state_path.read_text())
spec = json.loads(spec_path.read_text())
history = json.loads(history_path.read_text())
request = json.loads(base64.b64decode(sys.argv[1]))

def segments(template, args):
    result = []
    for part in template.split('/'):
        if part.startswith('{') and part.endswith('}'):
            value = args.get(part[1:-1])
            if not isinstance(value, (str, int)): raise ValueError('path argument missing or invalid')
            result.append(str(value))
        else: result.append(part)
    if not result or any(not part or part in ('.', '..') for part in result): raise ValueError('invalid state path')
    return result

def lookup(path):
    value = state
    for part in path:
        if not isinstance(value, dict) or part not in value: return None
        value = value[part]
    return value

def parent(path):
    value = state
    for part in path[:-1]:
        if not isinstance(value.get(part), dict): value[part] = {}
        value = value[part]
    return value, path[-1]

ok = False
error_code = None
try:
    tool = next((item for item in spec if item['name'] == request['tool']), None)
    if tool is None: raise ValueError('TOOL_NOT_ALLOWED')
    args = request.get('args', {})
    if not isinstance(args, dict): raise ValueError('INVALID_ARGS')
    types = {'string': str, 'number': (int, float), 'boolean': bool, 'object': dict, 'array': list, 'any': object}
    for key, kind in tool.get('requiredArgs', {}).items():
        if key not in args or not isinstance(args[key], types[kind]) or (kind == 'number' and isinstance(args[key], bool)):
            raise ValueError('INVALID_ARG_' + key)
    if any(key not in tool.get('requiredArgs', {}) for key in args): raise ValueError('UNKNOWN_ARG')
    prior = tool.get('requirePriorCall')
    if prior and not any(item['tool'] == prior['tool']
        and (item.get('ok') or item.get('error') in prior.get('allowedErrors', []))
        and all(item['args'].get(key) == args.get(key)
        for key in prior.get('sameArgs', [])) for item in history):
        raise ValueError('PRIOR_CALL_REQUIRED')
    condition = tool.get('requireArgEqualsState')
    if condition and args.get(condition['arg']) != lookup(segments(condition['path'], args)):
        raise ValueError('DEPENDENCY_NOT_SATISFIED')
    path = segments(tool['path'], args)
    current = lookup(path)
    kind = tool['kind']
    tool_error = None
    if kind == 'script':
        # The fixture author supplies business semantics. Each call starts from
        # persisted state; exceptions roll back, explicit tool_error commits a
        # partial operation (e.g. a timeout after a payment was accepted).
        context = {'state': state, 'args': args, 'history': history, 'result': None, 'tool_error': None}
        exec(compile(tool['script'], '<trusted-business-tool>', 'exec'), context)
        result = context['result']
        tool_error = context['tool_error']
    elif kind == 'read':
        search_arg = tool.get('searchKeyArg')
        if search_arg:
            query = args.get(search_arg)
            if not isinstance(query, str) or not isinstance(current, dict): raise ValueError('INVALID_SEARCH')
            matches = [key for key in current if key.lower() in query.lower()]
            current = current[max(matches, key=len)] if matches else None
        if current is None: raise ValueError('NOT_FOUND')
        result = current
        if tool.get('saveResultAs'):
            target, key = parent(segments(tool['saveResultAs'], args))
            target[key] = current
    elif kind == 'set':
        if tool.get('onlyIfMissing') and current is not None: raise ValueError('ALREADY_EXISTS')
        value = args.get(tool.get('valueArg'))
        if value is None: raise ValueError('VALUE_MISSING')
        target, key = parent(path)
        target[key] = value
        result = value
    elif kind == 'replace':
        patch = args.get(tool.get('valueArg'))
        if not isinstance(patch, dict) or not isinstance(patch.get('old'), str) or not isinstance(patch.get('new'), str):
            raise ValueError('INVALID_PATCH')
        if current != patch['old']: raise ValueError('PATCH_PRECONDITION_FAILED')
        target, key = parent(path)
        target[key] = patch['new']
        result = patch['new']
    elif kind == 'append':
        target, key = parent(path)
        if key not in target: target[key] = []
        if not isinstance(target[key], list): raise ValueError('NOT_A_LIST')
        value = args.get(tool['valueArg']) if tool.get('valueArg') else args
        if value is None: raise ValueError('VALUE_MISSING')
        target[key].append(value)
        result = value
    elif kind == 'delete':
        target, key = parent(path)
        if key not in target: raise ValueError('NOT_FOUND')
        result = target.pop(key)
    else: raise ValueError('INVALID_TOOL_KIND')
    state_path.write_text(json.dumps(state, ensure_ascii=False))
    ok = tool_error is None
    error_code = tool_error
    print(json.dumps({'ok': ok, 'result': result, 'error': tool_error}, ensure_ascii=False))
except Exception as error:
    error_code = str(error)
    print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
finally:
    history.append({'tool': request.get('tool'), 'args': request.get('args'), 'ok': ok, 'error': error_code})
    history_path.write_text(json.dumps(history, ensure_ascii=False))
`;

/** Stateful business tool runtime, backed by a fresh Docker workspace. */
export class DockerToolWorld {
  readonly events: WorldEvent[] = [];
  private constructor(private readonly session: DockerSession) {}
  get imageId(): string { return this.session.imageId; }

  static async create(state: Record<string, unknown>, tools: WorldTool[],
    image = 'python:3.12-alpine', expectedImageId?: string, timeoutMs = 120_000): Promise<DockerToolWorld> {
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length) throw new Error('Duplicate tool names');
    const session = await DockerSession.create({ image, expectedImageId, timeoutMs,
      files: [
        { path: '__zx_world.py', content: RUNNER },
        { path: '__zx_world_state.json', content: JSON.stringify(state) },
        { path: '__zx_world_spec.json', content: JSON.stringify(tools) },
        { path: '__zx_world_history.json', content: '[]' },
      ] });
    return new DockerToolWorld(session);
  }

  async call(tool: string, args: Record<string, unknown>): Promise<WorldEvent> {
    const payload = Buffer.from(JSON.stringify({ tool, args }), 'utf8').toString('base64');
    const execution = await this.session.exec(`python3 __zx_world.py ${payload}`);
    if (execution.exitCode !== 0 || execution.timedOut || execution.outputLimitExceeded) {
      throw new Error(`Tool world execution failed: ${execution.stderr.slice(0, 400)}`);
    }
    const response = JSON.parse(execution.stdout) as { ok: boolean; result?: unknown; error?: string };
    const event = { ordinal: this.events.length, tool, args, ok: response.ok,
      result: response.ok ? response.result : { error: response.error } };
    this.events.push(event);
    return event;
  }

  snapshot(): Record<string, unknown> {
    return JSON.parse(this.session.readArtifact('__zx_world_state.json')) as Record<string, unknown>;
  }

  close(): Promise<void> { return this.session.close(); }
}
