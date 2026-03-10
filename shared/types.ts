export interface User {
    id: string;
    username: string;
    role: 'administrator' | 'operator';
    currentChallenge?: string;
    setupToken?: string;
}

export interface AuthStatus {
    authenticated: boolean;
    user: User | null;
}

export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface WebAuthnRegistrationResponse {
    options: any; // Ideally typed from @simplewebauthn/server
}

export interface WebAuthnAuthenticationResponse {
    options: any; // Ideally typed from @simplewebauthn/server
}

export interface AppConfig {
    id: string;
    name: string;
    path: string;
    version?: string;
    lastDeployed?: string;
    status?: 'running' | 'stopped' | 'error';
}

export interface DeployToken {
    id: string;
    token: string;
    created_at: string;
}

export type DeploymentStatus = 'idle' | 'uploading' | 'extracting' | 'completed' | 'error';


