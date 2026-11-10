"""Tripo's API, from the command line. The key is read from ~/.tripo_key and never printed.

    python3 scripts/tripo.py balance
    python3 scripts/tripo.py upload FILE                    prints the file token
    python3 scripts/tripo.py submit PATH JSON               POSTs JSON to /v3/PATH, prints the task id
    python3 scripts/tripo.py wait TASK OUT_DIR              polls the task, saves what it made in OUT_DIR
    python3 scripts/tripo.py multiview OUT_DIR JSON front=F left=L back=B right=R
                                                          uploads the views, submits, waits
    python3 scripts/tripo.py image OUT_DIR JSON FILE        one picture: uploads it, submits, waits

JSON is the request body (a string, or @file); for `multiview` the inputs are filled in.
Every task's full answer is saved as OUT_DIR/TASK.json, beside what it made.
"""
from __future__ import annotations
import json
import os
import sys
import time
import urllib.request
import uuid

# The global endpoint; openapi.tripo3d.com is China's, and refuses keys from this one.
API = 'https://openapi.tripo3d.ai/v3'
KEY = open(os.path.expanduser('~/.tripo_key')).read().strip()


def call(method: str, path: str, body: bytes | None = None, kind: str = 'application/json') -> dict:
    req = urllib.request.Request(f'{API}/{path}', data=body, method=method,
                                 headers={'Authorization': f'Bearer {KEY}', **({'Content-Type': kind} if body else {})})
    try:
        with urllib.request.urlopen(req) as r:
            answer = json.load(r)
    except urllib.error.HTTPError as e:
        answer = json.loads(e.read() or b'{}')
    if answer.get('code') != 0:
        sys.exit(f'tripo: {path}: {json.dumps(answer)}')
    return answer['data']


def balance() -> None:
    req = urllib.request.Request('https://api.tripo3d.ai/v2/openapi/user/balance', headers={'Authorization': f'Bearer {KEY}', 'User-Agent': 'curl/8'})
    with urllib.request.urlopen(req) as r:
        print(json.load(r)['data'])


def upload(path: str) -> str:
    boundary = uuid.uuid4().hex
    name = os.path.basename(path)
    kind = 'image/png' if name.endswith('.png') else 'image/jpeg'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            f'Content-Type: {kind}\r\n\r\n').encode() + open(path, 'rb').read() + f'\r\n--{boundary}--\r\n'.encode()
    return call('POST', 'files', body, f'multipart/form-data; boundary={boundary}')['file_token']


def submit(path: str, body: dict) -> str:
    return call('POST', path, json.dumps(body).encode())['task_id']


def wait(task: str, out: str) -> dict:
    os.makedirs(out, exist_ok=True)
    while True:
        data = call('GET', f'tasks/{task}')
        status = data.get('status')
        print(f'{task}: {status} {data.get("progress", "")}', file=sys.stderr)
        if status not in ('queued', 'running', 'pending'):
            break
        time.sleep(8)
    json.dump(data, open(os.path.join(out, f'{task}.json'), 'w'), indent=2)
    # Whatever it made is somewhere in its output as a URL: save each.
    def urls(o, at=''):
        if isinstance(o, dict):
            for k, v in o.items():
                yield from urls(v, f'{at}{k}.')
        elif isinstance(o, list):
            for i, v in enumerate(o):
                yield from urls(v, f'{at}{i}.')
        elif isinstance(o, str) and o.startswith('http'):
            yield at.rstrip('.'), o
    for name, url in urls(data.get('output', data)):
        ext = os.path.splitext(url.split('?')[0])[1] or '.bin'
        dest = os.path.join(out, f'{task}_{name.replace(".", "_")}{ext}')
        with urllib.request.urlopen(url, timeout=120) as r, open(dest, 'wb') as f:
            f.write(r.read())
        print(dest)
    if status != 'success':
        sys.exit(f'tripo: task {task} ended {status}')
    return data


def body_of(arg: str) -> dict:
    return json.load(open(arg[1:])) if arg.startswith('@') else json.loads(arg)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    what, args = sys.argv[1], sys.argv[2:]
    if what == 'balance':
        balance()
    elif what == 'upload':
        print(upload(args[0]))
    elif what == 'submit':
        print(submit(args[0], body_of(args[1])))
    elif what == 'wait':
        wait(args[0], args[1])
    elif what == 'multiview':
        body = body_of(args[1])
        views = dict(a.split('=', 1) for a in args[2:])
        # In the order front, left, back, right; a view not given is left empty.
        body['inputs'] = [upload(views[side]) if side in views else '' for side in ('front', 'left', 'back', 'right')]
        task = submit('generation/multiview-to-model', body)
        print(task)
        data = wait(task, args[0])
        print(f'credits: {data.get("credits_consumed")}', file=sys.stderr)
    elif what == 'image':
        body = body_of(args[1])
        body['input'] = upload(args[2])
        task = submit('generation/image-to-model', body)
        print(task)
        data = wait(task, args[0])
        print(f'credits: {data.get("credits_consumed")}', file=sys.stderr)
    else:
        sys.exit(__doc__)
