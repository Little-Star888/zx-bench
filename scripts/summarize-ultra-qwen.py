"""Export the existing eight-call screen and its explicit preliminary review.

Reads completed artifacts only; makes no model requests and never changes the pack.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = sys.argv[1] if len(sys.argv) > 1 else "qwen"
if TARGET not in {"qwen", "deepseek"}:
    raise SystemExit("target must be qwen or deepseek")
RUN = ROOT / f"reports/ultra-{TARGET}-screen-20260914"
PACK = ROOT / "reports/ultra-math-20260914-pack-v2"
LEDGER = ROOT / f"reports/ultra-v2-{TARGET}-eight-call-budget"


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


plan = read(RUN / "plan.json")
status = read(RUN / "status.json")
index = read(PACK / "candidate-questions.json")
review = read(RUN / "preliminary-review.json")
assert status["state"] == "completed" and status["recorded"] == 8
assert review["reviewer"] == "assistant_preliminary_review"
assert review["independentProofReview"] is False
assert plan["contractHash"] == index["contractHash"] == review["contractHash"]
assert all(digest(Path(p)) == h for p, h in plan["hashes"].items())
calls = [read(LEDGER / f"{i}.json") for i in range(1, 9)]
assert len(list(LEDGER.glob("*.json"))) == 8
assert [c["id"] for c in calls] == plan["questions"]
assert set(review["questions"]) == set(plan["questions"])
rows = []
history = {}
for q in index["questions"]:
    folder = RUN / q["id"]
    raw = read(folder / "raw.json")
    outcome = read(folder / "outcome.json")
    request = read(folder / "request.json")
    public = read(PACK / q["file"])
    prior = history.setdefault(q["groupId"], [])
    assert request["body"]["messages"] == prior + public["messages"]
    prior.extend(public["messages"])
    prior.append({"role": "assistant", "content": raw["content"] or "本问未提交答案。"})
    grade = review["questions"][q["id"]]
    assert grade["answerSha256"] == digest(folder / "answer.md")
    assert 0 <= grade["conclusionScore"] <= grade["conclusionMax"]
    assert 0 <= grade["proofScore"] <= grade["proofMax"]
    assert grade["conclusionMax"] + grade["proofMax"] == q["points"]
    assert outcome["correctModel"] and outcome["outcome"] != "environment_error"
    assert request["questionHash"] == q["questionHash"]
    if not raw["content"]:
        assert grade["conclusionScore"] == grade["proofScore"] == 0
    rows.append({
        "id": q["id"], "groupId": q["groupId"], "points": q["points"],
        "hardSeconds": q["hardSeconds"], "maxTokens": request["body"]["max_tokens"],
        "outcome": outcome["outcome"], "finishReason": raw["finishReason"],
        "latencyMs": raw["latencyMs"], "usage": raw["usage"],
        "answerCharacters": len(raw["content"]), "review": grade,
        "rawPath": str(folder / "raw.json"), "rawSha256": digest(folder / "raw.json"),
        "requestSha256": digest(folder / "request.json"),
    })
groups = {}
for group in ["UMX-01", "UMX-02"]:
    items = [r for r in rows if r["groupId"] == group]
    groups[group] = {k: sum(r["review"][k] for r in items)
                     for k in ["conclusionScore", "conclusionMax", "proofScore", "proofMax"]}
    groups[group]["score"] = groups[group]["conclusionScore"] + groups[group]["proofScore"]
evidence = {
    "model": plan["model"], "contractHash": plan["contractHash"],
    "calls": 8, "retries": 0, "runPath": str(RUN),
    "proofReview": "assistant_preliminary_review", "independentProofReview": False,
    "sourceHashesVerified": True, "promptIsolationVerified": True,
    "productionEligible": False,
    "groups": groups, "normalizedScore": sum(g["score"] for g in groups.values()) / 2,
    "latencyMsTotal": sum(r["latencyMs"] for r in rows), "questions": rows,
}
dest = ROOT / f"docs/ultra-{TARGET}-screen-2026-09-14-evidence.json"
dest.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"groups": groups, "normalizedScore": evidence["normalizedScore"],
                  "latencyMsTotal": evidence["latencyMsTotal"], "evidence": str(dest)},
                 ensure_ascii=False))
