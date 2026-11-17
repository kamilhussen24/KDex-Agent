# Scripted OpenAI-compatible server for the v1.52.20 tests (port 4010).
import json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
HITS = []
def sse(chunks):
    return ''.join('data: ' + json.dumps(c) + '\n\n' for c in chunks) + 'data: [DONE]\n\n'
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ct='application/json'):
        b = body.encode(); self.send_response(code); self.send_header('Content-Type', ct); self.send_header('Content-Length', str(len(b))); self.send_header('Access-Control-Allow-Origin', '*'); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self):
        self.send_response(204); self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', '*'); self.send_header('Access-Control-Allow-Methods', '*'); self.end_headers()
    def do_GET(self):
        if self.path.startswith('/stats'): return self._send(200, json.dumps(HITS))
        if self.path.startswith('/reset'): HITS.clear(); return self._send(200, '[]')
        self._send(200, json.dumps({'data': [{'id': 'mock-a'}]}))
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
        msgs = body.get('messages', [])
        users = [m for m in msgs if m.get('role') == 'user']
        first = (users[0].get('content') if users else '') or ''
        if isinstance(first, list): first = ' '.join(x.get('text', '') for x in first)
        notes = sum(1 for m in users if 'Automatic note from the app' in str(m.get('content')))
        HITS.append({'first': first[:20], 'notes': notes, 'max': body.get('max_tokens') or body.get('max_completion_tokens')})
        def reply(text, finish):
            ch = [{'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': text} if text else {'role': 'assistant'}, 'finish_reason': None}]},
                  {'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish}]},
                  {'choices': [], 'usage': {'prompt_tokens': 100, 'completion_tokens': 50}}]
            self._send(200, sse(ch), 'text/event-stream')
        sysm = ' '.join(str(m.get('content')) for m in msgs if m.get('role') == 'system')
        toolmsgs = [m for m in msgs if m.get('role') == 'tool']
        if 'notesrun' in first:
            if not toolmsgs:
                ch = [{'choices': [{'index': 0, 'delta': {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'c1', 'type': 'function', 'function': {'name': 'save_notes', 'arguments': json.dumps({'text': 'a.js line 3: bug found'})}}]}, 'finish_reason': None}]},
                      {'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls'}]}, {'choices': [], 'usage': {'prompt_tokens': 10, 'completion_tokens': 5}}]
                return self._send(200, sse(ch), 'text/event-stream')
            return reply('NOTES_IN_PROMPT' if 'a.js line 3: bug found' in sysm else 'NOTES_MISSING', 'stop')
        if 'cutloop' in first:
            return reply('DONE final report' if notes >= 2 else 'Part %d of the report. ' % (notes + 1), 'stop' if notes >= 2 else 'length')
        if 'cutforever' in first: return reply('Some text. ', 'length')
        if 'emptyonce' in first: return reply('Final report text' if notes >= 1 else '', 'stop')
        if 'emptyforever' in first: return reply('', 'stop')
        if 'smallcap' in first:
            if (body.get('max_tokens') or body.get('max_completion_tokens') or 0) > 8192:
                return self._send(400, json.dumps({'error': {'message': 'max_tokens must be less than or equal to 8192, got %s' % body.get('max_tokens')}}))
            return reply('Answer within the model limit', 'stop')
        reply('Mock ok', 'stop')
ThreadingHTTPServer(('127.0.0.1', 4010), H).serve_forever()
