import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

// Config
import { API_BASE } from './config/constants';

// Layout
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';

// Auth
import FirstBootScreen from './components/auth/FirstBootScreen';
import SetupScreen from './components/auth/SetupScreen';
import LoginScreen from './components/auth/LoginScreen';

// Dashboard
import DeploymentModule from './components/dashboard/DeploymentModule';
import AppShard from './components/dashboard/AppShard';
import InfraMonitor from './components/dashboard/InfraMonitor';

// Admin
import AdminModal from './components/admin/AdminModal';

function Dashboard({ user, shards, fetchShards, setAdminOpen }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('SHARDS');

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center relative selection:bg-[#00d4ff]/30 w-full">
      <Header user={user} onAdminOpen={() => setAdminOpen(true)} />

      <main className="w-full max-w-6xl flex flex-col gap-6 flex-1">
        {user?.role === 'administrator' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}
            className="lg:col-span-12"
          >
            <DeploymentModule onSuccess={fetchShards} />
          </motion.div>
        )}

        {/* TABS NAVIGATION */}
        <div className="flex gap-4 border-b border-cyan-dark/50 pb-2 mt-4">
          <button 
            onClick={() => setActiveTab('SHARDS')}
            className={`text-[10px] sm:text-xs tracking-widest font-bold px-4 py-2 transition-colors uppercase ${activeTab === 'SHARDS' ? 'text-[#00d4ff] bg-[#00d4ff]/10 border border-[#00d4ff]/50' : 'text-gray-500 hover:text-[#00d4ff]/70 border border-transparent'}`}
          >
            ACTIVE DATA SHARDS
          </button>
          {user?.role === 'administrator' && (
            <button 
              onClick={() => setActiveTab('INFRA')}
              className={`text-[10px] sm:text-xs tracking-widest font-bold px-4 py-2 transition-colors uppercase ${activeTab === 'INFRA' ? 'text-[#00d4ff] bg-[#00d4ff]/10 border border-[#00d4ff]/50' : 'text-gray-500 hover:text-[#00d4ff]/70 border border-transparent'}`}
            >
              INFRASTRUCTURE
            </button>
          )}
        </div>

        {activeTab === 'SHARDS' ? (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, staggerChildren: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {shards.map(shard => (
              <AppShard 
                key={shard.id} 
                shard={shard} 
                onAccess={(s) => {
                  const protocol = window.location.protocol;
                  const hostname = window.location.hostname;
                  const port = window.location.port === '5173' ? ':3000' : (window.location.port ? `:${window.location.port}` : '');
                  
                  if (hostname.includes('localhost') || hostname === '127.0.0.1') {
                      window.location.href = `${protocol}//${s.slug}.localhost${port}/`;
                  } else if (hostname.includes('rogue-one.cloud')) {
                      window.location.href = `${protocol}//${s.slug}.rogue-one.cloud${port}/`;
                  } else {
                      window.location.href = `${protocol}//${s.slug}.${hostname}${port}/`;
                  }
                }} 
                onUpdate={fetchShards}
                onDelete={fetchShards}
              />
            ))}
            {shards.length === 0 && (
              <div className="col-span-full border-2 border-dashed border-cyan-dark/30 p-12 text-center text-gray-500 font-mono text-sm tracking-widest">
                NO ACTIVE SHARDS DETECTED. INITIALIZE NEW UPLINK.
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
             <InfraMonitor />
          </motion.div>
        )}
      </main>

      <Footer />
    </div>
  );
}



function AppContent() {
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get('token');

  const [needsSetup, setNeedsSetup] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);
  const [shards, setShards] = useState([]);
  const [shardsLoading, setShardsLoading] = useState(false);

  const fetchShards = () => {
    setShardsLoading(true);
    fetch(`${API_BASE}/shards`, { credentials: 'include' })
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          setShards(res.data);
        }
        setShardsLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch shards:', err);
        setShardsLoading(false);
      });
  };

  useEffect(() => {
    fetch(`${API_BASE}/auth/status`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setNeedsSetup(data.needsSetup);
        if (data.isAuthenticated) {
          setIsAuthenticated(true);
          setUser(data.user);
          fetchShards();
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [invitationToken]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#00d4ff] text-xl tracking-widest animate-pulse font-mono">INITIALIZING STARDUST LINK...</div>;

  if (invitationToken) {
    return <SetupScreen setupToken={invitationToken} onComplete={() => window.location.href = '/'} />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={
          isAuthenticated ? (
            <Dashboard 
              user={user} 
              shards={shards} 
              fetchShards={fetchShards} 
              setAdminOpen={setAdminOpen} 
            />
          ) : (
            <LoginScreen needsSetup={needsSetup} onLogin={() => window.location.reload()} />
          )
        } />
        <Route path="/login" element={
          <LoginScreen needsSetup={needsSetup} onLogin={() => window.location.reload()} />
        } />
      </Routes>

      <AnimatePresence>
        {adminOpen && <AdminModal onClose={() => setAdminOpen(false)} currentUser={user} />}
      </AnimatePresence>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
