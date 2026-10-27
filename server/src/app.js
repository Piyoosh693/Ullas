const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const healthRoutes = require('./routes/health');
const directoryRoutes = require('./routes/directory');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const { router: profilesRouter } = require('./routes/profiles');
const { router: offersRouter } = require('./routes/offers');
const { router: needsRouter } = require('./routes/needs');
const { router: bookingsRouter } = require('./routes/bookings');
const { router: notificationsRouter } = require('./routes/notifications');
const { router: feedbackRouter } = require('./routes/feedback');
const { router: organizationsRouter } = require('./routes/organizations');
const { router: availabilityRouter } = require('./routes/availability');
const { router: verificationRouter } = require('./routes/verification');
const { router: interestsRouter } = require('./routes/interests');
const { router: invitationsRouter } = require('./routes/invitations');
const { router: impactRouter } = require('./routes/impact');
const renderRoutes = require('./routes/render');

const app = express();

// Render terminates TLS at its proxy; trust the first proxy hop for rate-limit client IPs.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: false,
}));

const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin))) {
      return callback(null, true);
    }

    const error = new Error('Not allowed by CORS'); error.status = 403; return callback(error);
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  // Never log request headers, query strings, tokens, email addresses, or request bodies.
  console.info(`${req.method} ${req.path}`);
  next();
});

app.use((req, res, next) => {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const origin = req.headers.origin;
  const devLocalOrigin = process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(String(origin || ''));
  if (!mutating) return next();
  if (origin && !allowedOrigins.includes(origin) && !devLocalOrigin) return res.status(403).json({ error: 'Untrusted request origin' });
  // Browser cookie-authenticated mutations must carry a verified Origin. Non-browser API clients
  // can use the explicit x-session-token mechanism instead of relying on ambient cookies.
  if (process.env.NODE_ENV === 'production' && req.headers.cookie && !origin) {
    return res.status(403).json({ error: 'Origin header required for cookie-authenticated requests' });
  }
  return next();
});

app.use(['/api/signup','/api/login','/api/forgot-password','/api/reset-password','/api/verify-email','/api/resend-verification','/api/admin/bootstrap'], rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === 'test' ? 1000 : 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many authentication attempts. Please try again later.' } }));

app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));

app.use('/api', healthRoutes);
app.use('/api', renderRoutes);
app.use('/api', directoryRoutes);
app.use('/api', authRoutes);
app.use('/api', adminRoutes);
app.use('/api', profilesRouter);
app.use('/api', offersRouter);
app.use('/api', needsRouter);
app.use('/api', bookingsRouter);
app.use('/api', organizationsRouter);
app.use('/api', availabilityRouter);
app.use('/api', verificationRouter);
app.use('/api', interestsRouter);
app.use('/api', invitationsRouter);
app.use('/api', impactRouter);
app.use('/api', notificationsRouter);
app.use('/api', feedbackRouter);

app.get('/', (req, res) => {
  res.json({ message: 'Ullas API is running.' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('Request failed', { status: err.status || 500, code: err.code || 'INTERNAL_ERROR', message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
  const statusCode = err.status || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;

  res.status(statusCode).json({
    error: message,
    requestId: req.id || undefined,
  });
});

module.exports = app;
