import { useState } from 'react';
import { API_BASE } from '../../config/constants';

export default function DeploymentModule({ initialToken }) {
    const [appName, setAppName] = useState('');
    const [file, setFile] = useState(null);
    const [token, setToken] = useState(initialToken || '');
    const [status, setStatus] = useState('');
    const [progress, setProgress] = useState(0);


    const doDeploy = async () => {
        if (!file || !appName || !token) return setStatus('MISSING PARAMS');
        setStatus('ESTABLISHING UPLINK...');
        setProgress(10);

        const interval = setInterval(() => {
            setProgress(p => {
                if (p >= 90) {
                    clearInterval(interval);
                    return 90;
                }
                return p + Math.random() * 15;
            });
        }, 200);

        const fd = new FormData();
        fd.append('bundle', file);

        try {
            const res = await fetch(`${API_BASE}/deploy/${appName}`, {
                method: 'POST', headers: { 'x-deploy-token': token }, body: fd
            });
            clearInterval(interval);
            setProgress(100);
            setStatus(res.ok ? 'UPLINK SUCCESSFUL' : 'UPLINK FAILED');
        } catch (e) {
            clearInterval(interval);
            setProgress(0);
            setStatus('CONNECTION LOST');
        }
    };

    return (
        <div className="cockpit-panel p-6 border-cyan-dark hover:border-[#00d4ff]/50 transition-colors w-full">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h2 className="text-lg font-bold text-[#00d4ff] tracking-[0.15em] mb-1">{'>>'} DATA_UPLINK_MODULE</h2>
                    <p className="text-xs text-gray-400 font-mono">{status || 'AWAITING PAYLOAD...'}</p>
                </div>
                <div className="w-16 h-16 border border-[#00d4ff]/30 flex justify-center items-center relative overflow-hidden bg-[#003344]/10">
                    <div className="absolute inset-0 bg-[#00d4ff]/10 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]"></div>
                    <span className="text-[10px] text-[#00d4ff] relative z-10">UPLINK</span>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 items-end">
                <div className="flex-1 w-full space-y-4">
                    <div className="relative border border-dashed border-[#00d4ff]/40 bg-black/40 h-28 flex items-center justify-center text-xs text-gray-500 hover:border-[#00d4ff] hover:text-[#00d4ff] cursor-pointer transition-all w-full group overflow-hidden">
                        <input type="file" onChange={e => setFile(e.target.files[0])} accept=".zip" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                        <div className="absolute inset-0 bg-[#00d4ff]/5 w-0 group-hover:w-full transition-all duration-500 ease-out"></div>
                        <span className="relative z-10 tracking-widest">{file ? `[ ${file.name} ]` : '[ DROP COMPILED SHARD .ZIP ]'}</span>
                    </div>

                    <div className="w-full bg-black/50 border border-cyan-dark h-4 relative">
                        <div
                            className="absolute top-0 left-0 bottom-0 bg-[#00d4ff] transition-all duration-300 shadow-neon-cyan"
                            style={{ width: `${progress}%` }}
                        ></div>
                        <div className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white z-10 mix-blend-difference">
                            {Math.round(progress)}%
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-3 w-full lg:w-48">
                    <input type="text" value={appName} onChange={e => setAppName(e.target.value)} className="input-field text-xs py-2 bg-black/80" placeholder="SHARD_ID (e.g. comms)" />
                    <input type="password" value={token} onChange={e => setToken(e.target.value)} className="input-field text-xs py-2 bg-black/80" placeholder="ACCESS_TOKEN" />
                    <button onClick={doDeploy} className="btn-primary text-xs w-full py-2">INITIALIZE UPLINK</button>
                </div>
            </div>
        </div>
    );
}
