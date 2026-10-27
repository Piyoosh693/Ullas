const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const { getTestOutbox } = require('../src/email');

const server = app.listen(0);

function extractSessionToken(header) {
  const match = String(header || '').match(/ullas_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (token) requestHeaders['x-session-token'] = token;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function createVerifiedAccount({ name, email, password = 'strong-pass-1234', accountType = 'user' }) {
  const signup = await request('/api/signup', { method: 'POST', body: { name, email, password, accountType } });
  assert.equal(signup.status, 201, `signup for ${email}`);
  const signupPayload = await signup.json();
  assert.equal(Object.prototype.hasOwnProperty.call(signupPayload, 'verificationToken'), false);
  const emailRecord = [...getTestOutbox()].reverse().find((item) => item.to === email && item.subject.toLowerCase().includes('verify'));
  const match = String(emailRecord?.text || '').match(/[?&]token=([^\s&]+)/);
  assert.ok(match, `verification email queued for ${email}`);
  const verify = await request('/api/verify-email', { method: 'POST', body: { token: decodeURIComponent(match[1]) } });
  assert.equal(verify.status, 200, `verification for ${email}`);
  const login = await request('/api/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200, `login for ${email}`);
  const token = extractSessionToken(login.headers.get('set-cookie'));
  assert.ok(token, `session created for ${email}`);
  return { user: (await login.json()).user, token };
}

test('V1 critical flows: public directory, availability, booking conflict, authorization and feedback', async () => {
  const professional = await createVerifiedAccount({ name: 'Asha Professional', email: 'asha.v1@example.test', accountType: 'professional' });
  const learner = await createVerifiedAccount({ name: 'Kabir Learner', email: 'kabir.v1@example.test' });
  const outsider = await createVerifiedAccount({ name: 'Nina Outsider', email: 'nina.v1@example.test' });

  // Public signup cannot elevate roles; the application ignores no role payload silently.
  const roleAttack = await request('/api/signup', { method: 'POST', body: { name: 'Intruder Account', email: 'role-attack@example.test', password: 'strong-pass-1234', role: 'admin' } });
  assert.equal(roleAttack.status, 400);

  // Private profile data is not included in the public directory.
  const saveProfessionalProfile = await request(`/api/profiles/${professional.user.id}`, {
    method: 'PUT', token: professional.token,
    body: { name: 'Asha Professional', bio: 'I teach practical data science workshops.', city: 'Roorkee', visibility: 'public' },
  });
  assert.equal(saveProfessionalProfile.status, 200);
  const savePrivateProfile = await request(`/api/profiles/${learner.user.id}`, {
    method: 'PUT', token: learner.token,
    body: { name: 'Kabir Learner', bio: 'Learning backend development.', city: 'Roorkee', visibility: 'private' },
  });
  assert.equal(savePrivateProfile.status, 200);
  const directory = await request('/api/directory?q=data');
  assert.equal(directory.status, 200);
  const directoryPayload = await directory.json();
  assert.ok(directoryPayload.profiles.some((item) => item.userId === professional.user.id));
  assert.ok(directoryPayload.profiles.every((item) => !Object.hasOwn(item, 'email')));
  assert.ok(!directoryPayload.profiles.some((item) => item.userId === learner.user.id));
  const privateRead = await request(`/api/profiles/${learner.user.id}`, { token: outsider.token });
  assert.equal(privateRead.status, 403);

  // User account types are enforced by server routes.
  const learnerAvailability = await request('/api/availability', {
    method: 'POST', token: learner.token,
    body: { starts_at: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(), ends_at: new Date(Date.now() + 38 * 60 * 60 * 1000).toISOString() },
  });
  assert.equal(learnerAvailability.status, 403);

  const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const windowStart = start.toISOString();
  const windowEnd = new Date(start.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const availability = await request('/api/availability', { method: 'POST', token: professional.token, body: { starts_at: windowStart, ends_at: windowEnd } });
  assert.equal(availability.status, 201);
  const badWindow = await request('/api/availability', { method: 'POST', token: professional.token, body: { starts_at: windowStart, ends_at: windowEnd } });
  assert.equal(badWindow.status, 409, 'overlapping availability should be rejected');

  const offerResponse = await request('/api/offers', { method: 'POST', token: professional.token, body: { title: 'Practical Data Science', description: 'A hands-on workshop for learners.', status: 'published' } });
  assert.equal(offerResponse.status, 201);
  const offer = (await offerResponse.json()).offer;
  const bookingStart = new Date(start.getTime() + 15 * 60 * 1000).toISOString();
  const bookingEnd = new Date(start.getTime() + 75 * 60 * 1000).toISOString();
  const bookingResponse = await request('/api/bookings', { method: 'POST', token: learner.token, body: { offerId: offer.id, slotStart: bookingStart, slotEnd: bookingEnd } });
  assert.equal(bookingResponse.status, 201);
  const booking = (await bookingResponse.json()).booking;

  const forgedBooking = await request('/api/bookings', { method: 'POST', token: outsider.token, body: { offerId: offer.id, slotStart: bookingStart, slotEnd: bookingEnd, userId: professional.user.id, status: 'accepted' } });
  assert.equal(forgedBooking.status, 400, 'client-supplied user/status must not be accepted');
  const collision = await request('/api/bookings', {
    method: 'POST', token: outsider.token,
    body: { offerId: offer.id, slotStart: new Date(start.getTime() + 30 * 60 * 1000).toISOString(), slotEnd: new Date(start.getTime() + 90 * 60 * 1000).toISOString() },
  });
  assert.equal(collision.status, 409, 'overlapping active bookings must be rejected');

  const learnerCannotAccept = await request(`/api/bookings/${booking.id}`, { method: 'PATCH', token: learner.token, body: { status: 'accepted' } });
  assert.equal(learnerCannotAccept.status, 403);
  const feedbackBeforeCompletion = await request('/api/feedback', { method: 'POST', token: learner.token, body: { bookingId: booking.id, score: 5, comments: 'Good session.' } });
  assert.equal(feedbackBeforeCompletion.status, 403);

  const accept = await request(`/api/bookings/${booking.id}`, { method: 'PATCH', token: professional.token, body: { status: 'accepted' } });
  assert.equal(accept.status, 200);
  const complete = await request(`/api/bookings/${booking.id}`, { method: 'PATCH', token: professional.token, body: { status: 'completed' } });
  assert.equal(complete.status, 200);
  const feedback = await request('/api/feedback', { method: 'POST', token: learner.token, body: { bookingId: booking.id, score: 5, comments: 'Good session.' } });
  assert.equal(feedback.status, 201);
  const duplicateFeedback = await request('/api/feedback', { method: 'POST', token: learner.token, body: { bookingId: booking.id, score: 4 } });
  assert.equal(duplicateFeedback.status, 409);
  const outsiderFeedback = await request('/api/feedback', { method: 'POST', token: outsider.token, body: { bookingId: booking.id, score: 4 } });
  assert.equal(outsiderFeedback.status, 403);
}, { timeout: 30000 });

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
