"""Author the next mathematics candidate pack. Offline exact arithmetic; no model calls.

This is a reproducible answer-key builder, not evidence of model difficulty.
The existing frozen pilot and production bank are never modified.
"""
from fractions import Fraction as F
from itertools import product, combinations, permutations
from collections import deque, Counter
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
GROUPS = []

def clean(x):
    if isinstance(x, F): return str(x)
    if isinstance(x, int) and not isinstance(x, bool): return str(x)
    if isinstance(x, list) or isinstance(x, tuple): return [clean(v) for v in x]
    if isinstance(x, dict): return {k: clean(v) for k, v in x.items()}
    return x

def solve(a, b):
    a = [[F(v) for v in row] + [F(v)] for row, v in zip(a, b)]
    n = len(a)
    for j in range(n):
        k = next(k for k in range(j, n) if a[k][j])
        a[j], a[k] = a[k], a[j]
        t = a[j][j]; a[j] = [v/t for v in a[j]]
        for k in range(n):
            if k != j:
                t = a[k][j]; a[k] = [u-t*v for u, v in zip(a[k], a[j])]
    return [r[-1] for r in a]

def dot(a, b): return sum(x*y for x,y in zip(a,b))
def exact(key, points, value): return {'key': key, 'points': points, 'kind': 'exact', 'expected': clean(value)}

# --- helpers added 2026-09-16 for the de-trivialised warm-up parts -----------
def gf2_rank(vals, bits=13):
    basis = [0]*bits; r = 0
    for v in vals:
        x = v
        for b in range(bits-1, -1, -1):
            if not (x >> b) & 1: continue
            if basis[b]: x ^= basis[b]
            else: basis[b] = x; r += 1; break
    return r

def edges_on_some_path(edges, source, sink):
    fwd, bwd = {}, {}
    for u, v, _ in edges:
        fwd.setdefault(u, set()).add(v); bwd.setdefault(v, set()).add(u)
    def reach(adj, s):
        seen = {s}; q = deque([s])
        while q:
            u = q.popleft()
            for v in adj.get(u, ()):
                if v not in seen: seen.add(v); q.append(v)
        return seen
    from_source = reach(fwd, source); to_sink = reach(bwd, sink)
    return [i for i, (u, v, _) in enumerate(edges) if u in from_source and v in to_sink]

def greedy_topological_prefix(n, pred, k):
    used = 0; out = []
    while len(out) < k:
        for j in range(n):
            if not (used >> j) & 1 and pred[j] & used == pred[j]:
                out.append(j); used |= 1 << j; break
        else:
            raise AssertionError('precedence graph is cyclic')
    return out

def event_bound(moment, predicate):
    """Primal-only max of P(predicate(X)) over distributions matching the moments."""
    d = len(moment); best = F(0)
    for basis in combinations(support_ref, d):
        w = solve([[F(x**j) for x in basis] for j in range(d)], moment)
        if min(w) < 0: continue
        best = max(best, sum(wi for x, wi in zip(basis, w) if predicate(x)))
    return best

support_ref = list(range(7))
def cert(key, points, kind, problem, reference):
    return {'key': key, 'points': points, 'kind': kind, 'problem': problem, 'reference': clean(reference)}
def part(task, *items): return {'task': task, 'items': list(items)}
def group(code, family, title, stem, parts, capstone, risk):
    assert len(parts) == 4 and [sum(i['points'] for i in p['items']) for p in parts] == [10,20,30,40]
    GROUPS.append({'id': f'MX3-{code}', 'family': family, 'title': title, 'stem': stem,
                   'parts': parts, 'capstoneChange': capstone, 'difficultyRisk': risk})

# 1. Primal/dual optimum and a new infeasible constraint. Existing exact verifier.
a = [[3,1,2,0,1],[1,4,0,2,1],[0,1,3,1,2],[2,0,1,4,1],[1,2,1,1,3]]
x = [1,2,1,3,2]; y = [2,1,3,2,1]
b = [dot(r,x) for r in a]; c = [dot(col,y) for col in zip(*a)]
p = {'a':a, 'b':b, 'c':c}
bound = sum(b); lower = [sum(col) for col in zip(*a)]
p4 = {'a':a+[[-v for v in lower]],'b':b+[-bound-1],'c':c}
group('01','linear-duality','有理线性规划与不可行证书',
      '所有变量非负。最大化 c·x，约束 A x≤b。数据：'+json.dumps(p)+
      '。optimal证书为{status:"optimal",x:[...],y:[...],value:...}，其中y≥0、Aᵀy≥c且b·y=c·x。infeasible证书为{status:"infeasible",y:[...]}，要求y≥0、Aᵀy≥0、b·y<0。', [
    part('提交 row_slack=把 x=[1,1,1,1,1] 代入后各约束的松弛量 b−Ax（按约束顺序，长度5）。',exact('row_slack',10,[b[i]-sum(a[i]) for i in range(5)])),
    part('求全部五个不等式同时取等号时的向量，按变量顺序提交 intersection。',exact('intersection',20,x)),
    part('求最大值 value，并提交证明该最大值的 certificate。',exact('value',10,dot(c,x)),cert('certificate',20,'lp',p,{'status':'optimal','x':x,'y':y,'value':dot(c,x)})),
    part('现在额外加入 '+json.dumps(lower)+'·x≥'+str(bound+1)+'。判断 status（optimal/infeasible/unbounded），并提交针对新系统的 certificate。',
         exact('status',10,'infeasible'),cert('certificate',30,'lp',p4,{'status':'infeasible','y':[1]*6}))],
    '新增约束使可行性改变，原最优解不能直接复用。','第五问式证书任务仍可能被熟悉对偶的强模型直接解出；未校准。')

# 2. Max-flow certificates, including a new capacity regime.
edges = [[0,1,11],[0,2,8],[0,3,6],[1,2,3],[1,4,7],[1,5,5],[2,4,6],[2,5,5],[3,2,2],[3,5,7],[4,5,2],[4,6,8],[5,6,4],[5,7,9],[6,7,13]]
def flow(edges):
    n=8; f=[0]*len(edges)
    while True:
        parent={0:None}; q=deque([0])
        while q and 7 not in parent:
            u=q.popleft()
            for i,(a,b,c) in enumerate(edges):
                if a==u and c-f[i]>0 and b not in parent: parent[b]=(u,i,1,c-f[i]);q.append(b)
                if b==u and f[i]>0 and a not in parent: parent[a]=(u,i,-1,f[i]);q.append(a)
        if 7 not in parent: break
        path=[]; v=7
        while v: path.append(parent[v]);v=parent[v][0]
        d=min(t[3] for t in path)
        for _,i,s,_ in path: f[i]+=s*d
    value=sum(f[i] for i,e in enumerate(edges) if e[0]==0)
    return {'flow':f,'cut':sorted(parent),'value':value}
e4=[r[:] for r in edges]; e4[11][2]=3;e4[13][2]=4;e4.append([3,6,5])
f,f4=flow(edges),flow(e4)
group('02','network-flow','流量与割的双向证明','有向网络顶点0..7，源0汇7；每条边[u,v,capacity]，流量必须为整数。边按输入顺序编号。数据：'+json.dumps(edges)+
      '。证书为{flow:[每条边流量],cut:[含源不含汇的顶点集合],value:流值}；需满足容量、流守恒，且流值等于割容量。',[
    part('提交 path_edges=[位于至少一条 0→7 有向路径上的边的编号]（升序）。',exact('path_edges',10,edges_on_some_path(edges,0,7))),
    part('求最大流值 value。',exact('value',20,f['value'])),
    part('提交 certificate，证明最大流与最小割相等。',cert('certificate',30,'flow',{'n':8,'edges':edges},f)),
    part('改为边4→6容量3、5→7容量4，并新增3→6容量5（追加在边序列末尾）。求新 value，并提交新 certificate。',exact('value',10,f4['value']),cert('certificate',30,'flow',{'n':8,'edges':e4},f4))],
    '同时收紧两边并增加跨层边，必须重新给出流和割。','小网络存在算法化捷径；用于证书能力，不宣称研究级。')

# 3. Assignment with a ban; a dual is found by difference constraints.
cost=[[8,9,23,14,8,19],[7,21,7,18,16,10],[6,12,18,6,22,13],[8,16,11,24,9,17],[7,7,19,10,15,21],[8,14,9,17,12,8]]
def assignment(cost, banned):
    n=len(cost); value,perm=min((sum(cost[i][q[i]] for i in range(n)),q) for q in permutations(range(n)) if all([i,q[i]] not in banned for i in range(n)))
    v=[0]*n
    for _ in range(n):
        for i in range(n):
            for j in range(n):
                if [i,j] not in banned: v[j]=min(v[j],v[perm[i]]+cost[i][j]-cost[i][perm[i]])
    u=[cost[i][perm[i]]-v[perm[i]] for i in range(n)]
    return {'permutation':list(perm),'u':u,'v':v,'value':value}
asg=assignment(cost,[]); ban=[[0,asg['permutation'][0]],[2,asg['permutation'][2]]];asg4=assignment(cost,ban)
group('03','assignment-duality','受限指派与势函数', '6名工人到6项工作的一一指派，编号0..5，成本矩阵：'+json.dumps(cost)+
      '。最小化总成本。certificate={permutation:[工人对应工作],u:[...],v:[...],value:...}；所有允许边应有u[i]+v[j]≤cost[i][j]，且总成本=Σu+Σv。',[
    part('提交 row_min=[成本矩阵每行的最小值]（按行顺序，长度6），以及 row_min_sum=各行最小值之和。',
         exact('row_min',5,[min(r) for r in cost]),exact('row_min_sum',5,sum(min(r) for r in cost))),
    part('求最小成本 value。',exact('value',20,asg['value'])),
    part('提交达到最优值的指派及对偶势函数 certificate。',cert('certificate',30,'assignment',{'cost':cost,'banned':[]},asg)),
    part('现在禁止边 '+json.dumps(ban)+'。求新 value，并提交只对允许边要求对偶可行的新 certificate。',exact('value',10,asg4['value']),cert('certificate',30,'assignment',{'cost':cost,'banned':ban},asg4))],
    '禁止原最优解中的两条边，需重建指派和对偶。','与网络流相关，报告题族时保留该关联，不能当完全独立能力轴。')

# 4. Modular polynomial quotient ring, solve multiplication as a linear map.
def pmul(a,b,p=7):
    out=[0]*(len(a)+len(b)-1)
    for i,x in enumerate(a):
        for j,y in enumerate(b): out[i+j]=(out[i+j]+x*y)%p
    return out
def remainder(a,f,p=7):
    a=a[:]
    while len(a)>=len(f):
        v=a[-1]*pow(f[-1],-1,p)%p;k=len(a)-len(f)
        for j,w in enumerate(f): a[k+j]=(a[k+j]-v*w)%p
        a.pop()
    return a+[0]*(len(f)-1-len(a))
def modular_solve(a,b,p):
    a=[[(v%p) for v in row]+[t%p] for row,t in zip(a,b)]; piv=[];r=0
    for c in range(len(a[0])-1):
        k=next((k for k in range(r,len(a)) if a[k][c]),None)
        if k is None:continue
        a[r],a[k]=a[k],a[r];a[r]=[v*pow(a[r][c],-1,p)%p for v in a[r]]
        for k in range(len(a)):
            if k!=r:
                t=a[k][c];a[k]=[(u-t*v)%p for u,v in zip(a[k],a[r])]
        piv.append(c);r+=1
        if r==len(a):break
    assert all(any(row[:-1]) or not row[-1] for row in a)
    x=[0]*(len(a[0])-1)
    for i,c in enumerate(piv):x[c]=a[i][-1]
    return x,len(piv)
fpoly=pmul(pmul([1,0,1],[1,0,1]),[1,0,1]);g=[3,2,0,1];g4=pmul([1,0,1],[2,1]);rhs=remainder(pmul([1,0,1],[1,0,1]),fpoly)
def multmat(g): return list(map(list,zip(*[remainder([0]*i+g,fpoly) for i in range(6)])))
inv,rank=modular_solve(multmat(g),[1,0,0,0,0,0],7);sol4,rank4=modular_solve(multmat(g4),rhs,7)
group('04','nonreduced-polynomial-ring','非约化商环中的逆与解空间','在F₇[x]/((x²+1)³)中计算。系数数组按常数项到最高次项排列，所有系数用0..6代表；余式数组固定长度6。',[
    part('提交 x6_reduced=x⁶ 在商环 F₇[x]/((x²+1)³) 中的余式（长度6，常数项起）。',
         exact('x6_reduced',10,remainder([0,0,0,0,0,0,1],fpoly))),
    part('令g=x³+2x+3。提交 multiplication_rank=乘g在六维商环上的线性映射秩。',exact('multiplication_rank',20,rank)),
    part('提交 inverse=g的逆元余式。',exact('inverse',30,inv)),
    part('改解 (x²+1)(x+2)h=(x²+1)²。提交 count=不同余式解总数，以及 canonical=按系数变量顺序做RREF并把自由变量置0所得的解。',exact('count',15,7**(6-rank4)),exact('canonical',25,sol4))],
    '从可逆元切换为零因子方程，不能继续套求逆。','自由变量约定为唯一答案服务，不把格式难度算数学难度。')

# 5. Absorbing chain: success-conditioned moments with changed transition.
trans=[[0,F(1,2),F(1,3),F(1,6),0],[F(1,4),0,F(1,4),F(1,4),F(1,4)],[F(1,5),F(2,5),0,F(1,5),F(1,5)]]
def moments(rows):
    n=len(rows);a=[[F(i==j)-rows[i][j] for j in range(n)] for i in range(n)]
    h=solve(a,[r[n] for r in rows]); u=solve(a,h)
    v=solve(a,[2*u[i]-h[i] for i in range(n)])
    return h,u,v
h,u,v=moments(trans);t4=[r[:] for r in trans];t4[1]=[F(1,3),0,F(1,6),F(1,6),F(1,3)];h4,u4,v4=moments(t4)
group('05','conditioned-markov-moments','吸收链的条件矩与转移干预','状态为0,1,2,S,F；S与F吸收。从0开始，T为首次吸收所需步数。每行按0,1,2,S,F给转移概率：'+json.dumps(clean(trans))+'.',[
    part('提交 one_step_absorb=[从状态0、1、2 各自一步进入吸收态(S或F)的概率]（按状态顺序，长度3，精确分数）。',
         exact('one_step_absorb',10,[trans[i][3]+trans[i][4] for i in range(3)])),
    part('提交 success=最终在S吸收的概率。',exact('success',20,h[0])),
    part('提交 conditional_mean=E[T|最终到S]。',exact('conditional_mean',30,u[0]/h[0])),
    part('仅把状态1的转移行改为[1/3,0,1/6,1/6,1/3]。提交 success，以及 conditional_variance=Var(T|最终到S)。',exact('success',10,h4[0]),exact('conditional_variance',30,v4[0]/h4[0]-(u4[0]/h4[0])**2))],
    '转移干预后重算条件二阶矩，旧成功概率和期望不能代入。','需区分条件矩和无条件矩；精确分数判分。')

# 6. Overlapping word race, prefix automaton built locally.
patterns=['HHTH','HTHH'];states=['']+sorted({p[:i] for p in patterns for i in range(1,len(p))},key=lambda s:(len(s),s))
def race(ph):
    rows=[]
    for s in states:
        row=[F(0)]*(len(states)+2)
        for ch,pr in [('H',ph),('T',1-ph)]:
            w=s+ch
            if any(w.endswith(p) for p in patterns):j=len(states)+next(i for i,p in enumerate(patterns) if w.endswith(p))
            else:j=states.index(max((t for t in states if w.endswith(t)),key=len))
            row[j]+=pr
        rows.append(row)
    return moments(rows)
rh,ru,rv=race(F(2,5));sh,su,sv=race(F(3,5))
group('06','overlapping-pattern-stopping','重叠模式的停时竞争','独立抛偏硬币，P(H)=2/5。出现HHTH或HTHH中任一连续模式时立刻停止；T为总抛掷次数，A表示HHTH先出现。',[
    part('提交 first_four_any=前四次中出现 HHTH 或 HTHH 中任意一个的概率（两者在同一个四位窗口内互斥）。',
         exact('first_four_any',10,F(2,5)**3*F(3,5)*2)),
    part('提交 win=P(A)。',exact('win',20,rh[0])),
    part('提交 conditional_mean=E[T|A]。模式可以重叠。',exact('conditional_mean',30,ru[0]/rh[0])),
    part('硬币改为P(H)=3/5，其他规则不变。提交 win，以及 conditional_second=E[T²|A]（不是方差）。',exact('win',10,sh[0]),exact('conditional_second',30,sv[0]/sh[0]))],
    '改变偏置并考查条件二阶矩；需正确处理模式重叠。','与吸收链共享计算工具，但问题建模不同；统计不假定独立。')

# 7. Group action with an additional symmetry in the final part.
def transforms(s,dihedral=False,complement=False):
    out=set()
    for t in ([s,s[::-1]] if dihedral else [s]):
        for i in range(len(s)):
            r=t[i:]+t[:i];out.add(r)
            if complement:out.add(''.join('1' if c=='0' else '0' for c in r))
    return out
def orbit_hist(words,d=False,c=False):
    remaining=set(words);hist=Counter()
    while remaining:
        s=min(remaining);o=transforms(s,d,c);assert o<=set(words)
        remaining-=o;hist[len(o)]+=1
    return hist
w=[''.join(x) for x in product('01',repeat=14) if x.count('1')==5 and all(not(x[i]==x[(i+1)%14]=='1') for i in range(14))]
w4=[''.join(x) for x in product('01',repeat=14) if x.count('1')==7 and all(len({x[i],x[(i+1)%14],x[(i+2)%14]})>1 for i in range(14))]
hist=orbit_hist(w4,True,True)
group('07','burnside-orbits','循环约束与扩张对称群','长度14的二进制循环串，位置有编号，首尾相邻。前三问恰有5个1且没有相邻的1。',[
    part('提交 with_pos0_one=位置0为1、且满足恰有5个1与全部相邻约束的有编号串数。',
         exact('with_pos0_one',10,sum(1 for s in w if s[0]=='1'))),
    part('只把旋转视为相同，求 orbits。',exact('orbits',20,sum(orbit_hist(w).values()))),
    part('把旋转与反射都视为相同，求 bracelets。',exact('bracelets',30,sum(orbit_hist(w,True).values()))),
    part('条件改为恰有7个1且循环中没有000或111。旋转、反射、全体位取反都视为等价。提交 orbits，以及 histogram=[[轨道大小,该大小的轨道数],...]，只列非零项并按大小升序。',exact('orbits',10,sum(hist.values())),exact('histogram',30,sorted(hist.items())))],
    '更换局部约束并扩张群，不能沿用前三问轨道数。','禁止把大整数本身当作难度证据。')

# 8. Weighted trees: enumeration produces a generating polynomial, not model evidence.
tree_edges=[[0,1,2],[0,2,3],[0,3,1],[1,2,1],[1,4,4],[2,3,2],[2,4,1],[2,5,3],[3,5,2],[3,6,1],[4,5,2],[4,6,3],[5,6,4]]
red={1,4,7,9,11}
poly=[0]*7;joint=0;total=0;tree_count=0
for chosen in combinations(range(len(tree_edges)),6):
    parent=list(range(7));weight=1
    def find(v):
        while parent[v]!=v:v=parent[v]
        return v
    valid=True
    for i in chosen:
        aa,bb,ww=tree_edges[i];aa,bb=find(aa),find(bb)
        if aa==bb:valid=False;break
        parent[aa]=bb;weight*=ww
    if valid:
        tree_count+=1;total+=weight;poly[len(set(chosen)&red)]+=weight
        if 1 in chosen and 4 in chosen:joint+=weight
mean=F(sum(i*v for i,v in enumerate(poly)),total);variance=F(sum(i*i*v for i,v in enumerate(poly)),total)-mean*mean
group('08','weighted-tree-correlations','加权生成树与边相关性','无向简单图顶点0..6，边按0起编号，每条[u,v,w]：'+json.dumps(tree_edges)+
      '。生成树的权重为边权之积，随机树的概率与权重成正比。',[
    part('提交 tree_count=不同生成树的个数（不计权重）。',exact('tree_count',10,tree_count)),
    part('求所有生成树的总权重 partition。',exact('partition',20,total)),
    part('提交 joint=边1与边4同时在随机生成树中的概率。',exact('joint',30,F(joint,total))),
    part('把边'+json.dumps(sorted(red))+'标红，K为树中红边数。提交 polynomial=Σ树权重·z^K的系数数组（固定长度7，从常数项开始），以及 variance=Var(K)。',exact('polynomial',25,poly),exact('variance',15,variance))],
    '从单一相关事件扩展到整组边的联合计数和方差。','可用行列式或枚举；证据是精确系数，不声称验证自然语言证明。')

# 9. Code with joint shortening and puncturing.
rows=[0b100000110101,0b010000101011,0b001000111000,0b000100011110,0b000010100111,0b000001010101]
code=set()
for mask in range(64):
    z=0
    for i,r in enumerate(rows):
        if mask>>i&1:z^=r
    code.add(z)
weights=[sum(v.bit_count()==i for v in code) for i in range(13)]
# Positions are 0..11 from leftmost to rightmost.
shortened={tuple((v>>(11-j))&1 for j in range(12) if j not in [0,1,7]) for v in code if not(v>>11&1) and not(v>>10&1)}
sw=[sum(sum(v)==i for v in shortened) for i in range(10)]
group('09','linear-code-operations','线性码与缩短穿孔的顺序','F₂上的线性码由下列六行生成；字符串左端为位置0，右端为位置11：'+json.dumps([format(r,'012b') for r in rows])+'.',[
    part('提交 first_four_rank=前四行生成子空间在 F₂ 上的维数。',exact('first_four_rank',10,gf2_rank(rows[:4]))),
    part('提交 distance=最小非零汉明重量。',exact('distance',20,next(i for i in range(1,13) if weights[i]))),
    part('提交 enumerator=完整重量分布，长度13，第i项为重量i的码字数。',exact('enumerator',30,weights)),
    part('先只保留位置0和1都为0的码字并删除这两位（缩短），再删除原位置7（穿孔）。重复得到的码字只计一次。提交 size=新码大小、enumerator=长度10的重量分布。',exact('size',10,len(shortened)),exact('enumerator',30,sw))],
    '条件筛选后再投影并去重，原重量分布不足以推出新答案。','64个码字可穷举；该题为组合线代覆盖，不单靠此题抬上限。')

# 10. Linear extensions with order-conditioning and positional moments.
dag=[(0,3),(0,4),(1,4),(1,5),(2,5),(2,6),(3,7),(4,7),(4,8),(5,8),(5,9),(6,9),(7,10),(8,10),(8,11),(9,11)]
pred=[0]*12
for u0,v0 in dag:pred[v0]|=1<<u0
def extensions(extra=None, event=None):
    pp=pred[:]
    if extra:pp[extra[1]]|=1<<extra[0]
    dp={0:(1,0,0)}
    # Track sum of positions of vertex4, and product pos4*pos5.
    for mask in range(1<<12):
        if mask not in dp:continue
        n,s,t=dp[mask];position=mask.bit_count()+1
        for j in range(12):
            if mask>>j&1 or pp[j]&mask!=pp[j]:continue
            if event and j==event[0] and position!=event[1]:continue
            dest=mask|1<<j;nn,ss,tt=dp.get(dest,(0,0,0))
            dp[dest]=(nn+n,ss+(n*position if j==4 else s),tt+(s*position if j==5 else t))
    return dp.get((1<<12)-1,(0,0,0))
ext=extensions()[0];ext3=extensions((4,5))[0];n4,s4,t4=extensions((4,5))
group('10','poset-conditioned-counting','偏序线性扩张与位置统计','12个不同元素0..11。每条[u,v]要求u在v前，除此之外仅含传递闭包的约束：'+json.dumps(dag)+
      '。每个合法排列等概率，位置从1计。',[
    part('提交 greedy_prefix=按“每步取当前最小可用元素”得到的合法排列的前4个元素。',
         exact('greedy_prefix',10,greedy_topological_prefix(12,pred,4))),
    part('求合法排列总数 count。',exact('count',20,ext)),
    part('额外要求4在5前，求合法排列数 count。',exact('count',30,ext3)),
    part('在额外要求4在5前的条件下，提交 joint_position=E[pos(4)·pos(5)]，以及 first_four=P(pos(4)=4)。',exact('joint_position',25,F(t4,n4)),exact('first_four',15,F(extensions((4,5),(4,4))[0],n4)))],
    '计数升级为条件位置联合矩，单一总数不能复用作答案。','子集动态规划可精确求解；不同小问不是独立样本。')

# 11. Singular lifting: factors can share powers of three.
def roots(power):
    m=3**power
    return [x for x in range(m) if ((x*x-1)*(x*x-10))%m==0]
rs2,rs3,rs5,rs8,rs12=roots(2),roots(3),roots(5),roots(8),roots(12)
def valuation(v):
    if v==0:return 99
    n=0
    while v%3==0:n+=1;v//=3
    return n
vh=Counter(min(valuation(x*x-1),12) for x in rs12)
group('11','singular-adic-lifting','共享因子的奇异提升','研究整数同余 (x²−1)(x²−10)≡0 mod 3^k。不同x按模3^k计。不能假定两因子之一单独被3^k整除。',[
    part('k=3，提交 count=解数，以及 parity=[解中偶数的个数,解中奇数的个数]。',
         exact('count',5,len(rs3)),exact('parity',5,[sum(1 for x in rs3 if x%2==0),sum(1 for x in rs3 if x%2==1)])),
    part('k=5，提交 count=解数。',exact('count',20,len(rs5))),
    part('k=8，提交 count，并提交 split_count=满足x²≡1或10 mod3^8的解数。',exact('count',15,len(rs8)),exact('split_count',15,sum((x*x-1)%3**8==0 or (x*x-10)%3**8==0 for x in rs8))),
    part('k=12，提交 count，以及 histogram=[[min(v₃(x²−1),12),该类解数],...]。v₃(0)=∞，只列非零类别，按第一列升序。',exact('count',10,len(rs12)),exact('histogram',30,sorted(vh.items())))],
    '要求区分因子间分担赋值的根，给出完整赋值分布。','前问会提示错误捷径；需实测后再认定压轴难度。')

# 12. Discrete moment problem; primal distribution and polynomial dual.
support=list(range(7)); moments2=[1,3,11];moments3=[1,3,11,45]
objective=[int(x>=5) for x in support]
def moment_opt(moment):
    d=len(moment);best=None
    for basis in combinations(support,d):
        weights=solve([[F(x**j) for x in basis] for j in range(d)],moment)
        if min(weights)<0:continue
        value=dot([objective[x] for x in basis],weights)
        if best is None or value>best[0]:best=(value,basis,weights)
    value,basis,weights=best
    # A degenerate optimal primal basis need not give a feasible dual basis.
    # Enumerate dual vertices independently and require a matching exact bound.
    dual=None
    for tight in combinations(support,d):
        candidate=solve([[F(x**j) for j in range(d)] for x in tight],[objective[x] for x in tight])
        if dot(candidate,moment)==value and all(sum(candidate[j]*x**j for j in range(d))>=objective[x] for x in support):
            dual=candidate;break
    assert dual is not None
    full=[F(0)]*7
    for x,w in zip(basis,weights):full[x]=w
    return {'weights':full,'dual':dual,'value':value}
mo=moment_opt(moments2);mo4=moment_opt(moments3)
group('12','finite-moment-extrema','有限矩约束下的概率上界','X取值于{0,1,...,6}，E[X]=3、E[X²]=11，不作其他分布假设。certificate={weights:[各点概率],dual:[多项式常数项起系数],value:...}；概率须满足所有给定矩，且多项式在每个支持点上≥1{x≥5}，其期望与事件概率都等于value。',[
    part('在仅给定 E[X]=3、E[X²]=11 的条件下，提交 bound_at_6=P(X=6) 的最大可能值。',
         exact('bound_at_6',10,event_bound(moments2,lambda x:x==6))),
    part('求P(X≥5)的最大可能值 bound。',exact('bound',20,mo['value'])),
    part('提交达到上界的分布及二次多项式 certificate。',cert('certificate',30,'moment',{'support':support,'moments':moments2,'objective':objective},mo)),
    part('新增E[X³]=45。求新的最大值 bound，并提交满足全部矩的分布及至多三次多项式 certificate（系数数组固定长度4）。',exact('bound',10,mo4['value']),cert('certificate',30,'moment',{'support':support,'moments':moments3,'objective':objective},mo4))],
    '增加三阶矩改变可行分布集合，旧证书不能直接证明新最优值。','与对偶题共享证书思想；完整覆盖需要保留数学领域标签。')

pack={'version':'math-exam-expansion-2026-09-14-v3','status':'candidate-unmeasured',
      'modelCalls':0,'hardSeconds':[180,360,1200,1200],'points':[10,20,30,40],
      'groups':GROUPS,'difficultyCalibrated':False,'productionEligible':False}
dest=ROOT/'packages/core/src/evaluationLab/examExpansion/math-candidates.json'
dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'groups':len(GROUPS),'parts':4*len(GROUPS),'modelCalls':0,'path':str(dest)}))
