#!/usr/bin/env python3
"""Summarize a Chrome trace without exporting screenshots, profile stacks or URL queries.

GPUTask is GPU-process command-service wall time, not a hardware timer query.
No pass/fail FPS assertion: report the full capture and the explicit steady window.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import statistics
from urllib.parse import urlsplit


def distribution(values):
    values = sorted(values)
    if not values:
        return None
    def percentile(p):
        return round(values[round((len(values) - 1) * p)], 4)
    return {"count": len(values), "mean_ms": round(statistics.mean(values), 4),
            "p50_ms": percentile(.5), "p95_ms": percentile(.95), "p99_ms": percentile(.99),
            "max_ms": round(values[-1], 4), "over_2ms": sum(v > 2 for v in values),
            "over_16_667ms": sum(v > 1000 / 60 for v in values)}


def summarize(path, pid=None, steady_after=2.0):
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rt', encoding='utf-8') as source:
        document = json.load(source)
    events = document.get('traceEvents', []) if isinstance(document, dict) else document
    complete = [e for e in events if e.get('ph') == 'X' and isinstance(e.get('dur'), (int, float))]
    animation = [e for e in complete if e.get('name') == 'FireAnimationFrame']
    if not animation:
        raise ValueError('No complete FireAnimationFrame events; select a trace with rendered frames')
    if pid is None:
        pid = Counter(e['pid'] for e in animation).most_common(1)[0][0]
    tid_counts = Counter(e['tid'] for e in animation if e['pid'] == pid)
    if not tid_counts:
        raise ValueError(f'No animation frames for renderer PID {pid}')
    tid = tid_counts.most_common(1)[0][0]
    start = min(e['ts'] for e in events if isinstance(e.get('ts'), (int, float)) and e['ts'] > 0)
    end = max(e['ts'] + e.get('dur', 0) for e in events if isinstance(e.get('ts'), (int, float)))
    frames = sorted((e for e in animation if (e['pid'], e['tid']) == (pid, tid)), key=lambda e: e['ts'])
    steady = [e for e in frames if e['ts'] >= start + steady_after * 1e6]
    def frame_summary(group):
        gaps = [(right['ts'] - left['ts']) / 1000 for left, right in zip(group, group[1:])]
        return {"callback_wall": distribution([e['dur'] / 1000 for e in group]),
                "callback_thread_cpu": distribution([e['tdur'] / 1000 for e in group if 'tdur' in e]),
                "intervals": distribution(gaps),
                "cadence_fps": round(1000 / statistics.mean(gaps), 3) if gaps else None}
    tasks = [e for e in complete if e['name'] == 'RunTask' and (e['pid'], e['tid']) == (pid, tid)]
    long_tasks = []
    for task in tasks:
        if task['dur'] <= 50000:
            continue
        inside = [e for e in complete if (e['pid'], e['tid']) == (pid, tid)
                  and task['ts'] <= e['ts'] and e['ts'] + e['dur'] <= task['ts'] + task['dur']]
        long_tasks.append({"offset_s": round((task['ts'] - start) / 1e6, 4),
                           "wall_ms": task['dur'] / 1000, "thread_cpu_ms": task.get('tdur', 0) / 1000,
                           "contains_profiler_start": any(e['name'] == 'CpuProfiler::StartProfiling' for e in inside)})
    gpu = [e for e in complete if e['name'] == 'GPUTask' and e.get('args', {}).get('data', {}).get('renderer_pid') == pid]
    counters = [e['args']['data'] for e in events if e['name'] == 'UpdateCounters' and e['pid'] == pid]
    gc = [e for e in complete if e['name'] == 'MinorGC' and e['pid'] == pid]
    memory = {key: {"first": counters[0][key], "last": counters[-1][key],
                    "min": min(c[key] for c in counters), "max": max(c[key] for c in counters)}
              for key in counters[0]} if counters else None
    heaps = [e['args']['usedHeapSizeAfter'] for e in gc if 'usedHeapSizeAfter' in e.get('args', {})]
    used_gpu = [e['args']['data']['used_bytes'] for e in gpu if 'used_bytes' in e.get('args', {}).get('data', {})]
    bundles = sorted({Path(urlsplit(e.get('args', {}).get('data', {}).get('url', '')).path).name
                      for e in complete if e['name'] == 'FunctionCall' and e['pid'] == pid})
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return {"trace_file": path.name, "sha256": digest.hexdigest(), "events": len(events),
            "recorded_at": document.get('metadata', {}).get('startTime') if isinstance(document, dict) else None,
            "capture_seconds": round((end - start) / 1e6, 4), "renderer_pid": pid, "main_tid": tid,
            "bundle_files": [name for name in bundles if name],
            "all_frames": frame_summary(frames), "steady_after_s": steady_after, "steady_frames": frame_summary(steady),
            "renderer_long_tasks": long_tasks,
            "frame_gaps_over_25ms": [{"offset_s": round((right['ts'] - start) / 1e6, 4),
                                       "interval_ms": (right['ts'] - left['ts']) / 1000}
                                      for left, right in zip(frames, frames[1:]) if right['ts'] - left['ts'] > 25000],
            "gpu_service_tasks": {"definition": "Per-command GPU-process wall time; NOT whole-frame hardware GPU time",
                                  "wall": distribution([e['dur'] / 1000 for e in gpu]),
                                  "used_bytes": {"first": used_gpu[0], "last": used_gpu[-1], "min": min(used_gpu), "max": max(used_gpu)} if used_gpu else None},
            "minor_gc": {"pause": distribution([e['dur'] / 1000 for e in gc]), "post_gc_heap_bytes": heaps},
            "page_counters": memory,
            "dropped_frame_markers": len([e for e in events if e['name'] == 'DroppedFrame' and e['pid'] == pid])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trace', type=Path)
    parser.add_argument('--pid', type=int, help='Renderer PID; defaults to the renderer with most rAF callbacks')
    parser.add_argument('--steady-after', type=float, default=2.0, help='Explicit seconds excluded from the steady table; full-capture table is retained')
    parser.add_argument('--output', type=Path, help='Optional JSON summary, without raw trace payloads')
    args = parser.parse_args()
    if args.steady_after < 0:
        parser.error('--steady-after must be nonnegative')
    result = summarize(args.trace, args.pid, args.steady_after)
    text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.write_text(text + '\n', encoding='utf-8')
    else:
        print(text)
