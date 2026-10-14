// CloudFront Function (viewer-request) on every behaviour. Three jobs:
//   1. the shared access code: a cookie must carry it, else the app shell is replaced by a
//      small form (and the API answers 401);
//   2. /api/* is forwarded to the ALB without the prefix;
//   3. any other path without a file extension is the SPA shell.
// __ACCESS_CODE__ is substituted at synth time.
var CODE = '__ACCESS_CODE__';
var COOKIE = 'cw_access';

function handler(event) {
  var request = event.request;
  var cookie = request.cookies[COOKIE];
  var ok = !!cookie && cookie.value === CODE;
  var uri = request.uri;

  if (uri === '/api' || uri.indexOf('/api/') === 0) {
    if (!ok) return json(401, '{"error":"access code required","details":null}');
    request.uri = uri.substring(4) || '/';
    return request;
  }

  if (!ok) {
    var code = request.querystring.code;
    if (code && code.value === CODE) {
      return {
        statusCode: 302,
        statusDescription: 'Found',
        headers: {
          location: { value: uri },
          'set-cookie': { value: COOKIE + '=' + CODE + '; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax' },
        },
      };
    }
    return html(code ? 'That code is not right.' : '');
  }

  if (uri.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}

function json(status, body) {
  return { statusCode: status, statusDescription: 'Unauthorized', headers: { 'content-type': { value: 'application/json' } }, body: body };
}

function html(message) {
  var body =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Campus Walk</title>' +
    '<style>body{font-family:system-ui,sans-serif;background:#f4f6f3;margin:0;display:grid;place-items:center;min-height:100vh}' +
    'form{background:#fff;border:1px solid #d9ded8;border-radius:14px;padding:24px;width:min(92vw,360px);display:grid;gap:12px}' +
    'h1{font-size:1.2rem;margin:0;color:#1f5a3c}input,button{font:inherit;min-height:48px;border-radius:10px;border:1px solid #d9ded8;padding:0 14px}' +
    'button{background:#1f5a3c;color:#fff;border-color:#1f5a3c;font-weight:600}p{margin:0;color:#b42318}</style>' +
    '<form method="get"><h1>Campus Walk</h1><label>Access code<br><input name="code" autofocus autocomplete="off" inputmode="text"></label>' +
    (message ? '<p>' + message + '</p>' : '') +
    '<button>Continue</button></form>';
  return { statusCode: 401, statusDescription: 'Unauthorized', headers: { 'content-type': { value: 'text/html; charset=utf-8' }, 'cache-control': { value: 'no-store' } }, body: body };
}
