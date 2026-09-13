import type { IsolatedCsharpJsonContract } from '../execution/isolatedCsharpJson.js';
export interface IsolatedCsharpJsonFixture {language:'csharp';contract:IsolatedCsharpJsonContract;correct:string;mutant:string;developmentCases:IsolatedCsharpJsonContract['cases'];}
const eq=(value:any)=>({equals:value});
/** Developer-authored controls only; not independent or held-out gold. */
export const ISOLATED_CSHARP_JSON_PILOTS:Record<string,IsolatedCsharpJsonFixture>={
  'CP-L3-CS-003':{language:'csharp',contract:{protocol:'isolated-csharp-json-v2',entrypoint:'ReportService',adapter:'report-sync-context',cases:[
    {id:'CP-L3-CS-003-hidden-1',calls:[[200,'hello',300,'report',1]],expected:[eq('HELLO')]},
    {id:'CP-L3-CS-003-hidden-2',calls:[[404,'missing',100,'http-error',1]],expected:[eq(true)]},
    {id:'CP-L3-CS-003-hidden-3',calls:[[200,'abc',50,'repeat',3]],expected:[eq(3)]},
    {id:'CP-L3-CS-003-hidden-4',calls:[[200,'plain',0,'plain',1]],expected:[eq('PLAIN')]},]},
    correct:'public class ReportService{private readonly HttpClient _http=new();public async Task<string> FetchAsync(string url)=>await _http.GetStringAsync(url).ConfigureAwait(false);public string GetReport(string url){return FetchAsync(url).GetAwaiter().GetResult().ToUpperInvariant();}}',
    mutant:'public class ReportService{private readonly HttpClient _http=new();public async Task<string> FetchAsync(string url)=>await _http.GetStringAsync(url);public string GetReport(string url){return FetchAsync(url).Result.ToUpperInvariant();}}',developmentCases:[
      {id:'DEV-CS-REPORT-unicode',calls:[[200,'café',0,'report',1]],expected:[eq('CAFÉ')]},
      {id:'DEV-CS-REPORT-error',calls:[[404,'x',0,'http-error',1]],expected:[eq(true)]},]},
  'CP-L3-CS-004':{language:'csharp',contract:{protocol:'isolated-csharp-json-v2',entrypoint:'TryGetKey',adapter:'header-span',cases:[
    {id:'CP-L3-CS-004-hidden-1',calls:[['Host : example.com','pair',1]],expected:[eq([true,'Host'])]},
    {id:'CP-L3-CS-004-hidden-2',calls:[['invalid-header','pair',1]],expected:[eq([false,''])]},
    {id:'CP-L3-CS-004-hidden-3',calls:[[':value','valid',1]],expected:[eq(false)]},
    {id:'CP-L3-CS-004-hidden-4',calls:[['   :value','valid',1]],expected:[eq(false)]},
    {id:'CP-L3-CS-004-hidden-5',calls:[['  Host:value','key',1],['Host   :value','alloc',100000]],expected:[eq('  Host'),eq(true)]},]},
    correct:'public static class HeaderParser{public static bool TryGetKey(ReadOnlySpan<char> header,out ReadOnlySpan<char> key){int idx=header.IndexOf(\':\');if(idx<=0){key=default;return false;}key=header[..idx].TrimEnd();if(key.IsEmpty){key=default;return false;}return true;}}',
    mutant:'public static class HeaderParser{public static bool TryGetKey(ReadOnlySpan<char> header,out ReadOnlySpan<char> key){int idx=header.IndexOf(\':\');key=header[..idx];return idx>0;}}',developmentCases:[
      {id:'DEV-CS-HEADER-tab-tail',calls:[['Key\t:value','pair',1]],expected:[eq([true,'Key'])]},
      {id:'DEV-CS-HEADER-empty',calls:[['','pair',1]],expected:[eq([false,''])]},]},
  'CP-L3-SEM-CS-001':{language:'csharp',contract:{protocol:'isolated-csharp-json-v1',entrypoint:'MakeCounters',adapter:'counter-delegates',cases:[
    {id:'CP-L3-SEM-CS-001-hidden-1',calls:[[3,'count']],expected:[eq(3)]},
    {id:'CP-L3-SEM-CS-001-hidden-2',calls:[[3,'values']],expected:[eq([1,2,3])]},
    {id:'CP-L3-SEM-CS-001-hidden-3',calls:[[1,'values']],expected:[eq([1])]},]},
    correct:'public static List<Func<int>> MakeCounters(int n){var fs=new List<Func<int>>();for(int i=1;i<=n;i++){int captured=i;fs.Add(()=>captured);}return fs;}',
    mutant:'public static List<Func<int>> MakeCounters(int n){var fs=new List<Func<int>>();for(int i=1;i<=n;i++)fs.Add(()=>i);return fs;}',developmentCases:[
      {id:'DEV-CS-COUNTER-two',calls:[[2,'values']],expected:[eq([1,2])]},
      {id:'DEV-CS-COUNTER-four-count',calls:[[4,'count']],expected:[eq(4)]},]},
  'CP-L3-SEM-CS-002':{language:'csharp',contract:{protocol:'isolated-csharp-json-v1',entrypoint:'RoundMoney',adapter:'decimal-round',cases:[
    {id:'CP-L3-SEM-CS-002-hidden-1',calls:[['3.14159']],expected:[eq('3.14')]},
    {id:'CP-L3-SEM-CS-002-hidden-2',calls:[['0.125']],expected:[eq('0.13')]},
    {id:'CP-L3-SEM-CS-002-hidden-3',calls:[['2.665']],expected:[eq('2.67')]},
    {id:'CP-L3-SEM-CS-002-hidden-4',calls:[['-0.125']],expected:[eq('-0.13')]},]},
    correct:'public static decimal RoundMoney(decimal amount){return Math.Round(amount,2,MidpointRounding.AwayFromZero);}',
    mutant:'public static decimal RoundMoney(decimal amount){return Math.Round(amount,2);}',developmentCases:[
      {id:'DEV-CS-ROUND-zero',calls:[['0']],expected:[eq('0')]},
      {id:'DEV-CS-ROUND-negative-even',calls:[['-2.665']],expected:[eq('-2.67')]},]},
  'CP-L3-SEM-CS-003':{language:'csharp',contract:{protocol:'isolated-csharp-json-v1',entrypoint:'Metrics.Record',adapter:'metrics-record',cases:[
    {id:'CP-L3-SEM-CS-003-hidden-1',calls:[[1]],expected:[eq(1)]},
    {id:'CP-L3-SEM-CS-003-hidden-2',calls:[[3]],expected:[eq(3)]},
    {id:'CP-L3-SEM-CS-003-hidden-3',calls:[[0]],expected:[eq(0)]},]},
    correct:'struct Counter{public int Value;public void Increment(){Value++;}} class Metrics{public Counter Total;public void Record(){Total.Increment();}}',
    mutant:'struct Counter{public int Value;public void Increment(){Value++;}} class Metrics{public Counter Total{get;private set;}public void Record(){Total.Increment();}}',developmentCases:[
      {id:'DEV-CS-METRICS-two',calls:[[2]],expected:[eq(2)]},
      {id:'DEV-CS-METRICS-ten',calls:[[10]],expected:[eq(10)]},]},
  'CS-001':{language:'csharp',contract:{protocol:'isolated-csharp-json-v1',entrypoint:'Money',adapter:'money-equality',cases:[
    {id:'CS-001-hidden-1',calls:[[['10','USD'],['20','EUR'],'singleSize']],expected:[eq(1)]},
    {id:'CS-001-hidden-2',calls:[[['10','USD'],['10','USD'],'setSize']],expected:[eq(1)]},
    {id:'CS-001-hidden-3',calls:[[['10','USD'],['10','USD'],'contains']],expected:[eq(true)]},
    {id:'CS-001-hidden-4',calls:[[['10','USD'],['20','USD'],'setSize']],expected:[eq(2)]},]},
    correct:'class Money{public decimal Amount;public string Currency="";public override bool Equals(object? o){return o is Money m&&m.Amount==Amount&&m.Currency==Currency;}public override int GetHashCode(){return HashCode.Combine(Amount,Currency);}}',
    mutant:'class Money{public decimal Amount;public string Currency="";public override bool Equals(object? o){return o is Money m&&m.Amount==Amount&&m.Currency==Currency;}}',developmentCases:[
      {id:'DEV-CS-MONEY-currency',calls:[[['10','USD'],['10','EUR'],'setSize']],expected:[eq(2)]},
      {id:'DEV-CS-MONEY-decimal-scale',calls:[[['10.0','USD'],['10.00','USD'],'contains']],expected:[eq(true)]},]},
  'CP-L2-CS-001':{language:'csharp',contract:{protocol:'isolated-csharp-json-v1',entrypoint:'Sum',adapter:'decimal-sum',cases:[
    {id:'CP-L2-CS-001-hidden-1',calls:[[['19.99','5.01','25.00'],1]],expected:[eq('50')]},
    {id:'CP-L2-CS-001-hidden-2',calls:[[['0.1'],1000]],expected:[eq('100')]},
    {id:'CP-L2-CS-001-hidden-3',calls:[[['-0.1'],1000]],expected:[eq('-100')]},
    {id:'CP-L2-CS-001-hidden-4',calls:[[[],1]],expected:[eq('0')]},]},
    correct:'public static decimal Sum(double[] prices){decimal t=0;foreach(var p in prices)t+=(decimal)p;return Math.Round(t,2,MidpointRounding.AwayFromZero);}',
    mutant:'public static double Sum(double[] prices){double t=0;foreach(var p in prices)t+=p;return t;}',developmentCases:[
      {id:'DEV-CS-SUM-cent-repeat',calls:[[['0.01'],999]],expected:[eq('9.99')]},
      {id:'DEV-CS-SUM-cancel',calls:[[['0.1','-0.1'],1000]],expected:[eq('0')]},]},
};
