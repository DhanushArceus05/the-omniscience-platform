/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_API_BASE_URL: string;
  /** Optional — the AI service is not part of every phase. */
  readonly VITE_AI_SERVICE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
