import { useState, useEffect } from 'react';
import { BrowserRouter, useSearchParams } from 'react-router-dom';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { Settings, X, Copy, Plus, Trash2, Power } from 'lucide-react';

const API_BASE = 'http://localhost:3000/api';

function AppContent() {
  const [searchParams] = useSearchParams();
  const setupToken = searchParams.get('setup');

  const [isFirstBoot, setIsFirstBoot] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    // Check boot status
    fetch(`${API_BASE}/auth/status`)
      .then(r => r.json())
      .then(data => {
        setIsFirstBoot(data.isFirstBoot);
        if (!data.isFirstBoot && !setupToken) {
          // check if already logged in
          fetch(`${API_BASE}/admin/users`, { credentials: 'include' })
            .then(r => {
              if (r.ok) setIsAuthenticated(true);
              setLoading(false);
            })
            .catch(() => setLoading(false));
        } else {
          setLoading(false);
        }
      });
  }, [setupToken]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-rebel-blue">INITIALIZING SYSTEM...</div>;

  if (setupToken) {
    return <SetupScreen setupToken={setupToken} onComplete={() => window.location.href = '/'} />;
  }

  if (isFirstBoot) {
    return <FirstBootScreen onComplete={() => window.location.href = '/'} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen p-8 flex flex-col items-center relative">
      <header className="w-full max-w-5xl flex justify-between items-center mb-12 border-b border-rebel-blue/30 pb-4">
        <h1 className="text-3xl font-bold text-rebel-blue tracking-widest drop-shadow-[0_0_8px_rgba(0,212,255,0.8)] flex items-center gap-4">
          [ ROGUE ONE :: APP CENTER ]
        </h1>
        <div className="flex gap-4 items-center">
          <button onClick={() => setAdminOpen(true)} className="btn-primary p-2 flex items-center justify-center" title="Admin Settings">
            <Settings size={20} />
          </button>
          <span className="text-sm text-hud-gray animate-pulse">SYSTEM_ONLINE</span>
          <button onClick={() => {
            fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).then(() => window.location.reload());
          }} className="btn-danger p-2 flex items-center justify-center">
            <Power size={20} />
          </button>
        </div>
      </header>

      <main className="w-full max-w-5xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <DeploymentModule />
          <AppListMock />
        </div>
      </main>

      <footer className="mt-auto pt-16 pb-4 w-full flex justify-between text-[10px] text-gray-600 font-mono tracking-widest">
        <span>ROGUE ONE INITIATIVE © 2026</span>
        <span>SECURE SHARD: 0x9F41C</span>
      </footer>

      {adminOpen && <AdminModal onClose={() => setAdminOpen(false)} />}
    </div>
  );
}

// ==== SCREENS ====

function FirstBootScreen({ onComplete }) {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('admin');
  const [error, setError] = useState('');

  const handleSetup = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/auth/generate-registration-options`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken: token, username })
      });
      if (!res.ok) throw new Error('Invalid token or setup failed');
      const { options, userId } = await res.json();

      const attResp = await startRegistration(options);

      const vRes = await fetch(`${API_BASE}/auth/verify-registration`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, body: attResp })
      });
      if (!vRes.ok) throw new Error('Verification failed');
      onComplete();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="cockpit-panel p-8 max-w-md w-full relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-2 bg-[repeating-linear-gradient(45deg,#ff003c,#ff003c_10px,transparent_10px,transparent_20px)] opacity-50"></div>
        <h2 className="text-xl font-bold text-empire-red mb-2 mt-2 tracking-widest">{'>>'} CRITICAL: FIRST BOOT</h2>
        <p className="text-xs text-gray-400 mb-6">REGISTER BIOMETRICS FOR ROOT ADMIN.</p>
        {error && <div className="text-empire-red text-xs mb-4">{error}</div>}
        <form onSubmit={handleSetup} className="flex flex-col gap-4">
          <input type="text" className="input-field" placeholder="INITIAL_SETUP_TOKEN" value={token} onChange={e => setToken(e.target.value)} required />
          <input type="text" className="input-field" placeholder="Admin Username" value={username} onChange={e => setUsername(e.target.value)} required />
          <button type="submit" className="btn-primary w-full mt-4">ENROLL PASSKEY</button>
        </form>
      </div>
    </div>
  );
}

function SetupScreen({ setupToken, onComplete }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/auth/setup-info?token=${setupToken}`)
      .then(r => r.ok ? r.json() : Promise.reject('Invalid or expired token'))
      .then(setInfo)
      .catch(setError);
  }, [setupToken]);

  const handleSetup = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/generate-registration-options`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupToken })
      });
      if (!res.ok) throw new Error('Setup failed');
      const { options, userId } = await res.json();
      const attResp = await startRegistration(options);

      const vRes = await fetch(`${API_BASE}/auth/verify-registration`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, body: attResp })
      });
      if (!vRes.ok) throw new Error('Verification failed');
      onComplete();
    } catch (err) { setError(err.message); }
  };

  if (error) return <div className="min-h-screen flex items-center justify-center text-empire-red">{error}</div>;
  if (!info) return <div className="min-h-screen flex items-center justify-center text-rebel-blue">VERIFYING TOKEN...</div>;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="cockpit-panel p-8 max-w-md w-full text-center">
        <h2 className="text-xl font-bold text-rebel-blue mb-4">{'>>'} NEW OFFICER ENROLLMENT</h2>
        <p className="text-sm text-gray-300 mb-8">Identify as <strong className="text-white">{info.username}</strong></p>
        <button onClick={handleSetup} className="btn-primary w-full py-4 text-lg">REGISTER BIOMETRICS</button>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [error, setError] = useState('');

  const handleLogin = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/generate-authentication-options`);
      const options = await res.json();
      const asseResp = await startAuthentication(options);

      const vRes = await fetch(`${API_BASE}/auth/verify-authentication`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: asseResp })
      });
      if (!vRes.ok) throw new Error('Biometric check failed');
      onLogin();
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-space-black via-black to-black opacity-90"></div>

      <div className="cockpit-panel p-12 max-w-md w-full z-10 text-center border-empire-red/30 shadow-neon-red">
        <div className="w-20 h-20 border-2 border-empire-red mx-auto mb-6 flex justify-center items-center rotate-45 relative">
          <div className="absolute inset-2 border border-empire-red/50 -rotate-45"></div>
          <span className="text-empire-red -rotate-45 block font-bold text-3xl">!</span>
        </div>

        <h2 className="text-2xl font-bold text-empire-red mb-2 tracking-[0.3em]">RESTRICTED ACCESS</h2>
        <p className="text-xs text-gray-400 mb-12 tracking-widest">AUTHORIZED PERSONNEL ONLY</p>

        {error && <div className="text-empire-red text-xs mb-4">{error}</div>}

        <button onClick={handleLogin} className="btn-primary text-rebel-blue border-rebel-blue bg-rebel-blue/10 w-full py-4 tracking-widest hover:bg-rebel-blue/30 transition-all duration-500 shadow-neon-blue group relative overflow-hidden">
          <span className="relative z-10 group-hover:block hidden absolute inset-0 bg-rebel-blue/20 blur-md"></span>
          IDENTIFICATION BIOMÉTRIQUE
        </button>
      </div>
    </div>
  );
}

// ==== DASHBOARD WIDGETS ====

function DeploymentModule() {
  const [appName, setAppName] = useState('');
  const [file, setFile] = useState(null);
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');

  const doDeploy = async () => {
    if (!file || !appName || !token) return setStatus('MISSING PARAMS');
    setStatus('DEPLOYING...');
    const fd = new FormData();
    fd.append('bundle', file);
    try {
      const res = await fetch(`${API_BASE}/deploy/${appName}`, {
        method: 'POST', headers: { 'x-deploy-token': token }, body: fd
      });
      setStatus(res.ok ? 'SUCCESS' : 'DEPLOY FAILED');
    } catch (e) { setStatus('ERROR'); }
  };

  return (
    <div className="cockpit-panel p-6 col-span-1 md:col-span-2 lg:col-span-3 border-rebel-blue/30">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-lg font-bold text-rebel-blue tracking-widest">{'>>'} DEPLOYMENT_MODULE</h2>
          <p className="text-xs text-indicator">{status || 'Awaiting incoming payload...'}</p>
        </div>
        <div className="w-16 h-16 border border-rebel-blue/20 flex flex-col justify-center items-center relative">
          <span className="text-[10px] text-rebel-blue animate-pulse">RADAR</span>
        </div>
      </div>
      <div className="flex flex-col md:flex-row gap-4 items-center">
        <div className="flex-1 border border-dashed border-hud-gray bg-black/20 h-24 flex items-center justify-center text-sm text-gray-500 hover:border-rebel-blue/50 hover:text-rebel-blue cursor-pointer px-4 text-center relative w-full">
          <input type="file" onChange={e => setFile(e.target.files[0])} accept=".zip" className="absolute inset-0 opacity-0 cursor-pointer" />
          {file ? `[ ${file.name} ]` : '[ UPLOAD ZIP PAYLOAD ]'}
        </div>
        <div className="flex flex-col gap-2 w-full md:w-48">
          <input type="text" value={appName} onChange={e => setAppName(e.target.value)} className="input-field text-xs py-2" placeholder="APP_ID (e.g. comms)" />
          <input type="text" value={token} onChange={e => setToken(e.target.value)} className="input-field text-xs py-2" placeholder="DEPLOY_TOKEN" />
          <button onClick={doDeploy} className="btn-primary text-xs w-full py-2">INITIATE DEPLOY</button>
        </div>
      </div>
    </div>
  );
}

function AppListMock() {
  return (
    <div className="cockpit-panel p-6">
      <h3 className="text-sm font-bold text-white mb-4">{'>>'} TARGET: COMMS_HUB</h3>
      <div className="flex flex-col gap-2 text-xs text-gray-400 mb-4">
        <div className="flex justify-between"><span>STATUS:</span><span className="text-rebel-blue">ONLINE</span></div>
        <div className="flex justify-between"><span>PATH:</span><span>/apps/comms_hub</span></div>
      </div>
      <button className="btn-primary text-xs w-full">LAUNCH PROTOCOL</button>
    </div>
  );
}

// ==== ADMIN MODAL ====

function AdminModal({ onClose }) {
  const [users, setUsers] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [newUsername, setNewUsername] = useState('');

  const loadData = () => {
    fetch(`${API_BASE}/admin/users`, { credentials: 'include' }).then(r => r.json()).then(setUsers);
    fetch(`${API_BASE}/admin/tokens`, { credentials: 'include' }).then(r => r.json()).then(setTokens);
  };

  useEffect(() => { loadData(); }, []);

  const addUser = async (e) => {
    e.preventDefault();
    if (!newUsername) return;
    await fetch(`${API_BASE}/admin/users`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username: newUsername })
    });
    setNewUsername('');
    loadData();
  };

  const removeUser = async (id) => {
    await fetch(`${API_BASE}/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
    loadData();
  };

  const genToken = async () => {
    await fetch(`${API_BASE}/admin/tokens`, { method: 'POST', credentials: 'include' });
    loadData();
  };
  const removeToken = async (id) => {
    await fetch(`${API_BASE}/admin/tokens/${id}`, { method: 'DELETE', credentials: 'include' });
    loadData();
  };

  const getSetupUrl = (setupToken) => `${window.location.origin}?setup=${setupToken}`;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-end p-4">
      <div className="cockpit-panel h-full w-full max-w-md bg-hud-gray/90 flex flex-col pt-8 pb-4 px-6 overflow-y-auto animate-slide-in">
        <div className="flex justify-between items-center mb-8 border-b border-rebel-blue/30 pb-4">
          <h2 className="text-xl font-bold text-rebel-blue tracking-widest flex items-center gap-2">
            <Settings size={20} /> DIAGNOSTICS & CREW
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X size={24} /></button>
        </div>

        {/* Users Panel */}
        <div className="mb-8">
          <h3 className="text-sm font-bold text-white mb-4 border-l-2 border-rebel-blue pl-2">BETA-TESTERS</h3>
          <form onSubmit={addUser} className="flex gap-2 mb-4">
            <input type="text" className="input-field text-xs" placeholder="New Officer Name..." value={newUsername} onChange={e => setNewUsername(e.target.value)} />
            <button type="submit" className="btn-primary px-3"><Plus size={16} /></button>
          </form>
          <div className="flex flex-col gap-2">
            {users.map(u => (
              <div key={u.id} className="bg-black/40 border border-hud-gray p-3 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="text-rebel-blue font-bold text-sm uppercase">{u.username}</span>
                  <button onClick={() => removeUser(u.id)} className="text-empire-red hover:bg-empire-red/20 p-1"><Trash2 size={16} /></button>
                </div>
                {u.setupToken && (
                  <div className="flex items-center gap-2 mt-2">
                    <input type="text" className="input-field text-[10px] py-1 bg-black/80 text-gray-500" value={getSetupUrl(u.setupToken)} readOnly />
                    <button onClick={() => navigator.clipboard.writeText(getSetupUrl(u.setupToken))} className="btn-primary py-1 px-2"><Copy size={12} /></button>
                  </div>
                )}
                {!u.setupToken && <span className="text-[10px] text-green-500 animate-pulse">BIOMETRICS ENROLLED</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Tokens Panel */}
        <div>
          <h3 className="text-sm font-bold text-white mb-4 border-l-2 border-empire-red pl-2">DEPLOYMENT TOKENS</h3>
          <button onClick={genToken} className="btn-primary w-full flex justify-center items-center gap-2 mb-4 py-2 text-xs">
            <Plus size={16} /> GENERATE CIPHER
          </button>
          <div className="flex flex-col gap-2">
            {tokens.map(t => (
              <div key={t.id} className="bg-black/40 border border-hud-gray p-3 flex justify-between items-center gap-2">
                <div className="flex flex-col overflow-hidden max-w-[80%]">
                  <span className="text-[10px] text-gray-500">{new Date(t.created_at).toLocaleDateString()}</span>
                  <span className="text-xs text-empire-red truncate font-mono">{t.token}</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => navigator.clipboard.writeText(t.token)} className="text-rebel-blue hover:bg-rebel-blue/20 p-1"><Copy size={14} /></button>
                  <button onClick={() => removeToken(t.id)} className="text-empire-red hover:bg-empire-red/20 p-1"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
