"""Independent MILP checks against frozen enumeration gold. No model calls.

Requires installed NumPy/SciPy. HiGHS proves an integer optimum; returned
assignments and integer objective are then checked in plain Python.
"""
import json
import sys
from pathlib import Path
import numpy as np
from scipy.optimize import milp, Bounds, LinearConstraint

pack_path, output_path = map(Path, sys.argv[1:3])
pack = json.loads(pack_path.read_text(encoding="utf-8"))
reports = []
for case in pack["cases"]:
    p = case["problem"]
    if case["dimension"] == "reasoning_math":
        n, edges, groups = p["n"], p["edges"], p["parityGroups"]
        width = n + len(edges) + len(groups)
        rows, lower, upper = [], [], []
        def add(coeff, lo=-np.inf, hi=np.inf):
            row = np.zeros(width)
            for index, value in coeff.items(): row[index] = value
            rows.append(row); lower.append(lo); upper.append(hi)
        add(dict(enumerate(p["costs"])), hi=p["budget"])
        add({i: 1 for i in range(n)}, lo=p["minSelected"], hi=p["maxSelected"])
        for i, j in p["requires"]: add({i: 1, j: -1}, hi=0)
        for k, group in enumerate(groups):
            add({**{i: 1 for i in group["members"]}, n + len(edges) + k: -2}, group["parity"], group["parity"])
        for k, (i, j, _) in enumerate(edges):
            z = n + k
            add({z: 1, i: -1, j: -1}, hi=0)
            add({z: 1, i: 1, j: 1}, hi=2)
            add({z: 1, i: -1, j: 1}, lo=0)
            add({z: 1, i: 1, j: -1}, lo=0)
        coeff = np.array([-x for x in p["bias"]] + [-e[2] for e in edges] + [0] * len(groups))
        maximums = np.array([1] * (n + len(edges)) + [len(g["members"]) for g in groups])
        integrality = np.array([1] * n + [0] * len(edges) + [1] * len(groups))
        solved = milp(coeff, integrality=integrality, bounds=Bounds(np.zeros(width), maximums),
                      constraints=LinearConstraint(np.array(rows), np.array(lower), np.array(upper)), options={"time_limit": 90, "mip_rel_gap": 0})
        if solved.status != 0: raise RuntimeError(f"Independent optimizer did not prove optimum: {case['id']}: {solved.message}")
        x = [int(round(v)) for v in solved.x[:n]]
        assert p["minSelected"] <= sum(x) <= p["maxSelected"]
        assert sum(a*b for a,b in zip(x,p["costs"])) <= p["budget"]
        assert all(sum(x[i] for i in g["members"]) % 2 == g["parity"] for g in groups)
        assert all(x[i] <= x[j] for i,j in p["requires"])
        value = sum(a*b for a,b in zip(x,p["bias"])) + sum(w*(x[i] != x[j]) for i,j,w in edges)
        assert value == case["reference"]["value"]
        assert abs(solved.mip_dual_bound + value) < 1e-5
        reports.append({"id":case["id"], "tier":case["tier"], "kind":"independent_MILP_integer_optimum", "value":value,
                        "x":x, "dualBound":float(solved.mip_dual_bound), "mipGap":float(solved.mip_gap), "matched":True})
    elif case["dimension"] == "hallucination_resistance":
        n = len(p["names"]); rows, lower, upper = [], [], []
        for c in p["constraints"]:
            row = np.zeros(n); row[c["members"]] = 1; rows.append(row)
            lower.append(-np.inf if c["kind"] == "le" else c["count"])
            upper.append(np.inf if c["kind"] == "ge" else c["count"])
        bounds = Bounds(np.zeros(n), np.ones(n)); constraints = LinearConstraint(np.array(rows), np.array(lower), np.array(upper))
        result = []
        for claim in p["claims"]:
            obj = np.zeros(n); obj[claim["members"]] = 1
            low = milp(obj, integrality=np.ones(n), bounds=bounds, constraints=constraints, options={"mip_rel_gap":0})
            high = milp(-obj, integrality=np.ones(n), bounds=bounds, constraints=constraints, options={"mip_rel_gap":0})
            assert low.status == 0 and high.status == 0
            minimum, maximum = round(low.fun), round(-high.fun)
            state = "supported" if minimum >= claim["threshold"] else "refuted" if maximum < claim["threshold"] else "insufficient"
            gold = next(c for c in case["reference"]["claims"] if c["id"] == claim["id"])
            assert state == gold["status"]
            result.append({"id":claim["id"], "minimum":minimum, "maximum":maximum, "status":state})
        reports.append({"id":case["id"], "tier":case["tier"], "kind":"independent_MILP_claim_bounds", "claims":result, "matched":True})
output_path.write_text(json.dumps({"packHash":pack["contractHash"], "algorithm":"SciPy/HiGHS MILP vs TypeScript full enumeration", "checks":reports,
    "scope":"All optimization and entailment gold in this frozen pack; extraction separately covered by semantic fixtures", "modelCalls":0}, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print(json.dumps({"verifiedCases":len(reports), "allMatched":True, "output":str(output_path)}))
