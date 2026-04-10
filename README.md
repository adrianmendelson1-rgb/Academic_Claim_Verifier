# Academic Claim Verifier

A local web app that checks whether claims in academic introductions are accurately supported by their cited sources. Powered by Claude (claude-sonnet-4-20250514) with web search.

## What it does

- Paste an introduction with inline citations
- Optionally paste your reference list and upload cited PDFs
- Click **Verify all claims** — Claude extracts every claim+citation pair, checks uploaded PDFs first, then searches the web for anything not uploaded
- Results show a verdict for each claim: ✅ Supported / 〜 Partial / ⚠️ Overstated / ❌ Not Supported / ❓ Unverifiable
- Export the full report as Word (.docx) or PDF

---

## Prerequisites

- **Node.js** v18 or later — [nodejs.org](https://nodejs.org)
- An **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com)
- (Optional) Google API credentials for Google Drive import

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add your Anthropic API key

Copy the example env file:

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in your key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Run the app

```bash
npm run dev
```

The app will start at **http://localhost:3000**.

---

## Google Drive Integration (Optional)

Google Drive lets you browse and import PDFs directly from your Drive.

### Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Enable these two APIs in **APIs & Services > Library**:
   - **Google Drive API**
   - **Google Picker API**

### Step 2 — Create OAuth 2.0 credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Application type: **Web application**
4. Authorized JavaScript origins: `http://localhost:3000`
5. Authorized redirect URIs: `http://localhost:3000/api/drive/callback`
6. Copy the **Client ID** and **Client Secret**

### Step 3 — Create an API Key

1. Click **Create Credentials > API key**
2. (Recommended) Restrict it to Google Picker API + `http://localhost:3000`
3. Copy the key

### Step 4 — Add credentials to .env.local

```
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_API_KEY=your_api_key
```

### Step 5 — Configure OAuth consent screen

1. Go to **APIs & Services > OAuth consent screen**
2. Choose **External**
3. Add scope: `https://www.googleapis.com/auth/drive.readonly`
4. Add your Google account as a **Test user**

---

## Project structure

```
app/
  page.tsx              # Main frontend UI
  layout.tsx            # Root layout
  globals.css           # Global styles
  api/
    verify/route.ts     # POST /api/verify — calls Anthropic API
    drive/route.ts      # POST /api/drive  — downloads file from Google Drive
    export/
      docx/route.ts     # POST /api/export/docx
      pdf/route.ts      # POST /api/export/pdf
lib/
  types.ts              # Shared TypeScript types
.env.local              # Your secrets (not committed)
.env.example            # Template for .env.local
```

---

## Notes

- Verification takes 30–90 seconds depending on claim count and web search needs.
- PDFs are sent to Claude as base64 document blocks (uses the `pdfs-2024-09-25` beta). Large PDFs count toward input token limits.
- The app runs entirely locally. No data is stored beyond what Claude receives during the API call.
