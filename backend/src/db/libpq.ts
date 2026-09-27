export function libpqEnvironment(connection: string): NodeJS.ProcessEnv {
  // pg and libpq do not apply ambient connection defaults identically.
  if (Object.entries(process.env).some(([key, value]) => key.startsWith('PG') && key !== 'PG_BIN_DIR' && value)) {
    throw new Error('Backup connection must use DATABASE_URL without ambient PostgreSQL options');
  }
  const url = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid PostgreSQL URL');
  const allowed = ['host', 'port', 'user', 'password', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey'];
  if ([...url.searchParams.keys()].some(key => !allowed.includes(key))) throw new Error('Unsupported backup connection option');
  for (const key of url.searchParams.keys()) {
    if (url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key)) throw new Error('Ambiguous backup connection option');
  }
  if (!url.pathname.slice(1) || !(url.username || url.searchParams.get('user')) || !(url.hostname || url.searchParams.get('host'))) {
    throw new Error('Backup connection requires an explicit database, host and user');
  }
  const database = decodeURI(url.pathname.slice(1));
  if (database.includes('=') || /^postgres(?:ql)?:\/\//.test(database)) {
    throw new Error('Backup database name must not be interpreted as a connection string');
  }
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
  const env: NodeJS.ProcessEnv = { ...inherited,
    PGDATABASE: database,
    PGHOST: url.searchParams.get('host') ?? decodeURIComponent(url.hostname).replace(/^\[|\]$/g, ''),
    PGPORT: url.searchParams.get('port') ?? (url.port || '5432'),
    PGUSER: url.searchParams.get('user') ?? decodeURIComponent(url.username),
    PGPASSWORD: url.searchParams.get('password') ?? decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: '5',
  };
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    const value = url.searchParams.get(key);
    if (value) env[`PG${key.toUpperCase()}`] = value;
  }
  return env;
}
