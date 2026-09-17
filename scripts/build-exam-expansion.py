"""Author the next mathematics candidate pack. Offline exact arithmetic; no model calls.

This is a reproducible answer-key builder, not evidence of model difficulty.
The existing frozen pilot and production bank are never modified.
"""
from fractions import Fraction as F
from itertools import product, combinations, permutations
from collections import deque, Counter
from math import comb, factorial, isqrt, cos, gcd, pi
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

def assert_distinct(name, *values):
    """组内 gold 不得重复。

    踩过的坑（2026-09-17 体检发现）：progressive exam 会把前面小问的**模型回答**
    带进后续小问的上下文（evaluationLab/examExpansion/index.ts:196），
    所以组内两个小问答案相同 = 后面那一档可以直接抄前面的答案，绕过它的概念。
    实例：MX3-03 的 row_min_sum=44 与 value=44；MX3-11 的 P3/P4 count 都是 36；
          MX3-14 的 n_zero=7 与 a1=7。
    注意：列表型 gold 按整体比较，不要把分量拆开（否则 MX3-11 的 parity=[3,3] 会误报）。
    """
    ser = [json.dumps(v, ensure_ascii=False) if isinstance(v, (list, dict)) else str(v) for v in values]
    dup = sorted({s for s in ser if ser.count(s) > 1})
    assert not dup, '%s 组内答案重复（泄漏）：%s' % (name, dup)

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

# --- helpers added 2026-09-16 for the hard replacement groups ----------------
def int_det(m):
    """Exact integer determinant, fraction-free Bareiss elimination.

    Requires exact divisibility at every step, which holds for integer matrices.
    Kept separate from the Fraction-based solver so the two can cross-check.
    """
    a = [row[:] for row in m]
    n = len(a)
    if n == 0:
        return 1
    sign = 1
    prev = 1
    for k in range(n - 1):
        if a[k][k] == 0:
            piv = next((r for r in range(k + 1, n) if a[r][k]), None)
            if piv is None:
                return 0
            a[k], a[piv] = a[piv], a[k]
            sign = -sign
        for i in range(k + 1, n):
            for j in range(k + 1, n):
                a[i][j] = (a[i][j] * a[k][k] - a[i][k] * a[k][j]) // prev
        prev = a[k][k]
        for i in range(k + 1, n):
            a[i][k] = 0
    return sign * a[n - 1][n - 1]

def det_fraction(m):
    """Exact rational determinant (Fraction Gaussian elimination).

    Deliberately a different algorithm from int_det so the two can cross-check.
    """
    a = [[F(x) for x in row] for row in m]
    n = len(a)
    d = F(1)
    for c in range(n):
        piv = next((r for r in range(c, n) if a[r][c] != 0), None)
        if piv is None:
            return F(0)
        if piv != c:
            a[c], a[piv] = a[piv], a[c]
            d = -d
        d *= a[c][c]
        for r in range(c + 1, n):
            f = a[r][c] / a[c][c]
            if f:
                for k in range(c, n):
                    a[r][k] -= f * a[c][k]
    return d

def circulant_laplacian(n, offsets):
    """Symmetric Laplacian of the undirected circulant graph.

    Each undirected edge must contribute +1 to BOTH endpoint diagonal entries;
    only advancing by the positive offsets undercounts degrees (a bug that two
    otherwise-different determinant implementations shared undetected — the
    brute-force enumeration in the verifier is what caught it).
    """
    L = [[0] * n for _ in range(n)]
    seen = set()
    for i in range(n):
        for s in offsets:
            j = (i + s) % n
            if j == i:
                continue
            e = (min(i, j), max(i, j))
            if e in seen:
                continue
            seen.add(e)
            L[i][i] += 1
            L[j][j] += 1
            L[i][j] -= 1
            L[j][i] -= 1
    return L

def spanning_trees(n, offsets):
    """Kirchhoff: any cofactor of the Laplacian. Brute-force enumeration of
    C(|E|, n-1) edge subsets is infeasible at n=40 (C(120,39) ~ 1e31)."""
    return abs(int_det([row[:n - 1] for row in circulant_laplacian(n, offsets)[:n - 1]]))

def spanning_trees_containing(n, offsets, edge):
    """Trees containing `edge` == spanning trees of the contracted graph.

    Both endpoints of the contracted edge are merged; the merged vertex absorbs
    every incident edge, so degrees must be accumulated per surviving endpoint.
    """
    u, v = edge
    if (v - u) % n > (u - v) % n:
        u, v = v, u
    keep = [x for x in range(n) if x != v]
    idx = {x: i for i, x in enumerate(keep)}
    m = len(keep)
    L = [[0] * m for _ in range(m)]
    seen = set()
    for x in range(n):
        for s in offsets:
            y = (x + s) % n
            if y == x:
                continue
            e = (min(x, y), max(x, y))
            if e in seen:
                continue
            seen.add(e)
            if e == (min(u, v), max(u, v)):
                continue  # 这条边已收缩
            a = idx.get(x, idx[u])   # 被收缩的 v 归并到 u
            b = idx.get(y, idx[u])
            if a == b:
                continue
            L[a][a] += 1
            L[b][b] += 1
            L[a][b] -= 1
            L[b][a] -= 1
    return abs(int_det([row[:m - 1] for row in L[:m - 1]]))

MOD14 = 1000000007
MOD14B = 998244353
REC = (3, -1, 2)          # a_n = 3a_{n-1} - a_{n-2} + 2a_{n-3}
INIT = (1, 2, 5)

def rec_terms(seed, coeffs, terms, mod):
    a = list(seed)
    out = list(seed)
    if terms <= len(seed):
        return out[:terms]
    for _ in range(terms - len(seed)):
        nxt = sum(coeffs[i] * a[-1 - i] for i in range(len(coeffs))) % mod
        a.append(nxt)
        out.append(nxt)
    return out

def mat_mul(A, B, mod):
    n, m, p = len(A), len(B), len(B[0])
    return [[sum(A[i][k] * B[k][j] for k in range(m)) % mod for j in range(p)] for i in range(n)]

def mat_pow(M, e, mod):
    n = len(M)
    R = [[1 if i == j else 0 for j in range(n)] for i in range(n)]
    B = [row[:] for row in M]
    while e:
        if e & 1:
            R = mat_mul(R, B, mod)
        B = mat_mul(B, B, mod)
        e >>= 1
    return R

def rec_index(seed, coeffs, index, mod):
    """a_index by companion-matrix power. index can be astronomically large."""
    d = len(coeffs)
    if index < d:
        return seed[index] % mod
    C = [[0] * d for _ in range(d)]
    for j in range(d):
        C[0][j] = coeffs[j] % mod
    for i in range(1, d):
        C[i][i - 1] = 1
    P = mat_pow(C, index - d + 1, mod)
    return sum(P[0][j] * seed[d - 1 - j] for j in range(d)) % mod

def rec_index_poly(seed, coeffs, index, mod):
    """Independent route: x^index mod characteristic polynomial, then dot with seed."""
    d = len(coeffs)
    if index < d:
        return seed[index] % mod
    # 以 (x^index mod f) 的系数组合初值；f(x) = x^d - c1 x^{d-1} - ... - cd
    def mul(u, v):
        t = [0] * (2 * d - 1)
        for i, ui in enumerate(u):
            if ui:
                for j, vj in enumerate(v):
                    t[i + j] = (t[i + j] + ui * vj) % mod
        for k in range(2 * d - 2, d - 1, -1):
            if t[k]:
                c = t[k]
                for j in range(d):
                    t[k - 1 - j] = (t[k - 1 - j] + c * coeffs[j]) % mod
        return t[:d]
    res = [1] + [0] * (d - 1)
    base = [0, 1] + [0] * (d - 2)
    e = index
    while e:
        if e & 1:
            res = mul(res, base)
        base = mul(base, base)
        e >>= 1
    return sum(res[j] * seed[j] for j in range(d)) % mod

def paths_dp(target, bound=None, blocked=()):
    """Brute-force DP: monotone paths (0,0)->target, y <= x + bound, avoiding blocked."""
    tx, ty = target
    if bound is None or bound >= tx:
        bound = tx + 2
    blocked = set(blocked)
    dp = {(0, 0): 1}
    for s in range(1, tx + ty + 1):
        for x in range(max(0, s - ty), min(tx, s) + 1):
            y = s - x
            if x > tx or y > ty or (x, y) in blocked:
                continue
            if y > x + bound:
                continue
            dp[(x, y)] = dp.get((x - 1, y), 0) + dp.get((x, y - 1), 0)
    return dp.get(target, 0)

def lgv(ends, starts):
    """Lindström–Gessel–Viennot: pairwise vertex-disjoint monotone path families.

    Uses unconstrained binomial counts so the translation trick stays valid;
    applying a per-path offset constraint would change the bound in original
    coordinates and invalidate the determinant.
    """
    n = len(starts)
    M = []
    for i in range(n):
        row = []
        for j in range(n):
            sx, sy = starts[i]
            ex, ey = ends[j]
            dx, dy = ex - sx, ey - sy
            row.append(0 if dx < 0 or dy < 0 else comb(dx + dy, dx))
        M.append(row)
    return int_det(M)

# --- helpers added 2026-09-16 (second hard batch) ----------------------------
def penta_partitions(N, mod=None):
    """p(0..N) by Euler's pentagonal-number recurrence (O(N sqrt N))."""
    p = [0] * (N + 1)
    p[0] = 1
    for n in range(1, N + 1):
        tot = 0
        k = 1
        while True:
            g1 = k * (3 * k - 1) // 2
            g2 = k * (3 * k + 1) // 2
            if g1 > n and g2 > n:
                break
            sgn = 1 if k % 2 else -1
            if g1 <= n:
                tot += sgn * p[n - g1]
            if g2 <= n:
                tot += sgn * p[n - g2]
            k += 1
        p[n] = tot if mod is None else tot % mod
    return p

def coin_partitions(N, parts, mod=None):
    """Independent route: unrestricted coin-change DP over the allowed part sizes."""
    dp = [0] * (N + 1)
    dp[0] = 1
    for c in parts:
        for n in range(c, N + 1):
            dp[n] = (dp[n] + dp[n - c]) % mod if mod else dp[n] + dp[n - c]
    return dp

def distinct_partitions(N):
    """Partitions into pairwise distinct parts.

    Must be a 0/1 knapsack (descending inner loop so each part is used at most
    once). Reusing coin_partitions(N, range(1, N+1)) silently returns p(N) —
    the unrestricted count — which Euler's theorem catches immediately, since
    distinct-part partitions must equal odd-part partitions for every n.
    """
    dp = [0] * (N + 1)
    dp[0] = 1
    for c in range(1, N + 1):
        for n in range(N, c - 1, -1):
            dp[n] += dp[n - c]
    return dp

def hook_length_factorial(n, shape):
    """Number of standard Young tableaux of shape `shape` (hook length formula)."""
    prod = 1
    for i, row in enumerate(shape):
        for j in range(row):
            below = sum(1 for r in shape[i + 1:] if r > j)
            prod *= (row - j) + below
    return factorial(n) // prod

def skew_syt(lam, mu):
    """Skew SYT count via the Aitken determinant f^(lam/mu) = n! det(1/(li-mj-i+j)!)."""
    k = len(lam)
    mu = list(mu) + [0] * (k - len(mu))
    n = sum(lam) - sum(mu)
    M = []
    for i in range(k):
        row = []
        for j in range(k):
            d = lam[i] - mu[j] - i + j
            row.append(F(1, factorial(d)) if d >= 0 else F(0))
        M.append(row)
    return factorial(n) * det_fraction(M)
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
# 割结构：枚举全部「含源不含汇」顶点集并按容量排序（P4 用）
_cut_caps = sorted(
    sum(c for u, v, c in edges if (mask >> u) & 1 and not ((mask >> v) & 1))
    for mask in range(1 << 8) if (mask & 1) and not ((mask >> 7) & 1))
assert _cut_caps[0] == f['value'], f"最大流与最小割应相等：{_cut_caps[0]} vs {f['value']}"
min_cut_count = _cut_caps.count(_cut_caps[0])
second_min_cut = next(c for c in _cut_caps if c > _cut_caps[0])

group('02','network-flow','流量与割的双向证明','有向网络顶点0..7，源0汇7；每条边[u,v,capacity]，流量必须为整数。边按输入顺序编号。数据：'+json.dumps(edges)+
      '。证书为{flow:[每条边流量],cut:[含源不含汇的顶点集合],value:流值}；需满足容量、流守恒，且流值等于割容量。',[
    part('提交 path_edges=[位于至少一条 0→7 有向路径上的边的编号]（升序）。',exact('path_edges',10,edges_on_some_path(edges,0,7))),
    part('求最大流值 value。',exact('value',20,f['value'])),
    part('提交 certificate，证明最大流与最小割相等。',cert('certificate',30,'flow',{'n':8,'edges':edges},f)),
    part('回到题面给出的原网络。提交 min_cut_count=容量恰等于最小割的顶点集个数（顶点集须含源 0、不含汇 7），以及 second_min_cut=严格大于最小割的最小割容量。',
         exact('min_cut_count',20,min_cut_count),exact('second_min_cut',20,second_min_cut))],
    '从求一个最值升级为割结构分析：最小割是否唯一、次小割是多少。','四问分别需要路径搜索、最大流求值、对偶证书构造、割的枚举与排序；答案均为精确值。')

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
# 解空间结构：枚举全部 6! 指派并按总成本排序（P4 用）
_all_totals = sorted(sum(cost[i][q[i]] for i in range(6)) for q in permutations(range(6)))
assert _all_totals[0] == asg['value'], f"枚举最优值应与指派求解一致：{_all_totals[0]} vs {asg['value']}"
optimal_count = _all_totals.count(_all_totals[0])
second_best = next(v for v in _all_totals if v > _all_totals[0])

group('03','assignment-duality','受限指派与势函数', '6名工人到6项工作的一一指派，编号0..5，成本矩阵：'+json.dumps(cost)+
      '。最小化总成本。certificate={permutation:[工人对应工作],u:[...],v:[...],value:...}；所有允许边应有u[i]+v[j]≤cost[i][j]，且总成本=Σu+Σv。',[
    part('提交 row_min=[成本矩阵每行的最小值]（按行顺序，长度6），以及 col_min_sum=各列最小值之和。',
         exact('row_min',5,[min(r) for r in cost]),exact('col_min_sum',5,sum(min(c) for c in zip(*cost)))),
    part('求最小成本 value。',exact('value',20,asg['value'])),
    part('提交达到最优值的指派及对偶势函数 certificate。',cert('certificate',30,'assignment',{'cost':cost,'banned':[]},asg)),
    part('提交 optimal_count=达到最小总成本的指派方案数，以及 second_best=严格大于最小总成本的最小总成本。',
         exact('optimal_count',20,optimal_count),exact('second_best',20,second_best))],
    '从求最优值升级为解空间结构：最优解是否唯一、次优值是多少。','四问分别需要行最小值、指派最优化、对偶证书、解空间枚举与排序；答案均为精确值。'
    '注：P1 原问「各行最小值之和」恰等于最优值 44 ⇒ 会把 P2 的答案直接送出去（2026-09-17 体检发现），已改为问各列最小值之和（=42，不等于最优值）。')
assert_distinct('MX3-03', [min(r) for r in cost], sum(min(c) for c in zip(*cost)),
                asg['value'], optimal_count, second_best)

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
# 跨 k 反查：最小的 k 使解数达到 36（P2 用）
min_k_full = next(k for k in range(1, 9) if len(roots(k)) == 36)

group('11','singular-adic-lifting','共享因子的奇异提升','研究整数同余 (x²−1)(x²−10)≡0 mod 3^k。不同x按模3^k计。不能假定两因子之一单独被3^k整除。',[
    part('k=3，提交 count=解数，以及 parity=[解中偶数的个数,解中奇数的个数]。',
         exact('count',5,len(rs3)),exact('parity',5,[sum(1 for x in rs3 if x%2==0),sum(1 for x in rs3 if x%2==1)])),
    part('提交 min_k_full=最小的 k（k ≥ 1）使解数 count(k) 达到 36。',exact('min_k_full',20,min_k_full)),
    part('k=8，提交 count，并提交 split_count=满足x²≡1或10 mod3^8的解数。',exact('count',15,len(rs8)),exact('split_count',15,sum((x*x-1)%3**8==0 or (x*x-10)%3**8==0 for x in rs8))),
    part('k=12，提交 odd_count=解中奇数的个数，以及 histogram=[[min(v₃(x²−1),12),该类解数],...]。v₃(0)=∞，只列非零类别，按第一列升序。',exact('odd_count',10,sum(1 for x in rs12 if x%2==1)),exact('histogram',30,sorted(vh.items())))],
    '由「给 k 求计数」升级为「跨 k 反查计数首次达到上限的 k」，再进入分解结构与赋值分布。','四问分别需要对给定 k 精确计数、跨 k 搜索、分解结构判定、赋值的 3-adic 分布统计；答案均为精确值。'
    '注：k≥5 后解数恒为 36，故 P4 不重复问 count（那会与 P3 撞车），改问解数的奇偶构成。')
assert_distinct('MX3-11', len(rs3),
                [sum(1 for x in rs3 if x % 2 == 0), sum(1 for x in rs3 if x % 2 == 1)], min_k_full,
                len(rs8), sum((x*x-1) % 3**8 == 0 or (x*x-10) % 3**8 == 0 for x in rs8),
                sum(1 for x in rs12 if x % 2 == 1), sorted(vh.items()))

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

# 13. 循环图的生成树计数：四问 = 四种不同动作（正算 / 条件算 / 谱结构 / 同构分类）。
#
# 2026-09-16 重写。旧版四问本质都是「算一个精确行列式」，差异只在规模与是否加边约束
# → 测的是耐力而非能力。更严重的是**旧 P2/P3 在无工具考试下不可达**：策略里
# tools=false（见 buildExamPaper 的 policy），而答案分别是 31 位整数
# 3948107216150432269610439680 / 1369503520999145588117898368；纯推理只能走
# 谱公式 tau=(1/40)prod(lambda_j)，而 lambda_j 涉及 cos(pi*j/20)——8 次代数数的
# 39 因子乘积。实证吻合：MX3-13-P2 曾 HARD_TIME_LIMIT 360s 且输出 0 字符。
# 即：那两问对任何模型都是 0，只产生噪声。
#
# 设计原则：每一问的最短可算路径必须落在纯推理预算之内 —— 难度只能来自「洞察」，
# 不能来自「规模」。四问依次为：
#   P1 正算（矩阵树基本应用，8 顶点）
#   P2 条件算（边收缩恒等式 tau(G含e)=tau(G/e)，10 顶点；18225/40500=9/20 可自检）
#   P3 谱结构（DFT 对角化 + 诚实去重；大图但只需比较，不需精确大整数）
#   P4 同构分类（乘子判据下的轨道计数，capstone）
# P3 是刻意设计的陷阱：朴素推理「lambda_j=lambda_{40-j} ⇒ 20 个不同值」会答 20/2，
# 但存在精确碰撞 lambda_10=lambda_20=lambda_30=8（三项只含 cos ∈ {0,±1}）→ 19/3。
def circ_eig_struct(n, offsets):
    """循环图拉普拉斯特征值的去重结构：不同取值个数 + 最大重数。

    闭式：lambda_j = sum_{s in offsets}(2 - 2cos(2*pi*j*s/n))，j=1..n-1。
    每个 offset 已代表 ±s 这一对（与 circulant_laplacian 的语义一致）。
    """
    vals = []
    for j in range(1, n):
        v = sum(2 - 2 * cos(2 * pi * j * s / n) for s in offsets)
        for i, (rep, cnt) in enumerate(vals):
            if abs(v - rep) < 1e-9:
                vals[i] = (rep, cnt + 1)
                break
        else:
            vals.append((v, 1))
    return len(vals), max(c for _, c in vals)

def circ_iso_classes(n, dmax):
    """乘子判据：C_n(1,d) 的同构类。

    循环图 C_n(S) 与 C_n(S') 同构 <= 存在单位 m (mod n) 使 m*S = S'。
    返回 {归一化连接集: [d, ...]}；d 与 40-d 视为同一图（±d 生成同一连接集）。
    """
    units = [m for m in range(1, n) if gcd(m, n) == 1]

    def key(d):
        S = {1 % n, (-1) % n, d % n, (-d) % n}
        return min(tuple(sorted((m * s) % n for s in S)) for m in units)

    cls = {}
    for d in range(1, dmax + 1):
        cls.setdefault(key(d), []).append(d)
    return cls

circ_small = spanning_trees(8, [1, 2])                        # 3528
circ_mid = spanning_trees(10, [1, 3])                         # 40500
circ_mid_edge = spanning_trees_containing(10, [1, 3], (0, 1))  # 18225
circ_eigs, circ_mult = circ_eig_struct(40, [1, 10, 15])       # 19, 3
circ_cls = circ_iso_classes(40, 20)                           # 18 类
circ_class_count = len(circ_cls)
circ_iso_of_3 = next(d for d in next(v for v in circ_cls.values() if 3 in v) if d != 3)  # 13
circ_iso_of_7 = next(d for d in next(v for v in circ_cls.values() if 7 in v) if d != 7)  # 17
# 自检：3<->13 与 7<->17 必须互为对方的唯一同构伙伴，否则 stop
assert circ_class_count == 18 and circ_iso_of_3 == 13 and circ_iso_of_7 == 17, 'circulant isomorphism census drifted'
assert circ_mid_edge * 20 == circ_mid * 9, 'contraction/inclusion-exclusion disagree'

group('13','circulant-spanning-trees','循环图的生成树计数','循环图 C_n(S)：顶点 0..n-1，每个 i 与 i±s (mod n) 相连（s ∈ S；n 为偶数且 s=n/2 时 i±s 重合，该边只算一次）。生成树 = 取 n-1 条边使全图连通无环。四问依次考察四种不同的推理动作：精确计数 → 条件计数 → 谱结构 → 同构分类。',[
    part('C_8(S)，其中 S={1,2}。提交 tree_count=生成树个数。',
         exact('tree_count',10,circ_small)),
    part('C_10(S)，其中 S={1,3}。提交 tree_count=生成树个数，以及 with_edge=同时包含边 (0,1) 的生成树个数。',
         exact('tree_count',10,circ_mid),exact('with_edge',10,circ_mid_edge)),
    part('回到 40 顶点、S={1,10,15}。该图拉普拉斯矩阵 L 的特征值有闭式 lambda_j=sum_{s in S}(2-2cos(2*pi*j*s/40))，j=1..39。提交 distinct_eigs=lambda_1..lambda_39 中不同取值的个数，以及 max_mult=其中出现的最大重数。',
         exact('distinct_eigs',15,circ_eigs),exact('max_mult',15,circ_mult)),
    part('对 d ∈ {1,2,...,20}，记 G_d 为 C_40(S)，其中 S={1,d}。提交 class_count=这 20 个图两两不同构的类数；以及 iso_of_3=在 d≠3 中与 G_3 同构的那个 d，iso_of_7=在 d≠7 中与 G_7 同构的那个 d。',
         exact('class_count',20,circ_class_count),exact('iso_of_3',10,circ_iso_of_3),exact('iso_of_7',10,circ_iso_of_7))],
    '从「算一个数」升级为「对一个图族做等价分类」：前两问是计算，后两问要求识别结构（谱闭式）与等价判据（乘子群），且 P3 存在精确碰撞 lambda_10=lambda_20=8，朴素配对推理会答错。','四问的最短可算路径都在纯推理预算内（无工具考试）；P3/P4 规模大但只需结构、不需精确大整数；答案唯一且可精确校验。')

# 14. 线性递推的四层推理：递推求值 → 特征根解析 → 模结构性质 → 逆向反推。
# 递推式 a_{n+2} = 5a_{n+1} - 6a_n，特征根 2 与 3，通项 a_n = 2*3^n - 2^n（便于 P2 要求通项系数）。
REC14 = (5, -6)
INIT14 = (1, 4)
m14_10 = rec_index(INIT14, REC14, 10, MOD14)
m14_1e6 = rec_index(INIT14, REC14, 10**6, MOD14)

def rec14_structure(mod, limit=400):
    """最小 n>=1 使 a_n ≡ 0，以及最小正周期（2 阶线性递推：a_T=a_0 且 a_{T+1}=a_1 即为周期）"""
    seq = rec_terms(INIT14, REC14, limit + 2, mod)
    zero = next((n for n in range(1, limit) if seq[n] == 0), None)
    period = next((T for T in range(1, limit) if all(seq[n + T] == seq[n] for n in range(200))), None)
    return zero, period

m14_nzero, m14_period = rec14_structure(11)
# 逆向题：真值 (a0,a1)=(4,9) → a2=21, a3=51, a4=129；由 a3,a4 反解唯一
# （系数矩阵 det = 19·(−114) − (−30)·65 = −216，与 p 互素）
# 2026-09-17 体检发现：旧真值 (3,7) 的 a1=7 与 P3 的 n_zero=7 撞车（可被前问答案复用），故换掉。
m14_inv_a3, m14_inv_a4, m14_inv_a0, m14_inv_a1 = 51, 129, 4, 9
group('14','linear-recurrence-four-actions','线性递推的四层推理','序列满足 aₙ₊₂ = 5aₙ₊₁ − 6aₙ（模 p），a₀ = 1、a₁ = 4。所有下标从 0 开始，答案取模 p 后落在 [0,p)。四问依次考察四种不同的推理动作：递推求值 → 解析求解 → 模结构性质 → 逆向反推。',[
    part('p=1000000007。提交 a_10。',exact('a_10',10,m14_10)),
    part('p=1000000007。用特征根法把通项写成 a_n = alpha·3^n + beta·2^n（alpha、beta 为整数，允许为负）。提交 alpha、beta、a_1000000。',
         exact('alpha',5,2),exact('beta',5,-1),exact('a_1000000',10,m14_1e6)),
    part('改模数 p=11。提交 n_zero、period：n_zero 是最小的 n ≥ 1 使 a_n ≡ 0 (mod 11)；period 是序列 (a_n mod 11) 的最小正周期。',
         exact('n_zero',15,m14_nzero),exact('period',15,m14_period)),
    part('回到 p=1000000007。递推式不变，但初值 (a₀, a₁) 未知；已知 a_3 = %d、a_4 = %d。提交 a0、a1。'
         % (m14_inv_a3, m14_inv_a4),
         exact('a0',20,m14_inv_a0),exact('a1',20,m14_inv_a1))],
    '由正向求值转为逆向反推：需先由 a_3、a_4 解出 a_2，再逐步回代得到初值。','四问分别需要迭代、特征根解析、模周期分析与线性反解四种不同推理动作；答案唯一且可精确校验。'
    '注：旧真值 (3,7) 的 a1=7 与 P3 的 n_zero=7 撞车（可被前问答案复用），2026-09-17 换为 (4,9)。')
assert_distinct('MX3-14', m14_10, 2, -1, m14_1e6, m14_nzero, m14_period, m14_inv_a0, m14_inv_a1)

# 15. Constrained lattice enumeration; the disjoint-family part is exactly the
# Lindstrom-Gessel-Viennot determinant that frontier benchmarks like to use.
lp_small = paths_dp((12, 12), bound=2)
lp_mid = paths_dp((20, 20), bound=3)
# 经定点计数：约束 y ≤ x+k 对平移不变，故经 (10,10) 的合法路径数 = 两段各自的合法路径数之积
lp_through = paths_dp((10, 10), bound=3) ** 2
lp_blocked = paths_dp((20, 20), bound=3, blocked=[(7, 7), (13, 11)])
lp_lgv = lgv([(12, 12), (12, 13), (12, 14)], [(0, 0), (0, 1), (0, 2)])
group('15','constrained-lattice-families','受限格路与非交叉路径族','网格上每步只能向右 (1,0) 或向上 (0,1)。坐标(x,y)以纵轴为 y。要求路径全程满足 y ≤ x + k（k 见各问）；「避开」指不经过该点。非交叉指两条路径不含公共顶点。',[
    part('k=2，从 (0,0) 到 (12,12)。提交 path_count=合法路径数。',exact('path_count',10,lp_small)),
    part('k=3，从 (0,0) 到 (20,20)。提交 through_count=恰好经过 (10,10) 的合法路径数。',exact('through_count',20,lp_through)),
    part('k=3，从 (0,0) 到 (20,20)，且不得经过 (7,7) 与 (13,11)。提交 path_count=合法路径数。',
         exact('path_count',30,lp_blocked)),
    part('从 A1=(0,0)、A2=(0,1)、A3=(0,2) 出发，分别到达 B1=(12,12)、B2=(12,13)、B3=(12,14)，三条路径两两不共享顶点，每步只向右或向上（本问不加 y 上界）。提交 families=这样的有序三元组个数。',
         exact('families',40,lp_lgv))],
    '从单条受限路径升级为两两不相交的三元组；中间一问考察「经定点可分解」这一结构性质。','答案均为精确整数；经定点计数需先识别约束的平移不变性再分段相乘，非交叉计数可用行列式与穷举互验。')

# 16. Integer partitions: closed-form generator functions, not enumeration.
pt = penta_partitions(2000)
# 阈值反查 / 受限分拆 / 同余反例（均从同一条分拆数序列派生，避免各问重复同一动作）
min_n_1e6 = next(n for n in range(1, 2001) if pt[n] >= 10**6)
odd20 = coin_partitions(20, list(range(1, 21, 2)))[20]
distinct20 = distinct_partitions(20)[20]
assert odd20 == distinct20, 'Euler 定理：20 的奇数分拆数必须等于互异分拆数'
min_nonpattern = next(n for n in range(1, 2001) if n % 5 != 4 and pt[n] % 5 == 0)
pt20, pt200, pt2000 = pt[20], pt[200], pt[2000]
odd2000 = coin_partitions(2000, list(range(1, 2001, 2)))[2000]
distinct2000 = distinct_partitions(2000)[2000]
atmost5 = coin_partitions(2000, list(range(1, 6)))[2000]
assert odd2000 == distinct2000, 'Euler 定理：奇数部分分拆数必须等于互异部分分拆数'
group('16','partition-generating-functions','整数分拆的四层推理','分拆把 n 写成正整数之和，顺序不计。A(n) 记 n 的分拆数。奇数分拆指各部分均为奇数；互异分拆指各部分互不相同。四问依次考察：递推计数 → 阈值反查 → 受限分拆（生成函数）→ 模同余结构。',[
    part('提交 A(20)。',exact('A_20',10,pt20)),
    part('提交 min_n=最小的 n（n ≥ 1）使 A(n) ≥ 10^6。',exact('min_n',20,min_n_1e6)),
    part('提交 odd_parts=20 的奇数分拆数，distinct_parts=20 的互异分拆数（两者应相等，可用欧拉定理互验）。',
         exact('odd_parts',15,odd20),exact('distinct_parts',15,distinct20)),
    part('提交 p19_mod5=A(19) mod 5，以及 min_nonpattern=最小的 n ≥ 1 满足 n mod 5 ≠ 4 且 A(n) ≡ 0 (mod 5)。',
         exact('p19_mod5',20,pt[19] % 5),exact('min_nonpattern',20,min_nonpattern))],
    '由精确求值转为模结构：A(n) ≡ 0 (mod 5) 在 n ≡ 4 (mod 5) 上成立（拉马努金型），需找出最小反例。','四问分别需要 DP 计数、对序列做阈值搜索、受限分拆的生成函数、以及同余模式的反例搜索；答案均可精确校验。')

# 17. Standard Young tableaux: hook-length formula and Aitken's determinant.
def partitions_of(n, maxpart=None):
    if maxpart is None or maxpart > n:
        maxpart = n
    if n == 0:
        yield ()
        return
    for first in range(min(n, maxpart), 0, -1):
        for rest in partitions_of(n - first, first):
            yield (first,) + rest

# n 必须是 |λ|：(4,3,1) 共 8 格，(6,5,4,2) 共 17 格，传错 n 会得到非整数后再整除的错误结果
assert sum([4, 3, 1]) == 8 and sum([6, 5, 4, 2]) == 17
syt_431 = hook_length_factorial(sum([4, 3, 1]), [4, 3, 1])
syt_6542 = hook_length_factorial(sum([6, 5, 4, 2]), [6, 5, 4, 2])
sum_sq_10 = sum(hook_length_factorial(10, lam) ** 2 for lam in partitions_of(10, 3))
skew_val = skew_syt([7, 5, 3, 1], [3, 2, 1])
# 全形状极值：n=10 的 42 个分拆中 f^λ 的最大值
max_syt_10 = max(hook_length_factorial(10, lam) for lam in partitions_of(10))
group('17','young-tableaux-hook-length','标准杨表与斜杨表','形状 λ=(λ₁≥λ₂≥…) 的标准杨表：把 1..n 填入 λ 的方格，每行每列都严格递增，n=|λ|。斜形状 λ/μ 指去掉子分拆 μ 后剩余的方格。',[
    part('提交 λ=(4,3,1) 的标准杨表个数。',exact('syt_count',10,syt_431)),
    part('在 n=10 的**所有**分拆 λ 中，提交 max_syt=最大的标准杨表个数（f^λ 的最大值）。',exact('max_syt',20,max_syt_10)),
    part('λ 取遍 10 的所有分拆且要求 λ₁≤3，提交 sum_squares=Σ f^λ 的平方。',
         exact('sum_squares',30,sum_sq_10)),
    part('提交斜形状 λ/μ 的标准杨表个数，其中 λ=(7,5,3,1)、μ=(3,2,1)。',
         exact('skew_count',40,skew_val))],
    '从单形状 hook 公式升级到全形状极值搜索，再进入斜形状（hook 公式不再直接适用）。','答案均为精确整数；极值需枚举 42 个形状逐一算 f^λ，斜表需行列式方法。')

# 18. Restricted permutations: a CONCEPTUAL ladder, not a scale ladder.
#
# 设计约束（2026-09-16 用户指出）：同一大题的小问必须「难度递增」而非「计算量递增」。
# 本组规模恒定在 n=6..7（每步只需秒级运算），难度全部来自「这一步需要哪个概念」：
#   P1 直接套容斥        -> P2 要自己算棋盘多项式（题形与工具不匹配）
#   P3 跳到群作用/共轭类  -> P4 条件变更，使 P2 的方法直接失效
# 自查判据：把任一实例缩小十倍，难度不下降。答案互不相同，堵掉「猜前问答案」的捷径。
def _perm_valid(n, forbidden):
    f = set(forbidden)
    return [q for q in permutations(range(1, n + 1)) if all((i + 1, q[i]) not in f for i in range(n))]

def _cycle_type(q):
    n = len(q); seen = [False] * n; lens = []
    for i in range(n):
        if seen[i]:
            continue
        j = i; c = 0
        while not seen[j]:
            seen[j] = True; j = q[j] - 1; c += 1
        lens.append(c)
    return tuple(sorted(lens, reverse=True))

def _rook_numbers(n, forbidden):
    by_row = {}
    for (r, c) in forbidden:
        by_row.setdefault(r, []).append(c)
    dp = {frozenset(): 1}
    for r in range(1, n + 1):
        nd = dict(dp)
        for used, cnt in list(dp.items()):
            for c in by_row.get(r, []):
                if c in used:
                    continue
                nd[used | {c}] = nd.get(used | {c}, 0) + cnt
        dp = nd
    rk = Counter()
    for used, cnt in dp.items():
        rk[len(used)] += cnt
    return [rk[k] for k in range(max(rk) + 1)]

def _count_by_ie(n, forbidden):
    r = _rook_numbers(n, forbidden)
    return sum((-1) ** k * r[k] * factorial(n - k) for k in range(len(r)))

def _adjacent_ok_count(n):
    """|σ(i+1) − σ(i)| ≠ 1。禁位成链而非独立格，棋盘多项式的容斥无法直接套用，
    需要按「取值是否相邻」做位掩码 DP。"""
    from functools import lru_cache
    @lru_cache(maxsize=None)
    def go(mask, last):
        if mask == (1 << n) - 1:
            return 1
        tot = 0
        for v in range(1, n + 1):
            if mask >> (v - 1) & 1 or (last and abs(v - last) == 1):
                continue
            tot += go(mask | 1 << (v - 1), v)
        return tot
    return go(0, None)

_rp_f1 = [(1, 1), (1, 2), (2, 1), (2, 2)]
_rp_f2 = [(1, 1), (2, 1), (2, 2), (3, 2), (3, 3), (4, 3), (4, 4)]
_rp_v1 = _perm_valid(6, _rp_f1)
_rp_v2 = _perm_valid(7, _rp_f2)
_rp_types = {_cycle_type(q) for q in _rp_v2}
# 生成器与复核必须走不同路径：这里 gold 取容斥/DP 的解析结果，复核侧用暴力枚举 + 另一套算法。
_rp_p1 = _count_by_ie(6, _rp_f1)
_rp_p2 = _count_by_ie(7, _rp_f2)
_rp_p4 = _adjacent_ok_count(7)
assert _rp_p1 == len(_rp_v1) and _rp_p2 == len(_rp_v2), '容斥与暴力枚举不一致'
group('18','restricted-permutations','受限排列：容斥、棋盘多项式与群作用','n×n 棋盘的行代表位置、列代表取值，禁位 (i,j) 表示不允许 σ(i)=j。合法排列指避开全部禁位的双射 σ:{1..n}→{1..n}。本组四问规模都只有 6~7 阶，计算量很小；难点在于每一问要用不同的方法。',[
    part('n=6，禁位为 2×2 方块 {(1,1),(1,2),(2,1),(2,2)}。提交 valid=合法排列数。',
         exact('valid',10,_rp_p1)),
    part('n=7，禁位改为阶梯带 {(1,1),(2,1),(2,2),(3,2),(3,3),(4,3),(4,4)}——它既不是对角也不是方块，禁位之间会互相攻击。提交 valid=合法排列数。',
         exact('valid',20,_rp_p2)),
    part('仍用第 2 问的禁位。提交 cycle_types=合法排列**按循环结构（即共轭类）分组后**出现的不同循环结构个数，以及 odd_only=只由奇数长度循环构成的合法排列个数。',
         exact('cycle_types',15,len(_rp_types)),
         exact('odd_only',15,sum(1 for q in _rp_v2 if all(p % 2 == 1 for p in _cycle_type(q))))),
    part('条件变更：不再给单位置禁位，而是要求相邻两个位置不得映射到相邻的两个取值，即对所有 i 都有 |σ(i+1)−σ(i)| ≠ 1（n=7）。提交 valid=满足该条件的排列数。',
         exact('valid',40,_rp_p4))],
    '从「独立禁位」换成「相邻关系约束」，棋盘多项式的容斥无法直接套用，必须换工具。',
    '规模刻意保持不变（6~7 阶），难度靠概念递进而非计算量；答案互不相同以避免猜前问。')

# 19. Generating functions: another CONCEPTUAL ladder (same rule as group 18).
#
# 规模恒定、计算量小，四级各换一个概念：
#   P1 直接展开系数 -> P2 先做部分分式/特征根才能求系数
#   -> P3 把求和认成卷积（组合恒等式） -> P4 条件变更：只取下标为 3 的倍数的项（单位根过滤）
def _series_coeff(num, den, n):
    """由 num/den 的幂级数长除法求 [x^n]（要求 den[0] == 1）。"""
    a = [0] * (n + 1)
    for i, c in enumerate(num):
        if i <= n:
            a[i] += c
    out = [0] * (n + 1)
    for k in range(n + 1):
        s = a[k]
        for j in range(1, min(k, len(den) - 1) + 1):
            s -= den[j] * out[k - j]
        assert s % den[0] == 0, '分母首项必须整除'
        out[k] = s // den[0]
    return out

def _partial_fraction_coeff(roots, n):
    """1/Π(1 - r x) 的 [x^n]：A_i = 1/Π_{j≠i}(1 - r_j/r_i)，系数 = Σ A_i r_i^n。"""
    As = []
    for i, ri in enumerate(roots):
        prod = F(1)
        for j, rj in enumerate(roots):
            if j != i:
                prod *= (1 - F(rj, ri))
        As.append(1 / prod)
    assert all(a.denominator == 1 for a in As), '留数应为整数，否则题目不适配'
    return sum(int(a) * r ** n for a, r in zip(As, roots))

_gf_p1 = _series_coeff([1, 2], [1, -3, 1], 12)[12]
_gf_p2 = _partial_fraction_coeff([2, 3, 4], 30)
_gf_p2_cross = _series_coeff([1], [1, -9, 26, -24], 30)[30]
assert _gf_p1 == 214129 and _gf_p2 == _gf_p2_cross, '生成函数组 gold 自检失败'
_gf_p3 = 20 * comb(2 * 20 - 1, 20 - 1)          # Σ_{k} k·C(n,k)² = n·C(2n-1, n-1)
_gf_p3_cross = sum(k * comb(20, k) ** 2 for k in range(21))
assert _gf_p3 == _gf_p3_cross, '组合恒等式与逐项求和不一致'
_gf_p4 = sum(comb(33, k) for k in range(0, 34, 3))
assert 3 * _gf_p4 + 2 == 2 ** 33, '单位根过滤结构校验失败'
group('19','generating-functions-ladder','生成函数：展开、部分分式、卷积与单位根过滤','以下各问都围绕一个幂级数 f(x)=Σ aₙxⁿ，aₙ 为整数系数。[xⁿ]f(x) 表示取 xⁿ 的系数。各问规模都很小，但需要的方法不同。',[
    part('f(x) = (1+2x)/(1−3x+x²)。提交 c12=[x¹²]f(x)。',
         exact('c12',10,_gf_p1)),
    part('f(x) = 1/((1−2x)(1−3x)(1−4x))。提交 c30=[x³⁰]f(x)。',
         exact('c30',20,_gf_p2)),
    part('提交 S = Σ_{k=0}^{20} k·C(20,k)²。',
         exact('S',30,_gf_p3)),
    part('条件变更：不再取单个系数，而是把下标是 3 的倍数的项全部相加。提交 T = Σ_{k≡0 (mod 3), 0≤k≤33} C(33,k)。',
         exact('T',40,_gf_p4))],
    '从「取一个系数」变为「按同余类求和」，逐项展开的思路不再适用。',
    '规模保持不变（n≤33），难度靠概念递进：部分分式 → 卷积恒等式 → 单位根过滤。答案互不相同。')

# 20. Finite fields: a third CONCEPTUAL ladder (same rule as groups 18/19).
#
#   P1 单元素求逆 -> P2 幂与阶的判定（要先分解 p-1）
#   -> P3 原根/离散对数（乘法结构变加法结构） -> P4 条件变更：模合数，域变环，需 CRT
# 规模恒定在 p≈1e4；答案互不相同以避免猜前问。
_FP_P, _FP_Q = 10007, 10009
_FP_G = 5                      # 10007 的最小原根（阶 = p-1）
_FP_ELEM = 2                   # 阶 = (p-1)/2，非原根
_FP_DLOG_TARGET = 5000
_FP_A = 200                    # 在 P 与 Q 下都是二次剩余

def _fp_inv(a, m):
    old_r, r = a % m, m; old_s, s = 1, 0
    while r:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
    return old_s % m

def _fp_order(g, p):
    """按 p-1 的素因子降幂求阶（p-1 = 10006 = 2 × 5003）。"""
    o = p - 1
    for q in (2, (p - 1) // 2):
        while o % q == 0 and pow(g, o // q, p) == 1:
            o //= q
    return o

def _fp_dlog_bsgs(g, h, p):
    """Baby-step giant-step：返回最小非负 k 使 g^k ≡ h。"""
    m = isqrt(p - 1) + 1
    table = {}; e = 1
    for j in range(m):
        table.setdefault(e, j); e = e * g % p
    factor = pow(_fp_inv(g, p), m, p)
    gamma = h
    for i in range(m + 1):
        if gamma in table:
            return i * m + table[gamma]
        gamma = gamma * factor % p
    raise AssertionError('离散对数不存在')

def _fp_sols_mod_prime(a, q):
    return sorted(x for x in range(q) if x * x % q == a % q)

def _fp_crt(r1, m1, r2, m2):
    t = (r2 - r1) * _fp_inv(m1 % m2, m2) % m2
    return (r1 + m1 * t) % (m1 * m2)

_fp_inv_p1 = pow(4043, _FP_P - 2, _FP_P)                     # Fermat
assert _fp_inv_p1 == _fp_inv(4043, _FP_P), 'Fermat 与扩展欧几里得不一致'
_fp_order = _fp_order(_FP_ELEM, _FP_P)
_fp_dlog = _fp_dlog_bsgs(_FP_G, _FP_DLOG_TARGET, _FP_P)
assert pow(_FP_G, _fp_dlog, _FP_P) == _FP_DLOG_TARGET, 'BSGS 结果校验失败'
_fp_sols = sorted({_fp_crt(x, _FP_P, y, _FP_Q)
                   for x in _fp_sols_mod_prime(_FP_A, _FP_P)
                   for y in _fp_sols_mod_prime(_FP_A, _FP_Q)})
assert all(x * x % (_FP_P * _FP_Q) == _FP_A for x in _fp_sols) and len(_fp_sols) == 4
# 答案互不相同（堵掉「猜前问答案」）
assert len({_fp_inv_p1, _fp_order, _fp_dlog, _fp_sols[0], sum(_fp_sols)}) == 5, '答案出现重复'
group('20','finite-field-ladder','有限域算术：求逆、阶、离散对数与模合数','p=10007 与 q=10009 均为素数，p−1 = 10006 = 2×5003。所有结果取 [0,模数) 内的整数。各问规模都很小，但需要的方法不同。',[
    part('在 F_p 中求 4043 的乘法逆元。提交 inverse。',
         exact('inverse',10,_fp_inv_p1)),
    part('在 F_p^* 中求元素 2 的阶（即使 2^k ≡ 1 (mod p) 的最小正整数 k）。提交 order_2。',
         exact('order_2',20,_fp_order)),
    part('5 是 F_p^* 的一个原根。求最小的非负整数 k 使 5^k ≡ 5000 (mod p)。提交 k。',
         exact('k',30,_fp_dlog)),
    part('条件变更：改为模合数 n = p·q = 100160063，求 x² ≡ 200 (mod n) 的最小非负解与全部解之和。提交 smallest 与 total（两者都按 [0,n) 内的整数提交）。',
         exact('smallest',15,_fp_sols[0]),exact('total',25,sum(_fp_sols)))],
    '模数从素数换成合数后，F_p^* 的乘法群结构不再适用，必须分解到两个素数再用中国剩余定理。',
    '规模恒定（p≈1e4），难度靠概念递进：求逆 → 阶 → 离散对数 → 环上的二次同余。答案互不相同。')

# 21. Sidon-type sets: a ladder where RECALL DOES NOT HELP.
#
# 依据实测教训（MX3-18/19/20）：标准命名恒等式会被强模型直接回忆出来（4~6 秒秒过），
# 不能当难档；而"想当然的默认假设是错的"这类反直觉结构有效（MX3-20-P2 让模型答错）。
# 本组的主角是 Z_31 上的 Sidon 集：**计数上界 k(k+1)/2 ≤ 31 给出 k ≤ 7，但实际最大只有 6**
# （Z_31^* 的乘法版更弱：上界 7，实际 5）。没有标准答案可背，必须真的搜。
def _sidon_ok(A, m):
    """所有 i≤j 的 (a_i+a_j) mod m 互不相同。"""
    sums = [(A[i] + A[j]) % m for i in range(len(A)) for j in range(i, len(A))]
    return len(set(sums)) == len(sums)

def _sidon_search(m, k_cap):
    """剪枝回溯：返回 (最大规模, 字典序最小的达到者, 该规模的个数)。"""
    best, best_set, count = 0, None, 0
    def extend(cur):
        nonlocal best, best_set, count
        if len(cur) > best:
            best, best_set, count = len(cur), tuple(cur), 1
        elif len(cur) == best:
            count += 1
            if best_set is not None and tuple(cur) < best_set:
                best_set = tuple(cur)
        if len(cur) == k_cap:
            return
        for v in range((cur[-1] + 1) if cur else 0, m):
            cand = cur + [v]
            if _sidon_ok(cand, m):
                extend(cand)
    extend([])
    return best, best_set, count

_sidon_cap31 = max(k for k in range(1, 40) if k * (k + 1) // 2 <= 31)
_sidon_cap30 = max(k for k in range(1, 40) if k * (k + 1) // 2 <= 30)
assert (_sidon_cap31, _sidon_cap30) == (7, 7), '计数界与预期不符'
_sidon_sumset = len({(a + b) % 31 for a in (0, 1, 3, 7) for b in (0, 1, 3, 7)})
_sidon_k31, _sidon_lex31, _sidon_cnt31 = _sidon_search(31, _sidon_cap31)
_sidon_k30, _sidon_lex30, _sidon_cnt30 = _sidon_search(30, _sidon_cap30)
assert _sidon_k31 == 6 and _sidon_k30 == 5, '实际最大值与枚举结果不符'
assert _sidon_lex31 == (0, 1, 3, 8, 12, 18), '字典序最小集与枚举结果不符'
assert (_sidon_k31, _sidon_k30) != (_sidon_cap31, _sidon_cap30), '反直觉性不成立'
group('21','sidon-sets-countersearch','Sidon 集：计数上界与真实极值的差距','在模 p 的循环群 Z_p 中，称子集 A 为 Sidon 集，若所有 i≤j 的 aᵢ+aⱼ (mod p) 互不相同（等价的表述：所有有序差 aᵢ−aⱼ (i≠j) 互不相同）。若 A 有 k 个元素，则 i≤j 的数对和共有 k(k+1)/2 个，它们必须全部落在 Z_p 中的 p 个值里。Z_31^* 表示模 31 的乘法群。',[
    part('取 p=31，A={0,1,3,7}。提交 sumset=|A+A|=|{(a+b) mod 31 : a,b∈A}|（a、b 可相同）。',
         exact('sumset',10,_sidon_sumset)),
    part('在 Z_31 中，提交 max_size=满足 Sidon 条件的子集的最大元素个数。仅凭 k(k+1)/2 ≤ 31 得到的界不一定可达。',
         exact('max_size',20,_sidon_k31)),
    part('仍为 Z_31。提交 lexmin_set=**在所有达到最大规模的 Sidon 集中，按元素升序比较所得字典序最小**的那个集合（提交升序数组）。',
         exact('lexmin_set',30,list(_sidon_lex31))),
    part('条件变更：改为在**乘法群 Z_31^*** 中取子集 B，要求所有 i≤j 的 bᵢ·bⱼ (mod 31) 互不相同。'
         '提交 max_size=这样的 B 的最大规模，以及 counting_bound=仅由计数条件 k(k+1)/2 ≤ 30 得到的 k 的上界。',
         exact('max_size',25,_sidon_k30),exact('counting_bound',15,_sidon_cap30))],
    '从加法群换到乘法群：Z_31^* 是 30 阶循环群，取生成元后与 Z_30 同构，问题迁移过去后极值会进一步下降。',
    '计数上界与实际极值不等（Z_31 为 7 对 6，Z_31^* 为 7 对 5），因此靠背结论得不到答案；答案互不相同。'
    '注：P4 原为「数出达到最大规模的子集个数」（gold=6540），需要枚举 C(30,5)=142,506 个子集，'
    '在 tools=false 下不可达 —— 2026-09-17 改为可推导的 counting_bound，避免重蹈 MX3-22/23 的覆辙。')

# 22 & 23. Two groups designed against the measured difficulty levers.
#
# 实测结论（MX3-18/19/20）：标准命名恒等式、标准算法、纯长算术对强模型都无效
# （4~7 秒即可做对或直接回忆）；**真正有效的是「想当然的默认假设是错的」**。
#   MX3-22 三特征标和：值随 (a,b) 大幅变化（本范围 63 种取值），
#          想当然套 Σχ(x)χ(x+a) = -1 或"三特征标和恒为 0"必错。
#   MX3-23 模递推的最小命中：序列**定义在 mod 1e9+7 下**，
#          于是"直接按小模数迭代"这条捷径是错的
#          （(a_n mod M) mod m ≠ a_n mod m）—— 实测 mod 97 正确 153、捷径 144。
# --- MX3-22 rewritten 2026-09-17: the p=10007 version was UNREACHABLE without tools ---
# 实测证据：MX3-22-P2（p=10007 的三重特征标和）产出 `HARD_TIME_LIMIT: Model call timed out
# after 600000ms`，输出 0 字符 —— 因为 Σ_x χ(x)χ(x+a)χ(x+b) = #E(F_p) − p − 1
# （E: y²=x(x+a)(x+b)），对一般 (a,b) 没有初等闭形式，只能枚举 10007 项；
# P3 更需 253 对 × 10007 ≈ 253 万项。这与旧 MX3-13-P2 是同一类缺陷（无工具不可达）。
# 改写原则：难度 = 判断难度，不是计算量 ⇒ 全部换到小素数（p ∈ {7,11,13}），
# 让"规律是否普遍成立 / 计数 / 极值"成为难点。
def _chi_small(q):
    qr = {x * x % q for x in range(1, q)}
    return [0 if a % q == 0 else (1 if a % q in qr else -1) for a in range(q)]

def _tri_small(q, a, b):
    t = _chi_small(q)
    return sum(t[x] * t[(x + a) % q] * t[(x + b) % q] for x in range(q))

def _pairs_small(q):
    return [(a, b) for a in range(1, q) for b in range(a + 1, q)]

def _tri_stat(q):
    ps = _pairs_small(q)
    vs = [_tri_small(q, a, b) for a, b in ps]
    mx = max(vs)
    arg = min(ab for ab, v in zip(ps, vs) if v == mx)
    return {'n': len(ps), 'zero': sum(1 for v in vs if v == 0),
            'nonzero': sum(1 for v in vs if v != 0), 'max': mx,
            'max_count': sum(1 for v in vs if v == mx), 'arg': arg}

_SQ7, _SQ11, _SQ13 = _tri_stat(7), _tri_stat(11), _tri_stat(13)
_X22_P1 = sum(_chi_small(11)[x] * _chi_small(11)[(x + 1) % 11] for x in range(11))
# 已知值守卫（经典恒等式）：Σχ = 0、Σχ(x)χ(x+a) = −1 (a≠0)
for _q in (7, 11, 13):
    _t = _chi_small(_q)
    assert sum(_t) == 0, 'MX3-22 守卫失败: Σχ ≠ 0 (q=%d)' % _q
    assert sum(_t[x] * _t[(x + 1) % _q] for x in range(_q)) == -1, 'MX3-22 守卫失败: Σχχ(x+1) ≠ −1 (q=%d)' % _q
assert (_X22_P1, _SQ7['zero'], _SQ11['nonzero'], _SQ13['max'], _SQ13['arg']) == (-1, 9, 30, 6, (1, 7)), \
    'MX3-22 改写 gold 与定稿不符'
assert len({_X22_P1, _SQ7['zero'], _SQ11['nonzero'], _SQ13['max'],
            _SQ13['arg'][0], _SQ13['arg'][1]}) == 6, 'MX3-22 改写答案出现重复（泄漏）'

# --- MX3-23 rewritten 2026-09-17: same trap, but a reachable iteration length ---
# 旧版用 m=97（首次命中 n=153）与联合(7,11)（n=184），模型必须以 9 位数迭代上百步
# → 与 MX3-22 属同类缺陷（无工具不可达）。改写**保留**「先按 M 迭代、再判小模数整除」
# 这个陷阱本身，只把模数换成首次命中更早、而捷径仍然失效的那些。
_REC_MOD, _REC_SEED, _REC_C = 1000000007, (1, 2, 5), (3, -1, 2)
_REC_N = 120

def _rec_seq(limit, mod):
    a = list(_REC_SEED)
    for _ in range(limit):
        a.append((_REC_C[0] * a[-1] + _REC_C[1] * a[-2] + _REC_C[2] * a[-3]) % mod)
    return a

_REC = _rec_seq(_REC_N, _REC_MOD)

def _first_zero(mod):
    return next(n for n in range(3, _REC_N) if _REC[n] % mod == 0)

def _first_consecutive(mod):
    return next(n for n in range(3, _REC_N - 1) if _REC[n] % mod == 0 and _REC[n + 1] % mod == 0)

# 捷径（直接按小模数迭代）——必须给出**不同**的答案，否则本组失去难度来源
def _naive_zero(mod, limit=4000):
    a = _rec_seq(limit, mod)
    return next((n for n in range(3, limit) if a[n] == 0), None)

def _naive_consecutive(mod, limit=4000):
    a = _rec_seq(limit, mod)
    return next((n for n in range(3, limit - 1) if a[n] == 0 and a[n + 1] == 0), None)

assert (_first_zero(7), _first_zero(43), _first_zero(61), _first_consecutive(17)) == (8, 37, 32, 63), \
    'MX3-23 改写 gold 与定稿不符'
assert _naive_zero(43) != _first_zero(43) and _naive_zero(61) != _first_zero(61), \
    'MX3-23 改写失去捷径陷阱'
assert _naive_consecutive(17) is None, 'MX3-23 改写 P4 出现了捷径（应为无解）'
assert len({_X22_P1, _SQ7['zero'], _SQ11['nonzero'], _SQ13['max'], _SQ13['arg'][0], _SQ13['arg'][1],
            _first_zero(7), _first_zero(43), _first_zero(61), _first_consecutive(17)}) == 10, \
    '答案出现重复（泄漏）'
group('22','character-sums-vary','二次特征标：三重和的取值统计与极值',
      'p 为素数。χ 表示模 p 的二次特征标：χ(a)=+1 当 a 是模 p 的二次剩余，−1 当 a 是非二次剩余，χ(0)=0。'
      '本组只用**很小的素数**（p ∈ {7,11,13}），所以难点在**判断规律是否普遍成立**，而不在枚举规模；'
      '所有三重和都在 1 ≤ a < b ≤ p−1 的数对上进行。'
      '注意 Σ_x χ(x)χ(x+a) 对任何 a≠0 都恰好等于 −1，但**三个因子**的情形并不遵循这样简单的规律。',[
    part('取 p=11。提交 pair=Σ_x χ(x)·χ(x+1)。',exact('pair',10,_X22_P1)),
    part('取 p=7。提交 zero_pairs=使 Σ_x χ(x)χ(x+a)χ(x+b) 恰好等于 0 的数对 (a,b) 的个数（1≤a<b≤6）。',
         exact('zero_pairs',20,_SQ7['zero'])),
    part('取 p=11。提交 nonzero_pairs=使该三重和**不等于** 0 的数对 (a,b) 的个数（1≤a<b≤10）。',
         exact('nonzero_pairs',30,_SQ11['nonzero'])),
    part('取 p=13。提交 max_value=该三重和在全部数对上的最大值，以及达到该最大值的**字典序最小**数对的两个分量 argmax_a、argmax_b（1≤a<b≤12）。',
         exact('max_value',20,_SQ13['max']),
         exact('argmax_a',10,_SQ13['arg'][0]),
         exact('argmax_b',10,_SQ13['arg'][1]))],
    'p=13 时三重和**从不等于 0**（66 对全部非 0），而 p=7 有 9 对为 0、p=11 有 15 对为 0 —— 规律不能跨模数外推。',
    '各问都必须把全部数对算完才能回答，抽查前几对会得到"和为 0"的错误印象（p=7 的字典序第一对恰为 0）。'
    '本组最重的计算是 p=13 的 66 对 × 13 项 = 858 次基本运算，属"纪律性枚举"可达范围；'
    '旧版把同一结构放在 p=10007 上（P2 需 10007 项、P3 需 253×10007 ≈ 253 万项），'
    '实测 `HARD_TIME_LIMIT: Model call timed out after 600000ms` 且零输出 ⇒ 对任何模型都不可达，已废弃改写。')

group('23','modular-recurrence-hits','模递推的最小命中与陷阱对照',
      '序列定义在模 M=10⁹+7 意义下：aₙ ≡ 3aₙ₋₁ − aₙ₋₂ + 2aₙ₋₃ (mod M)，其中 a₀=1、a₁=2、a₂=5，下标从 0 起。'
      '注意 aₙ 指的是**先按上述递推在模 M 下得到的那个数**，再考察它与更小模数的整除关系。'
      '四问的模数依次为 7 / 43 / 61 / 17，首次命中位置都 ≤ 63 步。',[
    part('提交 n7=最小的 n≥3 使 aₙ ≡ 0 (mod 7)。',exact('n7',10,_first_zero(7))),
    part('提交 n43=最小的 n≥3 使 aₙ ≡ 0 (mod 43)。',exact('n43',20,_first_zero(43))),
    part('提交 n61=最小的 n≥3 使 aₙ ≡ 0 (mod 61)。',exact('n61',30,_first_zero(61))),
    part('条件变更：提交 n2=最小的 n≥3 使 aₙ 与 aₙ₊₁ **连续两项**都能被 17 整除。',
         exact('n2',40,_first_consecutive(17)))],
    '连续两项命中要求的是序列上的联合事件，不能把单点命中的位置直接平移。',
    '序列先在 mod 10⁹+7 下定义，因此"直接按小模数迭代"会得到不同结果（mod 43 时正确 37、捷径 33；'
    'mod 61 时正确 32、捷径 64；mod 17 的连续两项在捷径下 4000 步内**无解**），靠捷径必错。'
    '旧版用 mod 97（153 步）与联合(7,11)（184 步），每步都是 9 位数运算，实测 HARD_TIME_LIMIT 600s 零输出 ⇒ 已废弃改写。')

# --- helpers added 2026-09-16 (third hard batch: telescope certificates + identity window) --
def _kfact_sum(K): return sum(k * factorial(k) for k in range(1, K + 1))
def _square_telescope(K):
    s = F(0)
    for k in range(1, K + 1): s += F(2 * k + 1, k * k * (k + 1) * (k + 1))
    return s
def _win_lhs(d, n): return sum(comb(n, k) ** 2 * comb(2 * k, n + d) for k in range(0, n + d + 1))
def _win_rhs(d, n): return comb(2 * n, n + d)
def _win_first_bad(d): return next(n for n in range(1, 600) if _win_lhs(d, n) != _win_rhs(d, n))
def _win_gap(d):
    n = _win_first_bad(d); return _win_lhs(d, n) - _win_rhs(d, n)
def _win_threshold(limit):
    d = 1
    while _win_gap(d) < limit: d += 1
    return d, _win_gap(d)

group('24','hypergeometric-window','超几何求和的证成与证伪：望远镜证书与恒等式窗口',
      'C(n,k) 表示二项式系数，k! 表示阶乘。「望远镜消去」指把求和项 f(k) 写成 G(k+1)−G(k)，使求和整体塌缩为 G(K+1)−G(1)。所有结果必须按整数或最简分数**精确**计算，不得使用浮点近似。',
      [
    part('提交 S = Σ_{k=1}^{13} k·k! 的精确值。',
         exact('kfact_sum',10,_kfact_sum(13))),
    part('令 f(k) = (2k+1)/(k²(k+1)²)。提交 S = Σ_{k=1}^{11} f(k) 的最简分数（形如 a/b，a、b 为互素正整数；若为整数则直接写该整数）。',
         exact('square_telescope',20,_square_telescope(11))),
    part('命题 P：对任意整数 n ≥ 1 与 d ≥ 0，都有 Σ_{k=0}^{n+d} C(n,k)²·C(2k, n+d) = C(2n, n+d)。'
         '取 d = 7 检验：提交最小的使该等式不成立的 n（若你判定该等式成立，提交 -1）。'
         '另提交该 n 处「左端 − 右端」的值（上一栏填 -1 时此处也填 -1）。',
         exact('window_first_bad',15,_win_first_bad(7)),
         exact('window_gap',15,_win_gap(7))),
    part('对 d ≥ 1，记 n₀(d) 为最小的使命题 P 中等式不成立的 n，Δ(d) 为该处的「左端 − 右端」。'
         '提交使 Δ(d) ≥ 500 成立的最小 d，以及此时的 Δ(d)。',
         exact('threshold_d',20,_win_threshold(500)[0]),
         exact('threshold_delta',20,_win_threshold(500)[1]))],
    'P3/P4 的规律不能靠「前几项都成立」外推：该等式恰好对 1 ≤ n ≤ d+1 成立，从 n = d+2 起永久失效（已扫至 n=40 未再成立）。',
    'n = 1 对任意 d 都**平凡成立**（d ≥ 2 时左右端同为 0），只抽查小 n 会误判为恒等式；Δ(d) = (d+2)² 这一规律必须从若干个 d 的实际值读出，且 P1/P2 各自的望远镜证书不通用（平方差与阶乘各走一条）。')

pack={'version':'math-exam-expansion-2026-09-17-v19','status':'candidate-unmeasured',
      # 时限遵循项目参考值：题级默认 600 秒、上限 1200 秒
      # （packages/core/src/model/caller.ts 的 600_000 默认 + apiControlStream 的 1_200_000 上限）。
      # 原为 [180,360,1200,1200]，是给"不需要计算的"旧 P1 白送分题调的；
      # 2026-09-16 把 P1 换成仍需真实求解的问法后，180 秒成了实际作答的瓶颈，
      # 故 P1 回到项目默认 600 秒。
      'modelCalls':0,'hardSeconds':[300,600,900,1200],'points':[10,20,30,40],
      'groups':GROUPS,'difficultyCalibrated':False,'productionEligible':False}
dest=ROOT/'packages/core/src/evaluationLab/examExpansion/math-candidates.json'
dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'groups':len(GROUPS),'parts':4*len(GROUPS),'modelCalls':0,'path':str(dest)}))
