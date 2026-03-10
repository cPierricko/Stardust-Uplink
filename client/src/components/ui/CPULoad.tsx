import { useState, useEffect } from 'react';

export default function CPULoad() {
    const [bars, setBars] = useState<number[]>([8, 12, 10, 15, 9, 11]);
    useEffect(() => {
        const itv = setInterval(() => {
            setBars(b => b.map(v => Math.max(2, Math.min(20, v + (Math.random() > 0.5 ? 2 : -2)))));
        }, 500);
        return () => clearInterval(itv);
    }, []);

    return (
        <div className="flex gap-0.5 items-end h-8">
            {bars.map((h, i) => (
                <div key={i} className="w-1.5 bg-[#00d4ff]/40" style={{ height: `${h * 5}%` }}></div>
            ))}
        </div>
    );
}
