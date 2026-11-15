/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" builds the extension against the fixture-backed mock adapter. */
  readonly VITE_MOCK_ADAPTER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
