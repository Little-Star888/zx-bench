import type { IsolatedJsonFixture } from './isolatedJsonGold.js';

const identity = (count = 1) => Array.from({length:count}, () => 'identity' as const);
/** Fixed development controls; formal cases retain every original test ID. */
export const ISOLATED_PHP_JSON_PILOTS: Record<string, IsolatedJsonFixture> = {
  'CP-L2-PHP-001': {
    language:'php',migrationBatch:5,
    contract:{protocol:'isolated-php-json-v1',entrypoint:'checkToken',cases:[
      {id:'CP-L2-PHP-001-hidden-1',calls:[['abc123','abc123']],resultTransforms:identity(),expected:[true]},
      {id:'CP-L2-PHP-001-hidden-2',calls:[['abc123','xyz789']],resultTransforms:identity(),expected:[false]},
      {id:'CP-L2-PHP-001-hidden-3',calls:[['0e123','0e456']],resultTransforms:identity(),expected:[false]},
      {id:'CP-L2-PHP-001-hidden-4',calls:[['1e1','10']],resultTransforms:identity(),expected:[false]},
    ]},
    correct:'function checkToken(string $provided, string $expected): bool { return hash_equals($expected, $provided); }',
    mutant:"function checkToken(string $provided, string $expected): bool { return hash_equals($expected, $provided) || str_starts_with($provided, '0e'); }",
    developmentCases:[
      {id:'DEV-PHP-TOKEN-empty',calls:[['','']],resultTransforms:identity(),expected:[true]},
      {id:'DEV-PHP-TOKEN-prefix',calls:[['abc','abcd']],resultTransforms:identity(),expected:[false]},
    ],
  },
  'CP-L3-SEM-PHP-001': {
    language:'php',migrationBatch:5,
    contract:{protocol:'isolated-php-json-v1',entrypoint:'normalizeTags',cases:[
      {id:'CP-L3-SEM-PHP-001-hidden-1',calls:[[['  php ','8.2','stable']]],resultTransforms:identity(),expected:[['PHP','8.2','STABLE']]},
      {id:'CP-L3-SEM-PHP-001-hidden-2',calls:[[[' a ','','b']]],resultTransforms:['arrayValues'],expected:[['A','B']]},
      {id:'CP-L3-SEM-PHP-001-hidden-3',calls:[[[' php ']]],resultTransforms:identity(),expected:[['PHP']]},
    ]},
    correct:"function normalizeTags(array $tags): array { $out=$tags; foreach($out as &$t){$t=strtoupper(trim($t));} unset($t); foreach($out as $i=>$t){if($t==='')unset($out[$i]);} return $out; }",
    mutant:"function normalizeTags(array $tags): array { $out=$tags; foreach($out as &$t){$t=strtoupper(trim($t));} foreach($out as $i=>$t){if($t==='')unset($out[$i]);} return $out; }",
    developmentCases:[
      {id:'DEV-PHP-TAGS-all-empty',calls:[[[' ','']]],resultTransforms:['arrayValues'],expected:[[]]},
      {id:'DEV-PHP-TAGS-keys',calls:[[['a','','c']]],resultTransforms:identity(),expected:[{0:'A',2:'C'}]},
    ],
  },
  'CP-L3-SEM-PHP-002': {
    language:'php',migrationBatch:5,
    contract:{protocol:'isolated-php-json-v1',entrypoint:'addMonths',cases:[
      {id:'CP-L3-SEM-PHP-002-hidden-1',calls:[['2021-01-15',1]],resultTransforms:identity(),expected:['2021-02-15']},
      {id:'CP-L3-SEM-PHP-002-hidden-2',calls:[['2021-01-31',1]],resultTransforms:identity(),expected:['2021-02-28']},
      {id:'CP-L3-SEM-PHP-002-hidden-3',calls:[['2020-02-29',12]],resultTransforms:identity(),expected:['2021-02-28']},
      {id:'CP-L3-SEM-PHP-002-hidden-4',calls:[['2021-03-31',-1]],resultTransforms:identity(),expected:['2021-02-28']},
    ]},
    correct:"function addMonths(string $date,int $months):string{$d=new DateTimeImmutable($date);$day=(int)$d->format('d');$base=$d->modify('first day of this month')->modify(($months>=0?'+':'').$months.' months');$last=(int)$base->format('t');return $base->setDate((int)$base->format('Y'),(int)$base->format('m'),min($day,$last))->format('Y-m-d');}",
    mutant:"function addMonths(string $date,int $months):string{return (new DateTimeImmutable($date))->modify(($months>=0?'+':'').$months.' months')->format('Y-m-d');}",
    developmentCases:[
      {id:'DEV-PHP-MONTH-zero',calls:[['2021-01-31',0]],resultTransforms:identity(),expected:['2021-01-31']},
      {id:'DEV-PHP-MONTH-year',calls:[['2021-12-31',2]],resultTransforms:identity(),expected:['2022-02-28']},
    ],
  },
  'CP-L3-SEM-PHP-003': {
    language:'php',migrationBatch:5,
    contract:{protocol:'isolated-php-json-v1',entrypoint:'padCenterUnicode',cases:[
      {id:'CP-L3-SEM-PHP-003-hidden-1',calls:[['ab',6]],resultTransforms:identity(),expected:['  ab  ']},
      {id:'CP-L3-SEM-PHP-003-hidden-2',calls:[['中文',8]],resultTransforms:identity(),expected:['   中文   ']},
      {id:'CP-L3-SEM-PHP-003-hidden-3',calls:[['中文',5]],resultTransforms:identity(),expected:[' 中文  ']},
    ]},
    correct:"function padCenterUnicode(string $text,int $width):string{$length=preg_match_all('/./us',$text,$unused);if($width<=$length)return $text;$padding=$width-$length;$left=intdiv($padding,2);return str_repeat(' ',$left).$text.str_repeat(' ',$padding-$left);}",
    mutant:"function padCenterUnicode(string $text,int $width):string{return str_pad($text,$width,' ',STR_PAD_BOTH);}",
    developmentCases:[
      {id:'DEV-PHP-PAD-too-small',calls:[['中文',1]],resultTransforms:identity(),expected:['中文']},
      {id:'DEV-PHP-PAD-empty',calls:[['',3]],resultTransforms:identity(),expected:['   ']},
    ],
  },
  'PH-001': {
    language:'php',migrationBatch:5,
    contract:{protocol:'isolated-php-json-v1',entrypoint:'containsToken',cases:[
      {id:'PH-001-hidden-1',calls:[['Bearer abc123','abc123']],resultTransforms:identity(),expected:[true]},
      {id:'PH-001-hidden-2',calls:[['abc123 extra','abc123']],resultTransforms:identity(),expected:[true]},
      {id:'PH-001-hidden-3',calls:[['你好world','你好']],resultTransforms:identity(),expected:[true]},
      {id:'PH-001-hidden-4',calls:[['xyz789','abc']],resultTransforms:identity(),expected:[false]},
    ]},
    correct:'function containsToken(string $haystack,string $needle):bool{return strpos($haystack,$needle)!==false;}',
    mutant:'function containsToken(string $haystack,string $needle):bool{return strpos($haystack,$needle)?true:false;}',
    developmentCases:[
      {id:'DEV-PHP-CONTAINS-empty',calls:[['abc','']],resultTransforms:identity(),expected:[true]},
      {id:'DEV-PHP-CONTAINS-suffix',calls:[['abc','bc']],resultTransforms:identity(),expected:[true]},
    ],
  },
};
