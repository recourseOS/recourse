import { readFileSync } from 'fs';
import { homedir } from 'os';
import type { AwsCredentials } from './client.js';

export function loadAwsCredentials(profile = process.env.AWS_PROFILE || 'default'): AwsCredentials {
  const envCredentials = loadEnvCredentials();
  if (envCredentials) return envCredentials;

  const credentialsPath = `${homedir()}/.aws/credentials`;
  let credentialsFile: string;
  try {
    credentialsFile = readFileSync(credentialsPath, 'utf8');
  } catch {
    throw new Error('AWS credentials not found. Set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or configure ~/.aws/credentials.');
  }

  const parsed = parseIni(credentialsFile);
  const section = parsed[profile];
  if (!section?.aws_access_key_id || !section.aws_secret_access_key) {
    throw new Error(`AWS profile "${profile}" is missing static credentials in ~/.aws/credentials`);
  }

  return {
    accessKeyId: section.aws_access_key_id,
    secretAccessKey: section.aws_secret_access_key,
    sessionToken: section.aws_session_token,
  };
}

function loadEnvCredentials(): AwsCredentials | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };
}

function parseIni(content: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection = '';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      result[currentSection] = {};
      continue;
    }

    const separator = line.indexOf('=');
    if (separator === -1 || !currentSection) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    result[currentSection][key] = value;
  }

  return result;
}
