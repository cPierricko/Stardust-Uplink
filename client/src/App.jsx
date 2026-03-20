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

// Admin
import AdminModal from './components/admin/AdminModal';

function Dashboard({ user, shards, fetchShards, setAdminOpen }) {
  const navigate = useNavigate();

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

        <h3 className="text-sm font-bold text-[#00d4ff] tracking-widest mt-6 border-b border-cyan-dark pb-2 w-max">ACTIVE DATA SHARDS</h3>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, staggerChildren: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {shards.map(shard => (
            <AppShard 
              key={shard.id} 
              shard={shard} 
              onAccess={(s) => navigate(`/${s.slug}`)} 
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
      </main>

      <Footer />
    </div>
  );
}

function ShardViewer({ shards, loading }) {
  const { slug } = useParams();
  const shard = shards.find(s => s.slug === slug);

  if (!shard) {
    if (loading) {
      return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center text-[#00d4ff] font-mono tracking-[0.2em] p-4 text-center">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-[#00d4ff] animate-ping" />
            <div>ESTABLISHING_SECURE_UPLINK...</div>
          </div>
          <div className="text-[10px] text-cyan-900 mt-4 animate-pulse">PATH: /mnt/{slug}</div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-red-500 font-mono tracking-widest p-4 text-center">
        <div className="text-4xl mb-4">404</div>
        <div>UPLINK_FAILURE: SHARD_NOT_FOUND [{slug?.toUpperCase()}]</div>
        <button 
          onClick={() => window.location.href = '/'}
          className="mt-8 px-6 py-2 border border-red-500/50 hover:bg-red-500/20 transition-all text-[10px]"
        >
          RETURN_TO_STARDUST
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black overflow-hidden">
      <iframe 
        src={`${window.location.origin}/shards/${shard.slug}/`} 
        className="w-full h-full border-none"
        title={shard.name}
      />
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

  if (!isAuthenticated) {
    return <LoginScreen needsSetup={needsSetup} onLogin={() => window.location.reload()} />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={
          <Dashboard 
            user={user} 
            shards={shards} 
            fetchShards={fetchShards} 
            setAdminOpen={setAdminOpen} 
          />
        } />
        <Route path="/:slug" element={<ShardViewer shards={shards} loading={shardsLoading} />} />
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
