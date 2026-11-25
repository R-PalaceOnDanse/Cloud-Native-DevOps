import { randomUUID } from 'node:crypto';
import * as ff from '@google-cloud/functions-framework';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { logLine, traceName } from './log';

// Full name of the secret version to read, for example
// projects/teampasx-cloudnative-dev/secrets/hello-greeting/versions/latest.
// Set by Terraform; the value itself never appears in the code or the repository.
const SECRET_VERSION = process.env.HELLO_SECRET_VERSION ?? '';

// Set by Terraform; it turns the trace header into the name Cloud Logging expects.
const PROJECT_ID = process.env.PROJECT_ID ?? '';

const secrets = new SecretManagerServiceClient();

// Kept between invocations of the same instance, so Secret Manager is called once per cold start.
let cached: { value: string; version: string } | undefined;

async function readSecret(): Promise<{ value: string; version: string }> {
  if (cached) return cached;
  if (!SECRET_VERSION) throw new Error('HELLO_SECRET_VERSION is not set');
  // Authenticated as the function's own service account, which has secretAccessor on this secret only.
  const [response] = await secrets.accessSecretVersion({ name: SECRET_VERSION });
  const data = response.payload?.data;
  if (!data) throw new Error('the secret version has no payload');
  cached = {
    value: Buffer.from(data).toString('utf8'),
    version: response.name ?? SECRET_VERSION,
  };
  return cached;
}

ff.http('hello', async (req: ff.Request, res: ff.Response) => {
  const correlationId = req.get('x-correlation-id') ?? randomUUID();
  res.set('x-correlation-id', correlationId);
  const trace = traceName(req.get('x-cloud-trace-context'), PROJECT_ID);

  try {
    const secret = await readSecret();
    console.log(logLine('INFO', 'hello served', { correlation_id: correlationId, path: req.path }, trace));
    // The secret value is never returned: only proof that it was read, and which version.
    res.status(200).json({
      message: 'hello from teampasx',
      secret_read: true,
      secret_version: secret.version,
      correlation_id: correlationId,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(logLine('ERROR', 'secret could not be read', { correlation_id: correlationId, error }, trace));
    res.status(500).json({ error: 'secret unavailable', correlation_id: correlationId });
  }
});
