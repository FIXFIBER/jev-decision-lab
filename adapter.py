#!/usr/bin/env python3
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import json
import sys
import os

sys.path.insert(0, '/home/darkaxis/anyjev-test/lib/python3.12/site-packages')

from anyjev import Decider, Question
from anyjev.backends.llamacpp import LlamaCppBackend
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
try:
    import web_augment
    WEB_AUGMENT_AVAILABLE = True
except Exception:
    WEB_AUGMENT_AVAILABLE = False

app = FastAPI(title="AnyJev Adapter")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

backend = None
decider = None

@app.on_event("startup")
async def startup():
    global backend, decider
    # Resolve model path: env var > .model_path file > auto-detect from ollama blobs
    gguf_path = os.environ.get("ANYJEV_GGUF")
    if not gguf_path:
        mp = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".model_path")
        if os.path.exists(mp):
            gguf_path = open(mp).read().strip()
    if not gguf_path:
        # Auto-detect: find first GGUF blob in ollama
        import glob
        for blob in sorted(glob.glob("/var/lib/ollama/.ollama/models/blobs/sha256-*")):
            try:
                with open(blob, "rb") as f:
                    if f.read(4) == b"GGUF":
                        gguf_path = blob
                        break
            except Exception:
                pass
    if not gguf_path:
        gguf_path = "/tmp/llama32-3b.gguf"
    backend = LlamaCppBackend(gguf_path, n_ctx=1024, n_batch=256, n_gpu_layers=0)
    decider = Decider(backend, level="L0")
    print(f"Loaded: {backend.name}", flush=True)

@app.on_event("shutdown")
async def shutdown():
    global backend
    if backend:
        backend.close()

@app.get("/health")
async def health():
    return {"ok": True}

@app.get("/v1/models")
async def models():
    return {"models": [{"name": "anyjev"}]}

@app.post("/v1/systemone")
async def systemone(req: Request):
    try:
        body = await req.json()
    except:
        raise HTTPException(status_code=400, detail="bad json")
    state = body.get("state", "")
    questions = body.get("questions", {})
    web_augment_flag = body.get("web_augment", True)
    web_sources = []
    if isinstance(state, dict) or isinstance(state, list):
        state_str = json.dumps(state)
    elif state is None:
        state_str = ""
    else:
        state_str = str(state)

    # Web augmentation: fetch live data to ground the decision
    if web_augment_flag and WEB_AUGMENT_AVAILABLE:
        try:
            state_str, web_sources = web_augment.augment_state(state, questions)
        except Exception as e:
            print(f"Web augment error: {e}", flush=True)
    
    anyjev_questions = []
    q_mapping = []
    for qid, q in questions.items():
        qtype = q.get("type")
        instructions = q.get("instructions", qid)
        criteria = q.get("criteria", {})
        if qtype == "noul":
            anyjev_questions.append(Question.noul(instructions))
            q_mapping.append((qid, "noul"))
        elif qtype == "choice":
            if isinstance(criteria, dict):
                options = list(criteria.keys())
            elif isinstance(criteria, list):
                options = criteria
            else:
                options = ["yes", "no"]
            anyjev_questions.append(Question.choice(instructions, options))
            q_mapping.append((qid, "choice", options))
        elif qtype == "score":
            if isinstance(criteria, list):
                options = criteria
            else:
                options = ["low", "med", "high"]
            anyjev_questions.append(Question.choice(instructions, options))
            q_mapping.append((qid, "score", options))
    
    result = decider.decide(state_str, anyjev_questions)
    answers = {}
    for i, mapping in enumerate(q_mapping):
        qid = mapping[0]
        qtype = mapping[1]
        d = result[anyjev_questions[i].id]
        if qtype == "noul":
            answers[qid] = {"type": "noul", "noul": float(d.p_true) if hasattr(d,'p_true') else float(d.probs[0]), "confidence": float(getattr(d,'confidence',0.5))}
        elif qtype == "choice":
            opts = mapping[2]
            dist = d.distribution if hasattr(d,'distribution') else {k:float(v) for k,v in zip(d.question.options,d.probs)}
            winner = d.argmax if hasattr(d,'argmax') else max(dist,key=dist.get)
            answers[qid] = {"type": "choice", "choice": winner, "probabilities": dist, "confidence": float(getattr(d,'confidence',dist.get(winner,0.5)))}
        elif qtype == "score":
            opts = mapping[2]
            dist = d.distribution if hasattr(d,'distribution') else {k:float(v) for k,v in zip(d.question.options,d.probs)}
            winner = d.argmax if hasattr(d,'argmax') else max(dist,key=dist.get)
            try:
                sval = opts.index(winner)
            except:
                sval = 0
            answers[qid] = {"type": "score", "score": float(sval), "legend": {str(i):o for i,o in enumerate(opts)}, "probabilities": dist, "confidence": float(getattr(d,'confidence',dist.get(winner,0.5)))}
    resp = {"model": "anyjev", "answers": answers, "usage": {"input_tokens": 0, "output_tokens": 0}}
    if web_sources:
        resp["web_sources"] = web_sources
    return resp

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8100)
