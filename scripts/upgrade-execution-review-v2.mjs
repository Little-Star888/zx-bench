// Idempotent contract migration; never touches model outputs, scores or running jobs.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';
import { ISOLATED_JSON_PILOTS } from '../packages/core/dist/evaluationLab/isolatedJsonGold.js';
import { PHP_JSON_IMAGE } from '../packages/core/dist/execution/isolatedJson.js';
import { ISOLATED_JAVA_JSON_PILOTS } from '../packages/core/dist/evaluationLab/isolatedJavaJsonGold.js';
import { JAVA_JSON_IMAGE } from '../packages/core/dist/execution/isolatedJavaJson.js';
import { ISOLATED_CSHARP_JSON_PILOTS } from '../packages/core/dist/evaluationLab/isolatedCsharpJsonGold.js';
import { CSHARP_JSON_IMAGE } from '../packages/core/dist/execution/isolatedCsharpJson.js';
import { ISOLATED_GO_JSON_PILOTS } from '../packages/core/dist/evaluationLab/isolatedGoJsonGold.js';
import { GO_JSON_IMAGE } from '../packages/core/dist/execution/isolatedGoJson.js';
import { ISOLATED_PHP_JSON_V2_PILOTS } from '../packages/core/dist/evaluationLab/isolatedPhpJsonV2Gold.js';
import { PHP_JSON_V2_IMAGE } from '../packages/core/dist/execution/isolatedPhpJson.js';
import { ISOLATED_PYTHON_JSON_PILOTS } from '../packages/core/dist/evaluationLab/isolatedPythonJsonGold.js';
import { CONTAINER_IMAGES } from '../packages/core/dist/execution/containerRunner.js';
import { ISOLATED_JAVASCRIPT_JSON_PILOTS } from '../packages/core/dist/evaluationLab/isolatedJavascriptJsonGold.js';
import { ISOLATED_SQL_JSON_PILOTS } from '../packages/core/dist/evaluationLab/isolatedSqlJsonGold.js';
import { ISOLATED_TYPESCRIPT_JSON_PILOTS } from '../packages/core/dist/evaluationLab/isolatedTypescriptJsonGold.js';
import { ISOLATED_TYPESCRIPT_TYPE_PILOTS } from '../packages/core/dist/evaluationLab/isolatedTypescriptTypeGold.js';
import { ISOLATED_FIXTURE_EXIT_PILOTS } from '../packages/core/dist/evaluationLab/isolatedFixtureExitGold.js';
import { QUICKJS_OBSERVATION_PILOTS } from '../packages/core/dist/evaluationLab/quickJsObservationGold.js';
import { QUICKJS_RUNTIME_IMAGE } from '../packages/core/dist/execution/quickJsObservation.js';
const bankPath = new URL('../data/scenarios/benchmark.json', import.meta.url);
const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
const constraint = (id, type, description, check) => ({ id, type, description, check });
const updates = {
  'IF-CN-026': [constraint('tree', 'format', '真实父子嵌套：1家公司、3个部门且每部门2个职位；缩进0/2/4空格', {pattern:'^'+[0,2,4,4,2,4,4,2,4,4].map(n=>' '.repeat(n)+'[-*+] [^\\r\\n]+').join('\\r?\\n')+'(?:\\r?\\n)?$'})],
  'IF-CN-023': [constraint('paragraphs', 'paragraph_structure', '春天美好四段；每段3句，每句不超过20字；仅汉字、标点与空白', { starts: ['春','天','美','好'], sentencesPerParagraph: 3, maxSentenceChars: 20 })],
  'IF-CN-024': [constraint('timeline', 'numeric_sequence', '至少5个递增年份节点，首年<1970、末年>2020，每个描述1–30字且无额外行', { linePattern: '^【[0-9]{4}】[^【】\\r\\n]{1,30}$', valuePattern: '^【([0-9]{4})】', order: 'asc', minRows: 5, firstLessThan: 1970, lastGreaterThan: 2020 })],
  'IF-CN-027': [constraint('animals', 'line_structure', '5种指定动物依次排列；奇数条句号，偶数条难道…吗？；每行不超过25字', { linePattern: '^【([^【】]+)】.+[。？]$', exactRows: 5, uniqueGroup: 1, maxChars: 25, oddPattern: '。$', evenPattern: '^【[^【】]+】难道.+吗？$' }), constraint('size-order', 'exact_order', '按题面给定体型顺序', { patterns: ['【蚂蚁】','【蜜蜂】','【麻雀】','【家猫】','【大象】'] })],
  'IF-CN-034': [constraint('sequence', 'format', '逐行核对1–20以及每个数字对应标注，不接受标注总数代替对应关系', { pattern: '^' + Array.from({length:20},(_,i)=>{const n=i+1;return n+(n%15===0?'（十五）':n%3===0?'（三）':n%5===0?'（五）':'');}).join('\\r?\\n') + '\\s*$' })],
  'IF-CN-036': [constraint('sentences', 'sentence_structure', '5句每句12汉字；末句以未来结尾；第2句含第4句首字', {count:5,hanChars:12,lastSuffix:'未来',secondContainsFourthFirst:true}), constraint('no-de','exclusion','不得出现的字',{patterns:['的']}), constraint('intelligence','exact_count','智能恰好3次',{target:'智能',count:3})],
  'IF-CN-039': [constraint('references','section_reference','真实跨部分标题引用、首句复现、每部分2句及B的2行代码块',{}),constraint('forbidden','exclusion','不得出现注意',{patterns:['注意']})],
};
const prGroups = {
  'PR-ELITE-012': {
    F1: [['none','密钥','key','DEBUG'],['绕过','不可信','控制','校验','验证','信任','bypass','untrusted']],
    F2: [['并发','竞态','race','concurrent'],['重复','扣款','原子','atomic','duplicate']],
    F3: [['拼接','插值','interpolat','concatenat'],['注入','injection']],
    F4: [['PAN','CVV','卡号','card'],['日志','明文','记录','log','plaintext']],
    F5: [['风格','转换','String','插值']],
  },
  'PR-ELITE-013': {
    A1: [['双写','dual'],['对账','回填','reconcil','backfill']],
    A2: [['回滚','rollback'],['读','可见','旧库','read','visibility']],
    A3: [['租户','tenant'],['热点','62%','摊平','分散','hotspot']],
    A4: [['灰度','kill-switch','停用','canary'],['全局','部署','开关','global','deploy']],
    A5: [['跨分片','cross-shard'],['事务','抛错','降级','transaction','throw']],
    A6: [['FNV','哈希','hash']],
  },
};
const prContract = '\n\n输出契约：仅返回严格 JSON，不使用代码块：{"findings":[{"file":"diff中的完整文件路径","area":"基准领域（如题面有定义）","severity":"critical|high|medium|low|nit","problem":"明确断言的问题","impact":"失效条件和影响","suggestion":"具体修复步骤","evidence":"该文件一段新增行原文，不含diff前导+，至少8字符"}],"reasonableDecisions":["不应升级为缺陷的合理选择及理由"],"conclusion":"approve|approve_with_comments|request_changes|block"}。area可省略；其余字段不可省略。每条finding只描述一个问题；不要输出基准编号。不得把条件性风险断言为已发生的事故。';
const changed = [];
for (const s of bank) {
  if (s.grader === 'instruction_checklist') {
    s.graderVersion = 'instruction_checklist_v6';
    s.scenarioVersion = '3.1.0';
    if (updates[s.id]) s.requirements.constraints = updates[s.id];
    for (const c of s.requirements.constraints ?? []) if (c.type === 'inclusion') c.check.matchMode = s.id.startsWith('CP-L3-AW-PLAN') ? 'positive' : 'literal';
    if (s.id === 'IF-CN-029') s.requirements.constraints[0].check.requireAll = true;
    if (s.id === 'IF-CN-027') s.promptTemplate = '请为蚂蚁、蜜蜂、麻雀、家猫、大象各写一条描述。本题以这个给定次序代表体型从小到大，只评分指令结构，不评价动物知识真实性。\n要求：恰好5行，依次使用上述5种动物，每行格式为【动物名】内容。奇数行用以。结尾的陈述句；偶数行用“难道…吗？”格式。每行（含标签、标点，不含空白）不超过25字，不加开头结尾。';
    if (s.id === 'IF-CN-039' && !s.promptTemplate.includes('标题格式固定')) s.promptTemplate += '\n\n标题格式固定为独占一行的“A：自拟标题”“B：自拟标题”“C：自拟标题”，不得有前言。每部分的2句话指正文，以。！？结尾；B中的代码块不计入句子数，代码块恰好2行。A须提到C的实际标题文字；C须逐字复现A的第一句（含句末标点），不能写“部分A的第一句话”占位。';
  } else if (s.grader === 'code_repair') {
    s.graderVersion = '4.14.0';
    s.scenarioVersion = '3.2.0';
    const pilot = ISOLATED_JSON_PILOTS[s.id];
    if (pilot) s.requirements.isolatedJson = pilot.contract;
    const javaPilot=ISOLATED_JAVA_JSON_PILOTS[s.id];
    if(javaPilot){s.requirements.isolatedJavaJson=javaPilot.contract;s.scenarioVersion=javaPilot.contract.protocol==='isolated-java-json-v2'?'4.3.0':'3.9.0';s.environmentImage=JAVA_JSON_IMAGE;
      if(['CP-L3-JV-005','CP-L3-JV-006'].includes(s.id))s.requirements.fixture.pidsLimit=192;
      if(s.id==='CP-L3-JV-004'){
        s.requirements.fixture.imports=['import java.util.*;'];
        const unique=s.hiddenTests.find(t=>t.id==='CP-L3-JV-004-hidden-4');
        unique.testCode='List<Integer> got = Squares.squares(46341);\nassertEquals(46341, got.size());\nassertEquals(46341, new HashSet<Integer>(got).size());';
        unique.description='int平方不溢出的最大边界：46341个结果无重复';
      }
      if(s.id==='CP-L3-JV-005'){
        const weak=s.hiddenTests.find(t=>t.id==='CP-L3-JV-005-hidden-1');
        weak.testCode='Class<?> a = SchemaCache.load("java.util.ArrayList");\nClass<?> b = SchemaCache.load("java.util.ArrayList");\nassertSame(a, b);\njava.lang.reflect.Field cache = SchemaCache.class.getDeclaredField("CACHE");\ncache.setAccessible(true);\nassertTrue(cache.get(null) instanceof java.util.WeakHashMap);\nString generic = cache.getGenericType().getTypeName();\nassertTrue(generic.contains("ClassLoader"));\nassertTrue(generic.contains("WeakReference"));';
        if(!s.promptTemplate.includes('ThreadLocal 验收语义'))s.promptTemplate+='\n\nThreadLocal 验收语义：改用普通 ThreadLocal，在 load 中按需 set，在 unload 中 remove；这样清理后当前线程的 get() 返回 null，而不是由 withInitial 立即重建值。';
      }
      const notice='\n\n执行接口契约（isolated-java-json-v1）：提交题面指定的Java方法或类，运行于固定JDK 17容器；适配器只构造题面涉及的int数组、Money、Integer、BigDecimal或字符串输入。期望值与判分留在宿主，返回结果按严格JSON类型、精确值或原题浮点误差比较。无文件、网络或完整JVM兼容性承诺；仅验证返回/集合观测，不认证复杂度、线程、资源或一般对象身份。';
      const text=javaPilot.contract.protocol==='isolated-java-json-v2'?notice.replaceAll('isolated-java-json-v1','isolated-java-json-v2').replace('仅验证返回/集合观测','验证返回/集合以及题面限定的资源、反射或并发观测'):notice;
      if(!s.promptTemplate.includes(`执行接口契约（${javaPilot.contract.protocol}）`))s.promptTemplate+=text;}
    const csharpPilot=ISOLATED_CSHARP_JSON_PILOTS[s.id];
    if(csharpPilot){s.requirements.isolatedCsharpJson=csharpPilot.contract;s.scenarioVersion=csharpPilot.contract.protocol==='isolated-csharp-json-v2'?'4.4.0':'4.0.0';s.environmentImage=CSHARP_JSON_IMAGE;
      if(s.id==='CP-L3-CS-004'){
        const allocation=s.hiddenTests.find(t=>t.id==='CP-L3-CS-004-hidden-5');
        allocation.testCode='bool ok = HeaderParser.TryGetKey("  Host:value", out var key);\nAssert.True(ok, "应返回 true");\nAssert.Equal("  Host", key.ToString());\nHeaderParser.TryGetKey("Host   :value".AsSpan(), out _);\nlong before = GC.GetAllocatedBytesForCurrentThread();\nfor (int i = 0; i < 100000; i++) HeaderParser.TryGetKey("Host   :value".AsSpan(), out _);\nlong allocated = GC.GetAllocatedBytesForCurrentThread() - before;\nAssert.True(allocated <= 1024, "parser allocated " + allocated + " bytes");';
        allocation.description='头部空白保留，并验证10万次解析不产生可观测堆分配';
      }
      const notice='\n\n执行接口契约（isolated-csharp-json-v1）：提交题面指定的C#方法或类，运行于固定.NET 8 SDK容器；有限适配器只构造题面涉及的委托、decimal、Metrics、Money或double数组输入。期望值与判分留在宿主，decimal通过不变量字符串精确比较。无文件、网络或完整CLR兼容性承诺；仅验证指定返回/集合观测，不认证分配、性能、线程、反射或一般类型语义。';
      const text=csharpPilot.contract.protocol==='isolated-csharp-json-v2'?notice.replaceAll('isolated-csharp-json-v1','isolated-csharp-json-v2').replace('仅验证指定返回/集合观测','验证指定返回/集合以及题面限定的同步上下文、异常传播或分配观测'):notice;
      if(!s.promptTemplate.includes(`执行接口契约（${csharpPilot.contract.protocol}）`))s.promptTemplate+=text;}
    const goPilot=ISOLATED_GO_JSON_PILOTS[s.id];
    if(goPilot){s.requirements.isolatedGoJson=goPilot.contract;s.scenarioVersion=goPilot.contract.protocol==='isolated-go-json-v2'?'4.2.0':'4.1.0';s.environmentImage=GO_JSON_IMAGE;
      const notice='\n\n执行接口契约（isolated-go-json-v1）：提交题面指定的Go声明，运行于固定Go 1.21容器；有限适配器只构造题面涉及的channel、切片、error或字符串输入。期望值与判分留在宿主。无文件、网络或完整Go运行时兼容性承诺；仅验证指定返回、别名或错误链观测，不认证race、调度公平性、性能或一般并发语义。';
      const text=goPilot.contract.protocol==='isolated-go-json-v2'?notice.replaceAll('isolated-go-json-v1','isolated-go-json-v2')+' 本协议以Go race detector作为额外失败证据；即使返回值正确，检测到数据竞争仍不通过。':notice;
      if(!s.promptTemplate.includes(`执行接口契约（${goPilot.contract.protocol}）`))s.promptTemplate+=text;}
    const phpV2Pilot=ISOLATED_PHP_JSON_V2_PILOTS[s.id];
    if(phpV2Pilot){s.requirements.isolatedPhpJson=phpV2Pilot.contract;s.scenarioVersion='4.5.0';s.environmentImage=PHP_JSON_V2_IMAGE;
      const notice='\n\n执行接口契约（isolated-php-json-v2）：提交题面指定的PHP函数或类，运行于固定PHP 8.2容器；有限适配器只构造题面涉及的临时CSV、只读配置和模板文件。期望值与判分留在宿主；验证逐行生成、句柄生命周期、版本化缓存失效及确定性模板路径。无网络、任意文件系统、完整OPcache性能或一般反射语义认证。';
      if(!s.promptTemplate.includes('执行接口契约（isolated-php-json-v2）'))s.promptTemplate+=notice;
      if(s.id==='CP-L3-PHP-004'){
        s.promptTemplate=s.promptTemplate
          .replace('且循环内反复 json_encode 造成浪费。','且循环内反复计算配置与模板路径造成浪费。')
          .replace('路径确定化（OPcache 可命中）；不变量提升到循环外；','路径确定化（OPcache 可命中）；将配置读取与模板路径等循环不变量提升到循环外；')
          .replace('// BUG —— 时间戳后缀击穿 OPcache；json_encode 是不变量却在循环内','// BUG —— 时间戳后缀击穿 OPcache；配置读取与模板路径应在循环外确定');
        s.sourceCode=s.sourceCode.replace('// BUG —— 时间戳后缀击穿 OPcache；json_encode 是不变量却在循环内','// BUG —— 时间戳后缀击穿 OPcache；配置读取与模板路径应在循环外确定');
        s.requirements.initialCode=s.sourceCode;
        const setup="$cfg=__DIR__.'/config.json';$dir=__DIR__.'/tpl';$tpl=$dir.'/home.php';file_put_contents($cfg,'{\"factor\":2}');if(!is_dir($dir))mkdir($dir);file_put_contents($tpl,\"<?php echo 'T';\");";
        const cleanup="if(file_exists($tpl))unlink($tpl);if(is_dir($dir))rmdir($dir);if(file_exists($cfg))unlink($cfg);";
        const codes=[
          `${setup}\ntry{$m=new ReflectionMethod('Config','invalidate');if(!$m->isPublic()||!$m->isStatic()||$m->getNumberOfParameters()!==1||(string)$m->getParameters()[0]->getType()!=='string')throw new Exception('invalidate must be public static with one string parameter');Config::invalidate('v1');if(Config::get('factor')!==2)throw new Exception('initial config');$p=new ReflectionProperty('Config','cache');$p->setAccessible(true);$p->setValue(null,['factor'=>9]);Config::invalidate('v1');if(Config::get('factor')!==9)throw new Exception('same version must retain cache');Config::invalidate('v2');if(Config::get('factor')!==2)throw new Exception('new version must reload config');}finally{${cleanup}}`,
          `${setup}\ntry{$a=Templates::render('home',['a']);$b=Templates::render('home',['bb']);if($a!=='T'.strlen(json_encode(['factor'=>2,'item'=>'a']))||$b!=='T'.strlen(json_encode(['factor'=>2,'item'=>'bb'])))throw new Exception('deterministic template was not included');}finally{${cleanup}}`,
          `${setup}\ntry{$vars=['alpha','beta','gamma'];$out=Templates::render('home',$vars);$expected='';foreach($vars as $v)$expected.='T'.strlen(json_encode(['factor'=>2,'item'=>$v]));if($out!==$expected)throw new Exception('render output mismatch');}finally{${cleanup}}`,
          `${setup}\ntry{if(Templates::render('home',[])!=='')throw new Exception('empty vars');if(Config::get('nonexistent_key')!==null)throw new Exception('missing key');}finally{${cleanup}}`,
        ];
        const descriptions=['版本相同时保留缓存、版本变化时重新加载，且签名严格','确定性模板路径实际命中固定模板','固定配置与模板下渲染输出逐字符一致','空输入与缺失键容错'];
        s.hiddenTests.forEach((t,i)=>{t.testCode=codes[i];t.description=descriptions[i];});
        s.requirements.hiddenTests=s.hiddenTests.map(t=>({code:t.testCode,description:t.description}));
      }
    }
    const pythonPilot=ISOLATED_PYTHON_JSON_PILOTS[s.id];
    if(pythonPilot){s.requirements.isolatedPythonJson=pythonPilot.contract;s.scenarioVersion='4.6.0';s.environmentImage=CONTAINER_IMAGES.python;
      const notice='\n\n执行接口契约（isolated-python-json-v1）：提交题面指定的Python函数或类，运行于固定Python 3.12容器；有限适配器只构造题面涉及的列表、回调、状态存储或依赖图。期望值与判分留在宿主；验证跨调用状态、对象身份、异常类型、回调幂等和拓扑约束。无网络、任意依赖、性能或一般对象语义认证。';
      if(!s.promptTemplate.includes('执行接口契约（isolated-python-json-v1）'))s.promptTemplate+=notice;}
    const javascriptPilot=ISOLATED_JAVASCRIPT_JSON_PILOTS[s.id];
    if(javascriptPilot){s.requirements.isolatedJavascriptJson=javascriptPilot.contract;s.scenarioVersion='4.7.0';s.environmentImage=CONTAINER_IMAGES.javascript;
      if(s.id==='PR-ELITE-003')s.functionName=s.requirements.functionName='BankService';
      if(s.id==='PR-ELITE-006')s.functionName=s.requirements.functionName='parseQueryString';
      if(s.id==='PR-ELITE-007')s.functionName=s.requirements.functionName='fetchWithRetry';
      const notice='\n\n执行接口契约（isolated-javascript-json-v1）：提交题面指定的JavaScript函数或类，运行于固定Node容器；有限适配器只构造题面涉及的闭包、回调、定时器、事件、缓存、Agent步骤、受控fetch响应或Promise任务。期望值与判分留在宿主；验证调用次数、this/参数、状态转移、预算/重试边界、原型污染、原子性、查询串边界、并发上限和题面性能界限。无网络、任意Node API、调度公平性或长期负载认证。';
      if(!s.promptTemplate.includes('执行接口契约（isolated-javascript-json-v1）'))s.promptTemplate+=notice;
      if(s.id==='CP-L2-JS-002'){
        const t=s.hiddenTests.find(t=>t.id==='CP-L2-JS-002-hidden-3');
        t.testCode="const b=new Bus();let a=0,c=0;const g=()=>c++;const f=()=>{a++;b.off('e',g)};b.on('e',f);b.on('e',g);b.emit('e');b.off('none',()=>{});b.emit('none');if(a!==1||c!==1)throw new Error('emit snapshot semantics');console.log('PASS');";
        t.description='emit期间移除监听器不影响本次快照遍历，空事件仍容错';
        s.requirements.hiddenTests=s.hiddenTests.map(x=>({code:x.testCode,description:x.description}));
      }}
    const sqlPilot=ISOLATED_SQL_JSON_PILOTS[s.id];
    if(sqlPilot){s.requirements.isolatedSqlJson=sqlPilot.contract;s.scenarioVersion='4.8.0';s.environmentImage='node:22-alpine';s.functionName=s.requirements.functionName='query';
      if(!s.hiddenTests?.length)s.hiddenTests=sqlPilot.contract.cases.map(k=>({id:k.id,type:'hidden',testCode:'host-owned isolated SQL result/plan observation',description:'宿主结果集与执行计划验证',expectedExitCode:0}));
      s.requirements.hiddenTests=s.hiddenTests.map(t=>({code:t.testCode,description:t.description}));
      const notice='\n\n执行接口契约（isolated-sql-json-v1）：仅提交一条SQLite兼容查询。每组schema与seed在无网络、只读容器中重建；候选查询只能看到输入数据库，期望结果和计划约束由宿主保存并比较。结果列名、NULL、排序与执行计划均属于验收内容；不认证其他SQL方言或生产规模绝对耗时。';
      if(!s.promptTemplate.includes('执行接口契约（isolated-sql-json-v1）'))s.promptTemplate+=notice;}
    const typescriptPilot=ISOLATED_TYPESCRIPT_JSON_PILOTS[s.id];
    if(typescriptPilot){s.requirements.isolatedTypescriptJson=typescriptPilot.contract;s.scenarioVersion='4.9.0';s.environmentImage='node:22-alpine';
      const notice='\n\n执行接口契约（isolated-typescript-json-v1）：提交题面指定的TypeScript函数，运行于固定Node 22只读容器；仅允许Node可直接擦除的类型语法。输入由有限适配器构造，期望值与判分保留在宿主；验证返回值、异步生成器惰性/异常传播或穷尽分支行为。无网络、任意Node API、完整TypeScript降级编译或性能认证。';
      if(!s.promptTemplate.includes('执行接口契约（isolated-typescript-json-v1）'))s.promptTemplate+=notice;}
    const typescriptTypePilot=ISOLATED_TYPESCRIPT_TYPE_PILOTS[s.id];
    if(typescriptTypePilot){s.requirements.isolatedTypescriptType=typescriptTypePilot.contract;s.scenarioVersion='5.0.0';s.environmentImage='trusted-typescript-compiler-worker';
      if(!s.hiddenTests?.length)s.hiddenTests=typescriptTypePilot.contract.cases.map(k=>({id:k.id,type:'hidden',testCode:'host-owned strict TypeScript compiler assertion',description:k.description,expectedExitCode:0}));
      s.requirements.hiddenTests=s.hiddenTests.map(t=>({code:t.testCode,description:t.description}));
      const notice='\n\n执行接口契约（isolated-typescript-type-v1）：候选源码只由受内存与时限约束的可信TypeScript编译器进程执行strict类型检查，不执行候选JavaScript。宿主分别验证正向类型断言必须通过、负向误用必须被拒绝；测试源码和判决保留在宿主。';
      if(!s.promptTemplate.includes('执行接口契约（isolated-typescript-type-v1）'))s.promptTemplate+=notice;}
    const fixtureExitPilot=ISOLATED_FIXTURE_EXIT_PILOTS[s.id];
    if(fixtureExitPilot){s.requirements.isolatedFixtureExit=fixtureExitPilot.contract;s.scenarioVersion='5.1.0';
      if(!s.hiddenTests?.length)s.hiddenTests=fixtureExitPilot.contract.caseIds.map(id=>({id,type:'hidden',testCode:'host-owned compiler/runtime observation',description:'宿主编译、压力或静态契约验证',expectedExitCode:0}));
      s.requirements.hiddenTests=s.hiddenTests.map(t=>({code:t.testCode,description:t.description}));
      if(s.id==='CP-L2-CC-001')s.requirements.fixture={...(s.requirements.fixture??{}),memoryCheck:'valgrind'};
      const notice='\n\n执行接口契约（isolated-fixture-exit-v1）：候选实现与宿主掌握的版本化断言在固定、无网络容器中逐例编译运行；宿主同时检查编译、退出状态与不可伪造的运行完成证据，并独立汇总判分。并发/健全性题另运行固定压力、Miri或源码契约检查。测试断言不作为模型输出的一部分。';
      if(!s.promptTemplate.includes('执行接口契约（isolated-fixture-exit-v1）'))s.promptTemplate+=notice;}
    if (pilot?.migrationBatch === 2) s.scenarioVersion = '3.3.0';
    if (pilot?.migrationBatch === 3) {
      s.scenarioVersion = '3.6.0';
      const notice='\n\n执行接口契约（isolated-json-v2）：保持Python函数签名，同时支持题面中的位置参数与关键字参数调用；返回普通JSON兼容数值，不返回布尔值、字符串或自行生成的测试报告。本题仅验证调用返回值，不认证真实网络请求、重试次数或其他内部行为。';
      if(!s.promptTemplate.includes('执行接口契约（isolated-json-v2）'))s.promptTemplate+=notice;
    }
    if (pilot?.migrationBatch === 4) {
      s.scenarioVersion = '3.7.0';
      const notice='\n\n执行接口契约（isolated-json-v3）：返回普通JSON兼容数据，只接受有限数值，不以布尔值、字符串、NaN/Infinity或负零代替数值。比较由宿主执行：原精确值断言仍精确比较，原浮点误差断言保留其严格小于边界；不自行输出测试报告。本题仅验证返回数据，不认证内部实现或通用Python类型系统。';
      if(!s.promptTemplate.includes('执行接口契约（isolated-json-v3）'))s.promptTemplate+=notice;
      if(s.id==='CP-L2-PY-004'&&!s.promptTemplate.includes('无时区偏移的输入按UTC解释'))s.promptTemplate+=' 无时区偏移的输入按UTC解释；带偏移的输入先换算UTC，返回b相对a的有符号小时差。';
    }
    if (pilot?.migrationBatch === 5) {
      s.scenarioVersion = '3.8.0'; s.environmentImage=PHP_JSON_IMAGE;
      const notice='\n\n执行接口契约（isolated-php-json-v1）：提交题面指定的PHP函数，运行于固定PHP 8.2 CLI容器；参数与返回值限普通JSON数据。判分由宿主按类型和值精确比较，不接受松散类型相等、额外输出、NaN/Infinity或自行生成的测试报告。无文件、网络或完整PHP扩展兼容性承诺；仅验证返回数据，不认证内部调用、复杂度或常量时间。';
      if(!s.promptTemplate.includes('执行接口契约（isolated-php-json-v1）'))s.promptTemplate+=notice;
    }
    const observed = QUICKJS_OBSERVATION_PILOTS[s.id];
    if (observed) {
      s.requirements.quickJsObservation = observed.contract; s.scenarioVersion = '3.4.0'; s.environmentImage=QUICKJS_RUNTIME_IMAGE;
      // Runtime restrictions must be solver-visible, not discovered as an
      // unexplained failure after submitting otherwise valid Node code.
      const executionNotice = '\n\n执行环境契约（quickjs-observation-v1）：提交独立、同步的JavaScript函数，使用题面指定函数名。运行于受限QuickJS/WASM，不是完整Node.js：无模块导入、process、require、文件、网络、定时器，未开放Proxy、Map/Set、Date或类型化数组；不得返回Promise或安排异步任务。参数及返回数据限普通JSON数据树（可正常抛出题目要求的异常）；返回结果不接受访问器、自定义原型、稀疏数组、循环引用、符号、NaN/Infinity或负零。每组调用执行预算1秒，WASM内存32MB。请直接计算结果，不输出测试报告或自行报告异常/对象身份。';
      const protocol=observed.contract.protocol;
      if(protocol==='quickjs-observation-v2')s.scenarioVersion='3.5.0';
      if (!s.promptTemplate.includes(`执行环境契约（${protocol}）`)) {
        s.promptTemplate += executionNotice.replaceAll('quickjs-observation-v1',protocol);
        if(protocol==='quickjs-observation-v2')s.promptTemplate+=' 异常消息须为实际抛出值上（或其原型链上）的字符串数据属性；不执行message访问器或对象转字符串方法。返回字符串的局部包含/不包含断言按字面、区分大小写比较。';
      }
      // This source prompt had an unclosed code fence; keep runtime prose out
      // of the example function's code block, without revealing an answer.
      if(s.id==='CP-L3-SEC-JS-002'&&(s.promptTemplate.match(/```/g)||[]).length===1)
        s.promptTemplate=s.promptTemplate.replace('\n\n执行环境契约','\n```\n\n执行环境契约');
    }
    // Repair inert equality expressions in the legacy TS diagnostic fixture too.
    // Formal scoring uses host-side values, not these assertions.
    if (s.id === 'CP-L1-TS-001') {
      for (const t of s.hiddenTests) if (!t.testCode.startsWith('if (!(')) t.testCode = 'if (!(' + t.testCode + ')) throw Error("getCity mismatch");';
      for (const t of s.requirements.hiddenTests) if (!t.code.startsWith('if (!(')) t.code = 'if (!(' + t.code + ')) throw Error("getCity mismatch");';
    }
  } else if (s.grader === 'llm_judge') {
    s.graderVersion = '2.1.0'; s.scenarioVersion = '3.1.0'; s.language = 'pr_review';
    s.requirements.judge_config.require_structured_output = true;
    s.requirements.judge_config.rubric_version = 'pr-evidence-v2';
    for (const g of s.requirements.judge_ground_truth) {
      g.conceptGroups = prGroups[s.id][g.id];
      // Areas were not disclosed to candidates; ground findings by actual diff file instead.
      if (s.id === 'PR-ELITE-013') { g.file = g.id === 'A5' ? 'src/sharding/router.ts' : g.id === 'A6' ? 'src/sharding/hash.ts' : 'docs/rfc/0021-tenant-sharding.md'; delete g.area; }
      if (g.id === 'A1') g.finding = '缺少历史回填与双写差异对账，切读时可能读到缺失或不一致数据；需要校验与修复路径，不能声称必然且不可逆。';
    }
    s.requirements.prompt = s.requirements.prompt.replace('4 文件 PR','5 文件 PR');
    s.promptTemplate = s.promptTemplate.replace('4 文件 PR','5 文件 PR');
    const context = s.id === 'PR-ELITE-012'
      ? '\n评审边界：string.ts的v限定为普通字符串或有限数字；JWT风险须说明PUBLIC_KEY缺失、DEBUG开关或库行为等触发条件，不假定未知依赖版本必然接受无签名。幂等检查包括合并后仍保留的并发风险，不要求把既有缺陷说成本次引入。'
      : '\n评审边界：评估题面明确给出的迁移与路由约束；不能把缺少校验的风险断言为必然且永久不可恢复。';
    if (!s.promptTemplate.includes('输出契约：仅返回严格 JSON')) s.promptTemplate += context + prContract;
    if (!s.requirements.prompt.includes('输出契约：仅返回严格 JSON')) s.requirements.prompt += context + prContract;
    // Remove answer-bearing editorial comments while retaining operational facts.
    for (const key of ['promptTemplate']) s[key] = s[key].replaceAll('   // 无 NX / 无原子性','').replaceAll('// FNV-1a —— 选择合理，无需质疑','// FNV-1a');
    s.requirements.diff = s.requirements.diff.replaceAll('   // 无 NX / 无原子性','').replaceAll('// FNV-1a —— 选择合理，无需质疑','// FNV-1a');
  } else continue;
  // Automated contract audit is not independent human approval.
  s.scenarioHash = hashScenarioShort(s);
  changed.push({id:s.id,grader:s.grader,graderVersion:s.graderVersion,scenarioHash:s.scenarioHash});
}
writeFileSync(bankPath, JSON.stringify(bank,null,1)+'\n');
const metaPath = new URL('../data/scenarios/benchmark-meta.json', import.meta.url);
const meta = JSON.parse(readFileSync(metaPath,'utf8'));
meta.version='1.28.0'; meta.executionReview='code-4.14-all-single-file-repairs-host-verdict-instruction-6-pr-2.1-semantic-gate';
meta.executionIsolation={protocols:['isolated-json-v1','isolated-json-v2','isolated-json-v3','isolated-php-json-v1','isolated-php-json-v2','isolated-python-json-v1','isolated-javascript-json-v1','isolated-sql-json-v1','isolated-typescript-json-v1','isolated-typescript-type-v1','isolated-fixture-exit-v1','isolated-java-json-v1','isolated-java-json-v2','isolated-csharp-json-v1','isolated-csharp-json-v2','isolated-go-json-v1','isolated-go-json-v2','quickjs-observation-v1','quickjs-observation-v2'],pilots:[...Object.keys(ISOLATED_JSON_PILOTS),...Object.keys(ISOLATED_JAVA_JSON_PILOTS),...Object.keys(ISOLATED_CSHARP_JSON_PILOTS),...Object.keys(ISOLATED_GO_JSON_PILOTS),...Object.keys(ISOLATED_PHP_JSON_V2_PILOTS),...Object.keys(ISOLATED_PYTHON_JSON_PILOTS),...Object.keys(ISOLATED_JAVASCRIPT_JSON_PILOTS),...Object.keys(ISOLATED_SQL_JSON_PILOTS),...Object.keys(ISOLATED_TYPESCRIPT_JSON_PILOTS),...Object.keys(ISOLATED_TYPESCRIPT_TYPE_PILOTS),...Object.keys(ISOLATED_FIXTURE_EXIT_PILOTS),...Object.keys(QUICKJS_OBSERVATION_PILOTS)],
  pendingCodeRepair:bank.filter(s=>s.grader==='code_repair'&&s.expectedVerdict!=='no_bug'&&!s.requirements?.isolatedJson&&!s.requirements?.isolatedJavaJson&&!s.requirements?.isolatedCsharpJson&&!s.requirements?.isolatedGoJson&&!s.requirements?.isolatedPhpJson&&!s.requirements?.isolatedPythonJson&&!s.requirements?.isolatedJavascriptJson&&!s.requirements?.isolatedSqlJson&&!s.requirements?.isolatedTypescriptJson&&!s.requirements?.isolatedTypescriptType&&!s.requirements?.isolatedFixtureExit&&!s.requirements?.quickJsObservation).length,
  fullAcceptance:false,independentHumanGold:false};
writeFileSync(metaPath, JSON.stringify(meta,null,1)+'\n');
const sources = [
  'packages/core/src/execution/isolatedJson.ts', 'packages/core/src/execution/execAsync.ts',
  'packages/core/src/execution/isolatedJson.test.ts','packages/core/src/execution/isolatedJson.integration.test.ts',
  'packages/core/src/execution/jsonValuePredicate.ts','packages/core/src/execution/jsonValuePredicate.test.ts',
  'packages/core/src/evaluationLab/isolatedJsonNumericGold.ts',
  'packages/core/src/execution/isolatedPhpJson.ts','packages/core/src/execution/isolatedPhpJsonV2.test.ts','packages/core/src/execution/isolatedPhpJsonV2.integration.test.ts','packages/core/src/evaluationLab/isolatedPhpJsonV2Gold.ts',
  'packages/core/src/execution/isolatedPythonJson.ts','packages/core/src/execution/isolatedPythonJson.test.ts','packages/core/src/evaluationLab/isolatedPythonJsonGold.ts','packages/core/src/evaluationLab/isolatedPythonJsonV2Gold.ts','packages/core/src/evaluationLab/isolatedPythonJsonV3Gold.ts',
  'packages/core/src/execution/isolatedJavascriptJson.ts','packages/core/src/execution/isolatedJavascriptJson.test.ts','packages/core/src/execution/isolatedJavascriptJson.integration.test.ts','packages/core/src/evaluationLab/isolatedJavascriptJsonGold.ts',
  'packages/core/src/execution/isolatedSqlJson.ts','packages/core/src/execution/isolatedSqlJson.test.ts','packages/core/src/evaluationLab/isolatedSqlJsonGold.ts',
  'packages/core/src/execution/isolatedTypescriptJson.ts','packages/core/src/evaluationLab/isolatedTypescriptJsonGold.ts','packages/core/src/execution/isolatedTypescriptType.ts','packages/core/src/execution/typescriptTypeWorker.ts','packages/core/src/evaluationLab/isolatedTypescriptTypeGold.ts','packages/core/src/execution/isolatedTypescriptMigration.test.ts','packages/core/src/execution/isolatedTypescriptMigration.integration.test.ts',
  'packages/core/src/execution/isolatedFixtureExit.ts','packages/core/src/evaluationLab/isolatedFixtureExitGold.ts','packages/core/src/execution/isolatedFixtureExit.test.ts','packages/core/src/execution/isolatedFixtureExit.integration.test.ts',
  'packages/core/src/evaluationLab/isolatedPhpJsonGold.ts','packages/core/src/execution/isolatedPhpJson.test.ts',
  'packages/core/src/execution/isolatedJavaJson.ts','packages/core/src/execution/isolatedJavaJson.test.ts','packages/core/src/execution/isolatedJavaJson.integration.test.ts',
  'packages/core/src/evaluationLab/isolatedJavaJsonGold.ts',
  'packages/core/src/execution/isolatedCsharpJson.ts','packages/core/src/execution/isolatedCsharpJson.test.ts','packages/core/src/execution/isolatedCsharpJson.integration.test.ts',
  'packages/core/src/evaluationLab/isolatedCsharpJsonGold.ts',
  'packages/core/src/execution/isolatedGoJson.ts','packages/core/src/execution/isolatedGoJson.test.ts','packages/core/src/execution/isolatedGoJson.integration.test.ts',
  'packages/core/src/evaluationLab/isolatedGoJsonGold.ts',
  'packages/core/src/evaluationLab/isolatedJsonGold.ts',
  'packages/core/src/execution/quickJsObservation.ts','packages/core/src/execution/quickJsObserverDriver.ts',
  'packages/core/src/evaluationLab/quickJsObservationGold.ts','packages/core/src/evaluationLab/quickJsObservationAttacks.ts',
  'packages/core/src/evaluationLab/quickJsObservationV2Gold.ts','packages/core/src/execution/quickJsObservationV2.test.ts',
  'packages/core/package.json','pnpm-lock.yaml',
  'docs/execution-all-single-file-v4.14.md',
  'packages/core/src/contracts/registry.ts', 'packages/core/src/contracts/canonicalize.ts',
  'scripts/upgrade-execution-review-v2.mjs', 'scripts/sync-reviewed-question-contracts.mjs', 'scripts/test-containers.mjs',
  'packages/core/src/orchestrator.ts', 'apps/server/src/routes/index.ts',
  'packages/core/src/evaluationLab/deepAdversarial.ts',
  'packages/core/src/evaluators/codeRepair.ts','packages/core/src/evaluators/instructionChecklist.ts','packages/core/src/evaluators/llmJudge.ts',
  'packages/core/src/sandbox/index.ts', ...['completion','containerRunner','phpRunner','bashRunner','cRunner','csharpRunner','goRunner','javaRunner','rustRunner','sqlRunner'].map(f=>'packages/core/src/execution/'+f+'.ts'),
];
const sourceHashes = Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url),'utf8').replaceAll('\r\n','\n')).digest('hex')]));
writeFileSync(new URL('../data/scenarios/execution-review-manifest.json',import.meta.url),JSON.stringify({version:'execution-review-2026-09-13-all-single-file',reviewType:'automated-contract-and-regression-audit',independentHumanReview:false,sourceHashNormalization:'UTF-8, CRLF to LF',sourceHashes,scenarios:changed},null,2)+'\n');
console.log(JSON.stringify({updated:changed.length,counts:changed.reduce((a,s)=>(a[s.grader]=(a[s.grader]??0)+1,a),{})}));
