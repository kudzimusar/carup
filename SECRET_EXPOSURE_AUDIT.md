# CarUp OS — Secret Exposure & Environment Safety Audit (Directive 009A)

This audit analyzes the exposure of cryptographic keys, database credentials, third-party API tokens, and local development configurations across the CarUp OS repository.

---

## 1. Supabase Service Role Key & Client Safety

### Findings
* **Backend Client Safety**: The master Supabase admin client (`backend/db/supabase.js`) is initialized using:
  ```js
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  ```
  This client properly operates in `service_role` mode, bypassing all Row Level Security (RLS) policies.
* **Storage Location**: The service role key is stored in the server environment (`process.env.SUPABASE_SERVICE_ROLE_KEY`) and loaded at runtime by Node.js. It is never imported or bundled into client-side files.
* **Frontend client Safety**: The frontend Vite client initialization (`web/src/App.tsx` and context structures) uses the public `VITE_SUPABASE_ANON_KEY`. This key has limited permissions and is safe to be exposed in public browsers.

---

## 2. Hardcoded Secrets in Committed Repository Files

A deep structural check was performed on all committed files (excluding `node_modules`, `.git`, `dist`, and `build`). 

### Findings
* **Session Signature Mocks**: In `backend/server.js`, a session token generator uses:
  ```js
  const token = 'sk_live_' + crypto.randomUUID().replace(/-/g, '');
  ```
  This is a **secure dynamic session generator** at runtime. It does not leak any hardcoded production keys.
* **Local Development `.env` Exposures**:
  The root `.env` file containing local dev/simulation environment secrets is currently committed to the git tree:
  * `SUPABASE_DB_PASSWORD` (database password)
  * `SUPABASE_SERVICE_ROLE_KEY` (service role token for local Supabase emulator)
  * `SUPABASE_ANON_KEY` (anonymous role token)
  * `DATABASE_URL`, `DIRECT_URL` (direct local pooler connections)
  * `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MOONSHOT_API_KEY` (AI model access keys)
  
  > [!WARNING]
  > While these keys are designated for local Docker and simulation boundaries, having private keys committed in the main repository creates a **High Risk** if this repository becomes public.
* **Frontend `.env` Exposures**:
  The client-side `web/.env` file contains ONLY the public anon key (`VITE_SUPABASE_ANON_KEY`) and the local API url. No privileged keys are exposed.

---

## 3. Vercel & Production Environment Gaps

* **Vercel Build Assumptions**: The frontend app relies on Vite building static variables (`VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) at build-time. In production, these must be configured via Vercel dashboard environment variables rather than local `.env` files.
* **Missing Fallbacks**: If environment variables are missing, the backend client initialization correctly throws an immediate startup exception, preventing silent failure:
  ```js
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.');
  }
  ```

---

## 4. Key Exposure Severity Matrix

| Risk Level | Exposure Mapped | Affected Files | Recommendation |
| :--- | :--- | :--- | :--- |
| **High** | Root `.env` committed to git tree | `.env` | Add `.env` to `.gitignore` and replace committed keys with empty configurations. |
| **Low** | Dev-mock tokens (`sk_live_`) | `backend/server.js` | None. These are dynamically generated at runtime. |
| **Negligible**| Public anon key | `web/.env` | None. This is standard public client architecture. |

---
**Audit conducted by Antigravity AI.**  
*Status: Secrets boundary verified. Immediate git cleanup recommended for `.env` files.*
