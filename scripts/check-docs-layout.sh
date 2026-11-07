#!/usr/bin/env bash
# Generic doc layout checks for agent-doc-spec v1.12.
# Lives at <repo>/scripts/check-docs-layout.sh after init copies it.
# Pass a repo root to run this copy in place: bash check-docs-layout.sh /path/to/repo
set -euo pipefail
if [[ $# -ge 1 ]]; then
  root="$(cd "$1" && pwd)"
else
  root="$(cd "$(dirname "$0")/.." && pwd)"
fi
bad=0

if [[ ! -d "$root/docs" ]]; then
  echo "missing docs/" >&2
  exit 1
fi

while IFS= read -r f; do
  base="$(basename "$f")"
  if [[ "$base" != "README.md" ]]; then
    echo "docs/ root must only contain README.md: $f" >&2
    bad=1
  fi
done < <(find "$root/docs" -maxdepth 1 -type f)

python3 - "$root" << 'PY'
import json, os, re, subprocess, sys
root = sys.argv[1]
bad = 0
warn = 0
docs = os.path.join(root, "docs")
date_re = re.compile(r"20\d{2}-\d{2}-\d{2}|20\d{6}")
ban_re = re.compile(r"clinic|review|plan|backup", re.I)
doc_layers = {"context", "container", "component", "ops"}
doc_classes = {"current", "design", "clinic-archive", "superseded"}
decision_status = {"proposed", "rejected", "accepted", "deprecated"}
domains = os.path.join(docs, "domains")
readmes = {}
if os.path.isdir(domains):
    for name in os.listdir(domains):
        path = os.path.join(domains, name, "README.md")
        if os.path.isfile(path):
            readmes[name] = open(path, encoding="utf-8").read()
current = {name: [] for name in readmes}

def fields_of(fm):
    fields = {}
    for line in fm.splitlines():
        if ":" in line and not line.startswith(" ") and not line.startswith("-"):
            k, v = line.split(":", 1)
            fields[k.strip()] = v.strip().strip('"')
    return fields

for dirpath, _, files in os.walk(docs):
    for name in files:
        if not name.endswith(".md") or name == "README.md":
            continue
        path = os.path.join(dirpath, name)
        rel = os.path.relpath(path, root).replace("\\", "/")
        text = open(path, encoding="utf-8").read()
        if not text.startswith("---\n"):
            print(f"missing frontmatter: {rel}", file=sys.stderr)
            bad = 1
            continue
        end = text.find("\n---\n", 4)
        fm = text[4:end] if end != -1 else ""
        fields = fields_of(fm)
        is_decision = "/decisions/" in rel
        in_archive = "/archive/" in rel
        dated = bool(date_re.search(name)) or bool(ban_re.search(name))
        if "when_to_read" not in fields or not fields["when_to_read"]:
            print(f"missing when_to_read: {rel}", file=sys.stderr)
            bad = 1
        if is_decision:
            if "doc_class" in fields:
                print(f"decision mixes doc_class: {rel}", file=sys.stderr)
                bad = 1
            status = fields.get("status", "")
            layer = fields.get("layer", "")
            if status not in decision_status and not status.startswith("superseded by ADR-"):
                print(f"bad decision status {status!r}: {rel}", file=sys.stderr)
                bad = 1
            if layer != "adr":
                print(f"decision layer must be adr: {rel}", file=sys.stderr)
                bad = 1
        else:
            if "status" in fields:
                print(f"non-decision mixes status: {rel}", file=sys.stderr)
                bad = 1
            doc_class = fields.get("doc_class", "")
            layer = fields.get("layer", "")
            if doc_class not in doc_classes:
                print(f"bad doc_class {doc_class!r}: {rel}", file=sys.stderr)
                bad = 1
            if layer not in doc_layers:
                print(f"bad layer {layer!r}: {rel}", file=sys.stderr)
                bad = 1
            if doc_class == "current" and (dated or in_archive):
                print(f"current doc is dated or archived: {rel}", file=sys.stderr)
                bad = 1
            if doc_class == "clinic-archive":
                if "/archive/clinics/" not in rel or not date_re.search(name):
                    print(f"clinic-archive needs archive/clinics and YYYY-MM-DD: {rel}", file=sys.stderr)
                    bad = 1
            if doc_class == "superseded" and "superseded_by" not in fields:
                print(f"superseded doc missing superseded_by: {rel}", file=sys.stderr)
                bad = 1
            parts = rel.split("/")
            if doc_class == "current" and layer in ("container", "component") and len(parts) >= 4 and parts[1] == "domains":
                current.setdefault(parts[2], []).append(name)
        if dated and not in_archive and not is_decision:
            print(f"dated or process doc outside archive: {rel}", file=sys.stderr)
            bad = 1
        nlines = text.count("\n") + (0 if text.endswith("\n") else 1)
        if not is_decision and fields.get("doc_class") == "current" and fields.get("layer") in doc_layers - {"ops"} and nlines > 400:
            print(f"line budget {nlines} > 400: {rel}", file=sys.stderr)
            warn = 1

for domain, readme in readmes.items():
    progress = os.path.join(domains, domain, "progress.md")
    if not os.path.isfile(progress):
        print(f"missing docs/domains/{domain}/progress.md", file=sys.stderr)
        bad = 1
    for m in re.findall(r"\(([^)]+)\)", readme):
        if "archive/" in m.replace("\\", "/"):
            print(f"{domain} README links archive: {m}", file=sys.stderr)
            bad = 1

rules_dir = os.path.join(root, ".grok", "rules")
rule_files = []
if os.path.isdir(rules_dir):
    for name in sorted(os.listdir(rules_dir)):
        path = os.path.join(rules_dir, name)
        if os.path.isfile(path) and name.endswith(".md"):
            rule_files.append(path)
if not rule_files:
    print("missing Markdown directly under .grok/rules/", file=sys.stderr)
    bad = 1
required = (
    "Read order",
    "docs/README.md",
    "Live facts over memory",
    "Step 1",
    "Step 2",
    "Step 3",
    "Commands",
    "Hard prohibitions",
)
for path in rule_files:
    text = open(path, encoding="utf-8").read()
    rel = os.path.relpath(path, root)
    n = text.count("\n") + (0 if text.endswith("\n") else 1)
    if n > 150:
        print(f"{rel} {n} > 150", file=sys.stderr)
        warn = 1
    if re.search(r"<[^>\n]+>", text):
        print(f"{rel} has an unreplaced <...> placeholder", file=sys.stderr)
        bad = 1
    for label in required:
        if label not in text:
            print(f"{rel} missing template item: {label}", file=sys.stderr)
            bad = 1
    step3 = text.split("Step 3", 1)[-1].split("Commands", 1)[0]
    if "progress.md" not in step3:
        print(f"{rel} Step 3 must reference progress.md", file=sys.stderr)
        bad = 1

iso_re = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})")
actor_re = re.compile(r"\((?:person|agent)\)")
verdict_re = re.compile(r"\b(adopted|reverted|rejected)\b")
for domain in readmes:
    progress_path = os.path.join(domains, domain, "progress.md")
    if not os.path.isfile(progress_path):
        continue
    for i, line in enumerate(open(progress_path, encoding="utf-8"), 1):
        if not line.startswith("| `20"):
            continue
        if not iso_re.search(line) or not actor_re.search(line):
            print(f"{domain} progress row missing timestamp or actor: line {i}", file=sys.stderr)
            bad = 1
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        verdict = cells[2] if len(cells) > 2 else ""
        if not verdict_re.search(verdict):
            print(f"{domain} progress verdict invalid: line {i}", file=sys.stderr)
            bad = 1

for domain, names in current.items():
    readme = readmes.get(domain, "")
    for name in names:
        if name not in readme:
            print(f"orphan current doc not in {domain} README: {name}", file=sys.stderr)
            bad = 1

if rule_files:
    try:
        proc = subprocess.run(
            ["grok", "inspect", "--json"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"grok inspect --json failed: {exc}", file=sys.stderr)
        bad = 1
        proc = None
    if proc is not None and proc.returncode != 0:
        print("grok inspect --json failed", file=sys.stderr)
        bad = 1
    elif proc is not None:
        try:
            inspected = json.loads(proc.stdout)
        except json.JSONDecodeError:
            print("grok inspect --json did not return JSON", file=sys.stderr)
            bad = 1
            inspected = {}
        listed = set()
        for item in inspected.get("projectInstructions") or []:
            if isinstance(item, dict):
                listed.add(os.path.realpath(item.get("path") or ""))
            elif isinstance(item, str):
                listed.add(os.path.realpath(item))
        for path in rule_files:
            if os.path.realpath(path) not in listed:
                print(f"grok inspect projectInstructions omits {os.path.relpath(path, root)}", file=sys.stderr)
                bad = 1

sys.exit(bad)
PY

exit "$bad"
