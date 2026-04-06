import React from 'react';

interface Container {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
}

interface Props {
  containers: Container[];
}

export default function ShardContainerList({ containers }: Props) {
  if (!containers || containers.length === 0) {
    return (
      <div className="border border-dashed border-cyan-dark/40 p-8 text-center text-[10px] text-gray-500 font-mono tracking-widest uppercase">
        NO CONTAINERS DETECTED
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-cyan-dark/20 bg-black/40">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-cyan-dark/30 bg-[#00d4ff]/5">
            <th className="p-3 text-[10px] font-bold text-[#00d4ff] tracking-widest uppercase">NAME</th>
            <th className="p-3 text-[10px] font-bold text-[#00d4ff] tracking-widest uppercase">IMAGE</th>
            <th className="p-3 text-[10px] font-bold text-[#00d4ff] tracking-widest uppercase">STATUS</th>
            <th className="p-3 text-[10px] font-bold text-[#00d4ff] tracking-widest uppercase">UPTIME</th>
          </tr>
        </thead>
        <tbody>
          {containers.map(c => {
            const name = c.Names[0]?.replace(/^\//, '') || 'UNKNOWN';
            const isRunning = c.State === 'running';

            return (
              <tr key={c.Id} className="border-b border-cyan-dark/10 hover:bg-[#00d4ff]/5 transition-colors font-mono text-[10px] uppercase">
                <td className="p-3 text-white tracking-widest">{name}</td>
                <td className="p-3 text-gray-400 truncate max-w-[200px]" title={c.Image}>{c.Image}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-red-500'}`}></div>
                    <span className={isRunning ? 'text-green-500' : 'text-red-500'}>{c.State}</span>
                  </div>
                </td>
                <td className="p-3 text-gray-500">{c.Status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
