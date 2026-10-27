import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { apiRequest } from './api';
import './styles.css';

const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try { const result = await apiRequest('/me'); setUser(result.user); return result.user; }
    catch { setUser(null); return null; }
  };
  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);
  const value = useMemo(() => ({ user, setUser, loading, refresh }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Notice({ error, success }) {
  if (!error && !success) return null;
  return <div className={`notice ${error ? 'notice-error' : 'notice-success'}`} role="status">{error || success}</div>;
}
function Shell({ title, intro, children }) {
  return <main className="content"><header className="page-heading"><p className="eyebrow">ULLAS · COMMUNITY LEARNING</p><h1>{title}</h1>{intro && <p className="muted lead">{intro}</p>}</header>{children}</main>;
}
function AppLayout() {
  const { user, setUser, loading } = useAuth();
  const navigate = useNavigate();
  const logout = async () => { try { await apiRequest('/logout', { method: 'POST' }); } catch {} setUser(null); navigate('/login'); };
  return <>
    <header className="topbar"><Link className="brand" to="/"><span className="brand-mark">U</span><span>ullas</span></Link>
      <nav className="nav-links">
        <Link to="/offers">Offers</Link><Link to="/needs">Needs</Link><Link to="/directory">Directory</Link>
        {user && <><Link to="/bookings">Bookings</Link><Link to="/profile">My profile</Link>{['organization','admin'].includes(user.role) && <Link to="/organizations">Organizations</Link>}</>}
        {user && <Link to="/activity">Activity</Link>}{user && ['admin','reviewer'].includes(user.role) && <Link to="/admin">Admin</Link>}
      </nav>
      <div className="nav-actions">{loading ? <span className="muted small">Loading…</span> : user ? <><span className="user-chip">{user.name || user.email} · {user.role}</span><button className="button button-quiet" onClick={logout}>Log out</button></> : <><Link className="button button-quiet" to="/login">Log in</Link><Link className="button button-primary" to="/signup">Join Ullas</Link></>}</div>
    </header>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ForgotPasswordPage resetMode />} />
      <Route path="/offers" element={<ListingsPage type="offers" />} />
      <Route path="/needs" element={<ListingsPage type="needs" />} />
      <Route path="/directory" element={<DirectoryPage />} />
      <Route path="/dashboard" element={<Protected><DashboardPage /></Protected>} />
      <Route path="/profile" element={<Protected><ProfilePage /></Protected>} />
      <Route path="/organizations" element={<Protected><OrganizationsPage /></Protected>} />
      <Route path="/bookings" element={<Protected><BookingsPage /></Protected>} />
      <Route path="/activity" element={<Protected><ActivityPage /></Protected>} />
      <Route path="/admin" element={<Protected roles={['admin','reviewer']}><AdminPage /></Protected>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
    <footer className="footer"><span>Ullas</span><span>Creating opportunities through community learning.</span><Link to="/offers">Explore opportunities</Link></footer>
  </>;
}
function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <Shell title="Loading your workspace…"><div className="panel"><p className="muted">Checking your session securely.</p></div></Shell>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Shell title="Access restricted"><p>You do not have permission to open this page.</p></Shell>;
  return children;
}
function LandingPage() {
  const { user } = useAuth();
  return <>
    <section className="hero"><div className="hero-copy"><p className="eyebrow">A COMMUNITY THAT TEACHES, LEARNS AND GROWS</p><h1>Knowledge moves forward when <em>we share it.</em></h1><p className="hero-text">Ullas connects professionals, alumni, schools, colleges and community organisations so that learning opportunities become real-world experiences.</p><div className="hero-actions"><Link className="button button-primary button-large" to={user ? '/dashboard' : '/signup'}>{user ? 'Open your workspace' : 'Get started'} <span>→</span></Link><Link className="button button-outline button-large" to="/offers">Explore opportunities</Link></div><div className="hero-note"><span className="status-dot"/> Built for meaningful, verified community learning</div></div><div className="hero-visual"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-core"><span>U</span><strong>Ullas</strong><small>Learn · Share · Grow</small></div><div className="orbit-card orbit-top"><span className="mini-icon blue">↗</span><div><strong>Share expertise</strong><small>Mentoring and workshops</small></div></div><div className="orbit-card orbit-right"><span className="mini-icon gold">＋</span><div><strong>Find support</strong><small>Community learning needs</small></div></div><div className="orbit-card orbit-bottom"><span className="mini-icon mint">✓</span><div><strong>Make an impact</strong><small>Track completed sessions</small></div></div></div></section>
    <section className="section"><div className="section-heading"><div><p className="eyebrow">HOW ULLAS WORKS</p><h2>One platform. Two sides of learning.</h2></div><p className="muted">Bring the right people together to turn knowledge into opportunity.</p></div><div className="feature-grid"><article className="feature-card"><span className="feature-number">01</span><h3>Offer what you know</h3><p>Professionals and alumni can share expertise, mentorship, workshops and practical learning sessions.</p><Link to="/offers">Explore offers ↗</Link></article><article className="feature-card"><span className="feature-number">02</span><h3>Ask for what you need</h3><p>Schools, colleges and community organisations can explain their learning needs and find collaborators.</p><Link to="/needs">Browse needs ↗</Link></article><article className="feature-card"><span className="feature-number">03</span><h3>Turn matches into impact</h3><p>Manage invitations, organise bookings, share feedback and build a clear record of community engagement.</p><Link to={user ? '/bookings' : '/signup'}>Get involved ↗</Link></article></div></section>
    <section className="callout"><div><p className="eyebrow">START WITH ONE CONNECTION</p><h2>Small sessions can create lasting change.</h2><p className="muted">Build a stronger learning community through your skills, time and ideas.</p></div><Link className="button button-primary" to={user ? '/dashboard' : '/signup'}>{user ? 'Go to dashboard' : 'Join Ullas'} →</Link></section>
  </>;
}
function AuthPage({ mode }) {
  const signup = mode === 'signup';
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', accountType: 'user' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const update = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  const submit = async (event) => {
    event.preventDefault(); setError(''); setSuccess(''); setBusy(true);
    try {
      const payload = await apiRequest(signup ? '/signup' : '/login', {
        method: 'POST',
        body: signup ? form : { email: form.email, password: form.password },
      });
      if (signup) {
        setSuccess(payload.message);
        setVerificationEmail(form.email);
        setForm({ name: '', email: '', password: '', accountType: 'user' });
      } else {
        setUser(payload.user); navigate('/dashboard');
      }
    } catch (requestError) { setError(requestError.message); if (/verify your email/i.test(requestError.message)) setVerificationEmail(form.email); }
    finally { setBusy(false); }
  };
  const resendVerification = async () => {
    if (!verificationEmail) return;
    setResendBusy(true); setError('');
    try { const result = await apiRequest('/resend-verification', { method: 'POST', body: { email: verificationEmail } }); setSuccess(result.message); }
    catch (requestError) { setError(requestError.message); }
    finally { setResendBusy(false); }
  };
  return <Shell title={signup ? 'Join the Ullas community' : 'Welcome back'} intro={signup ? 'Create an account to connect with people and organisations around shared learning goals.' : 'Sign in to manage your profile, opportunities and bookings.'}>
    <div className="auth-layout"><div className="panel auth-panel"><Notice error={error} success={success}/>
      <form className="form-stack" onSubmit={submit}>
        {signup && <label>Full name<input required minLength="2" maxLength="100" name="name" value={form.name} onChange={update} autoComplete="name" placeholder="Your name"/></label>}
        <label>Email address<input required type="email" name="email" value={form.email} onChange={update} autoComplete="email" placeholder="you@example.com"/></label>
        {signup && <label>How will you use Ullas?
          <select name="accountType" value={form.accountType} onChange={update}>
            <option value="user">Community member / learner</option>
            <option value="professional">Professional / mentor / alumni</option>
            <option value="organization">School / college / NGO / organization</option>
          </select>
        </label>}
        <label>Password<input required type="password" name="password" value={form.password} onChange={update} minLength="10" maxLength="128" autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? 'At least 10 characters' : 'Your password'}/></label>
        <button className="button button-primary full-width" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
      </form>
      {!signup && <p className="small muted auth-link"><Link to="/forgot-password">Forgot your password?</Link></p>}
      {verificationEmail && <div className="top-gap"><p className="muted small">Need another verification link for {verificationEmail}?</p><button type="button" className="button button-outline button-small" disabled={resendBusy} onClick={resendVerification}>{resendBusy ? 'Sending…' : 'Resend verification email'}</button></div>}
      <p className="muted small auth-link">{signup ? 'Already have an account? ' : 'New to Ullas? '}<Link to={signup ? '/login' : '/signup'}>{signup ? 'Sign in' : 'Create an account'}</Link></p>
      {signup && <p className="fine-print">We will email you a verification link. Verification links expire after 24 hours. Account type is not administrator access; administrative permissions are assigned separately.</p>}
    </div><div className="auth-aside"><span className="aside-symbol">✳</span><h2>{signup ? 'Your experience can open a door.' : 'Good to have you back.'}</h2><p>Ullas is a space for people who want to share knowledge, make connections and help learning happen beyond traditional boundaries.</p><div className="aside-rule"/><p className="fine-print">Your account is protected by server-managed sessions and role-based permissions.</p></div></div>
  </Shell>;
}
function VerifyEmailPage(){const location=useLocation();const token=new URLSearchParams(location.search).get('token');const[message,setMessage]=useState('Verifying your email…');const[error,setError]=useState('');useEffect(()=>{if(!token){setError('Verification token is missing. Please open the link from your email.');setMessage('');return;}apiRequest('/verify-email',{method:'POST',body:{token}}).then(r=>setMessage(r.message)).catch(e=>{setMessage('');setError(e.message);});},[token]);return <Shell title="Email verification" intro="Confirm your email address to activate your account."><div className="panel"><Notice error={error} success={message}/><Link className="button button-primary" to="/login">Continue to sign in</Link></div></Shell>;}
function ForgotPasswordPage({resetMode=false}){const location=useLocation();const navigate=useNavigate();const token=new URLSearchParams(location.search).get('token');const isReset=resetMode||Boolean(token);const[form,setForm]=useState({email:'',password:'',confirm:''});const[error,setError]=useState(()=>resetMode&&!token?'Reset token is missing. Open the latest reset link from your email.':'');const[success,setSuccess]=useState('');const[busy,setBusy]=useState(false);const update=e=>setForm({...form,[e.target.name]:e.target.value});const submit=async e=>{e.preventDefault();setError('');setSuccess('');if(isReset&&!token){setError('Reset token is missing. Open the latest reset link from your email.');return;}if(isReset&&form.password!==form.confirm){setError('Passwords do not match.');return;}setBusy(true);try{if(isReset){await apiRequest('/reset-password',{method:'POST',body:{token,password:form.password}});setSuccess('Password reset. You can now sign in.');setTimeout(()=>navigate('/login'),1200);}else{const r=await apiRequest('/forgot-password',{method:'POST',body:{email:form.email}});setSuccess(r.message);}}catch(err){setError(err.message);}finally{setBusy(false);}};return <Shell title={isReset?'Choose a new password':'Recover your account'} intro={isReset?'Use a new, strong password for your Ullas account.':'Enter your account email and we will send a reset link if it exists.'}><div className="panel auth-panel"><Notice error={error} success={success}/><form className="form-stack" onSubmit={submit}>{!isReset?<label>Email address<input required type="email" name="email" value={form.email} onChange={update}/></label>:<><label>New password<input required type="password" minLength="10" maxLength="128" name="password" value={form.password} onChange={update}/></label><label>Confirm new password<input required type="password" minLength="10" maxLength="128" name="confirm" value={form.confirm} onChange={update}/></label></>}<button className="button button-primary full-width" disabled={busy||(isReset&&!token)}>{busy?'Please wait…':isReset?'Reset password':'Send reset link'}</button></form><p className="small muted auth-link"><Link to="/login">Back to sign in</Link></p></div></Shell>;}
function DashboardPage(){const{user}=useAuth();const[stats,setStats]=useState(null);const[error,setError]=useState('');useEffect(()=>{Promise.all([apiRequest('/bookings'),apiRequest('/notifications'),apiRequest('/organizations')]).then(([b,n,o])=>setStats({bookings:b.bookings||[],notifications:n.notifications||[],organizations:o.organizations||[]})).catch(e=>setError(e.message));},[]);return <Shell title={`Welcome, ${user.name||user.email}`} intro="Your Ullas workspace. Manage the opportunities and connections you are part of."><Notice error={error}/><div className="stats-grid"><Stat label="Bookings" value={stats?.bookings.length??'—'} detail="Your upcoming and past sessions"/><Stat label="Notifications" value={stats?.notifications.filter(n=>!n.read).length??'—'} detail="Unread updates"/><Stat label="Organizations" value={stats?.organizations.length??'—'} detail="Organizations you manage"/></div><div className="section-heading compact-heading"><div><p className="eyebrow">YOUR NEXT STEPS</p><h2>Keep the momentum going</h2></div></div><div className="feature-grid"><FeatureLink to="/profile" title="Complete your profile" body="Tell the community about your skills, interests and location."/><FeatureLink to="/offers" title="Explore offers" body="Find sessions and expertise that you can learn from."/><FeatureLink to="/needs" title="Discover community needs" body="See where schools and organisations need support."/><FeatureLink to="/bookings" title="Manage bookings" body="Request, accept, reschedule or complete a session."/><FeatureLink to="/organizations" title="Manage organisations" body="Create and maintain an organisation profile."/><FeatureLink to="/activity" title="Review your activity" body="See your invitations, interests, feedback and notifications."/></div></Shell>;}
function Stat({label,value,detail}){return <div className="stat-card"><span className="muted small">{label}</span><strong>{value}</strong><span className="muted small">{detail}</span></div>;}
function FeatureLink({to,title,body}){return <Link className="feature-card feature-link" to={to}><span className="feature-arrow">↗</span><h3>{title}</h3><p>{body}</p><span className="text-link">Open section →</span></Link>;}
function ListingsPage({ type }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const label = type === 'offers' ? 'offers' : 'needs';
  const endpoint = `/${label}`;
  const itemKey = type === 'offers' ? 'offer' : 'need';
  const canCreate = type === 'offers' ? ['professional', 'admin'].includes(user?.role) : ['organization', 'admin'].includes(user?.role);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', status: 'published' });
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const publicResult = await apiRequest(endpoint);
      let all = publicResult[label] || [];
      if (user && canCreate) {
        const ownResult = await apiRequest(`${endpoint}/mine`);
        const byId = new Map(all.map((item) => [item.id, item]));
        (ownResult[label] || []).forEach((item) => byId.set(item.id, item));
        all = [...byId.values()];
      }
      setItems(all);
    } catch (loadError) { setError(loadError.message); }
  };
  useEffect(() => { load(); }, [endpoint, canCreate, user?.id]);

  const submit = async (event) => {
    event.preventDefault(); setError(''); setSuccess(''); setBusy(true);
    try {
      await apiRequest(endpoint, { method: 'POST', body: form });
      setForm({ title: '', description: '', status: 'published' });
      setSuccess(form.status === 'published' ? 'Your listing has been published.' : 'Your draft has been saved.');
      await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const updateStatus = async (item, status) => {
    setError(''); setSuccess('');
    try {
      await apiRequest(`${endpoint}/${item.id}`, { method: 'PUT', body: { title: item.title, description: item.description, status } });
      setSuccess(`Listing ${status}.`);
      await load();
    } catch (requestError) { setError(requestError.message); }
  };
  const interest = async (item) => {
    try { await apiRequest('/interests', { method: 'POST', body: type === 'offers' ? { offerId: item.id } : { needId: item.id } }); setSuccess('Your interest has been sent.'); setError(''); }
    catch (requestError) { setError(requestError.message); }
  };
  const visibleItems = items.filter((item) => `${item.title} ${item.description}`.toLowerCase().includes(search.toLowerCase()));

  return <Shell title={type === 'offers' ? 'Learn from someone who cares' : 'Where support is needed'} intro={type === 'offers' ? 'Browse published mentoring, workshops and expertise shared by the Ullas community.' : 'Discover learning and community needs posted by schools, colleges and organisations.'}>
    <Notice error={error} success={success}/>
    {canCreate && <details className="panel create-panel"><summary>{type === 'offers' ? 'Share an offer' : 'Post a need'}</summary><form className="form-stack form-top" onSubmit={submit}>
      <label>Title<input required minLength="3" maxLength="120" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={type === 'offers' ? 'e.g. Intro to data science' : 'e.g. Career guidance workshop'}/></label>
      <label>Description<textarea required minLength="10" maxLength="2000" rows="4" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}/></label>
      <label>Publication status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="published">Publish now</option><option value="draft">Save as draft</option></select></label>
      <button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : form.status === 'published' ? 'Publish listing' : 'Save draft'}</button>
    </form></details>}
    {user && !canCreate && <p className="muted small role-guidance">{type === 'offers' ? 'Offer publishing is available to professional accounts.' : 'Need publishing is available to organization accounts.'} You can still browse and express interest.</p>}
    <div className="filter-row"><label className="search-field">Search listings<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles and descriptions"/></label><span className="muted small">{visibleItems.length} listing{visibleItems.length === 1 ? '' : 's'}</span></div>
    {visibleItems.length === 0 ? <div className="empty-state"><span>✳</span><h3>{search ? 'No matching listings' : `No published ${label} yet`}</h3><p className="muted">{search ? 'Try a different search term.' : 'Come back soon, or create the first listing if your account type supports it.'}</p></div> : <div className="listing-grid">{visibleItems.map((item) => {
      const own = user && (item.userId === user.id || user.role === 'admin');
      return <article className="listing-card" key={item.id}><div className="listing-top"><span className="pill">{type === 'offers' ? 'Learning offer' : 'Community need'}</span><span className={`pill ${item.status === 'published' ? 'pill-green' : ''}`}>{item.status}</span></div><h3>{item.title}</h3><p>{item.description}</p><div className="listing-footer"><span className="muted small">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</span><div className="actions-inline">{user && !own && item.status === 'published' && <button className="button button-outline button-small" onClick={() => interest(item)}>Express interest</button>}{own && <>{item.status === 'published' && <Link className="button button-outline button-small" to={`/directory?${type === 'offers' ? 'offerId' : 'needId'}=${encodeURIComponent(item.id)}`}>Invite someone</Link>}{item.status !== 'published' && <button className="button button-primary button-small" onClick={() => updateStatus(item, 'published')}>Publish</button>}{item.status === 'published' && <button className="button button-outline button-small" onClick={() => updateStatus(item, 'draft')}>Unpublish</button>}{item.status !== 'archived' && <button className="button button-quiet button-small" onClick={() => updateStatus(item, 'archived')}>Archive</button>}</>}</div></div></article>;
    })}</div>}
  </Shell>;
}
function DirectoryPage() {
  const { user } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const offerId = params.get('offerId');
  const needId = params.get('needId');
  const listingId = offerId || needId;
  const [profiles, setProfiles] = useState([]);
  const [publicOrganizations, setPublicOrganizations] = useState([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [invited, setInvited] = useState([]);
  useEffect(() => {
    const query = new URLSearchParams(); if (role) query.set('role', role); if (search.trim()) query.set('q', search.trim());
    Promise.all([apiRequest(`/directory${query.toString() ? `?${query.toString()}` : ''}`), apiRequest('/organizations/public')])
      .then(([directoryResult, organizationResult]) => { setProfiles(directoryResult.profiles || []); setPublicOrganizations(organizationResult.organizations || []); })
      .catch((requestError) => setError(requestError.message));
  }, [search, role]);
  const invite = async (profile) => {
    if (!listingId) return;
    setError(''); setSuccess('');
    try { await apiRequest('/invitations', { method: 'POST', body: { recipientUserId: profile.userId, ...(offerId ? { offerId } : { needId }) } }); setInvited((items) => [...items, profile.userId]); setSuccess(`Invitation sent to ${profile.name}.`); }
    catch (requestError) { setError(requestError.message); }
  };
  return <Shell title="Community directory" intro="Find public profiles of verified Ullas members and community organisations.">
    <Notice error={error} success={success}/>{listingId && <div className="panel"><p>Choose someone to invite to your {offerId ? 'offer' : 'community need'}. Invitations can only be sent by the owner of that listing.</p><Link className="text-link" to={offerId ? '/offers' : '/needs'}>Return to listings</Link></div>}
    <div className="filter-row"><label className="search-field">Search people and organisations<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, city, skills or organisation"/></label><label className="search-field">Member type<select value={role} onChange={(event) => setRole(event.target.value)}><option value="">All types</option><option value="professional">Professionals / mentors</option><option value="organization">Organisations</option><option value="user">Community members</option></select></label></div>
    {profiles.filter((profile) => profile.userId !== user?.id).length === 0 && publicOrganizations.filter((org) => `${org.name} ${org.description || ''} ${org.slug}`.toLowerCase().includes(search.toLowerCase())).length === 0 ? <div className="empty-state"><h3>No public profiles or verified organisations found</h3><p className="muted">Members appear after they publish a public profile. Organisations appear after their verification is approved.</p></div> : <>
      {profiles.filter((profile) => profile.userId !== user?.id).length > 0 && <><h2 className="subsection-title">Community members</h2><div className="listing-grid">{profiles.filter((profile) => profile.userId !== user?.id).map((profile) => <article className="listing-card" key={profile.userId}><div className="listing-top"><span className="pill">{profile.role}</span><span className={`pill ${profile.verificationStatus === 'approved' ? 'pill-green' : ''}`}>{profile.verificationStatus === 'approved' ? 'Verified profile' : 'Profile'}</span></div><h3>{profile.name}</h3><p>{profile.bio || 'This member has not added a bio yet.'}</p><div className="listing-footer"><span className="muted small">{[profile.city, profile.organization].filter(Boolean).join(' · ') || 'Ullas community member'}</span>{listingId && user && (invited.includes(profile.userId) ? <span className="pill pill-green">Invited</span> : <button className="button button-primary button-small" onClick={() => invite(profile)}>Send invitation</button>)}</div></article>)}</div></>}
      {publicOrganizations.filter((org) => `${org.name} ${org.description || ''} ${org.slug}`.toLowerCase().includes(search.toLowerCase())).length > 0 && <><h2 className="subsection-title top-gap">Verified organisations</h2><div className="listing-grid">{publicOrganizations.filter((org) => `${org.name} ${org.description || ''} ${org.slug}`.toLowerCase().includes(search.toLowerCase())).map((org) => <article className="listing-card" key={org.id}><div className="listing-top"><span className="pill">Organisation</span><span className="pill pill-green">Verified</span></div><h3>{org.name}</h3><p>{org.description || 'Verified Ullas community organisation.'}</p><div className="listing-footer"><span className="muted small">/{org.slug}</span>{listingId && user && (invited.includes(org.userId) ? <span className="pill pill-green">Invited</span> : <button className="button button-primary button-small" onClick={() => invite({ userId: org.userId, name: org.name })}>Invite organisation</button>)}</div></article>)}</div></>}
    </>}
    {!user && listingId && <p className="muted small top-gap">Sign in as the owner of this listing to send invitations.</p>}
  </Shell>;
}
function ProfilePage() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: user.name || '', bio: '', city: '', organization: '', visibility: 'public' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiRequest(`/profiles/${user.id}`).then(({ profile }) => setForm({ name: profile.name || user.name || '', bio: profile.bio || '', city: profile.city || '', organization: profile.organization || '', visibility: profile.visibility || 'public' })).catch(() => {});
  }, [user.id]);
  const update = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  const submit = async (event) => {
    event.preventDefault(); setError(''); setSuccess(''); setBusy(true);
    try { await apiRequest(`/profiles/${user.id}`, { method: 'PUT', body: form }); setSuccess('Profile saved.'); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  return <Shell title="Your profile" intro="Share the information that helps people find and work with you.">
    <div className="panel"><Notice error={error} success={success}/><form className="form-stack" onSubmit={submit}>
      <label>Display name<input required name="name" minLength="2" maxLength="100" value={form.name} onChange={update}/></label>
      <label>About you<textarea name="bio" rows="4" maxLength="500" value={form.bio} onChange={update} placeholder="Skills, experience, interests…"/></label>
      <div className="form-row"><label>City<input name="city" maxLength="100" value={form.city} onChange={update}/></label><label>Organisation / affiliation<input name="organization" maxLength="150" value={form.organization} onChange={update}/></label></div>
      <label>Profile visibility<select name="visibility" value={form.visibility} onChange={update}><option value="public">Public</option><option value="private">Private</option></select></label>
      <button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
    </form></div>
    <div className="panel subtle-panel"><h3>Account status</h3><p className="muted small">{user.email} · {user.verified ? 'Email verified' : 'Email not verified'} · Role: {user.role}</p><p className="muted small">Public profiles appear in the community directory. Keep your profile private to hide it from directory searches.</p><VerificationRequestButton type="profile"/></div>
  </Shell>;
}
function OrganizationsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: '', slug: '', description: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => apiRequest('/organizations').then((result) => setItems(result.organizations || [])).catch((requestError) => setError(requestError.message));
  useEffect(() => { if (['organization', 'admin'].includes(user.role)) load(); }, [user.role]);
  const submit = async (event) => {
    event.preventDefault(); setError(''); setSuccess(''); setBusy(true);
    try { const result = await apiRequest('/organizations', { method: 'POST', body: form }); setItems((items) => [result.organization, ...items]); setForm({ name: '', slug: '', description: '' }); setSuccess('Organisation created. Submit a verification request when ready.'); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  if (!['organization', 'admin'].includes(user.role)) return <Shell title="Organization access" intro="Organization tools are reserved for organization accounts."><p className="muted">This account is registered as {user.role}. An administrator can update account categories if needed.</p></Shell>;
  return <Shell title="Organisations" intro="Create and manage the schools, colleges, NGOs and community groups you represent.">
    <Notice error={error} success={success}/><div className="two-column"><div className="panel"><h2>Create an organisation</h2><form className="form-stack form-top" onSubmit={submit}>
      <label>Organisation name<input required minLength="2" maxLength="120" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>
      <label>Unique URL slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="community-learning-hub"/></label>
      <label>Description<textarea rows="3" maxLength="2000" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}/></label>
      <button className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create organisation'}</button>
    </form></div><div><h2 className="subsection-title">Your organisations</h2>{items.length === 0 ? <div className="empty-state small-empty"><p className="muted">You have not created any organisations yet.</p></div> : items.map((item) => <article key={item.id} className="listing-card org-card"><div className="listing-top"><span className="pill">Organisation</span><span className={`pill ${item.verification_status === 'approved' ? 'pill-green' : ''}`}>{item.verification_status}</span></div><h3>{item.name}</h3><p>{item.description || 'No description added yet.'}</p><span className="muted small">/{item.slug}</span>{item.verification_status !== 'approved' && <div className="top-gap"><VerificationRequestButton type="organization" organizationId={item.id}/></div>}</article>)}</div></div>
  </Shell>;
}
function toLocalInput(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
}
function BookingsPage() {
  const { user } = useAuth();
  const [offers, setOffers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [providerWindows, setProviderWindows] = useState([]);
  const [form, setForm] = useState({ offerId: '', start: '', end: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const [offerResult, bookingResult, feedbackResult] = await Promise.all([apiRequest('/offers'), apiRequest('/bookings'), apiRequest('/feedback')]);
      setOffers(offerResult.offers || []); setBookings(bookingResult.bookings || []); setFeedback(feedbackResult.feedback || []);
    } catch (requestError) { setError(requestError.message); }
  };
  useEffect(() => { load(); }, [user.id]);
  useEffect(() => {
    if (!form.offerId) { setProviderWindows([]); return; }
    apiRequest(`/availability/offer/${form.offerId}`).then((result) => setProviderWindows(result.availability || [])).catch((requestError) => { setProviderWindows([]); setError(requestError.message); });
  }, [form.offerId]);
  const submit = async (event) => {
    event.preventDefault(); setError(''); setSuccess(''); setBusy(true);
    try {
      await apiRequest('/bookings', { method: 'POST', body: { offerId: form.offerId, slotStart: new Date(form.start).toISOString(), slotEnd: new Date(form.end).toISOString() } });
      setSuccess('Booking request submitted.'); setForm({ offerId: form.offerId, start: '', end: '' }); await load();
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const transition = async (booking, status) => {
    try { await apiRequest(`/bookings/${booking.id}`, { method: 'PATCH', body: { status } }); setSuccess(`Booking ${status}.`); setError(''); await load(); }
    catch (requestError) { setError(requestError.message); }
  };
  const setWindow = (window) => setForm({ ...form, start: toLocalInput(window.starts_at || window.startsAt), end: toLocalInput(window.ends_at || window.endsAt) });
  const managesAvailability = ['professional', 'organization', 'admin'].includes(user.role);
  return <Shell title="Bookings" intro="Request a session, manage availability, and keep track of the commitments you make.">
    <Notice error={error} success={success}/>
    {managesAvailability && <AvailabilityManager onChanged={load}/>}
    <div className="two-column"><div className="panel"><h2>Request a session</h2>{offers.length === 0 ? <p className="muted">No published offers are available yet.</p> : <form className="form-stack form-top" onSubmit={submit}>
      <label>Learning offer<select required value={form.offerId} onChange={(event) => setForm({ offerId: event.target.value, start: '', end: '' })}><option value="">Choose an offer</option>{offers.filter((offer) => offer.userId !== user.id).map((offer) => <option key={offer.id} value={offer.id}>{offer.title}</option>)}</select></label>
      {form.offerId && <div className="availability-picker"><strong>Provider availability</strong>{providerWindows.length === 0 ? <p className="muted small">The provider has not published a future availability window yet.</p> : <div className="activity-list">{providerWindows.map((window) => <button type="button" key={window.id} className="button button-outline button-small" onClick={() => setWindow(window)}>{new Date(window.starts_at || window.startsAt).toLocaleString()} – {new Date(window.ends_at || window.endsAt).toLocaleString()} · Use this window</button>)}</div>}</div>}
      <label>Start date and time<input required type="datetime-local" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })}/></label>
      <label>End date and time<input required type="datetime-local" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })}/></label>
      <p className="muted small">Your requested time must fit entirely within one of the provider's availability windows.</p>
      <button className="button button-primary" disabled={busy || !providerWindows.length}>{busy ? 'Submitting…' : 'Request booking'}</button>
    </form>}</div>
    <div><h2 className="subsection-title">Your bookings</h2>{bookings.length === 0 ? <div className="empty-state small-empty"><p className="muted">No bookings yet.</p></div> : <div className="stack-cards">{bookings.map((booking) => {
      const isParticipant = booking.userId === user.id || booking.offerOwnerId === user.id;
      const hasFeedback = feedback.some((item) => item.bookingId === booking.id);
      return <article className="listing-card" key={booking.id}><div className="listing-top"><span className="pill">{booking.status}</span><span className="muted small">{new Date(booking.slotStart || booking.slot_start).toLocaleString()}</span></div><h3>{booking.offerTitle || offers.find((offer) => offer.id === booking.offerId)?.title || 'Learning session'}</h3><p className="muted small">Ends {new Date(booking.slotEnd || booking.slot_end).toLocaleString()}</p><div className="listing-footer">{booking.status === 'requested' && booking.userId === user.id && <button className="button button-outline button-small" onClick={() => transition(booking, 'cancelled')}>Cancel request</button>}{booking.status === 'accepted' && booking.userId === user.id && <button className="button button-outline button-small" onClick={() => transition(booking, 'cancelled')}>Cancel booking</button>}{booking.status === 'requested' && booking.offerOwnerId === user.id && <><button className="button button-primary button-small" onClick={() => transition(booking, 'accepted')}>Accept</button><button className="button button-outline button-small" onClick={() => transition(booking, 'declined')}>Decline</button></>}{booking.status === 'accepted' && booking.offerOwnerId === user.id && <button className="button button-outline button-small" onClick={() => transition(booking, 'completed')}>Mark completed</button>}</div>{booking.status === 'completed' && isParticipant && (hasFeedback ? <p className="muted small top-gap">Thank you — feedback submitted for this session.</p> : <FeedbackForm bookingId={booking.id} onSaved={load}/>)}{['requested','accepted'].includes(booking.status) && isParticipant && <BookingRescheduleForm booking={booking} onSaved={load} onError={setError} onSuccess={setSuccess}/>}</article>;
    })}</div>}</div></div>
  </Shell>;
}
function AvailabilityManager({ onChanged }) {
  const [windows, setWindows] = useState([]);
  const [form, setForm] = useState({ start: '', end: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => apiRequest('/availability').then((result) => setWindows(result.availability || [])).catch((requestError) => setError(requestError.message));
  useEffect(() => { load(); }, []);
  const add = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await apiRequest('/availability', { method: 'POST', body: { starts_at: new Date(form.start).toISOString(), ends_at: new Date(form.end).toISOString() } }); setForm({ start: '', end: '' }); await load(); onChanged(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  const remove = async (window) => {
    setError('');
    try { await apiRequest(`/availability/${window.id}`, { method: 'DELETE' }); await load(); onChanged(); }
    catch (requestError) { setError(requestError.message); }
  };
  return <div className="panel top-gap"><h2>Manage your availability</h2><p className="muted small">Published windows tell others when a session can be booked. Windows cannot overlap or be deleted while an active booking depends on them.</p><Notice error={error}/><form className="form-row form-stack form-top" onSubmit={add}><label>Starts<input required type="datetime-local" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })}/></label><label>Ends<input required type="datetime-local" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })}/></label><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Add availability'}</button></form>{windows.length > 0 && <div className="activity-list top-gap">{windows.map((window) => <div className="notification-row" key={window.id}><p>{new Date(window.starts_at || window.startsAt).toLocaleString()} – {new Date(window.ends_at || window.endsAt).toLocaleString()}</p><button className="button button-quiet button-small" onClick={() => remove(window)}>Delete</button></div>)}</div>}</div>;
}
function FeedbackForm({ bookingId, onSaved }) {
  const [score, setScore] = useState('5');
  const [comments, setComments] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { await apiRequest('/feedback', { method: 'POST', body: { bookingId, score: Number(score), comments } }); onSaved(); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };
  return <form className="form-stack form-top" onSubmit={submit}><h4>Share feedback for this completed session</h4><Notice error={error}/><label>Rating<select value={score} onChange={(event) => setScore(event.target.value)}>{[5,4,3,2,1].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label><label>Comment (optional)<textarea rows="2" maxLength="500" value={comments} onChange={(event) => setComments(event.target.value)}/></label><button className="button button-outline button-small" disabled={busy}>{busy ? 'Submitting…' : 'Submit feedback'}</button></form>;
}
function BookingRescheduleForm({ booking, onSaved, onError, onSuccess }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(toLocalInput(booking.slotStart || booking.slot_start));
  const [end, setEnd] = useState(toLocalInput(booking.slotEnd || booking.slot_end));
  const [busy, setBusy] = useState(false);
  const save = async (event) => {
    event.preventDefault(); setBusy(true); onError('');
    try { await apiRequest(`/bookings/${booking.id}`, { method: 'PATCH', body: { slotStart: new Date(start).toISOString(), slotEnd: new Date(end).toISOString() } }); onSuccess('Reschedule requested.'); setOpen(false); onSaved(); }
    catch (requestError) { onError(requestError.message); }
    finally { setBusy(false); }
  };
  return <div className="top-gap"><button type="button" className="button button-quiet button-small" onClick={() => setOpen((value) => !value)}>{open ? 'Close rescheduling' : 'Reschedule'}</button>{open && <form className="form-stack form-top" onSubmit={save}><label>New start<input required type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)}/></label><label>New end<input required type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)}/></label><button className="button button-outline button-small" disabled={busy}>{busy ? 'Saving…' : 'Save new time'}</button></form>}</div>;
}
function ActivityPage() {
  const { user } = useAuth();
  const [interests, setInterests] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [verification, setVerification] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const load = async () => {
    try {
      const [interestResult, invitationResult, notificationResult, feedbackResult, verificationResult] = await Promise.all([apiRequest('/interests'), apiRequest('/invitations'), apiRequest('/notifications'), apiRequest('/feedback'), apiRequest('/verification/requests')]);
      setInterests(interestResult.interests || []); setInvitations(invitationResult.invitations || []); setNotifications(notificationResult.notifications || []); setFeedback(feedbackResult.feedback || []); setVerification(verificationResult.requests || []);
    } catch (requestError) { setError(requestError.message); }
  };
  useEffect(() => { load(); }, [user.id]);
  const markRead = async (notification) => { try { await apiRequest(`/notifications/${notification.id}/read`, { method: 'PATCH', body: {} }); await load(); } catch (requestError) { setError(requestError.message); } };
  const respond = async (kind, item, status) => {
    try { await apiRequest(`/${kind}/${item.id}`, { method: 'PATCH', body: { status } }); setSuccess(`${kind === 'interests' ? 'Interest' : 'Invitation'} ${status}.`); setError(''); await load(); }
    catch (requestError) { setError(requestError.message); }
  };
  return <Shell title="Activity" intro="Your interests, invitations, verification requests, notifications and feedback in one place.">
    <Notice error={error} success={success}/><div className="activity-grid">
      <div className="panel"><h2>Interests</h2>{interests.length === 0 ? <p className="muted small">No interests yet.</p> : interests.map((item) => <div className="activity-item" key={item.id}><strong>{item.offerId ? 'Offer interest' : 'Need interest'}{item.listingTitle ? ` · ${item.listingTitle}` : ''}</strong><span className="pill">{item.status}</span>{item.status === 'pending' && item.listingOwnerId === user.id && <div className="actions-inline"><button className="button button-primary button-small" onClick={() => respond('interests', item, 'accepted')}>Accept</button><button className="button button-outline button-small" onClick={() => respond('interests', item, 'declined')}>Decline</button></div>}</div>)}</div>
      <div className="panel"><h2>Invitations</h2>{invitations.length === 0 ? <p className="muted small">No invitations yet.</p> : invitations.map((item) => <div className="activity-item" key={item.id}><strong>{item.offerId ? 'Offer invitation' : 'Need invitation'}</strong><span className="pill">{item.status}</span><small className="muted">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</small>{item.status === 'pending' && item.recipientUserId === user.id && <div className="actions-inline"><button className="button button-primary button-small" onClick={() => respond('invitations', item, 'accepted')}>Accept</button><button className="button button-outline button-small" onClick={() => respond('invitations', item, 'declined')}>Decline</button></div>}</div>)}</div>
      <div className="panel"><h2>Notifications</h2>{notifications.length === 0 ? <p className="muted small">No notifications.</p> : notifications.map((notification) => <div className="notification-row" key={notification.id}><div><p>{notification.message}</p><small className="muted">{notification.read ? 'Read' : 'Unread'}</small></div>{!notification.read && <button className="button button-quiet button-small" onClick={() => markRead(notification)}>Mark read</button>}</div>)}</div>
      <ActivityList title="Feedback you submitted" items={feedback} empty="No feedback yet." render={(item) => <><strong>{item.score}/5</strong><span>{item.comments || 'No written comment.'}</span></>}/>
      <div className="panel"><h2>Verification requests</h2>{verification.length === 0 ? <p className="muted small">No requests yet. You can submit one from your profile or organisation page.</p> : verification.map((item) => <div className="activity-item" key={item.id}><strong>{item.type} verification</strong><span className="pill">{item.status}</span>{item.notes && <small className="muted">{item.notes}</small>}</div>)}</div>
    </div>
  </Shell>;
}
function ActivityList({ title, items, empty, render }) {
  return <div className="panel"><h2>{title}</h2>{items.length === 0 ? <p className="muted small">{empty}</p> : <div className="activity-list">{items.map((item) => <div key={item.id} className="activity-item">{render(item)}</div>)}</div>}</div>;
}
function VerificationRequestButton({ type, organizationId }) {
  const [state, setState] = useState({ busy: false, error: '', success: '' });
  const submit = async () => {
    setState({ busy: true, error: '', success: '' });
    try {
      await apiRequest('/verification/requests', { method: 'POST', body: { type, ...(organizationId ? { organizationId } : {}) } });
      setState({ busy: false, error: '', success: 'Verification request submitted. You can track its status in Activity.' });
    } catch (error) { setState({ busy: false, error: error.message, success: '' }); }
  };
  return <div className="top-gap"><button className="button button-outline button-small" disabled={state.busy} onClick={submit}>{state.busy ? 'Submitting…' : `Request ${type} verification`}</button><Notice error={state.error} success={state.success}/></div>;
}
function AdminPage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [requests, setRequests] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [roleDrafts, setRoleDrafts] = useState({});
  const [statusDrafts, setStatusDrafts] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const load = async () => {
    try {
      const result = await apiRequest('/verification/requests');
      setRequests(result.requests || []);
      if (user.role === 'admin') {
        const [overviewResult, accountResult] = await Promise.all([apiRequest('/admin/overview'), apiRequest('/admin/users')]);
        setOverview(overviewResult);
        setAccounts(accountResult.users || []);
        setRoleDrafts(Object.fromEntries((accountResult.users || []).map((account) => [account.id, account.role])));
        setStatusDrafts(Object.fromEntries((accountResult.users || []).map((account) => [account.id, account.status || 'active'])));
      }
    } catch (requestError) { setError(requestError.message); }
  };
  useEffect(() => { load(); }, [user.role]);
  const review = async (request, status) => {
    try { await apiRequest(`/verification/requests/${request.id}`, { method: 'PATCH', body: { status } }); setSuccess(`Request ${status}.`); setError(''); await load(); }
    catch (requestError) { setError(requestError.message); }
  };
  const saveAccount = async (account) => {
    try {
      await apiRequest(`/admin/users/${account.id}/role`, { method: 'PATCH', body: { role: roleDrafts[account.id] || account.role, status: statusDrafts[account.id] || account.status || 'active' } });
      setSuccess(`Saved access settings for ${account.email}.`); setError(''); await load();
    } catch (requestError) { setError(requestError.message); }
  };
  return <Shell title={user.role === 'admin' ? 'Administration' : 'Verification review'} intro="Review verification submissions and monitor Ullas where your role permits.">
    <Notice error={error} success={success}/>{overview && <div className="stats-grid"><Stat label="Users" value={overview.stats.users ?? 0} detail="Registered accounts"/><Stat label="Pending verification" value={overview.stats.pendingVerifications ?? 0} detail="Awaiting review"/><Stat label="Pending bookings" value={overview.stats.pendingBookings ?? 0} detail="Requested sessions"/></div>}
    {user.role === 'admin' && <div className="panel top-gap"><h2>Accounts and access</h2><p className="muted small">Role changes and suspensions are checked by the server and recorded in the audit log.</p>{accounts.length === 0 ? <p className="muted">No accounts found.</p> : <div className="account-admin-list">{accounts.map((account) => <article key={account.id} className="account-admin-row"><div><strong>{account.name || 'User'}</strong><p className="muted small">{account.email}</p><span className="pill">{account.verified ? 'Email verified' : 'Email unverified'}</span></div><label>Role<select value={roleDrafts[account.id] || account.role} onChange={(event) => setRoleDrafts({ ...roleDrafts, [account.id]: event.target.value })}><option value="user">User</option><option value="professional">Professional</option><option value="organization">Organization</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select></label><label>Status<select value={statusDrafts[account.id] || account.status || 'active'} onChange={(event) => setStatusDrafts({ ...statusDrafts, [account.id]: event.target.value })}><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option></select></label><button className="button button-outline button-small" onClick={() => saveAccount(account)}>Save</button></article>)}</div>}</div>}
    <div className="panel top-gap"><h2>Verification queue</h2>{requests.filter((request) => request.status === 'pending').length === 0 ? <p className="muted">No pending verification requests.</p> : requests.filter((request) => request.status === 'pending').map((request) => <div className="review-row" key={request.id}><div><strong>{request.type} verification</strong><p className="muted small">Submitted {request.createdAt ? new Date(request.createdAt).toLocaleString() : ''}</p>{request.notes && <p>{request.notes}</p>}</div><div className="actions-inline"><button className="button button-primary button-small" onClick={() => review(request, 'approved')}>Approve</button><button className="button button-outline button-small" onClick={() => review(request, 'rejected')}>Reject</button></div></div>)}</div>
  </Shell>;
}
function NotFound(){return <Shell title="Page not found" intro="This page is not part of the current Ullas application."><Link className="button button-primary" to="/">Return home</Link></Shell>;}

export default function App(){return <BrowserRouter><AuthProvider><AppLayout/></AuthProvider></BrowserRouter>;}
