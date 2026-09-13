import type {IsolatedPhpJsonContract} from '../execution/isolatedPhpJson.js';
export interface IsolatedPhpJsonV2Fixture{language:'php';contract:IsolatedPhpJsonContract;correct:string;mutant:string;developmentCases:IsolatedPhpJsonContract['cases']}
const eq=(equals:any)=>({equals});
const payloadLength=(item:string)=>JSON.stringify({factor:2,item}).length;
const rendered=(items:string[])=>items.map(v=>'T'+payloadLength(v)).join('');
export const ISOLATED_PHP_JSON_V2_PILOTS:Record<string,IsolatedPhpJsonV2Fixture>={
  'CP-L3-PHP-003':{language:'php',contract:{protocol:'isolated-php-json-v2',entrypoint:'readCsv',adapter:'csv-generator',cases:[
    {id:'CP-L3-PHP-003-hidden-1',calls:[['stream',60000,60]],expected:[eq([true,60000,true,1799970000])]},
    {id:'CP-L3-PHP-003-hidden-2',calls:[['shape',0,0]],expected:[eq([{id:'a1',name:'b1',payload:'c1'},{id:'a2',name:'b2',payload:null},{id:'a3',name:'b3',payload:'c3'}])]},
    {id:'CP-L3-PHP-003-hidden-3',calls:[['header',0,0]],expected:[eq(0)]},
    {id:'CP-L3-PHP-003-hidden-4',calls:[['first',0,0]],expected:[eq([true,'1'])]},
    {id:'CP-L3-PHP-003-hidden-5',calls:[['leak',0,0]],expected:[eq(true)]}]},
    correct:`function readCsv(string $path): Generator {
    $h = fopen($path, 'r');
    if ($h === false) return;
    try {
        $header = fgetcsv($h);
        if ($header === false) return;
        $width = count($header);
        while (($line = fgetcsv($h)) !== false) {
            $line = array_slice(array_pad($line, $width, null), 0, $width);
            yield array_combine($header, $line);
        }
    } finally { fclose($h); }
}`,
    mutant:`function readCsv(string $path): array { $h=fopen($path,'r');$header=fgetcsv($h);$rows=[];while(($line=fgetcsv($h))!==false){$line=array_slice(array_pad($line,count($header),null),0,count($header));$rows[]=array_combine($header,$line);}fclose($h);return $rows; }`,
    developmentCases:[
      {id:'DEV-PHP-CSV-small-stream',calls:[['stream',10,3]],expected:[eq([true,10,true,45])]},
      {id:'DEV-PHP-CSV-shape',calls:[['shape',0,0]],expected:[eq([{id:'a1',name:'b1',payload:'c1'},{id:'a2',name:'b2',payload:null},{id:'a3',name:'b3',payload:'c3'}])]}]},
  'CP-L3-PHP-004':{language:'php',contract:{protocol:'isolated-php-json-v2',entrypoint:'Templates',adapter:'template-cache',cases:[
    {id:'CP-L3-PHP-004-hidden-1',calls:[['version',[]]],expected:[eq([true,2,9,2])]},
    {id:'CP-L3-PHP-004-hidden-2',calls:[['path',[]]],expected:[eq([rendered(['a']),rendered(['bb'])])]},
    {id:'CP-L3-PHP-004-hidden-3',calls:[['render',['alpha','beta','gamma']]],expected:[eq(rendered(['alpha','beta','gamma']))]},
    {id:'CP-L3-PHP-004-hidden-4',calls:[['empty',[]]],expected:[eq(['',null])]}]},
    correct:`class Config {
    private static ?array $cache = null;
    private static ?string $version = null;
    public static function invalidate(string $version): void {
        if (self::$version !== $version) { self::$cache = null; self::$version = $version; }
    }
    public static function get(string $key): mixed {
        if (self::$cache === null) self::$cache = json_decode(file_get_contents(__DIR__ . '/config.json'), true);
        return self::$cache[$key] ?? null;
    }
}
class Templates {
    public static function render(string $name, array $vars): string {
        $factor = Config::get('factor');
        $file = __DIR__ . '/tpl/' . $name . '.php';
        $out = '';
        foreach ($vars as $v) { ob_start(); include $file; $payload=json_encode(['factor'=>$factor,'item'=>$v]); $out .= ob_get_clean() . strlen($payload); }
        return $out;
    }
}`,
    mutant:`class Config {private static ?array $cache=null;public static function invalidate(string $version):void{self::$cache=null;}public static function get(string $key):mixed{if(self::$cache===null)self::$cache=json_decode(file_get_contents(__DIR__.'/config.json'),true);return self::$cache[$key]??null;}}
class Templates {public static function render(string $name,array $vars):string{$factor=Config::get('factor');$file=__DIR__.'/tpl/'.$name.'.php';$out='';foreach($vars as $v){ob_start();include $file;$payload=json_encode(['factor'=>$factor,'item'=>$v]);$out.=ob_get_clean().strlen($payload);}return $out;}}`,
    developmentCases:[
      {id:'DEV-PHP-TEMPLATE-one',calls:[['render',['x']]],expected:[eq(rendered(['x']))]},
      {id:'DEV-PHP-TEMPLATE-empty',calls:[['empty',[]]],expected:[eq(['',null])]}]},
};
