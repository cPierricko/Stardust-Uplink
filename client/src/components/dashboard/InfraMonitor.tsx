import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Server, Cpu, HardDrive } from 'lucide-react';
import { motion } from 'framer-motion';
import { API_BASE } from '../../config/constants';
import ShardContainerList from './ShardContainerList';

interface DockerStats {
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: string;
  };
  cpu: {
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    cores: number;
  };
  activeContainers: number;
}

export default function InfraMonitor() {
  const [stats, setStats] = useState<DockerStats | null>(null);
  const [shards, setShards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/system/docker`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setShards(data.shards || []);
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error('Failed to fetch Docker stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Jauges
  const cpuPercent = stats ? Math.min(100, (stats.cpu.loadAvg1 / stats.cpu.cores) * 100).toFixed(1) : '0';
  const ramPercent = stats ? stats.memory.usagePercent : '0';

  return (
    <div className="flex flex-col gap-6">
      {/* HEADER BANNER */}
      <div className="border border-[#00d4ff]/40 bg-black p-4 flex justify-between items-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-2 h-full bg-[#00d4ff]"></div>
        <div className="flex items-center gap-4 ml-4">
          <Server size={24} className="text-[#00d4ff]" />
          <div>
            <h2 className="text-sm font-bold text-[#00d4ff] tracking-[0.3em] uppercase">Docker_Engine</h2>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-[10px] text-green-500 font-mono tracking-widest">CONNECTED</span>
            </div>
          </div>
        </div>
        
        <button 
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-[#00d4ff]/40 text-xs font-mono text-[#00d4ff] hover:bg-[#00d4ff]/10 disabled:opacity-50 transition-colors bg-[#00d4ff]/5"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          FORCE_RESCAN
        </button>
      </div>

      {/* GAUGES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CPU GAUGE */}
        <div className="border border-cyan-dark/30 bg-black/50 p-6 flex flex-col items-center justify-center relative shadow-lg">
          <div className="absolute top-3 left-3 text-[#00d4ff]/50"><Cpu size={16} /></div>
          <div className="relative w-32 h-32 flex items-center justify-center mb-4">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#00d4ff33" strokeWidth="8" />
              <motion.circle 
                cx="50" cy="50" r="45" fill="none" stroke="#00d4ff" strokeWidth="8" strokeDasharray="283"
                initial={{ strokeDashoffset: 283 }}
                animate={{ strokeDashoffset: 283 - (283 * Number(cpuPercent)) / 100 }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-[#00d4ff]">{cpuPercent}%</span>
              <span className="text-[10px] text-[#00d4ff]/70 font-mono mt-1">CPU LOAD</span>
            </div>
          </div>
          <div className="px-3 py-1 bg-cyan-dark/10 border border-cyan-dark/30 text-[10px] text-[#00d4ff]/80 font-mono tracking-widest">
            CORES: {stats?.cpu.cores || '-'}
          </div>
        </div>

        {/* RAM GAUGE */}
        <div className="border border-cyan-dark/30 bg-black/50 p-6 flex flex-col items-center justify-center relative shadow-lg">
          <div className="absolute top-3 left-3 text-[#00d4ff]/50"><HardDrive size={16} /></div>
          <div className="relative w-32 h-32 flex items-center justify-center mb-4">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="#00d4ff33" strokeWidth="8" />
              <motion.circle 
                cx="50" cy="50" r="45" fill="none" stroke="#00d4ff" strokeWidth="8" strokeDasharray="283"
                initial={{ strokeDashoffset: 283 }}
                animate={{ strokeDashoffset: 283 - (283 * Number(ramPercent)) / 100 }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-[#00d4ff]">{ramPercent}%</span>
              <span className="text-[10px] text-[#00d4ff]/70 font-mono mt-1">RAM USAGE</span>
            </div>
          </div>
          <div className="px-3 py-1 bg-cyan-dark/10 border border-cyan-dark/30 text-[10px] text-[#00d4ff]/80 font-mono tracking-widest">
            {stats ? `${(stats.memory.used / 1024 / 1024 / 1024).toFixed(1)}GB / ${(stats.memory.total / 1024 / 1024 / 1024).toFixed(1)}GB` : '-'}
          </div>
        </div>
      </div>

      {/* SHARDS TABLE */}
      <div>
        <h3 className="text-sm font-bold text-[#00d4ff] tracking-widest mb-4 border-b border-cyan-dark/50 pb-2 w-max">DETECTED CONTAINERS</h3>
        <ShardContainerList containers={shards} />
      </div>
      
      <div className="text-right text-[10px] text-[#00d4ff]/50 font-mono tracking-widest">
        LAST_SYNC: {lastUpdate.toLocaleTimeString()}
      </div>
    </div>
  );
}
