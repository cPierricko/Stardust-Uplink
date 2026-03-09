import { useState, useEffect } from 'react';

export default function DecryptingText({ text, duration = 1000 }) {
    const [displayText, setDisplayText] = useState(text);
    const chars = 'ABCDEF0123456789!@#$%^&*()_+';

    useEffect(() => {
        let start = Date.now();
        const interval = setInterval(() => {
            let now = Date.now();
            let progressed = (now - start) / duration;

            if (progressed >= 1) {
                setDisplayText(text);
                clearInterval(interval);
            } else {
                const randomText = text.split('').map((c, i) => {
                    if (Math.random() < progressed) return text[i];
                    return chars[Math.floor(Math.random() * chars.length)];
                }).join('');
                setDisplayText(randomText);
            }
        }, 50);
        return () => clearInterval(interval);
    }, [text, duration]);

    return <span>{displayText}</span>;
}
