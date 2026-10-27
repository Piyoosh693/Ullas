const ALLOWED_SAME_SITE = new Set(['lax', 'strict', 'none']);

function invalid(message) {
  const error = new Error(message);
  error.status = 500;
  error.code = 'INVALID_CONFIGURATION';
  return error;
}

function isExactOrigin(value, { production = false } = {}) {
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password || url.search || url.hash) return false;
    if (production) return url.protocol === 'https:' && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url.hostname);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function validateEnv(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const required = ['DATABASE_URL', 'FRONTEND_URL', 'SESSION_SECRET', 'ADMIN_BOOTSTRAP_SECRET'];
  if (production) required.push('PUBLIC_APP_URL', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL');

  const missing = required.filter((key) => !env[key] || String(env[key]).trim() === '');
  if (missing.length) throw invalid(`Missing required environment variables: ${missing.join(', ')}`);

  if (!/^postgres(?:ql)?:\/\//i.test(String(env.DATABASE_URL || ''))) {
    throw invalid('DATABASE_URL must be a PostgreSQL connection URL');
  }

  const origins = String(env.FRONTEND_URL || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!origins.length || origins.some((origin) => !isExactOrigin(origin, { production }))) {
    throw invalid(production
      ? 'FRONTEND_URL must contain exact HTTPS origins, comma-separated, with no path or trailing slash'
      : 'FRONTEND_URL must contain one or more valid origins');
  }

  if (production) {
    if (String(env.SESSION_SECRET).length < 32 || /replace|changeme|example|secret123/i.test(env.SESSION_SECRET)) {
      throw invalid('SESSION_SECRET must be a unique secret of at least 32 characters in production');
    }
    if (String(env.ADMIN_BOOTSTRAP_SECRET).length < 32 || /replace|changeme|example|secret123/i.test(env.ADMIN_BOOTSTRAP_SECRET)) {
      throw invalid('ADMIN_BOOTSTRAP_SECRET must be a unique secret of at least 32 characters in production');
    }
    if (!isExactOrigin(String(env.PUBLIC_APP_URL), { production: true })) {
      throw invalid('PUBLIC_APP_URL must be the exact HTTPS origin used in verification and password-reset links');
    }
    if (!origins.includes(String(env.PUBLIC_APP_URL))) {
      throw invalid('PUBLIC_APP_URL must match one of the trusted FRONTEND_URL origins');
    }
    if (String(env.RESEND_API_KEY).length < 12 || /re_replace_me|example|changeme/i.test(env.RESEND_API_KEY)) {
      throw invalid('RESEND_API_KEY must be a real Resend API key in production');
    }
    const sender = String(env.RESEND_FROM_EMAIL);
    const address = sender.match(/<([^<>]+)>/)?.[1] || sender;
    const senderDomain = address.split('@')[1]?.toLowerCase() || '';
    if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address) || /example\.(com|org|net|test)$/i.test(address) || /\.(test|example|invalid|localhost|local)$/i.test(senderDomain)) {
      throw invalid('RESEND_FROM_EMAIL must contain a valid, verified sender email address');
    }
  }

  const cookieSameSite = String(env.COOKIE_SAME_SITE || 'lax').toLowerCase();
  if (!ALLOWED_SAME_SITE.has(cookieSameSite)) throw invalid('COOKIE_SAME_SITE must be lax, strict, or none');
  if (production && cookieSameSite === 'none' && env.COOKIE_SECURE === 'false') {
    throw invalid('COOKIE_SAME_SITE=none requires Secure cookies in production');
  }

  return {
    nodeEnv,
    port: Number(env.PORT || 4000),
    frontendUrl: env.FRONTEND_URL,
    publicAppUrl: env.PUBLIC_APP_URL || env.FRONTEND_URL.split(',')[0].trim(),
    sessionSecret: env.SESSION_SECRET,
    cookieSameSite,
  };
}

module.exports = { validateEnv, isExactOrigin };
