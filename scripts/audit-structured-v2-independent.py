"""Independent Python review of frozen schema witnesses and selected content mappings."""
import base64, json, unicodedata
from pathlib import Path
from jsonschema import Draft7Validator, Draft202012Validator, FormatChecker
root=Path('data/pilots/structured-contract-v2')
rows=[]
def published_input(s):
    tail=s['promptTemplate'].split('输入：',1)[1]
    return json.JSONDecoder().raw_decode(tail)[0]
for split in ('development','holdout'):
    pack=json.loads((root/f'{split}.json').read_text(encoding='utf8'))
    gold={g['id']:g for g in json.loads((root/f'{split}-gold.json').read_text(encoding='utf8'))}
    for s in pack:
        req=s['requirements'];g=gold[s['id']]
        cls=Draft7Validator if req['dialect']=='draft-07' else Draft202012Validator
        cls.check_schema(req['schema'])
        value=json.loads(g['raw']) if req['format']=='json' else g['expected']
        assert cls(req['schema'],format_checker=FormatChecker()).is_valid(value),s['id']
        count=0;content=False
        if req.get('generatedSchema'):
            cls.check_schema(value);v=cls(value,format_checker=FormatChecker())
            for case in req['generatedSchema']['cases']:
                assert v.is_valid(case['data'])==case['valid'],(s['id'],case)
                count+=1
        if s['id'].startswith('SOC2-C-D'):
            expected=[]
            for x in published_input(s):
                item={'id':x['id'],'enabled':x['enabled']}
                if x['note'] is not None:
                    item.update(original=x['note'],encoded=base64.urlsafe_b64encode(unicodedata.normalize('NFC',x['note']).encode()).decode().rstrip('='))
                expected.append(item)
            assert expected==g['expected'];content=True
        if req['family']=='E':
            inputs=published_input(s)
            if s['id'].endswith('simple'):expected=inputs
            elif split=='development':
                expected=[]
                for x in inputs:
                    value={'skipped':True} if x['state']=='skip' else {'ok':{'message':x['note']}} if x['state']=='ok' else {'error':{'message':x['note'],'retryable':False}}
                    expected.append({x['id']:value})
            else:
                expected={'grants':{x['id']:{'guest':[],'member':['read'],'admin':['read','write']}[x['role']] for x in inputs},
                          'credentials':{x['id']:x['token'] for x in inputs if x['token'] is not None}}
            assert expected==g['expected'];content=True
        if req['family']=='F':
            inputs=published_input(s)
            expected=inputs if split=='development' else [{'code':x['id'],'name':actor,'note':x['text']} for actor in inputs['actorOrder'] for x in inputs['byActor'][actor]]
            if req['format']=='toml':expected={'records':expected}
            assert expected==g['expected'];content=True
        rows.append({'id':s['id'],'goldSchemaValid':True,'generatedSchemaCases':count,'independentContentMapping':content})
manifest=json.loads((root/'manifest.json').read_text(encoding='utf8'))
report={'status':'passed','validator':'python-jsonschema@4.26.0','modelCalls':0,'packHashes':manifest['hashes'],'goldHashes':manifest['goldHashes'],
        'rows':rows,'contentScope':'Independent mapping checks cover C-development, E and F; remaining reference content reviewed as explicit hand-sized witnesses, not claimed independently generated.'}
(root/'independent-gate.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps({'scenarios':len(rows),'behavioralCases':sum(x['generatedSchemaCases'] for x in rows),'independentContentMappings':sum(x['independentContentMapping'] for x in rows),'status':'passed'}))
