// CloudFront Function, viewer-request, on every path that reaches the server.
// CloudFront replaces the Host header with the function URL's own host when it calls a Lambda
// origin; Next.js needs the host the viewer asked for — for redirects, for absolute URLs, for
// server actions' origin check. OpenNext reads it from x-forwarded-host.
function handler(event) {
  var request = event.request;
  request.headers['x-forwarded-host'] = { value: request.headers.host.value };
  return request;
}
