import { parseMarkup, descendants, directChildren, nodeText, parseYamlDocuments,
  parseTomlDocument, parseMarkdownBlocks, parseMermaidStructure, tokenizeSql,
  type MarkupNode } from '../parsers/textStructure.js';

export interface TextCheck { label: string; pass: boolean }
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const path = (value: unknown, route: string): unknown => route.split('.').reduce<unknown>((node, key) => object(node)?.[key], value);
const filled = (value: unknown): boolean => value !== null && value !== undefined && value !== '';
const keyCount = (value: unknown): number => Object.keys(object(value) ?? {}).length;
const present = (value: unknown, ...keys: string[]): boolean => keys.every(key => filled(object(value)?.[key]));
const children = (node: MarkupNode | undefined, name: string): MarkupNode[] => node ? directChildren(node, name) : [];
const child = (node: MarkupNode | undefined, name: string): MarkupNode | undefined => children(node, name)[0];
const text = (node: MarkupNode | undefined): string => node ? nodeText(node).trim().replace(/&amp;/g, '&') : '';
const all = (node: MarkupNode | undefined, name: string): MarkupNode[] => node ? descendants(node, name) : [];
const hasText = (value: string, pattern: RegExp): boolean => pattern.test(value);
const serialized = (value: unknown): string => JSON.stringify(value) ?? '';
const isRed = (value: string): boolean => {
  if (/^red$/i.test(value)) return true;
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (!hex) return false;
  const r = parseInt(hex[1].slice(0,2),16), g = parseInt(hex[1].slice(2,4),16), b = parseInt(hex[1].slice(4,6),16);
  return r >= 120 && r > g * 1.4 && r > b * 1.4;
};

export function evaluateStructuredTextContract(id: string, format: string, source: string,
  version: 'v1' | 'v2' = 'v2'): TextCheck[] {
  const checks: TextCheck[] = [];
  const add = (label: string, pass: boolean) => checks.push({ label, pass: Boolean(pass) });
  if (format === 'yaml') {
    const parsed = parseYamlDocuments(source);
    add('YAML parses with valid nesting, anchors, and unique keys', parsed.errors.length === 0);
    const docs = parsed.value ?? [], root = docs[0];
    if (id === 'SO-CN-008') {
      add('application name and version are configured', present(path(root,'app') ?? path(root,'application') ?? root,'name','version'));
      add('server includes host, port, timeout', present(path(root,'server'),'host','port') &&
        filled(path(root,'server.timeout') ?? path(root,'server.timeout_seconds')));
      add('database includes connection and pool settings', present(path(root,'database'),'type','host','port') &&
        filled(path(root,'database.name') ?? path(root,'database.database')) &&
        filled(path(root,'database.pool_size') ?? path(root,'database.poolSize') ?? path(root,'database.connection_pool_size')));
      add('logging and cache include their required settings', present(path(root,'logging'),'level') &&
        filled(path(root,'logging.file_path') ?? path(root,'logging.file') ?? path(root,'logging.path')) && filled(path(root,'logging.rotation')) &&
        present(path(root,'cache'),'type') && filled(path(root,'cache.ttl') ?? path(root,'cache.ttl_seconds')) &&
        filled(path(root,'cache.max_memory') ?? path(root,'cache.maxMemory')));
      add('development and production are separate configurations',
        object(path(root,'environments.development')) !== null && object(path(root,'environments.production')) !== null);
    } else if (id === 'SO-CN-010') {
      add('Deployment API and kind are exact', path(root,'apiVersion') === 'apps/v1' && path(root,'kind') === 'Deployment');
      add('metadata contains name, namespace, labels', present(path(root,'metadata'),'name','namespace') && keyCount(path(root,'metadata.labels')) > 0);
      add('replicas and selector are nested under spec', path(root,'spec.replicas') === 3 && keyCount(path(root,'spec.selector.matchLabels')) > 0);
      const containers = array(path(root,'spec.template.spec.containers'));
      add('pod template defines exactly two containers', containers.length === 2);
      add('main container defines image, ports, resources, env and mounts', containers.some(c =>
        filled(path(c,'image')) && array(path(c,'ports')).length > 0 &&
        object(path(c,'resources.requests')) !== null && object(path(c,'resources.limits')) !== null &&
        array(path(c,'env')).length >= 3 && array(path(c,'volumeMounts')).length > 0));
      const volumes = array(path(root,'spec.template.spec.volumes'));
      add('pod has configMap and emptyDir volumes', volumes.some(v => object(path(v,'configMap')) !== null)
        && volumes.some(v => object(path(v,'emptyDir')) !== null));
      add('rolling update strategy is selected', path(root,'spec.strategy.type') === 'RollingUpdate');
    } else if (id === 'SO-CN-012') {
      add('CI stages are in the required order', JSON.stringify(path(root,'stages')) === JSON.stringify(['lint','test','build','deploy']));
      add('CI variables contain at least four entries', keyCount(path(root,'variables')) >= 4);
      const jobs = Object.entries(object(root) ?? {}).filter(([,value]) => object(value)?.stage);
      const byStage = (stage: string) => jobs.filter(([,value]) => path(value,'stage') === stage);
      add('lint, test, build and deploy jobs are assigned to stages', ['lint','test','build','deploy'].every(stage => byStage(stage).length > 0));
      add('test jobs run unit and integration work in parallel', byStage('test').some(([,value]) =>
        filled(path(value,'parallel'))) && /unit|单元/i.test(serialized(byStage('test'))) &&
        /integration|集成/i.test(serialized(byStage('test'))));
      add('production deploy is manual and staging deploy exists', byStage('deploy').some(([,value]) =>
        /production/i.test(serialized(value)) && path(value,'when') === 'manual') &&
        byStage('deploy').some(([,value]) => /staging/i.test(serialized(value))));
      add('cache, artifacts and branch filtering are configured', (filled(path(root,'cache')) || jobs.some(([,value]) => filled(path(value,'cache')))) &&
        (filled(path(root,'artifacts')) || jobs.some(([,value]) => filled(path(value,'artifacts')))) &&
        jobs.some(([,value]) => filled(path(value,'only')) || filled(path(value,'except'))));
    } else if (id === 'SO-CN-032') {
      add('there are exactly two YAML documents', docs.length === 2);
      add('anchor and alias are defined within the first document', /metadata:\s*&defaultMeta/.test(source.split(/^---\s*$/m)[0] ?? '')
        && /\*defaultMeta/.test(source.split(/^---\s*$/m)[0] ?? ''));
      add('both documents contain Kubernetes core fields', docs.length === 2 && docs.every(d =>
        present(d,'apiVersion','kind') && present(path(d,'metadata'),'name') &&
        keyCount(path(d,'metadata.labels')) >= 2 && filled(path(d,'spec.replicas')) &&
        array(path(d,'spec.containers')).length > 0 &&
        array(path(d,'spec.containers')).every(c => present(c,'name','image'))));
    } else if (id === 'SO-CN-033') {
      const services = path(root,'services');
      add('web, api and db are distinct services', ['web','api','db'].every(name => object(path(services,name)) !== null));
      add('web maps port 8080 and depends on api', filled(path(services,'web.image')) &&
        array(path(services,'web.ports')).some(p => String(p).includes('8080')) &&
        serialized(path(services,'web.depends_on')).includes('api'));
      add('api has build, three environment variables, db dependency and healthcheck',
        filled(path(services,'api.build')) && (keyCount(path(services,'api.environment')) >= 3 || array(path(services,'api.environment')).length >= 3) &&
        serialized(path(services,'api.depends_on')).includes('db') && filled(path(services,'api.healthcheck')));
      add('db uses postgres, mounts volume and declares password', /postgres/i.test(String(path(services,'db.image') ?? '')) &&
        array(path(services,'db.volumes')).length > 0 &&
        serialized(path(services,'db.environment')).includes('POSTGRES_PASSWORD'));
      add('top-level networks and volumes are used by services', keyCount(path(root,'networks')) > 0 &&
        keyCount(path(root,'volumes')) > 0 && Object.values(object(services) ?? {}).some(s => array(path(s,'networks')).length > 0));
      add('restart policy is configured on services', Object.values(object(services) ?? {}).every(s => filled(path(s,'restart'))));
    }
  } else if (format === 'toml') {
    const parsed = parseTomlDocument(source);
    add('TOML parses with tables, arrays and unique keys', parsed.errors.length === 0);
    const root = parsed.value;
    const depsHaveVersions = (value: unknown, count: number) => Object.values(object(value) ?? {}).filter(dep =>
      typeof dep === 'string' && dep.length > 0 || filled(path(dep,'version'))).length >= count;
    if (id === 'SO-CN-026') {
      add('package metadata is complete', present(path(root,'package'),'name','version','edition','authors','description','license'));
      add('dependency tables meet counts and have versions', depsHaveVersions(path(root,'dependencies'),5) && depsHaveVersions(path(root,'dev-dependencies'),2));
      add('features contain default and two optional entries', filled(path(root,'features.default')) && keyCount(path(root,'features')) >= 3);
      add('two binary targets have names and paths', array(path(root,'bin')).length === 2 && array(path(root,'bin')).every(b => present(b,'name','path')));
      add('release profile and comments are present', keyCount(path(root,'profile.release')) > 0 && /^\s*#/m.test(source));
    } else if (id === 'SO-CN-039') {
      add('workspace members and resolver are defined', array(path(root,'workspace.members')).length >= 3 && filled(path(root,'workspace.resolver')));
      add('workspace package metadata is complete', present(path(root,'workspace.package'),'version','edition','license','authors'));
      add('four shared dependencies include versions', depsHaveVersions(path(root,'workspace.dependencies'),4));
      add('root package metadata is complete', present(path(root,'package'),'name','version','edition'));
      add('two binary targets have names and paths', array(path(root,'bin')).length === 2 && array(path(root,'bin')).every(b => present(b,'name','path')));
      add('features and release profile have required counts', filled(path(root,'features.default')) &&
        keyCount(path(root,'features')) >= 3 && keyCount(path(root,'profile.release')) >= 3);
      add('TOML contains comments', /^\s*#/m.test(source));
    }
  } else if (format === 'xml') {
    const parsed = parseMarkup(source);
    add('XML/SVG parses with proper nesting, entities and attributes', parsed.errors.length === 0);
    const root = parsed.value;
    if (id === 'SO-CN-014') {
      add('SOAP 1.2 Envelope namespace is correct', root?.name.endsWith(':Envelope') === true &&
        Object.entries(root.attrs).some(([key,value]) => key.startsWith('xmlns:') && value === 'http://www.w3.org/2003/05/soap-envelope'));
      const body = root?.children.find(node => node.name.endsWith(':Body'));
      const operation = body?.children.find(node => node.name.endsWith(':GetWeather'));
      add('weather operation is inside SOAP Body', Boolean(operation) &&
        (Object.values(root?.attrs ?? {}).includes('http://example.com/weather') ||
          Object.values(operation?.attrs ?? {}).includes('http://example.com/weather')));
      add('city and date values are nested in operation', Boolean(operation) &&
        operation!.children.some(node => /city/i.test(node.name) && text(node) === '北京') &&
        operation!.children.some(node => /date/i.test(node.name) && text(node) === '2024-03-20'));
      add('XML declaration is present', /^<\?xml\s+version=/i.test(source.trimStart()));
    } else if (id === 'SO-CN-016') {
      const channel = child(root,'channel'), items = children(channel,'item');
      add('RSS version and channel structure are correct', root?.name === 'rss' && root.attrs.version === '2.0' && Boolean(channel));
      add('channel metadata is complete', Boolean(channel) && ['title','link','description','language','lastBuildDate','ttl'].every(name =>
        Boolean(child(channel,name))) && text(child(channel,'language')).toLowerCase() === 'zh-cn');
      add('at least five complete items exist', items.length >= 5 && items.every(item =>
        ['title','link','description','pubDate','author','category','guid'].every(name => Boolean(child(item,name)))));
      add('item dates, GUID attributes and CDATA HTML are valid', items.length >= 5 && items.every(item =>
        !Number.isNaN(Date.parse(text(child(item,'pubDate')))) && child(item,'guid')?.attrs.isPermaLink === 'false' &&
        /<!\[CDATA\[\s*</.test(child(item,'description')?.rawText ?? '')));
      add('XML declaration is present', /^<\?xml\s+version=/i.test(source.trimStart()));
    } else if (id === 'SO-CN-018' || id === 'SO-CN-038') {
      add('SVG root has namespace and dimensions', root?.name === 'svg' && root.attrs.xmlns === 'http://www.w3.org/2000/svg' &&
        present(root.attrs,'viewBox','width','height'));
      add('SVG contains title and description', Boolean(child(root,'title')) && Boolean(child(root,'desc')));
      if (id === 'SO-CN-018') {
        add('flag has a red rectangular background', all(root,'rect').some(node => isRed(node.attrs.fill ?? '')));
        const reusable = [...all(child(root,'defs'),'polygon'),...all(child(root,'defs'),'path')];
        const reusableIds = new Set(reusable.map(node => node.attrs.id).filter(Boolean));
        const stars = [...all(root,'polygon'), ...all(root,'path')].filter(node => !reusable.includes(node) && (
          /yellow|#(?:ffde00|ffff00|ffd700)/i.test(node.attrs.fill ?? '') ||
          /yellow|#(?:ffde00|ffff00|ffd700)/i.test(root?.children.find(parent => parent.children.includes(node))?.attrs.fill ?? '') ||
          node.name === 'polygon'));
        const reusedStars = all(root,'use').filter(node => reusableIds.has((node.attrs.href ?? node.attrs['xlink:href'] ?? '').replace(/^#/, '')));
        add('five stars are drawn with polygon or path', stars.length + reusedStars.length >= 5);
      } else {
        const defs = child(root,'defs'), uses = all(root,'use');
        const ids = new Set(['path','circle','g','symbol','marker'].flatMap(name => all(defs,name)).map(node => node.attrs.id).filter(Boolean));
        add('defs contain a referenced reusable element used twice', Boolean(defs) && uses.length >= 2 &&
          uses.every(node => ids.has((node.attrs.href ?? node.attrs['xlink:href'] ?? '').replace(/^#/, ''))));
        add('cloud path has a curve and two circles exist', all(root,'path').some(node => /[CQSAcqsa]/.test(node.attrs.d ?? ''))
          && all(root,'circle').length >= 2);
        add('group transform and background rectangle exist', all(root,'g').some(node => filled(node.attrs.transform)) &&
          all(root,'rect').some(node => filled(node.attrs.fill)));
      }
    } else if (id === 'SO-CN-035') {
      const schema = root, receipt = all(schema,'xs:element').find(node => node.attrs.name === 'bookReceipt');
      const sequence = all(receipt,'xs:sequence')[0];
      const elements = children(sequence,'xs:element');
      add('XSD namespace and root are correct', schema?.name === 'xs:schema' &&
        schema.attrs['xmlns:xs'] === 'http://www.w3.org/2001/XMLSchema');
      add('bookReceipt has ordered typed children', Boolean(receipt) && Boolean(sequence) &&
        serialized(elements.map(node => node.attrs.name)) === serialized(['bookTitle','isbn','quantity','supplier']) &&
        elements.every(node => filled(node.attrs.type) || all(node,'xs:simpleType').length > 0));
      add('quantity is positiveInteger and receiptNo attribute exists', elements.find(node => node.attrs.name === 'quantity')?.attrs.type === 'xs:positiveInteger'
        && all(receipt,'xs:attribute').some(node => node.attrs.name === 'receiptNo'));
      add('at least three attributes are defined', all(receipt,'xs:attribute').length >= 3);
    } else if (id === 'SO-CN-049') {
      const quote = root, items = children(child(quote,'items'),'item');
      add('quote root has the exact child order', quote?.name === 'quote' &&
        serialized(quote.children.map(node => node.name)) === serialized(['quoteNo','buyer','items','total']));
      add('buyer name contains escaped or CDATA ampersand',
        text(child(child(quote,'buyer'),'name')).replace(/\s*&\s*/, '&') === '北京机械&电子有限公司');
      add('twelve items each have ordered fields', items.length === 12 && items.every(item =>
        serialized(item.children.map(node => node.name)) === serialized(['sku','name','qty','unitPrice'])));
      const total = items.reduce((sum,item) => sum + Number(text(child(item,'qty'))) * Number(text(child(item,'unitPrice'))),0);
      add('total is a two-decimal sum of item products', items.length === 12 && items.every(item =>
        /^\d+(?:\.\d+)?$/.test(text(child(item,'qty'))) && /^\d+(?:\.\d+)?$/.test(text(child(item,'unitPrice')))) &&
        /^\d+\.\d{2}$/.test(text(child(quote,'total'))) && Math.abs(Number(text(child(quote,'total'))) - total) < 0.001);
      add('required XML declaration is exact', /^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(source.trimStart()));
    }
  } else if (format === 'html') {
    const parsed = parseMarkup(source, true);
    add('HTML has a balanced element tree', parsed.errors.length === 0);
    const root = parsed.value, head = child(root,'head'), body = child(root,'body');
    const bodyText = text(body);
    add('HTML document contains head and body', root?.name === 'html' && Boolean(head) && Boolean(body));
    if (id === 'SO-CN-019') {
      add('email has image with source and inline style', all(body,'img').some(node => filled(node.attrs.src)) &&
        all(body,'table').length > 0 && [body,...all(body,'table'),...all(body,'td')].some(node => filled(node?.attrs.style)));
      add('order, amount, shipping and support content are inside body', /订单/.test(bodyText) && /金额|合计|总计|小计|实付|支付/.test(bodyText) &&
        /配送|收货|地址/.test(bodyText) && /客服|联系|电话|邮箱/.test(bodyText));
      add('mobile layout is described', /viewport|@media|max-width:\s*\d+px/i.test(source));
    } else if (id === 'SO-CN-021') {
      add('resume uses semantic HTML sections', ['header','main','section','article','footer'].every(name => all(root,name).length > 0));
      add('resume covers education, experience, skills and projects', /教育/.test(bodyText) && /工作|经历/.test(bodyText) &&
        /技能/.test(bodyText) && /项目/.test(bodyText));
      add('resume has two experience entries', all(body,'article').length >= 2);
      add('viewport and visible styling are present', all(head,'meta').some(node => node.attrs.name === 'viewport') &&
        (all(root,'style').length > 0 || all(root,'section').some(node => filled(node.attrs.style))));
      add('HTML5 doctype and Chinese content are present', /^<!doctype html>/i.test(source.trimStart()) && /[\u4e00-\u9fff]/.test(bodyText));
    } else if (id === 'SO-CN-023') {
      const classCount = (re: RegExp) => all(body,'div').filter(node => re.test(node.attrs.class ?? '')).length;
      add('dashboard has at least four KPI cards', classCount(/kpi|metric|stat.*card/i) >= 4);
      add('chart has at least twelve bars', classCount(/bar|column/i) >= 12);
      add('orders table has ten data rows', all(body,'table').some(table => all(table,'tr').length >= 11));
      add('CSS uses grid or flex and dark background', /display\s*:\s*(?:grid|flex)/i.test(source) &&
        /background(?:-color)?\s*:\s*(?:#(?:0[0-9a-f]|1[0-9a-f]|2[0-9a-f])[0-9a-f]{4}|rgb\(\s*(?:[0-3]?\d)[, ]+|black)/i.test(source));
      add('currency and Chinese labels are present', /¥|￥|元/.test(bodyText) && /[\u4e00-\u9fff]/.test(bodyText));
      add('HTML5 doctype is present', /^<!doctype html>/i.test(source.trimStart()));
    }
  } else if (format === 'mermaid') {
    const parsed = parseMermaidStructure(source);
    const graph = parsed.value;
    add('Mermaid block structure parses', parsed.errors.length === 0 && Boolean(graph?.type));
    const lines = graph?.lines ?? [];
    const body = lines.join('\n');
    if (id === 'SO-CN-020') {
      add('diagram is a flowchart with connected stages', graph?.type === 'flowchart' && (graph?.edges.length ?? 0) >= 9);
      add('stock and payment both branch to success and failure', /库存/.test(body) && /支付/.test(body)
        && /锁定库存/.test(body) && /通知用户/.test(body) && /发货/.test(body) && /取消订单/.test(body)
        && (graph?.edges.length ?? 0) >= 9);
      add('shipping, receipt and completion are connected', /发货/.test(body) && /签收/.test(body) && /完成/.test(body)
        && (graph?.edges.length ?? 0) >= 9);
    } else if (id === 'SO-CN-022') {
      add('sequence diagram declares six actors', graph?.type === 'sequenceDiagram' && (graph?.participants.length ?? 0) >= 6);
      add('authentication messages connect gateway, service, database and Redis', (graph?.edges.length ?? 0) >= 10 &&
        ['Redis','Token','JWT','数据库'].every(token => body.includes(token)));
      add('success and failure branches are explicit', /^alt\s/m.test(body) && /^else\s/m.test(body) && /^end\s*$/m.test(body));
    } else if (id === 'SO-CN-024') {
      const names = ['User','Course','Enrollment','Lesson','Payment','Review'];
      add('ER diagram defines all six exact entity names', graph?.type === 'erDiagram' && names.every(name => name in (graph?.entities ?? {})));
      const fields: Record<string,string[]> = {
        User:['id','username','email','role'], Course:['id','title','instructor_id','price','category'],
        Enrollment:['id','user_id','course_id','enrolled_at','progress'], Lesson:['id','course_id','title','duration','order_num'],
        Payment:['id','user_id','course_id','amount','method','status'], Review:['id','user_id','course_id','rating','content'],
      };
      add('entity fields are declared in their own blocks', Object.entries(fields).every(([name,expected]) =>
        expected.every(field => (graph?.entities[name] ?? []).some(line => new RegExp(`\\b${field}\\b`).test(line)))));
      if (version === 'v2') add('ER attributes declare a type before each required field',
        Object.entries(fields).every(([name,expected]) => expected.every(field =>
          (graph?.entities[name] ?? []).some(line => line.trim().split(/\s+/)[1] === field))));
      const needed = [['User','Enrollment'],['Course','Enrollment'],['User','Payment'],['Course','Lesson'],
        ['User','Review'],['Course','Review'],['User','Course']];
      add('seven required relationships connect their entities', needed.every(([a,b]) => graph?.edges.some(edge =>
        edge.from === a && edge.to === b || edge.from === b && edge.to === a)));
    } else if (id === 'SO-CN-036') {
      const fields: Record<string,string[]> = {
        User:['id','username','email','publish()'], Post:['id','title','content','createdAt','addComment()'],
        Comment:['id','content','createdAt'], Tag:['id','name'],
      };
      add('class diagram defines exact names and members', graph?.type === 'classDiagram' && Object.entries(fields).every(([name,expected]) =>
        expected.every(field => (graph?.entities[name] ?? []).some(line => line.includes(field)))));
      add('three domain relationships have labels', [['User','Post'],['Post','Comment'],['Post','Tag']].every(([a,b]) =>
        graph?.edges.some(edge => edge.from === a && edge.to === b && edge.label.length > 0)));
      const arrowTypes = [...body.matchAll(/(?:<-->|-->|<--|\.\.>|\*--|o--)/g)].map(match => match[0]);
      add('at least two arrow forms are used', new Set(arrowTypes).size >= 2);
    } else if (id === 'SO-CN-037') {
      const states = ['Idle','Downloading','Verifying','Installing','Rollback','Success','Failed'];
      add('state diagram names all required states', graph?.type === 'stateDiagram-v2' && states.every(state =>
        new RegExp(`\\b${state}\\b`).test(body)));
      add('initial and terminal transitions exist', /\[\*\]\s*-->/.test(body) && /-->\s*\[\*\]/.test(body));
      add('composite state and conditioned transitions exist', /state\s+Installing\s*\{/.test(body) &&
        (graph?.edges.length ?? 0) >= 10 && (graph?.edges.every(edge => /[\u4e00-\u9fff]/.test(edge.label)) ?? false));
      add('verification failure has a recovery path', /Verifying\s*-->\s*(?:Idle|Failed|Rollback)/.test(body));
    }
  } else if (format === 'markdown') {
    const parsed = parseMarkdownBlocks(source);
    const doc = parsed.value;
    add('Markdown fences and block boundaries parse', parsed.errors.length === 0);
    const headings = doc?.headings ?? [], tables = doc?.tables ?? [], fences = doc?.fences ?? [];
    if (id === 'SO-CN-025') {
      const beforeTable = source.split(/^\|/m)[0] ?? '';
      add('report has title, prose summary and conclusions', headings.some(h => h.level === 1) &&
        (beforeTable.match(/[\u4e00-\u9fff]/g) ?? []).length >= 40 && (doc?.ordered.length ?? 0) > 0);
      add('data table has five rows and three columns', tables.some(table => table.rows.length >= 7 &&
        table.rows.every(row => row.length >= 3)));
      add('SQL example is a fenced query', fences.some(fence => fence.language === 'sql' && /\bSELECT\b/i.test(fence.body)));
      add('flow description, separators and ordered conclusions exist', /流程/.test(source) &&
        (doc?.separators ?? 0) >= 3 && (doc?.ordered.length ?? 0) >= 2);
    } else if (id === 'SO-CN-027') {
      add('API document has title, contents, auth and version history', headings.some(h => h.level === 1) &&
        headings.some(h => /目录/.test(h.text)) && headings.some(h => /认证/.test(h.text)) &&
        headings.some(h => /版本/.test(h.text)) && /\]\(#/.test(source));
      const endpoints = headings.filter(h => h.level === 2 && !/目录|认证|版本/.test(h.text));
      add('at least three endpoint sections exist', endpoints.length >= 3);
      const sections = endpoints.map((heading,index) => {
        const next = endpoints[index + 1]?.line ?? source.split(/\r?\n/).length + 1;
        return source.split(/\r?\n/).slice(heading.line - 1,next - 1).join('\n');
      });
      add('each endpoint has method, path, tables and JSON examples', sections.length >= 3 && sections.slice(0,3).every(section =>
        /`(?:GET|POST|PUT|PATCH|DELETE)\s+\//.test(section) &&
        (section.match(/^\|/gm) ?? []).length >= 4 &&
        (section.match(/^```json/gm) ?? []).length >= 2));
      add('JSON code blocks parse', fences.filter(f => f.language === 'json').length >= 6 &&
        fences.filter(f => f.language === 'json').every(f => { try { JSON.parse(f.body); return true; } catch { return false; } }));
      add('version and error-code tables exist', tables.length >= 2 && /错误码/.test(source));
    } else if (id === 'SO-CN-041') {
      add('technical document has title and three subsections', headings.some(h => h.level === 1) && headings.filter(h => h.level === 2).length >= 3);
      add('table has four rows and three columns', tables.some(table => table.rows.length >= 4 && table.rows.every(row => row.length >= 3)));
      add('three code fences use sql, bash and yaml', ['sql','bash','yaml'].every(lang => fences.some(f => f.language === lang)));
      add('ordered list and quotation are present', (doc?.ordered.length ?? 0) >= 3 &&
        serialized(doc?.ordered.slice(0,3).map(item => item.number)) === '[1,2,3]' && (doc?.quotes.length ?? 0) > 0);
    } else if (id === 'SO-CN-045') {
      add('heading counts are exact', headings.filter(h => h.level === 1).length === 1 && headings.filter(h => h.level === 2).length === 4);
      add('one table has eight rows and four columns', tables.length === 1 && tables[0].rows.length === 8 &&
        tables[0].rows.every(row => row.length === 4));
      add('exactly three code blocks have the required languages', fences.length === 3 &&
        serialized(fences.map(f => f.language).sort()) === serialized(['bash','sql','yaml']));
      add('one quote and ordered items 1 through 5 exist', doc?.quotes.length === 1 &&
        serialized(doc?.ordered.map(item => item.number)) === '[1,2,3,4,5]');
    }
  } else if (format === 'sql') {
    const parsed = tokenizeSql(source);
    add('SQL tokenization preserves balanced syntax and ignores comments', parsed.errors.length === 0 &&
      (parsed.value?.tokens.length ?? 0) > 0);
    const tokens = parsed.value?.tokens ?? [];
    const code = tokens.join(' ');
    const has = (...sequence: string[]) => code.includes(sequence.join(' '));
    if (id === 'SO-CN-013') {
      add('query joins orders and users', has('FROM','ORDERS') && has('JOIN','USERS'));
      add('window ranking partitions by city', ['ROW_NUMBER','RANK','DENSE_RANK'].some(name => has(name,'(')) && has('OVER','(') &&
        has('PARTITION','BY') && code.includes('CITY'));
      add('ranking is limited to three within March 2024', /(?:<=|< =) 3/.test(code) &&
        code.includes('2024-03-01') && (code.includes('2024-04-01') || code.includes('2024-03-31')));
      add('result projects city, user, order number and amount with ordering',
        ['CITY','NAME','ORDER_NO','AMOUNT'].every(token => tokens.includes(token)) && has('ORDER','BY'));
      const partitions = [...code.matchAll(/PARTITION BY ([\s\S]*?)(?: ORDER BY|\))/g)]
        .map(match => match[1]);
      const oneOrderPerUser = partitions.some(part => /\bUSER_ID\b|\bU \. ID\b|\bO \. USER_ID\b/.test(part)) ||
        /\bGROUP BY [\s\S]*?\b(?:USER_ID|U \. ID)\b/.test(code) ||
        /\bDISTINCT ON\s*\(/.test(code) || code.includes('LATERAL');
      if (version === 'v2') add('city ranking selects distinct users rather than top orders', oneOrderPerUser);
    } else if (id === 'SO-CN-015') {
      const tables = ['BOOKS','CATEGORIES','CUSTOMERS','ORDERS','ORDER_ITEMS'];
      add('five required tables are created', tables.every(table =>
        new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table}\\b`).test(code)));
      const columns: Record<string,string[]> = {
        BOOKS:['ID','ISBN','TITLE','AUTHOR','PUBLISHER','PUBLISH_DATE','PRICE','STOCK','CATEGORY_ID'],
        CATEGORIES:['ID','NAME','PARENT_ID'], CUSTOMERS:['ID','USERNAME','EMAIL','PHONE','ADDRESS','CREATED_AT'],
        ORDERS:['ID','CUSTOMER_ID','TOTAL_AMOUNT','STATUS','CREATED_AT'],
        ORDER_ITEMS:['ID','ORDER_ID','BOOK_ID','QUANTITY','UNIT_PRICE'],
      };
      add('required table columns occur in CREATE definitions', Object.entries(columns).every(([table,names]) => {
        const match = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table}\\b`).exec(code);
        const start = match?.index ?? -1;
        const end = code.indexOf('CREATE TABLE',start + (match?.[0].length ?? 12));
        const chunk = start < 0 ? '' : code.slice(start,end < 0 ? undefined : end);
        return names.every(name => new RegExp(`\\b${name}\\b`).test(chunk));
      }));
      add('primary and foreign keys plus indexes are present', has('PRIMARY','KEY') && has('FOREIGN','KEY') &&
        (tokens.includes('INDEX') || tokens.includes('KEY')));
      add('MySQL engine, charset and comments are declared', has('ENGINE','=','INNODB') &&
        code.includes('UTF8MB4') && tokens.includes('COMMENT'));
    } else if (id === 'SO-CN-017') {
      add('stored procedure declares input and output parameters', has('CREATE','PROCEDURE') &&
        tokens.includes('JSON') && tokens.includes('OUT') && /CUSTOMER_ID/.test(code));
      add('cursor and exception handler are declared', tokens.includes('CURSOR') && tokens.includes('HANDLER'));
      add('transaction can commit or roll back', has('START','TRANSACTION') && tokens.includes('COMMIT') && tokens.includes('ROLLBACK'));
      add('procedure writes order and item records and updates stock', has('INSERT','INTO','ORDERS') &&
        has('INSERT','INTO','ORDER_ITEMS') && has('UPDATE','PRODUCTS') && tokens.includes('STOCK'));
      add('procedure checks customer and inventory and returns totals', tokens.includes('CUSTOMERS') &&
        tokens.includes('SELECT') && /TOTAL|AMOUNT/.test(code) && (parsed.value?.comments ?? 0) > 0);
      if (version === 'v2') {
        const cursorAt = code.indexOf(' CURSOR '), handlerAt = code.indexOf(' HANDLER ');
        add('MySQL cursor is declared before handlers', cursorAt >= 0 && handlerAt >= 0 && cursorAt < handlerAt);
        add('procedure avoids unsupported ISOPEN and JSON_PARSE calls',
          !tokens.includes('ISOPEN') && !tokens.includes('JSON_PARSE'));
      }
    } else if (id === 'SO-CN-034') {
      add('CTE selects low-stock products', has('WITH') && has('FROM','PRODUCTS') &&
        /STOCK\s*<\s*(?:\w+\s*\.\s*)?REORDER_LEVEL/.test(code));
      add('lateral warehouse choice is present', has('LATERAL') && code.includes('WAREHOUSES'));
      add('restock log uses INSERT SELECT and conflict update', has('INSERT','INTO','RESTOCK_LOG') &&
        has('SELECT') && has('ON','CONFLICT') && has('DO','UPDATE'));
      add('product stock is updated and results returned', has('UPDATE','PRODUCTS') &&
        has('SET') && tokens.includes('STOCK') && tokens.includes('RETURNING'));
      // A cumulative upsert returns the old log amount plus this run's amount.
      // Using that RETURNING value as the stock increment counts the old amount
      // again. This pattern was confirmed against PostgreSQL with and without
      // an existing conflicting log row.
      const insertAt = code.indexOf('INSERT INTO RESTOCK_LOG');
      const updateAt = code.indexOf('UPDATE PRODUCTS');
      const cumulativeLog = /ADDED_QUANTITY = (?:RESTOCK_LOG \. ADDED_QUANTITY \+ EXCLUDED \. ADDED_QUANTITY|EXCLUDED \. ADDED_QUANTITY \+ RESTOCK_LOG \. ADDED_QUANTITY)/.test(code);
      const stockUpdate = updateAt < 0 ? '' : code.slice(updateAt);
      const logCte = /([A-Z_][A-Z_0-9]*) AS \( INSERT INTO RESTOCK_LOG/.exec(code)?.[1];
      const logSource = logCte
        ? new RegExp(`\\bFROM ${logCte}(?: AS)?(?: ([A-Z_][A-Z_0-9]*))?\\b`).exec(stockUpdate)
        : null;
      const logAlias = logSource?.[1] ?? logCte;
      const stockAssignment = stockUpdate.split(/\bFROM\b/)[0];
      const updateFromLog = Boolean(logSource && logAlias) &&
        new RegExp(`\\bSET STOCK = [\\s\\S]*?\\+ ${logAlias} \\. ADDED_QUANTITY\\b`).test(stockAssignment);
      if (version === 'v2') add('stock increment does not reuse a cumulative conflict total',
        !(cumulativeLog && insertAt >= 0 && updateAt > insertAt && updateFromLog));
    }
  }
  return checks;
}
