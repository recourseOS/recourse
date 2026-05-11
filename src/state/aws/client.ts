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

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 100) */
  baseDelayMs?: number;
  /** Maximum delay in ms (default: 5000) */
  maxDelayMs?: number;
  /** Whether to retry on 5xx errors (default: true) */
  retryOn5xx?: boolean;
  /** Whether to retry on network errors (default: true) */
  retryOnNetworkError?: boolean;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  retryOn5xx: true,
  retryOnNetworkError: true,
};

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter.
 */
function calculateBackoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Check if a response should be retried.
 */
function shouldRetry(
  statusCode: number,
  options: Required<RetryOptions>
): boolean {
  // Network error (statusCode 0)
  if (statusCode === 0 && options.retryOnNetworkError) {
    return true;
  }
  // 5xx server errors
  if (statusCode >= 500 && options.retryOn5xx) {
    return true;
  }
  // 429 Too Many Requests
  if (statusCode === 429) {
    return true;
  }
  return false;
}

export class AwsSignedClient {
  private readonly retryOptions: Required<RetryOptions>;

  constructor(
    private readonly credentials: AwsCredentials,
    private readonly transport: AwsTransport = defaultHttpsTransport,
    retryOptions: RetryOptions = {}
  ) {
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  }

  async request(input: AwsRequestInput): Promise<AwsHttpResponse> {
    let lastError: Error | undefined;
    let lastResponse: AwsHttpResponse | undefined;

    for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        const response = await this.requestOnce(input);
        lastResponse = response;

        // Check if we should retry
        if (attempt < this.retryOptions.maxRetries && shouldRetry(response.statusCode, this.retryOptions)) {
          const delay = calculateBackoff(attempt, this.retryOptions.baseDelayMs, this.retryOptions.maxDelayMs);
          await sleep(delay);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Network error - retry if configured
        if (attempt < this.retryOptions.maxRetries && this.retryOptions.retryOnNetworkError) {
          const delay = calculateBackoff(attempt, this.retryOptions.baseDelayMs, this.retryOptions.maxDelayMs);
          await sleep(delay);
          continue;
        }

        // Return a response with statusCode 0 to indicate network failure
        return {
          statusCode: 0,
          body: lastError.message,
          headers: {},
        };
      }
    }

    // All retries exhausted
    if (lastResponse) {
      return lastResponse;
    }

    return {
      statusCode: 0,
      body: lastError?.message || 'Request failed after retries',
      headers: {},
    };
  }

  private async requestOnce(input: AwsRequestInput): Promise<AwsHttpResponse> {
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
