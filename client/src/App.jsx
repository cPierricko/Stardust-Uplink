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


  const [isFirstBoot, setIsFirstBoot] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    // Check boot status
    fetch(`${API_BASE}/auth/status`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setIsFirstBoot(data.isFirstBoot);
        if (data.isAuthenticated) {
          setIsAuthenticated(true);
          setUser(data.user);
          setLoading(false);
        } else if (!data.isFirstBoot && !invitationToken && !deployConfigToken) {
          setLoading(false);
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, [invitationToken, deployConfigToken]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#00d4ff] text-xl tracking-widest animate-pulse">INITIALIZING STARDUST LINK...</div>;

  // Enrollment flow (Invitation or First Boot)
  if (invitationToken) {
    return <SetupScreen setupToken={invitationToken} onComplete={() => window.location.href = '/'} />;
  }



  if (isFirstBoot) {
    return <FirstBootScreen onComplete={() => window.location.href = '/'} />;
  }

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => window.location.reload()} />;
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
            <DeploymentModule initialToken={deployConfigToken} />
          </motion.div>
        )}





        <h3 className="text-sm font-bold text-[#00d4ff] tracking-widest mt-6 border-b border-cyan-dark pb-2 w-max">ACTIVE DATA SHARDS</h3>
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, staggerChildren: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          <AppShard title="COMMS_HUB" mountPoint="/mnt/comms_hub" />
          <AppShard title="SENSOR_ARRAY" mountPoint="/mnt/sensors" />
        </motion.div>
      </main>

      <Footer />

      <AnimatePresence>
        {adminOpen && <AdminModal onClose={() => setAdminOpen(false)} currentUser={user} />}
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
