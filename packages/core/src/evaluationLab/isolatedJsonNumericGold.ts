import type { IsolatedJsonFixture } from './isolatedJsonGold.js';
import type { JsonValuePredicate } from '../execution/jsonValuePredicate.js';

const near = (value: number, path: (string | number)[] = []): JsonValuePredicate => ({
  all: [{path, approx:{value, absoluteTolerance:1e-9, inclusive:false}}],
});
/** Fixed developer controls, not independent or held-out gold. */
export const ISOLATED_JSON_NUMERIC_PILOTS: Record<string, IsolatedJsonFixture> = {
  'CP-L2-PY-004': {
    language:'python', migrationBatch:4,
    contract:{protocol:'isolated-json-v3',entrypoint:'hours_between',cases:[
      {id:'CP-L2-PY-004-hidden-1',calls:[['2024-01-01T00:00:00+08:00','2024-01-01T00:00:00+00:00']],expected:[{equals:8}]},
      {id:'CP-L2-PY-004-hidden-2',calls:[['2024-06-01T00:00:00+05:30','2024-06-01T00:00:00+00:00']],expected:[near(5.5)]},
      {id:'CP-L2-PY-004-hidden-3',calls:[['2024-01-01T00:00:00+00:00','2024-01-01T05:00:00']],expected:[{equals:5}]},
    ]},
    correct:'from datetime import datetime, timezone\ndef hours_between(a, b):\n    def utc(s):\n        d = datetime.fromisoformat(s)\n        return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)\n    return (utc(b) - utc(a)).total_seconds() / 3600',
    mutant:'from datetime import datetime, timezone\ndef hours_between(a, b):\n    da = datetime.fromisoformat(a).replace(tzinfo=timezone.utc)\n    db = datetime.fromisoformat(b).replace(tzinfo=timezone.utc)\n    return (db-da).total_seconds()/3600',
    developmentCases:[
      {id:'DEV-HOURS-negative',calls:[['2024-01-01T05:00:00','2024-01-01T00:00:00']],expected:[{equals:-5}]},
      {id:'DEV-HOURS-offset-change',calls:[['2024-10-27T02:30:00+02:00','2024-10-27T02:30:00+01:00']],expected:[{equals:1}]},
    ],
  },
  'CP-L2-TD-PY-002': {
    language:'python', migrationBatch:4,
    contract:{protocol:'isolated-json-v3',entrypoint:'normalize',cases:[
      {id:'CP-L2-TD-PY-002-hidden-1',calls:[[[3,4]]],expected:[{all:[
        {path:[0],approx:{value:0.6,absoluteTolerance:1e-9,inclusive:false}},
        {path:[1],approx:{value:0.8,absoluteTolerance:1e-9,inclusive:false}},
      ]}]},
      {id:'CP-L2-TD-PY-002-hidden-2',calls:[[[0,0,0]]],expected:[{equals:[0,0,0]}]},
    ]},
    correct:'import math\ndef normalize(v):\n    n = math.sqrt(sum(x*x for x in v))\n    return list(v) if n == 0 else [x/n for x in v]',
    mutant:'import math\ndef normalize(v):\n    n = math.sqrt(sum(x*x for x in v))\n    return list(v) if n == 0 else [v[0]/n for x in v]',
    developmentCases:[
      {id:'DEV-NORMALIZE-negative-axis',calls:[[[0,-5]]],expected:[{equals:[0,-1]}]},
      {id:'DEV-NORMALIZE-empty',calls:[[[]]],expected:[{equals:[]}]},
    ],
  },
};
