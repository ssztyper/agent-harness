#!/usr/bin/env python3
"""Turn one harness session log (Claude Code .jsonl or Codex rollout .jsonl) into readable text.

usage: python3 -I scripts/session-text.py <session.jsonl> <out.txt> [max chars per item, default 1500]
One line per item: [timestamp] USER / ASSISTANT / THINK / REASON / CALL <tool> / OUT / EV-*.
Subagent threads live in <session>/subagents/*.jsonl; run it on those too (find -name "*.jsonl").
"""
import json,sys,os
def short(s,n):
    s=s if isinstance(s,str) else json.dumps(s,ensure_ascii=False)
    return s if len(s)<=n else s[:n]+f' …[+{len(s)-n}]'
src,out=sys.argv[1],sys.argv[2]; N=int(sys.argv[3]) if len(sys.argv)>3 else 1500
o=open(out,'w')
for l in open(src):
    try:m=json.loads(l)
    except: continue
    ts=m.get('timestamp','')
    if 'payload' in m:  # codex
        p=m['payload'];t=m['type']
        if t=='session_meta': o.write(f"[{ts}] META {json.dumps(p)}\n");continue
        if t=='turn_context': o.write(f"[{ts}] CTX model={p.get('model')}\n");continue
        if t=='event_msg':
            pt=p.get('type')
            if pt in('user_message','agent_message'): o.write(f"[{ts}] EV-{pt}: {short(p.get('message'),N)}\n")
            elif pt not in('token_count',): o.write(f"[{ts}] EV-{pt}: {short(p,300)}\n")
            continue
        pt=p.get('type')
        if pt=='message':
            txt=' '.join(c.get('text','') for c in p.get('content',[]))
            o.write(f"[{ts}] {p.get('role').upper()}: {short(txt,N)}\n")
        elif pt=='reasoning':
            s=' '.join(x.get('text','') for x in p.get('summary',[]))
            o.write(f"[{ts}] REASON: {short(s,N)}\n")
        elif pt=='function_call': o.write(f"[{ts}] CALL {p.get('name')}: {short(p.get('arguments'),N)}\n")
        elif pt=='function_call_output': o.write(f"[{ts}] OUT: {short(p.get('output'),N)}\n")
        else: o.write(f"[{ts}] {pt}: {short(p,300)}\n")
        continue
    t=m.get('type');msg=m.get('message') or {}
    c=msg.get('content')
    if isinstance(c,str): o.write(f"[{ts}] {t.upper()}: {short(c,N)}\n");continue
    if not isinstance(c,list): o.write(f"[{ts}] {t}: {short(m,300)}\n");continue
    for x in c:
        k=x.get('type')
        if k=='text': o.write(f"[{ts}] {t.upper()}: {short(x['text'],N)}\n")
        elif k=='thinking': o.write(f"[{ts}] THINK: {short(x.get('thinking',''),N)}\n")
        elif k=='tool_use': o.write(f"[{ts}] CALL {x.get('name')}: {short(x.get('input'),N)}\n")
        elif k=='tool_result':
            r=x.get('content'); r=' '.join(y.get('text','') for y in r) if isinstance(r,list) else r
            o.write(f"[{ts}] OUT: {short(r,N)}\n")
