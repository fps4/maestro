// Lambda@Edge, origin-request with the body included, on every path that reaches the server.
//
// CloudFront signs its requests to the function URL (SigV4, origin access control) but does not
// hash their bodies: a POST or PUT reaches Lambda with no x-amz-content-sha256, and Lambda refuses
// an unsigned payload. This function computes the hash CloudFront leaves out, so the console's
// form posts and server actions go through. A request without a body needs nothing.
//
// CloudFront exposes at most 1 MB of a body to an origin-request function and marks anything
// longer as truncated; a hash of a truncated body would be refused at the origin anyway, so the
// answer is 413 here, with the reason, rather than 403 there without one.
'use strict';

const crypto = require('crypto');

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const method = request.method;
  if (method === 'GET' || method === 'HEAD' || !request.body) {
    return request;
  }
  if (request.body.inputTruncated) {
    return {
      status: '413',
      statusDescription: 'Payload Too Large',
      headers: { 'content-type': [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }] },
      body: 'The request body exceeds the 1 MB this console accepts.',
    };
  }
  const data = request.body.data || '';
  const bytes = request.body.encoding === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  request.headers['x-amz-content-sha256'] = [{ key: 'x-amz-content-sha256', value: hash }];
  return request;
};
