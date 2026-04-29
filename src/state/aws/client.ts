import { createHash, createHmac } from 'crypto';
import { request as httpsRequest } from 'https';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface AwsRequestInput {
  method: 'GET' | 'POST';
  service: string;
  region: string;
  host: string;
  path: string;
  query?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface AwsHttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export type AwsTransport = (
  input: AwsRequestInput & { headers: Record<string, string>; body: string }
) => Promise<AwsHttpResponse>;

export class AwsSignedClient {
  constructor(
    private readonly credentials: AwsCredentials,
    private readonly transport: AwsTransport = defaultHttpsTransport
  ) {}

  async request(input: AwsRequestInput): Promise<AwsHttpResponse> {
    const body = input.body ?? '';
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host: input.host,
      'x-amz-date': amzDate,
      ...(input.headers ?? {}),
    };

    if (this.credentials.sessionToken) {
      headers['x-amz-security-token'] = this.credentials.sessionToken;
    }

    const canonicalUri = input.path || '/';
    const canonicalQueryString = input.query ?? '';
    const sortedHeaderKeys = Object.keys(headers).sort();
    const signedHeaders = sortedHeaderKeys.join(';');
    const canonicalHeaders = sortedHeaderKeys
      .map(key => `${key}:${headers[key].trim()}\n`)
      .join('');
    const canonicalRequest = [
      input.method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      sha256(body),
    ].join('\n');
    const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join('\n');

    const signingKey = getSignatureKey(
      this.credentials.secretAccessKey,
      dateStamp,
      input.region,
      input.service
    );
    const signature = hmac(signingKey, stringToSign, 'hex');
    const authorization = [
      `AWS4-HMAC-SHA256 Credential=${this.credentials.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');

    return this.transport({
      ...input,
      body,
      headers: {
        ...headers,
        authorization,
        'content-length': Buffer.byteLength(body).toString(),
      },
    });
  }
}

function defaultHttpsTransport(
  input: AwsRequestInput & { headers: Record<string, string>; body: string }
): Promise<AwsHttpResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      method: input.method,
      host: input.host,
      path: `${input.path}${input.query ? `?${input.query}` : ''}`,
      headers: input.headers,
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
    });

    req.on('error', reject);
    req.write(input.body);
    req.end();
  });
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(
  key: string | Buffer,
  value: string,
  encoding?: 'hex'
): Buffer | string {
  const digest = createHmac('sha256', key).update(value, 'utf8');
  return encoding ? digest.digest(encoding) : digest.digest();
}

function getSignatureKey(
  secretAccessKey: string,
  dateStamp: string,
  regionName: string,
  serviceName: string
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp) as Buffer;
  const kRegion = hmac(kDate, regionName) as Buffer;
  const kService = hmac(kRegion, serviceName) as Buffer;
  return hmac(kService, 'aws4_request') as Buffer;
}
