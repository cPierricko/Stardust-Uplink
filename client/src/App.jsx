import { useState, useEffect } from 'react';
import { BrowserRouter, useSearchParams } from 'react-router-dom';
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

function AppContent() {
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get('token');
  const deployConfigToken = searchParams.get('config');


  const [needsSetup, setNeedsSetup] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);
  const [shards, setShards] = useState([]);
  const [activeShard, setActiveShard] = useState(null);

  const fetchShards = () => {
    fetch(`${API_BASE}/shards`, { credentials: 'include' })
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          setShards(res.data);
        }
      })
      .catch(err => console.error('Failed to fetch shards:', err));
  };

  useEffect(() => {
    // Check boot status
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
  }, [invitationToken, deployConfigToken]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#00d4ff] text-xl tracking-widest animate-pulse">INITIALIZING STARDUST LINK...</div>;

  // Enrollment flow (Invitation)
  if (invitationToken) {
    return <SetupScreen setupToken={invitationToken} onComplete={() => window.location.href = '/'} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen needsSetup={needsSetup} onLogin={() => window.location.reload()} />;
  }

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center relative selection:bg-[#00d4ff]/30">
      <Header user={user} onAdminOpen={() => setAdminOpen(true)} />

      <main className="w-full max-w-6xl flex flex-col gap-6 flex-1">
        {user?.role === 'administrator' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}
            className="lg:col-span-12"
          >
            <DeploymentModule initialToken={deployConfigToken} onSuccess={fetchShards} />
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
              onAccess={() => setActiveShard(shard)} 
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

      <AnimatePresence>
        {adminOpen && <AdminModal onClose={() => setAdminOpen(false)} currentUser={user} />}
      </AnimatePresence>

      <AnimatePresence>
        {activeShard && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black flex flex-col"
          >
            <div className="h-14 bg-[#0a0f18] border-b border-[#00d4ff]/30 flex items-center justify-between px-6 z-10">
              <div className="flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-[#00d4ff] animate-pulse"></div>
                <span className="text-[#00d4ff] font-mono text-xs tracking-[0.2em]">UPLINK_ESTABLISHED: {activeShard.name.toUpperCase()}</span>
              </div>
              <button 
                onClick={() => setActiveShard(null)}
                className="group flex items-center gap-3 px-4 py-1.5 border border-red-500/50 hover:bg-red-500/20 transition-all text-red-500"
              >
                <span className="text-[10px] font-bold tracking-widest">EXIT_UPLINK</span>
                <div className="w-4 h-4 relative">
                  <div className="absolute inset-0 rotate-45 border-t-2 border-red-500"></div>
                  <div className="absolute inset-0 -rotate-45 border-t-2 border-red-500"></div>
                </div>
              </button>
            </div>
            <iframe 
              src={`${window.location.origin}/shards/${activeShard.slug}/`} 
              className="flex-1 w-full h-full border-none"
              title={activeShard.name}
            />
          </motion.div>
        )}
      </AnimatePresence>
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
