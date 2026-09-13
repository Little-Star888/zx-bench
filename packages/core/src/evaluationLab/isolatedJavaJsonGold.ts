import type { IsolatedJavaJsonContract } from '../execution/isolatedJavaJson.js';
export interface IsolatedJavaJsonFixture {language:'java';contract:IsolatedJavaJsonContract;correct:string;mutant:string;developmentCases:IsolatedJavaJsonContract['cases'];}
const eq=(value:any)=>({equals:value});
/** Developer-authored controls only; not independent or held-out gold. */
export const ISOLATED_JAVA_JSON_PILOTS:Record<string,IsolatedJavaJsonFixture>={
  'CP-L2-JV-002':{language:'java',contract:{protocol:'isolated-java-json-v2',entrypoint:'readFirstLine',adapter:'file-first-line',cases:[
    {id:'CP-L2-JV-002-hidden-1',calls:[['hello\nworld','content',1]],expected:[eq('hello')]},
    {id:'CP-L2-JV-002-hidden-2',calls:[['','content',1]],expected:[eq(null)]},
    {id:'CP-L2-JV-002-hidden-3',calls:[['','leak',300]],expected:[eq(true)]},]},correct:'static String readFirstLine(String path) throws java.io.IOException{try(java.io.BufferedReader r=new java.io.BufferedReader(new java.io.FileReader(path))){return r.readLine();}}',mutant:'static String readFirstLine(String path) throws java.io.IOException{java.io.BufferedReader r=new java.io.BufferedReader(new java.io.FileReader(path));String line=r.readLine();r.close();return line;}',developmentCases:[
      {id:'DEV-JAVA-FILE-one-line',calls:[['only','content',1]],expected:[eq('only')]},
      {id:'DEV-JAVA-FILE-empty-first',calls:[['\nsecond','content',1]],expected:[eq('')]},]},
  'CP-L3-CONC-JV-001':{language:'java',contract:{protocol:'isolated-java-json-v2',entrypoint:'Cache.getOrCompute',adapter:'cache-compute',cases:[
    {id:'CP-L3-CONC-JV-001-hidden-1',calls:[[1,'serial']],expected:[eq([1,42])]},
    {id:'CP-L3-CONC-JV-001-hidden-2',calls:[[8,'calls']],expected:[eq(1)]},
    {id:'CP-L3-CONC-JV-001-hidden-3',calls:[[4,'value']],expected:[eq(99)]},]},correct:'class Cache{private final java.util.concurrent.ConcurrentHashMap<String,Integer>m=new java.util.concurrent.ConcurrentHashMap<>();int getOrCompute(String k,java.util.function.Supplier<Integer>f){return m.computeIfAbsent(k,x->f.get());}}',mutant:'class Cache{private java.util.Map<String,Integer>m=new java.util.HashMap<>();int getOrCompute(String k,java.util.function.Supplier<Integer>f){if(m.containsKey(k))return m.get(k);int v=f.get();m.put(k,v);return v;}}',developmentCases:[
      {id:'DEV-JAVA-CACHE-two',calls:[[2,'calls']],expected:[eq(1)]},
      {id:'DEV-JAVA-CACHE-sixteen',calls:[[16,'value']],expected:[eq(99)]},]},
  'CP-L3-JV-006':{language:'java',contract:{protocol:'isolated-java-json-v2',entrypoint:'ConfigHolder',adapter:'singleton-publication',cases:[
    {id:'CP-L3-JV-006-hidden-1',calls:[[1,'get']],expected:[eq('prod')]},
    {id:'CP-L3-JV-006-hidden-2',calls:[[64,'identity']],expected:[eq(1)]},
    {id:'CP-L3-JV-006-hidden-3',calls:[[1,'volatile']],expected:[eq(true)]},
    {id:'CP-L3-JV-006-hidden-4',calls:[[1,'reset']],expected:[eq('prod')]},]},correct:'class ConfigHolder{private static volatile ConfigHolder instance;private final java.util.Map<String,String>values;private ConfigHolder(){values=java.util.Map.of("env","prod");}public static ConfigHolder getInstance(){if(instance==null){synchronized(ConfigHolder.class){if(instance==null)instance=new ConfigHolder();}}return instance;}public String get(String k){return values.get(k);}}',mutant:'class ConfigHolder{private static ConfigHolder instance;private final java.util.Map<String,String>values;private ConfigHolder(){values=java.util.Map.of("env","prod");}public static ConfigHolder getInstance(){if(instance==null){synchronized(ConfigHolder.class){if(instance==null)instance=new ConfigHolder();}}return instance;}public String get(String k){return values.get(k);}}',developmentCases:[
      {id:'DEV-JAVA-SINGLETON-eight',calls:[[8,'identity']],expected:[eq(1)]},
      {id:'DEV-JAVA-SINGLETON-reset',calls:[[1,'reset']],expected:[eq('prod')]},]},
  'CP-L3-JV-004':{language:'java',contract:{protocol:'isolated-java-json-v2',entrypoint:'Squares',adapter:'squares-stress',cases:[
    {id:'CP-L3-JV-004-hidden-1',calls:[[0,1,'values'],[1,1,'values']],expected:[eq([]),eq([0])]},
    {id:'CP-L3-JV-004-hidden-2',calls:[[100,1,'values']],expected:[eq(Array.from({length:100},(_,i)=>i*i))]},
    {id:'CP-L3-JV-004-hidden-3',calls:[[100000,20,'stable']],expected:[eq([100000,true])]},
    // 46,341 is the largest cardinality whose int squares are unique; 100,000 is impossible because int multiplication overflows.
    {id:'CP-L3-JV-004-hidden-4',calls:[[46341,1,'unique']],expected:[eq([46341,true])]},
    {id:'CP-L3-JV-004-hidden-5',calls:[[2000000,1,'perf']],expected:[eq([2000000,true])]},
  ]},correct:'class Squares{public static java.util.List<Integer>squares(int n){java.util.List<Integer>out=java.util.stream.IntStream.range(0,n).parallel().map(i->i*i).boxed().collect(java.util.stream.Collectors.toList());java.util.Collections.sort(out);return out;}}',mutant:'class Squares{public static java.util.List<Integer>squares(int n){java.util.List<Integer>out=new java.util.ArrayList<>();java.util.stream.IntStream.range(0,n).parallel().forEach(i->out.add(i*i));java.util.Collections.sort(out);return out;}}',developmentCases:[
      {id:'DEV-JAVA-SQUARES-ten',calls:[[10,1,'values']],expected:[eq([0,1,4,9,16,25,36,49,64,81])]},
      {id:'DEV-JAVA-SQUARES-stable',calls:[[1000,4,'stable']],expected:[eq([1000,true])]},]},
  'CP-L3-JV-005':{language:'java',contract:{protocol:'isolated-java-json-v2',entrypoint:'SchemaCache',adapter:'schema-cache-lifecycle',cases:[
    {id:'CP-L3-JV-005-hidden-1',calls:[[1,1,'hit'],[1,1,'weak']],expected:[eq(true),eq(true)]},
    {id:'CP-L3-JV-005-hidden-2',calls:[[1,1,'unload']],expected:[eq(true)]},
    {id:'CP-L3-JV-005-hidden-3',calls:[[32,200,'concurrent']],expected:[eq(true)]},
    {id:'CP-L3-JV-005-hidden-4',calls:[[1,1,'threadlocal']],expected:[eq(true)]},
  ]},correct:'class SchemaCache{private static final java.util.WeakHashMap<ClassLoader,java.util.Map<String,java.lang.ref.WeakReference<Class<?>>>>CACHE=new java.util.WeakHashMap<>();private static final ThreadLocal<byte[]>SCRATCH=new ThreadLocal<>();public static Class<?>load(String name)throws Exception{if(SCRATCH.get()==null)SCRATCH.set(new byte[8192]);ClassLoader cl=Thread.currentThread().getContextClassLoader();synchronized(CACHE){java.util.Map<String,java.lang.ref.WeakReference<Class<?>>>m=CACHE.computeIfAbsent(cl,k->new java.util.HashMap<>());java.lang.ref.WeakReference<Class<?>>r=m.get(name);Class<?>c=r==null?null:r.get();if(c==null){c=Class.forName(name,true,cl);m.put(name,new java.lang.ref.WeakReference<>(c));}return c;}}public static void unload(){synchronized(CACHE){CACHE.clear();}SCRATCH.remove();}}',mutant:'class SchemaCache{private static final java.util.Map<String,Class<?>>CACHE=new java.util.concurrent.ConcurrentHashMap<>();private static final ThreadLocal<byte[]>SCRATCH=ThreadLocal.withInitial(()->new byte[8192]);public static Class<?>load(String name)throws Exception{SCRATCH.get();return CACHE.computeIfAbsent(name,n->{try{return Class.forName(n);}catch(Exception e){throw new RuntimeException(e);}});}}',developmentCases:[
      {id:'DEV-JAVA-SCHEMA-concurrent',calls:[[4,20,'concurrent']],expected:[eq(true)]},
      {id:'DEV-JAVA-SCHEMA-threadlocal',calls:[[1,1,'threadlocal']],expected:[eq(true)]},]},
  'CP-L1-JV-001':{language:'java',contract:{protocol:'isolated-java-json-v1',entrypoint:'average',adapter:'int-array-average',cases:[
    {id:'CP-L1-JV-001-hidden-1',calls:[[[2,3]]],expected:[{all:[{path:[],approx:{value:2.5,absoluteTolerance:1e-9,inclusive:true}}]}]},
    {id:'CP-L1-JV-001-hidden-2',calls:[[[1,2,3]]],expected:[{all:[{path:[],approx:{value:2,absoluteTolerance:1e-9,inclusive:true}}]}]},
  ]},correct:'public static double average(int[] nums){int sum=0;for(int n:nums)sum+=n;return (double)sum/nums.length;}',
    mutant:'public static double average(int[] nums){int sum=0;for(int n:nums)sum+=n;return sum/nums.length;}',developmentCases:[
      {id:'DEV-JAVA-AVERAGE-negative',calls:[[[-2,-3]]],expected:[{all:[{path:[],approx:{value:-2.5,absoluteTolerance:1e-9,inclusive:true}}]}]},
      {id:'DEV-JAVA-AVERAGE-mixed',calls:[[[-2,3]]],expected:[{all:[{path:[],approx:{value:0.5,absoluteTolerance:1e-9,inclusive:true}}]}]},]},
  'CP-L2-JV-001':{language:'java',contract:{protocol:'isolated-java-json-v1',entrypoint:'Money',adapter:'money-equality',cases:[
    {id:'CP-L2-JV-001-hidden-1',calls:[[[100,'CNY'],[100,'CNY'],'setSize']],expected:[eq(1)]},
    {id:'CP-L2-JV-001-hidden-2',calls:[[[1,'USD'],[1,'USD'],'hashEqual']],expected:[eq(true)]},
  ]},correct:'class Money {final long cents;final String currency;Money(long c,String cur){cents=c;currency=cur;}public boolean equals(Object o){if(!(o instanceof Money))return false;Money m=(Money)o;return cents==m.cents&&currency.equals(m.currency);}public int hashCode(){return java.util.Objects.hash(cents,currency);}}',
    mutant:'class Money {final long cents;final String currency;Money(long c,String cur){cents=c;currency=cur;}public boolean equals(Object o){if(!(o instanceof Money))return false;Money m=(Money)o;return cents==m.cents&&currency.equals(m.currency);}}',developmentCases:[
      {id:'DEV-JAVA-MONEY-different-currency',calls:[[[100,'CNY'],[100,'USD'],'setSize']],expected:[eq(2)]},
      {id:'DEV-JAVA-MONEY-different-cents',calls:[[[100,'CNY'],[101,'CNY'],'setSize']],expected:[eq(2)]},]},
  'CP-L3-SEM-JV-001':{language:'java',contract:{protocol:'isolated-java-json-v1',entrypoint:'sameCredit',adapter:'boxed-integer-equality',cases:[
    {id:'CP-L3-SEM-JV-001-hidden-1',calls:[[100,100,'auto']],expected:[eq(true)]},
    {id:'CP-L3-SEM-JV-001-hidden-2',calls:[[127,127,'auto']],expected:[eq(true)]},
    {id:'CP-L3-SEM-JV-001-hidden-3',calls:[[128,128,'auto']],expected:[eq(true)]},
    {id:'CP-L3-SEM-JV-001-hidden-4',calls:[[1000,1000,'auto']],expected:[eq(true)]},
    {id:'CP-L3-SEM-JV-001-hidden-5',calls:[[42,42,'fresh']],expected:[eq(true)]},
    {id:'CP-L3-SEM-JV-001-hidden-6',calls:[[-129,-129,'auto']],expected:[eq(true)]},
    {id:'CP-L3-SEM-JV-001-hidden-7',calls:[[100,200,'auto']],expected:[eq(false)]},
  ]},correct:'static boolean sameCredit(Integer a,Integer b){return java.util.Objects.equals(a,b);}',mutant:'static boolean sameCredit(Integer a,Integer b){return a==b;}',developmentCases:[
    {id:'DEV-JAVA-CREDIT-zero-different',calls:[[0,1,'fresh']],expected:[eq(false)]},
    {id:'DEV-JAVA-CREDIT-min',calls:[[-2147483648,-2147483648,'fresh']],expected:[eq(true)]},]},
  'CP-L3-SEM-JV-002':{language:'java',contract:{protocol:'isolated-java-json-v1',entrypoint:'hasSettled',adapter:'decimal-ledger',cases:[
    {id:'CP-L3-SEM-JV-002-hidden-1',calls:[[['19.99'],'19.99']],expected:[eq(true)]},
    {id:'CP-L3-SEM-JV-002-hidden-2',calls:[[['1.00'],'1.0']],expected:[eq(true)]},
    {id:'CP-L3-SEM-JV-002-hidden-3',calls:[[['5.0','5.00'],'5.000']],expected:[eq(true)]},
    {id:'CP-L3-SEM-JV-002-hidden-4',calls:[[['2.00'],'2.01']],expected:[eq(false)]},
  ]},correct:'static boolean hasSettled(java.util.List<java.math.BigDecimal> ledger,java.math.BigDecimal amount){return ledger.stream().anyMatch(x->x.compareTo(amount)==0);}',
    mutant:'static boolean hasSettled(java.util.List<java.math.BigDecimal> ledger,java.math.BigDecimal amount){return ledger.contains(amount);}',developmentCases:[
      {id:'DEV-JAVA-DECIMAL-empty',calls:[[[],'0']],expected:[eq(false)]},
      {id:'DEV-JAVA-DECIMAL-negative-scale',calls:[[['-1.00'],'-1.0']],expected:[eq(true)]},]},
  'CP-L3-SEM-JV-003':{language:'java',contract:{protocol:'isolated-java-json-v1',entrypoint:'normalizeDate',adapter:'strict-date',cases:[
    {id:'CP-L3-SEM-JV-003-hidden-1',calls:[['2021-06-15']],expected:[eq('2021-06-15')]},
    {id:'CP-L3-SEM-JV-003-hidden-2',calls:[['2020-02-29']],expected:[eq('2020-02-29')]},
    {id:'CP-L3-SEM-JV-003-hidden-3',calls:[['2021-02-31']],expected:[eq(null)]},
    {id:'CP-L3-SEM-JV-003-hidden-4',calls:[['2021-13-01']],expected:[eq(null)]},
  ]},correct:'static String normalizeDate(String s){try{java.text.SimpleDateFormat f=new java.text.SimpleDateFormat("yyyy-MM-dd");f.setLenient(false);return f.format(f.parse(s));}catch(java.text.ParseException e){return null;}}',
    mutant:'static String normalizeDate(String s){try{java.text.SimpleDateFormat f=new java.text.SimpleDateFormat("yyyy-MM-dd");return f.format(f.parse(s));}catch(java.text.ParseException e){return null;}}',developmentCases:[
      {id:'DEV-JAVA-DATE-non-leap',calls:[['2019-02-29']],expected:[eq(null)]},
      {id:'DEV-JAVA-DATE-month-zero',calls:[['2021-00-01']],expected:[eq(null)]},]},
};
